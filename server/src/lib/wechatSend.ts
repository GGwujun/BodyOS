/**
 * 服务端发微信订阅消息。
 *
 * 为什么必须由服务端发:小程序没有本地通知,用户离开小程序后客户端没有任何执行机会。
 * 想让「晚上 8 点提醒我练」真的到点响,只能服务端拿着用户授权过的**一次发送额度**
 * 调微信接口推给他。
 *
 * 两道前置闸门,任一不满足就静默不发(而不是给用户报错):
 *   1. 小程序后台「订阅消息」里申请到模板,模板 id 配到 WECHAT_TMPL_TRAINING;
 *   2. 用户点过授权 —— 微信的规矩是**一次授权只能发一条**,发完额度就没了,
 *      所以客户端每次练完都会顺口问一句要不要再来一次。
 *
 * 模板字段:微信要求按模板里定义的字段名传值(thing1/time2/thing3 这种)。
 * 下面按「训练提醒」类模板的常见三字段布局填,**如果你在后台选的模板字段名不同,
 * 改 REMIND_FIELDS 这一处即可** —— 别的地方不出现字段名。
 */
import { env } from '../env';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';

/** 用户点提醒后落在小程序里的页面 */
export const REMIND_PAGE = 'pkg-exercise/plan-view/index';

/**
 * 模板字段名 → 我们填什么。**必须和后台模板逐字对应**:
 * 后台「每日训练提醒」模板是
 *   训练计划 {{thing5}} / 训练时间 {{time1}} / 连续训练天数 {{thing2}}
 *   完成情况 {{thing6}} / 训练建议 {{thing3}}
 * 少填一个字段或字段名写错,微信都会整条拒发(47003)。
 * thing* 在微信侧是「20 个以内字符」的短文本,超了整条消息会被拒,所以一律先截断。
 */
export const REMIND_FIELDS = {
  /** 训练计划:今天该练了 */
  subject: 'thing5',
  /** 训练时间:用户设定的提醒时刻 */
  when: 'time1',
  /** 连续训练天数:截至昨天的连续天数 */
  streak: 'thing2',
  /** 完成情况:到点还没练 */
  status: 'thing6',
  /** 训练建议:一句按语气挑的话 */
  note: 'thing3'
} as const;

/** 微信 thing 类型字段的字数上限 */
export const THING_MAX = 20;

/** 截到微信的长度上限;顺便把换行换成空格(短信式的字段里换行会被拒) */
export function clip(text: string, max = THING_MAX): string {
  const t = String(text ?? '').replace(/[\r\n]+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * 微信 time 字段的格式:`YYYY年M月D日 HH:mm`。
 * 用用户本地日期 + 设置里的时刻拼出来,而不是拿发送那一刻 ——
 * 轮询晚了几分钟时,消息里显示的仍该是用户定的 20:00。
 */
export function scheduleText(localDate: string, hhmm: string): string {
  const [y, m, d] = localDate.split('-');
  return `${y}年${Number(m)}月${Number(d)}日 ${hhmm}`;
}

/** 「连续训练天数」的文案;0 天不说「连续 0 天」 */
export function streakText(days: number): string {
  return days > 0 ? `已连续 ${days} 天` : '今天开始新的一轮';
}

export interface RemindInput {
  subject: string;
  note: string;
  /** 用户本地日期 YYYY-MM-DD */
  localDate: string;
  /** 用户设置的提醒时刻 HH:mm */
  time: string;
  /** 截至昨天的连续训练天数(0 = 断过,从今天重新算) */
  streakDays: number;
}

/**
 * 模板字段值。**服务端不知道用户今天该练哪个训练日**(计划是客户端的一坨 JSON,
 * 而且会轮转),所以推送比小程序里的卡片更短:只说「该练了」和一句按语气挑的话。
 * 能算准的两件事照实填:昨天为止连续练了几天、今天到点还没有训练记录。
 */
export function remindData(input: RemindInput): Record<string, { value: string }> {
  return {
    [REMIND_FIELDS.subject]: { value: clip(input.subject) },
    [REMIND_FIELDS.when]: { value: scheduleText(input.localDate, input.time) },
    [REMIND_FIELDS.streak]: { value: streakText(input.streakDays) },
    [REMIND_FIELDS.status]: { value: '今天还没练' },
    [REMIND_FIELDS.note]: { value: clip(input.note) }
  };
}

interface CachedToken {
  token: string;
  /** 毫秒时间戳,到点就重取 */
  expiresAt: number;
}

let cached: CachedToken | null = null;
/** 并发去重:同一个 tick 里给多个人发,不能每个人都去换一次 token */
let inflight: Promise<string> | null = null;

/** access_token 有效期 7200 秒;提前 5 分钟换新的,避免边界上刚好过期 */
export function tokenFresh(now: number, expiresAt: number): boolean {
  return expiresAt - now > 5 * 60 * 1000;
}

export function resetTokenCache(): void {
  cached = null;
  inflight = null;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && tokenFresh(now, cached.expiresAt)) return cached.token;
  if (inflight) return inflight;

  inflight = (async () => {
    const url = new URL(TOKEN_URL);
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', env.wechatAppId);
    url.searchParams.set('secret', env.wechatAppSecret);
    const res = await fetch(url, { method: 'GET' });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!body.access_token) {
      // errmsg 里可能带 ip 白名单提示,留给运维看,别回给用户
      throw new Error(`获取微信 access_token 失败: ${body.errcode ?? ''} ${body.errmsg ?? ''}`.trim());
    }
    const ttl = (body.expires_in ?? 7200) * 1000;
    cached = { token: body.access_token, expiresAt: Date.now() + ttl };
    return body.access_token;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export interface SendResult {
  ok: boolean;
  /** 微信侧错误码:43101 = 用户没授权/授权已用完,应该把剩余额度清零 */
  errcode?: number;
  errmsg?: string;
  /** 因为没配模板而跳过的,不算失败 */
  skipped?: boolean;
}

/**
 * 发一条订阅消息。openid 为空(本地开发用户)或未配模板 → skipped,不报错。
 * 其余情况一律不抛异常:发不出去不该让整个 tick 崩掉,调用方按 errcode 决定要不要清额度。
 */
export async function sendSubscribeMessage(
  openid: string | null | undefined,
  data: Record<string, { value: string }>
): Promise<SendResult> {
  if (!openid) return { ok: false, skipped: true };
  if (!env.wechatTmplTraining) return { ok: false, skipped: true };
  if (!env.wechatAppId || !env.wechatAppSecret) return { ok: false, skipped: true };

  try {
    const token = await getAccessToken();
    const url = `${SEND_URL}?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: openid,
        template_id: env.wechatTmplTraining,
        page: REMIND_PAGE,
        miniprogram_state: 'formal',
        lang: 'zh_CN',
        data
      })
    });
    const body = (await res.json()) as { errcode?: number; errmsg?: string };
    if (body.errcode === 0) return { ok: true };
    return { ok: false, errcode: body.errcode, errmsg: body.errmsg };
  } catch (e) {
    return { ok: false, errmsg: (e as Error)?.message ?? '发送异常' };
  }
}
