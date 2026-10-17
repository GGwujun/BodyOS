/**
 * 训练提醒设置 —— 本机一份,同时镜像到服务器一份。
 *
 * 为什么要放服务器:小程序的**订阅消息只能由服务端发**(客户端在用户离开小程序后
 * 没有任何执行机会,小程序也没有本地通知)。服务端要按时发就得知道:
 * 几点发、按哪个时区算、还剩几次可发 —— 这些都跟着账号走,换手机不用重设。
 *
 * 时区为什么要一起存:服务端拿的是 UTC 时间,而「晚上 8 点提醒我」说的是**用户那边**的
 * 8 点 —— 出差到别的时区时,该按新时区算(手机上的 8 点才是真的 8 点),所以每次保存
 * 都重新上报当前偏移。东八区 = 480,注意不是 `getTimezoneOffset()` 的 -480。
 */
import Taro from '@tarojs/taro';

const K_REMINDER = 'bodyos.training.reminder';

/**
 * 提醒语气 —— 「温和 / 幽默 / 打气」这套词表住在**主包**。
 *
 * 理由是方向:存进设置里的 `tone` 得先有一个权威说法(哪些值算数、认不出来退回哪一档),
 * 而设置这一层在主包;分包 `engine/nudge.ts` 只是拿它去挑文案。全项目一直是
 * **「分包 engine → 主包 utils」**这一个方向(`nudge.ts` 引 `utils/date` 同理),
 * 让主包反过来 import 分包会把这层关系搅乱 —— 而且引的是个不碰动作库的小模块,
 * 真要出事(哪天 nudge 顺手引了动作库)是**主包体积被悄悄拽大**,不报错。
 */
export type NudgeTone = 'gentle' | 'fun' | 'cheer';
export const NUDGE_TONES: NudgeTone[] = ['gentle', 'fun', 'cheer'];
export const DEFAULT_TONE: NudgeTone = 'gentle';

/** 认不出来的语气一律退回默认 —— 这个值可能是从服务器回来的(那份只是照发的镜像,不是可信来源) */
export function toneOf(v: unknown): NudgeTone {
  return NUDGE_TONES.includes(v as NudgeTone) ? (v as NudgeTone) : DEFAULT_TONE;
}

export interface ReminderSettings {
  /** 订阅消息提醒(要用户亲手点一下授权才发得出去) */
  enabled: boolean;
  /** 本地时间的 'HH:mm' */
  time: string;
  /** 提醒语气(本机卡片也用它) */
  tone: NudgeTone;
  /** 计划日没练的当晚再补一次 */
  nudge: boolean;
  /** 相对 UTC 的分钟数(东八区 = 480) */
  tzOffsetMin: number;
}

/* ---------------- 服务端下发的那一份(模板 id + 剩余额度) ---------------- */

const K_REMINDER_SERVER = 'bodyos.training.reminder.server';

/**
 * 模板 id 和剩余额度都是**服务端才知道**的,但练完补领授权时来不及先发请求
 * (微信要求 requestSubscribeMessage 紧跟用户点击),所以上一次同步到的值要留在本机。
 */
export interface ReminderServerState {
  /** 服务端下发的订阅消息模板 id;空串 = 后台没配或还没同步过 */
  tmplId: string;
  /** 上次从服务端读到的剩余可发条数 */
  grants: number;
}

export const EMPTY_REMINDER_SERVER: ReminderServerState = { tmplId: '', grants: 0 };

export function loadReminderServer(): ReminderServerState {
  const raw = Taro.getStorageSync(K_REMINDER_SERVER);
  if (!raw || typeof raw !== 'object') return { ...EMPTY_REMINDER_SERVER };
  const r = raw as Partial<ReminderServerState>;
  return {
    tmplId: typeof r.tmplId === 'string' ? r.tmplId : '',
    // 额度只可能是非负整数;脏值按 0 算 —— 宁可多问一次授权,也别拿坏数据去发请求
    grants: typeof r.grants === 'number' && Number.isFinite(r.grants) ? Math.max(0, Math.floor(r.grants)) : 0
  };
}

export function saveReminderServer(patch: Partial<ReminderServerState>): ReminderServerState {
  const prev = loadReminderServer();
  const next: ReminderServerState = {
    tmplId: patch.tmplId === undefined ? prev.tmplId : (typeof patch.tmplId === 'string' ? patch.tmplId : prev.tmplId),
    grants: patch.grants === undefined
      ? prev.grants
      : (typeof patch.grants === 'number' && Number.isFinite(patch.grants) ? Math.max(0, Math.floor(patch.grants)) : prev.grants)
  };
  Taro.setStorageSync(K_REMINDER_SERVER, next);
  return next;
}

/**
 * 练完要不要顺手补领一条?三个条件缺一不可:
 * 提醒开着、知道模板 id、而且本机记着的额度已经用光。
 *
 * 为什么卡在「额度为 0」而不是每次都问:一次性订阅每授权一次只多一条,
 * 用户没勾「总是保持以上选择」时每次调用都会弹窗 —— 有额度还弹就是纯打扰。
 * 额度为 0 时弹这一次是必要的,否则下一条提醒就发不出去了。
 */
export function needsReminderTopUp(
  settings: ReminderSettings = loadReminder(),
  server: ReminderServerState = loadReminderServer()
): boolean {
  return settings.enabled && !!server.tmplId && server.grants <= 0;
}

export const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  time: '20:00',
  tone: DEFAULT_TONE,
  nudge: true,
  tzOffsetMin: 480
};

/** 提醒时刻的候选项。健身房的现实:早上练的人要早提醒,晚上练的人八点提醒等于催他出门 */
export const TIME_CHOICES = ['07:00', '08:00', '12:00', '17:00', '19:00', '20:00', '21:00', '22:00'];

/** 当前时区相对 UTC 的分钟数(东八区 → 480) */
export function tzOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}

export function validTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/**
 * '20:00' → '晚上 8:00'。Picker 里光看 20:00 不够直观。
 *
 * 分钟一律照写(不把 8:00 缩成 8):同一列里一会儿「晚上 8」一会儿「晚上 8:30」
 * 反而不好扫,而且单说「晚上 8」到底指 8 点还是个序号说不清。
 * 认不出来的值原样返回 —— 宁可不美化,也不能把用户设的时间显示成别的。
 */
export function hhmmText(v: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '');
  if (!m) return v || '';
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const part = h < 6 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
  return `${part} ${h12}:${m[2]}`;
}

/**
 * 本机存过设置没有?—— 决定「本机」和「服务器」谁是设置的真源。
 *
 * 规则:本机存过 → 本机说了算(服务器只是照着发,它从来不是设置的编辑入口);
 * 本机一片空白(换手机、重装)→ 服务器上那份才是用户最后的样子。
 * 少了这道判断,离线改过设置的人下次一联网打开这页就会被服务器上的旧值**悄悄改回去**。
 */
export function hasLocalReminder(): boolean {
  const raw = Taro.getStorageSync(K_REMINDER);
  return !!raw && typeof raw === 'object';
}

export function loadReminder(): ReminderSettings {
  const raw = Taro.getStorageSync(K_REMINDER);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_REMINDER };
  const r = raw as Partial<ReminderSettings>;
  return {
    enabled: !!r.enabled,
    time: validTime(r.time) ? r.time : DEFAULT_REMINDER.time,
    tone: toneOf(r.tone),
    nudge: r.nudge === undefined ? DEFAULT_REMINDER.nudge : !!r.nudge,
    tzOffsetMin: typeof r.tzOffsetMin === 'number' ? r.tzOffsetMin : tzOffsetMin()
  };
}

/**
 * 可以只改其中几项。
 * `time`/`tone` 放宽成 unknown:它们会**原样从服务器回来**(服务器只是照发的镜像,不是可信来源),
 * 类型上写死成 'HH:mm' / 语气枚举等于假装服务器一定会守规矩 —— 校验放在 saveReminder 里做,
 * 不在调用点上做。
 */
export type ReminderPatch = Partial<Omit<ReminderSettings, 'time' | 'tone'>> & { time?: unknown; tone?: unknown };

/**
 * 唯一的写入路径 —— 所以脏数据在这里就该被挡掉,而不是指望每个调用方自己先校验。
 */
export function saveReminder(patch: ReminderPatch): ReminderSettings {
  const prev = loadReminder();
  const next: ReminderSettings = {
    // 没传的字段一律保留原值 —— 只改语气不该顺手把开关关掉
    enabled: patch.enabled === undefined ? prev.enabled : !!patch.enabled,
    time: validTime(patch.time) ? patch.time : prev.time,
    tone: toneOf(patch.tone ?? prev.tone),
    nudge: patch.nudge === undefined ? prev.nudge : !!patch.nudge,
    // 时区每次都重新取:出差到别的时区,该按新的算
    tzOffsetMin: tzOffsetMin()
  };
  Taro.setStorageSync(K_REMINDER, next);
  return next;
}
