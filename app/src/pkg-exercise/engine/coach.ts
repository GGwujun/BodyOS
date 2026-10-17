/**
 * 训练教练 —— 他记得你答过什么、给过哪几版方案、你最后要了哪一版。
 *
 * 这里和 `ai/chat` 那条饮食问答**不是一件事**:那条是问一句答一句,不留方案;
 * 教练的产物是一份能被导入的动作安排 —— 进了计划之后,组次、渐进、日程全都按
 * 普通计划走。所以这一份状态只存三样东西:
 *
 *   · **你答过什么**(profile):目标、经验、器械、每周几天、想避开什么;
 *   · **他给过的方案**(pending + history):没决定的只留最后一版,定了的留档;
 *   · **说过的话**(messages):用户看得见的对话,不存思考过程。
 *
 * 为什么整份存在本机而不是服务端:方案最终是 `TrainingPlan`,而计划本身就在本机
 * (见 store.ts)。把提案放服务端会出现「方案在云上、导入却要用本机动作库」的两套
 * 真相;教练不导入就什么都没有,也就没有要同步的东西。等用户导入,计划自己会同步。
 *
 * **红线**:这个文件里会出现在界面上的字,不许有「AI/智能/大模型/智谱」。
 * 用户看见的是一个教练,不是模型。
 */
import Taro from '@tarojs/taro';
import { START_NOTE, estMinutes, findExercise, generatePlan } from './generator';
import { WEEKDAY_ZH, scheduleOf } from './schedule';
import type { EquipAccess, Goal, Level, PlanDay, PlanSchedule, TrainingPlan } from './types';
import { ACCESS_ZH, GOAL_ZH, LEVEL_ZH } from './types';

const KEY = 'bodyos.training.coach';
/** 只留最近这么多份已决定的方案 —— 再往前的通常已经和当前计划对不上了 */
const HISTORY_CAP = 20;
/** 一句话能带回多少条限制:再多就不该靠匹配,应该去动作库自己删 */
const LIMIT_MAX = 10;

/** 教练问过的那几题 —— 和生成器真正吃进去的参数一一对应,不多问用不上的 */
export interface CoachProfile {
  goal: Goal;
  level: Level;
  access: EquipAccess;
  daysPerWeek: number;
  sessionMin: number;
  /** 想排哪几天(0 = 周一 … 6 = 周日)。空 = 按天数铺开 */
  preferredDays: number[];
  /** 想避开的动作名(逗号/顿号隔开),比如「引体向上、硬拉」 */
  limitations: string;
}

export interface CoachMessage {
  id: string;
  at: string;
  role: 'coach' | 'user';
  kind: 'text' | 'intake' | 'applied' | 'dismissed';
  text: string;
}

export interface CoachProposal {
  id: string;
  at: string;
  /** 第几版 —— 改一次加一,让「这是第 2 版」说得出来 */
  iteration: number;
  plan: TrainingPlan;
  summary: string;
  /** 这份方案是按什么排的、导入后会发生什么 */
  basedOn: string;
  status: 'pending' | 'imported' | 'dismissed';
  /**
   * 导入时被替换掉的那份计划。存下来才有「撤回」可言 —— 用户导入后可能马上发现排得不对,
   * 而那时旧计划已经被覆盖了;没有这一格,撤回只能是一句空话。
   */
  prevPlan?: TrainingPlan;
}

export interface CoachState {
  profile: CoachProfile | null;
  messages: CoachMessage[];
  /** 当前待决定的方案 —— 同一时间只有一份 */
  pending: CoachProposal | null;
  /** 已经导入/丢弃的方案,新的在前 */
  history: CoachProposal[];
}

const GREETING = '我是你的训练教练。先回答几个问题,我按你的目标、经验和器械排一版;你点头之前不会动你现在的计划。';

export function emptyCoach(): CoachState {
  return {
    profile: null,
    messages: [{
      id: `hello-${Date.now()}`,
      at: new Date().toISOString(),
      role: 'coach',
      kind: 'text',
      text: GREETING
    }],
    pending: null,
    history: []
  };
}

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function message(role: CoachMessage['role'], kind: CoachMessage['kind'], text: string): CoachMessage {
  return { id: newId('msg'), at: new Date().toISOString(), role, kind, text };
}

/* ============================ 读 / 写 ============================ */

const GOALS: Goal[] = ['fatloss', 'muscle', 'endurance'];
const LEVELS: Level[] = ['beginner', 'intermediate'];
const ACCESSES: EquipAccess[] = ['body', 'dumbbell', 'home', 'gym'];

function saneProfile(raw: unknown): CoachProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as CoachProfile;
  if (!GOALS.includes(p.goal) || !LEVELS.includes(p.level) || !ACCESSES.includes(p.access)) return null;
  const days = Math.min(6, Math.max(2, Math.round(Number(p.daysPerWeek) || 3)));
  const min = Math.min(120, Math.max(15, Math.round(Number(p.sessionMin) || 45)));
  const preferred = Array.isArray(p.preferredDays)
    ? [...new Set(p.preferredDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  return {
    goal: p.goal,
    level: p.level,
    access: p.access,
    daysPerWeek: days,
    sessionMin: min,
    preferredDays: preferred,
    limitations: typeof p.limitations === 'string' ? p.limitations.slice(0, 120) : ''
  };
}

function sanePlan(raw: unknown): TrainingPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as TrainingPlan;
  if (typeof p.id !== 'string' || !Array.isArray(p.days)) return null;
  const days = p.days.filter((d): d is PlanDay =>
    !!d && typeof d.key === 'string' && typeof d.title === 'string' && Array.isArray(d.items));
  if (!days.length) return null;
  // 逐项摸一遍 UI 会直接取用的字段;坏了就整份不要,而不是让一张卡渲染到一半抛出来
  for (const d of days) {
    for (const it of d.items) {
      if (!it || typeof it.exerciseId !== 'string' || typeof it.nameZh !== 'string') return null;
    }
  }
  return { ...p, days };
}

function saneProposal(raw: unknown, status?: CoachProposal['status']): CoachProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as CoachProposal;
  const plan = sanePlan(p.plan);
  if (!plan || typeof p.id !== 'string') return null;
  return {
    id: p.id,
    at: typeof p.at === 'string' ? p.at : new Date().toISOString(),
    iteration: Number.isFinite(p.iteration) ? Math.max(1, Math.round(p.iteration)) : 1,
    plan,
    summary: typeof p.summary === 'string' ? p.summary.slice(0, 300) : '',
    basedOn: typeof p.basedOn === 'string' ? p.basedOn.slice(0, 300) : '',
    status: status ?? (p.status === 'imported' || p.status === 'dismissed' ? p.status : 'pending'),
    // 旧版本存下的提案没有这一格 —— 没有就不能撤回,而不是撤回成一份空计划
    prevPlan: sanePlan(p.prevPlan) ?? undefined
  };
}

function saneMessage(raw: unknown): CoachMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as CoachMessage;
  if (typeof m.text !== 'string' || !m.text) return null;
  if (m.role !== 'coach' && m.role !== 'user') return null;
  if (!['text', 'intake', 'applied', 'dismissed'].includes(m.kind)) return null;
  return {
    id: typeof m.id === 'string' ? m.id : newId('msg'),
    at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
    role: m.role,
    kind: m.kind,
    text: m.text.slice(0, 2000)
  };
}

/** 读这份状态。**坏了就重开一份**,而不是把页面卡在半个对象上 */
export function loadCoach(): CoachState {
  let raw: unknown;
  try {
    raw = Taro.getStorageSync(KEY);
  } catch {
    return emptyCoach();
  }
  if (!raw || typeof raw !== 'object') return emptyCoach();
  const s = raw as CoachState;
  const messages = Array.isArray(s.messages)
    ? s.messages.map(saneMessage).filter((m): m is CoachMessage => !!m).slice(-200)
    : [];
  return {
    profile: saneProfile(s.profile),
    // 对话记录整段坏掉时补回开场白:页面不是从一块空白开始的,不然用户不知道该说什么
    messages: messages.length ? messages : emptyCoach().messages,
    pending: saneProposal(s.pending),
    history: Array.isArray(s.history)
      ? s.history.map((p) => saneProposal(p)).filter((p): p is CoachProposal => !!p).slice(0, HISTORY_CAP)
      : []
  };
}

export function saveCoach(s: CoachState): void {
  try {
    // 对话可以一直聊,但存储不该一直涨 —— 和 loadCoach 那边的 200 条同一口径
    Taro.setStorageSync(KEY, { ...s, messages: s.messages.slice(-200) });
  } catch {
    // 写不进去只影响下次打开看不到这段对话 —— 不该把正在选方案的人卡住
  }
}

/* ============================ 排一版 ============================ */

/** 常见的每周铺法(2-6 练),用户没指定哪几天时用 */
const DEFAULT_WEEK: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5]
};

/**
 * 把几套训练日排进一周。
 * 用户点过的日子优先;不够的按默认铺法补齐,不把两套硬塞进同一天 ——
 * 合并训练是计划页的功能,但教练的初版应该先给出最清楚的一周。
 */
export function buildWeek(keys: string[], preferred: number[]): string[][] {
  const n = keys.length;
  let slots = [...new Set(preferred)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (slots.length > n) slots = slots.slice(0, n);
  if (slots.length < n) {
    for (const dow of DEFAULT_WEEK[n] ?? [0, 2, 4, 5, 6, 1, 3]) {
      if (slots.length >= n) break;
      if (!slots.includes(dow)) slots.push(dow);
    }
    slots.sort((a, b) => a - b);
  }
  const week = Array.from({ length: 7 }, () => [] as string[]);
  keys.forEach((key, i) => {
    if (slots[i] != null) week[slots[i]].push(key);
  });
  return week;
}

/** 「引体向上、硬拉,深蹲不能做」→ ['引体向上','硬拉','深蹲'] */
export function parseLimitations(text: string): string[] {
  return text
    .split(/[,，、;；\n/]+/)
    .map((s) => s.trim().replace(/^(不要|不能做|不想练|避开|别做)\s*/g, ''))
    .filter((s) => s.length >= 2 && s.length <= 20)
    .slice(0, LIMIT_MAX);
}

const limitHits = (name: string, limits: string[]): boolean =>
  limits.some((x) => name.includes(x) || x.includes(name));

/**
 * 想避开的动作:优先在同一个动作的备选里换一个,没有备选就从这一天拿掉。
 * 这不是医生,读不懂「膝盖不舒服」—— 所以界面上写的是**动作名**:
 * 能照着做的事就老实做,读不懂的不假装懂(见 intake 的提示)。
 */
function applyLimitations(plan: TrainingPlan, limits: string[]): TrainingPlan {
  if (!limits.length) return plan;
  const days = plan.days.map((d) => {
    const items = d.items.flatMap((it) => {
      if (!limitHits(it.nameZh, limits)) return [it];
      const alt = (it.alternates ?? [])
        .map((id) => findExercise(id))
        .find((ex) => ex && !limitHits(ex.nameZh, limits));
      // 备选沿用这一项的处方:组数/次数/休息是教练为这个槽位定的,不是动作自带的
      if (alt) return [{ ...it, exerciseId: alt.id, nameZh: alt.nameZh }];
      return [];
    });
    return { ...d, items, estMin: estMinutes(items) };
  });
  return { ...plan, days };
}

/**
 * 排一版方案。生成器是纯函数,同样的回答永远得到同样的安排 ——
 * 这对教练是好事:第 1 版和第 2 版只差用户改掉的那一项,不会每次都换一批动作
 * 让人没法比较。要换动作是动作库里「换一个」的事。
 */
export function makeProposal(profile: CoachProfile, iteration: number): CoachProposal {
  const limits = parseLimitations(profile.limitations);
  const plan = applyLimitations(generatePlan({
    goal: profile.goal,
    level: profile.level,
    access: profile.access,
    daysPerWeek: profile.daysPerWeek,
    sessionMin: profile.sessionMin
  }), limits);
  const keys = plan.days.map((d) => d.key);
  const week = buildWeek(keys, profile.preferredDays);
  const withSchedule: TrainingPlan = {
    ...plan,
    id: `coach-${Date.now()}`,
    createdAt: new Date().toISOString(),
    lastNote: `${START_NOTE}${limits.length ? ` 已避开:${limits.join('、')}。` : ''}`,
    schedule: { mode: 'week', week, rotation: keys }
  };
  const trainingDays = week
    .map((ks, dow) => (ks.length ? WEEKDAY_ZH[dow] : ''))
    .filter(Boolean)
    .join('、');
  const summary = `${GOAL_ZH[profile.goal]} · 每周 ${plan.days.length} 练${trainingDays ? `(${trainingDays})` : ''} · 单次约 ${profile.sessionMin} 分钟`;
  const basedOn = `按「${ACCESS_ZH[profile.access]}」条件编排;导入后每练完一次,重量和次数会按你的表现自己往前调。`;
  return {
    id: newId('proposal'),
    at: new Date().toISOString(),
    iteration,
    plan: withSchedule,
    summary,
    basedOn,
    status: 'pending'
  };
}

/**
 * 导入时「不使用这份周计划」的那条路 —— 动作换掉,原来的日程尽量留着。
 *
 * 两边的训练日 key 不一定对得上(老计划叫「推日」,新方案可能叫「全身 A」),所以
 * 要按新计划过滤一遍。过滤完什么都不剩的时候才退回「新训练日按顺序轮转」:
 * 留着一份全是空 key 的固定周,等于导入完一个没有日程的计划。
 */
export function scheduleForImport(oldPlan: TrainingPlan | null, plan: TrainingPlan): PlanSchedule {
  const keys = new Set(plan.days.map((d) => d.key));
  const old = scheduleOf(oldPlan);
  const week = old.week.map((ks) => ks.filter((k) => keys.has(k)));
  let rotation = old.rotation.filter((k) => keys.has(k));
  let mode: PlanSchedule['mode'] = old.mode;
  if (!week.some((ks) => ks.length)) {
    mode = 'rotation';
    if (!rotation.length) rotation = plan.days.map((d) => d.key);
  }
  return { mode, week, rotation };
}

/** 输入卡上那几行「我的回答」 */
export function intakeLines(p: CoachProfile): string[] {
  const limits = parseLimitations(p.limitations);
  const days = p.preferredDays.length ? `(${p.preferredDays.map((d) => WEEKDAY_ZH[d]).join('、')})` : '';
  return [
    `目标:${GOAL_ZH[p.goal]}`,
    `经验:${LEVEL_ZH[p.level]}`,
    `每周 ${p.daysPerWeek} 练${days} · 单次约 ${p.sessionMin} 分钟`,
    `器械:${ACCESS_ZH[p.access]}`,
    ...(limits.length ? [`避开:${limits.join('、')}`] : [])
  ];
}

/* ============================ 改一改 ============================ */

const clean = (t: string) => t.trim().slice(0, 300);

/**
 * 从一句话里读出能落到参数上的改动。
 * **只认说得准的几种**(天数/时长/目标/经验/器械/星期),别的一律不猜 ——
 * 猜错的计划比不改更糟。返回的 `changes` 是要给用户看的那几句话。
 */
export function refineProfile(p: CoachProfile, text: string): { profile: CoachProfile; changes: string[] } {
  const s = clean(text);
  const next: CoachProfile = { ...p, preferredDays: [...p.preferredDays] };
  const changes: string[] = [];

  if (/少一天|减一天/.test(s)) {
    const v = Math.max(2, next.daysPerWeek - 1);
    if (v !== next.daysPerWeek) { next.daysPerWeek = v; changes.push(`每周改成 ${v} 练`); }
  } else if (/多一天|加一天/.test(s)) {
    const v = Math.min(6, next.daysPerWeek + 1);
    if (v !== next.daysPerWeek) { next.daysPerWeek = v; changes.push(`每周改成 ${v} 练`); }
  }
  const dayMatch = s.match(/(?:每周|一周|练)\s*([2-6])\s*天/) ?? s.match(/([2-6])\s*练/);
  if (dayMatch) {
    const v = Number(dayMatch[1]);
    if (v !== next.daysPerWeek) { next.daysPerWeek = v; changes.push(`每周改成 ${v} 练`); }
  }

  if (/半小时/.test(s)) {
    if (next.sessionMin !== 30) { next.sessionMin = 30; changes.push('单次改成 30 分钟'); }
  } else if (/一小时|1\s*小时/.test(s)) {
    if (next.sessionMin !== 60) { next.sessionMin = 60; changes.push('单次改成 60 分钟'); }
  } else {
    const minMatch = s.match(/(\d{2,3})\s*分钟/);
    if (minMatch) {
      const v = Math.min(120, Math.max(15, Number(minMatch[1])));
      if (v !== next.sessionMin) { next.sessionMin = v; changes.push(`单次改成 ${v} 分钟`); }
    }
  }

  const goal: [RegExp, Goal, string][] = [
    [/增肌|肌肉|变壮/, 'muscle', '增肌'],
    [/减脂|减重|减肥|瘦/, 'fatloss', '减脂'],
    [/耐力|体能|心肺/, 'endurance', '耐力']
  ];
  for (const [re, v, label] of goal) {
    if (re.test(s) && next.goal !== v) { next.goal = v; changes.push(`目标改成${label}`); break; }
  }

  const level: [RegExp, Level, string][] = [
    [/新手|入门|刚开始/, 'beginner', '入门'],
    [/有经验|进阶|练过一阵/, 'intermediate', '进阶']
  ];
  for (const [re, v, label] of level) {
    if (re.test(s) && next.level !== v) { next.level = v; changes.push(`经验改成${label}`); break; }
  }

  const access: [RegExp, EquipAccess, string][] = [
    [/健身房|器械齐全|去练/, 'gym', '健身房'],
    [/徒手|自重/, 'body', '徒手'],
    [/哑铃/, 'dumbbell', '哑铃'],
    [/家里|居家|在家/, 'home', '居家']
  ];
  for (const [re, v, label] of access) {
    if (re.test(s) && next.access !== v) { next.access = v; changes.push(`器械改成${label}`); break; }
  }

  if (/工作日/.test(s)) {
    next.preferredDays = [0, 1, 2, 3, 4];
    changes.push('排在周一到周五');
  } else if (/周末/.test(s)) {
    next.preferredDays = [5, 6];
    changes.push('排在周六、周日');
  } else {
    const order = ['一', '二', '三', '四', '五', '六', '日'];
    const found: number[] = [];
    const re = /周([一二三四五六日天])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const v = m[1] === '天' ? 6 : order.indexOf(m[1]);
      if (v >= 0 && !found.includes(v)) found.push(v);
    }
    if (found.length) {
      next.preferredDays = found.sort((a, b) => a - b);
      changes.push(`排在${found.map((d) => WEEKDAY_ZH[d]).join('、')}`);
    }
  }

  return { profile: next, changes };
}

/** 说完一句但没有可落地的改动 —— 告诉用户哪些话是听得懂的,别让人对着输入框猜 */
export const REFINE_HINT = '这句话里没有能直接改的参数。可以直接说「每周 4 练」「40 分钟」「换哑铃」「增肌」「排周末」;要避开某个动作,点右上角调整回答。';
