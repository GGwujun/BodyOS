import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { USER_ID } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr, toDateStr, addDays } from '../lib/date';
import { recomputeDaily } from '../engine';
import { parseActivity, dailyAnalysis, weeklyAnalysis } from '../ai/prompts';
import { recognizeAndCalculate } from '../ai/foodRecognition';
import { buildCoachContext, ChatInputSchema } from '../ai/coachContext';
import { completeCoachTurn } from '../ai/coachTurn';

const router = Router();

/** POST /ai/food/parse — 文本/图片解析,返回需用户确认的条目 */
const FoodParseSchema = z.object({
  text: z.string().optional(),
  image: z.string().optional()
});

router.post('/food/parse', async (req, res) => {
  const parsed = FoodParseSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');
  try {
    // 三阶段:识别 → 查表 → 计算；失败时不生成替代数据。
    const result = await recognizeAndCalculate(parsed.data.text, parsed.data.image);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, (e as Error).message, { affectsData: false });
  }
});

/** POST /ai/activity/parse — 自然语言解析运动 */
router.post('/activity/parse', async (req, res) => {
  const text = (req.body?.text as string) || '';
  if (!text) return err(res, 400, 'text 必填');
  try {
    const result = await parseActivity(text);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, (e as Error).message, { affectsData: false });
  }
});

/** POST /ai/daily-analysis — 后端取当日 DailySummary 后分析 */
router.post('/daily-analysis', async (req, res) => {
  const dateStr = (req.body?.date as string) || todayStr();
  try {
    const summary = await recomputeDaily(USER_ID, dateStr);
    const result = await dailyAnalysis(summary);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, (e as Error).message, { affectsData: false });
  }
});

/** POST /ai/weekly-analysis — 后端取 7 天汇总后生成周报 */
router.post('/weekly-analysis', async (req, res) => {
  const weekStart = (req.body?.weekStart as string) || addDays(todayStr(), -6);
  try {
    const days = Array.from({ length: 7 }, (_, i) => toDate(addDays(weekStart, i)));
    const summaries = await prisma.dailySummary.findMany({
      where: { userId: USER_ID, date: { in: days } }
    });
    const goal = await prisma.goal.findFirst({
      where: { userId: USER_ID, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    const result = await weeklyAnalysis({ summaries, goal });
    return ok(res, result);
  } catch (e) {
    return err(res, 500, (e as Error).message, { affectsData: false });
  }
});

/** POST /ai/chat — 后端拼上下文 + 持久化对话 */
router.post('/chat', async (req, res) => {
  const parsed = ChatInputSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  try {
  // Saved server data is authoritative; caller context cannot replace health facts.
  const today = todayStr();
    const profile = await prisma.userProfile.findUnique({where:{userId:USER_ID}});
    const summary = await recomputeDaily(USER_ID, today);
    const goal = await prisma.goal.findFirst({
      where: { userId: USER_ID, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    const recent = await prisma.dailySummary.findMany({
      where: {
        userId: USER_ID,
        date: { in: [0, 1, 2].map((d) => toDate(addDays(today, -d))) }
      },
      orderBy: { date: 'asc' }
    });
    const context = buildCoachContext(profile, {
      today: {
        bodyScore: summary.bodyScore,
        intakeCalories: summary.intakeCalories,
        burnCalories: summary.burnCalories,
        netCalories: summary.netCalories,
        nutrition: summary.nutrition,
        steps: summary.steps
      },
      goal,
      recentTrend: recent.map((s) => ({
        date: toDateStr(s.date),
        bodyScore: s.bodyScore,
        netCalories: s.netCalories
      }))
    });

    // 只取前端最新一条 user 消息,历史由后端从 DB 拼(保证多轮连贯)
    const lastUser = [...parsed.data.messages].reverse().find((m) => m.role === 'user');
    const userContent = lastUser?.content ?? '';

    // History includes only persisted turns. The current message is appended in memory.
    const conversations = await prisma.aIConversation.findMany({
      where: { userId: USER_ID },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { role: true, content: true }
    });
    const history = conversations
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const reply = await completeCoachTurn(history, userContent, context, response =>
      prisma.$transaction(async tx => {
        await tx.aIConversation.create({data:{userId:USER_ID,role:'user',content:userContent}});
        await tx.aIConversation.create({data:{userId:USER_ID,role:'assistant',content:response,context:context as never}});
      })
    );
    return ok(res, { reply });
  } catch (e) {
    return err(res, 500, (e as Error).message, { affectsData: false });
  }
});

/** GET /ai/chat/history — 拉取最近对话 */
router.get('/chat/history', async (req, res) => {
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const messages = await prisma.aIConversation.findMany({
    where: { userId: USER_ID },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  return ok(res, messages.reverse());
});

export default router;
