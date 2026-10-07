import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { toDate, todayStr, toDateStr, addDays, isValidDateStr } from '../lib/date';
import { recomputeDaily } from '../engine';
import { parseActivity, dailyAnalysis, weeklyAnalysis } from '../ai/prompts';
import { recognizeAndCalculate } from '../ai/foodRecognition';
import { buildCoachContext, ChatInputSchema } from '../ai/coachContext';
import { completeCoachTurn } from '../ai/coachTurn';
import { wrap } from '../lib/asyncHandler';
import { isUserError, fallbackMessage } from '../lib/userError';

const router = Router();

/** POST /ai/food/parse — 文本/图片解析,返回需用户确认的条目 */
const FoodParseSchema = z.object({
  text: z.string().max(500).optional(),
  image: z.string().max(6_000_000).optional() // base64 图片,与 index.ts json 上限配套
});

router.post('/food/parse', wrap(async (req, res) => {
  const parsed = FoodParseSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');
  if (!parsed.data.text?.trim() && !parsed.data.image) {
    return err(res, 400, '请提供食物描述或图片', { affectsData: false });
  }
  try {
    // 三阶段:识别 → 查表 → 计算；失败时不生成替代数据。
    const result = await recognizeAndCalculate(parsed.data.text, parsed.data.image);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, isUserError(e) ? e.message : fallbackMessage('ai/food/parse', e), { affectsData: false });
  }
}));

/** POST /ai/activity/parse — 自然语言解析运动 */
router.post('/activity/parse', wrap(async (req, res) => {
  const text = ((req.body?.text as string) || '').slice(0, 200);
  if (!text.trim()) return err(res, 400, 'text 必填');
  try {
    const result = await parseActivity(text);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, isUserError(e) ? e.message : fallbackMessage('ai/activity/parse', e), { affectsData: false });
  }
}));

/** POST /ai/daily-analysis — 后端取当日 DailySummary 后分析 */
router.post('/daily-analysis', wrap(async (req, res) => {
  const dateStr = (req.body?.date as string) || todayStr();
  if (!isValidDateStr(dateStr)) return err(res, 400, 'date 格式应为 YYYY-MM-DD');
  try {
    const summary = await recomputeDaily(getUserId(res), dateStr);
    const result = await dailyAnalysis(summary);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, isUserError(e) ? e.message : fallbackMessage('ai/daily-analysis', e), { affectsData: false });
  }
}));

/** POST /ai/weekly-analysis — 后端取 7 天汇总后生成周报 */
router.post('/weekly-analysis', wrap(async (req, res) => {
  const weekStart = (req.body?.weekStart as string) || addDays(todayStr(), -6);
  if (!isValidDateStr(weekStart)) return err(res, 400, 'weekStart 格式应为 YYYY-MM-DD');
  try {
    const days = Array.from({ length: 7 }, (_, i) => toDate(addDays(weekStart, i)));
    const summaries = await prisma.dailySummary.findMany({
      where: { userId: getUserId(res), date: { in: days } }
    });
    const goal = await prisma.goal.findFirst({
      where: { userId: getUserId(res), isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    const result = await weeklyAnalysis({ summaries, goal });
    return ok(res, result);
  } catch (e) {
    return err(res, 500, isUserError(e) ? e.message : fallbackMessage('ai/weekly-analysis', e), { affectsData: false });
  }
}));

/** POST /ai/chat — 后端拼上下文 + 持久化对话 */
router.post('/chat', wrap(async (req, res) => {
  const parsed = ChatInputSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '参数错误');

  try {
  // Saved server data is authoritative; caller context cannot replace health facts.
  const today = todayStr();
    const profile = await prisma.userProfile.findUnique({where:{userId:getUserId(res)}});
    const summary = await recomputeDaily(getUserId(res), today);
    const goal = await prisma.goal.findFirst({
      where: { userId: getUserId(res), isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    const recent = await prisma.dailySummary.findMany({
      where: {
        userId: getUserId(res),
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
      where: { userId: getUserId(res) },
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
        await tx.aIConversation.create({data:{userId:getUserId(res),role:'user',content:userContent}});
        await tx.aIConversation.create({data:{userId:getUserId(res),role:'assistant',content:response,context:context as never}});
      })
    );
    return ok(res, { reply });
  } catch (e) {
    return err(res, 500, isUserError(e) ? e.message : fallbackMessage('ai/chat', e), { affectsData: false });
  }
}));

/** GET /ai/chat/history — 拉取最近对话 */
router.get('/chat/history', wrap(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const messages = await prisma.aIConversation.findMany({
    where: { userId: getUserId(res) },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  return ok(res, messages.reverse());
}));

export default router;
