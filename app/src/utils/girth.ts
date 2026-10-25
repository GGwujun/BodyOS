import { dayDiff } from './date';
import type { BodyMeasurement } from '@/services/types';

/**
 * 围度与体脂:腰、胸、臀、上臂、大腿,外加体脂率 —— 外加用户自己加的部位。
 *
 * 体重只说明「重了多少」,不说明「变在哪」—— 减脂期体重不变、腰围小两厘米是常有的事,
 * 增肌期体重涨了、腰围没动才叫练对了地方。体脂率是第六个可记录的数:它和围度一样
 * 「看趋势不看单点」(不同仪器的绝对值能差出 5 个百分点,自己的前后对比才有意义)。
 * 这份逻辑负责把一串测量记录摊成「每个部位最新多少、比上次/比第一次变了多少、走势如何」。
 *
 * 内置六个部位在记录里各有自己的一列;自己加的部位(「左上臂」「小腿围」这类)没有列,
 * 统一住在记录的 `extras` 这张键值表里,键也是 Site.k。这份文件只放**纯逻辑**
 * (部位表、序列、显隐组合),本机存储在 girth-prefs.ts —— 冒烟测试要求这里不碰 Taro。
 */

export type GirthKey = 'waistCm' | 'chestCm' | 'hipCm' | 'armCm' | 'thighCm' | 'bodyFatPct';

export type SiteUnit = 'cm' | '%';

export interface Site {
  /** 部位键:内置的是固定键名,自建的是 `x-` 开头(记录里落在 extras 那张表) */
  k: string;
  label: string;
  hint: string;
  /** 单位 —— 五个围度是厘米,体脂率是百分比(念法、合理区间、浮动阈值都跟着单位走) */
  unit: SiteUnit;
  /** 客户端合理区间;接口对体脂收得更宽(0-100),这里拦的是「明显输错了」 */
  min: number;
  max: number;
}

export const SITES: Site[] = [
  { k: 'waistCm', label: '腰围', hint: '肚脐水平绕一圈,自然呼气,别吸肚子', unit: 'cm', min: 10, max: 300 },
  { k: 'chestCm', label: '胸围', hint: '胸部最丰满处水平绕一圈,自然呼吸', unit: 'cm', min: 10, max: 300 },
  { k: 'hipCm', label: '臀围', hint: '臀部最凸处水平绕一圈,双脚并拢', unit: 'cm', min: 10, max: 300 },
  { k: 'armCm', label: '上臂围', hint: '手臂最粗处,发力绷紧量同一边', unit: 'cm', min: 10, max: 300 },
  { k: 'thighCm', label: '大腿围', hint: '大腿最粗处,站直放松量同一边', unit: 'cm', min: 10, max: 300 },
  { k: 'bodyFatPct', label: '体脂率', hint: '体脂秤或皮脂夹测得的百分比;不同仪器差得多,固定用同一台、同一时间测,只和自己的历史比', unit: '%', min: 3, max: 60 }
];

/** 围度合理区间(厘米)—— 五个围度共用,和接口校验保持一致,量错一位数能当场看出来 */
export const MIN_CM = 10;
export const MAX_CM = 300;

/* ============ 自己加的部位 ============ */

/** 自建部位的键前缀:看到 `x-` 开头就知道这个数在记录的 extras 里,不在列上 */
export const CUSTOM_PREFIX = 'x-';

export interface CustomSiteDef {
  /** 不带前缀的那半截(`x-` 后面的随机串),存进偏好、跟着账号同步 */
  id: string;
  name: string;
}

/** 自建部位的定义 → 统一的 Site 形状,下游(表单/序列/校验)一个口径 */
export const customSite = (def: CustomSiteDef): Site => ({
  k: CUSTOM_PREFIX + def.id,
  label: def.name,
  hint: '自己加的部位:固定同一位置、同一侧量,只和自己的历史比',
  unit: 'cm',
  min: MIN_CM,
  max: MAX_CM
});

/**
 * 部位偏好:哪些部位被藏起来了、自建了哪些部位。
 * `hidden` 里既有内置键也有自建键 —— 「藏」对两种部位是同一件事,删自建才是另一件事。
 */
export interface GirthPrefs {
  hidden: string[];
  custom: CustomSiteDef[];
}

export const EMPTY_PREFS: GirthPrefs = { hidden: [], custom: [] };

/** 录入表单和概览默认显示的部位:没藏的内置 + 没藏的自建 */
export function activeSites(p: GirthPrefs): Site[] {
  return [
    ...SITES.filter((s) => !p.hidden.includes(s.k)),
    ...p.custom.filter((c) => !p.hidden.includes(CUSTOM_PREFIX + c.id)).map(customSite)
  ];
}

/**
 * 能选着看曲线的部位 = 显示中的 + 「藏了但量过数」的。
 * 藏一个部位不该把它的历史一起藏死:不然手一滑,那些数就再也找不回来了。
 */
export function availableSites(p: GirthPrefs, records: BodyMeasurement[]): Site[] {
  const active = activeSites(p);
  const shown = new Set(active.map((s) => s.k));
  const extra: Site[] = [];
  for (const s of SITES) {
    if (!shown.has(s.k) && records.some((r) => valueOf(r, s.k) != null)) extra.push(s);
  }
  for (const c of p.custom) {
    const k = CUSTOM_PREFIX + c.id;
    if (!shown.has(k) && records.some((r) => valueOf(r, k) != null)) extra.push(customSite(c));
  }
  return [...active, ...extra];
}

export interface SiteSeries {
  k: string;
  label: string;
  unit: SiteUnit;
  /** 时间升序、**全量**(不截尾)—— 画图要取哪一段是页面按区间挑的事,这里把数据备齐 */
  points: { label: string; date: string; value: number }[];
  latest: number | null;
  /** 上一次量到的值(不是上一条记录 —— 中间那次可能没量这个部位) */
  prev: number | null;
  /** 第一次量到的值 */
  first: number | null;
  lastDate: string | null;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 一条记录里某个部位的值:内置的在列上,自建的在 extras 里 —— 调用方不用管它是哪种 */
export function valueOf(m: BodyMeasurement, k: string): number | null {
  const raw = (m as unknown as Record<string, unknown>)[k];
  if (raw != null) return num(raw as number | null | undefined);
  const e = m.extras?.[k];
  return num(typeof e === 'number' ? e : null);
}

/** 按测量时间升序(字符串 ISO 直接比字典序即可) */
export function ascOf(records: BodyMeasurement[]): BodyMeasurement[] {
  return [...records].sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0));
}

/** 每个部位一条序列。点取全量,页面用 spanFilter 按区间裁;「最新/上次/第一次」永远是全量的 */
export function seriesOf(records: BodyMeasurement[], sites: Site[] = SITES): SiteSeries[] {
  const asc = ascOf(records);
  return sites.map((site) => {
    const all = asc
      .map((r) => ({ date: r.measuredAt, value: valueOf(r, site.k) }))
      .filter((x): x is { date: string; value: number } => x.value != null);
    return {
      k: site.k,
      label: site.label,
      unit: site.unit,
      points: all.map((x) => ({ label: x.date.slice(5, 10), date: x.date, value: x.value })),
      latest: all.length ? all[all.length - 1].value : null,
      prev: all.length > 1 ? all[all.length - 2].value : null,
      first: all.length ? all[0].value : null,
      lastDate: all.length ? all[all.length - 1].date : null
    };
  });
}

/** 有数据的部位(按传入部位表的顺序排) */
export function measuredSites(records: BodyMeasurement[], sites: Site[] = SITES): SiteSeries[] {
  return seriesOf(records, sites).filter((s) => s.latest != null);
}

export const DELTA_AT = 0.2;
/** 体脂的「算没变」阈值更宽:体脂秤的日常浮动(水分、进食)就有零点几个百分点 */
export const DELTA_AT_PCT = 0.5;

/**
 * 变化量怎么念。围度有 1 厘米上下的日常浮动,所以:
 * 不足 0.2 厘米当没变;一次变化超过 5 厘米的多半是量错了地方,提示重测。
 * 体脂率(%)同理,阈值换成 0.5 个百分点;一次跳 5 个百分点的多半是换了仪器或换了测法。
 */
export function deltaText(from: number, to: number, unit: SiteUnit = 'cm'): { text: string; dir: -1 | 0 | 1 } {
  const pct = unit === '%';
  const d = Math.round((to - from) * 10) / 10;
  if (Math.abs(d) < (pct ? DELTA_AT_PCT : DELTA_AT)) return { text: '没变', dir: 0 };
  const dir: -1 | 1 = d > 0 ? 1 : -1;
  const text = `${d > 0 ? '+' : ''}${d}${pct ? '%' : ' cm'}`;
  return { text: Math.abs(d) > 5 ? `${text}(差这么多,是不是${pct ? '换了台仪器' : '量错位置了'})` : text, dir };
}

/* ============ 看多远 ============ */

export type BodySpan = '30' | '90' | '365' | 'all';

/** 曲线区间 —— 体重页和围度页同一套,两处的「看多远」长得一样才不用学两遍 */
export const BODY_SPANS: { k: BodySpan; label: string }[] = [
  { k: '30', label: '近 1 个月' },
  { k: '90', label: '近 3 个月' },
  { k: '365', label: '近 1 年' },
  { k: 'all', label: '全部' }
];

/**
 * 按区间挑点(只该作用于曲线;「最新值/最好成绩/记录列表」看的是全程,跟着窗口缩就答错了问题)。
 * `date` 允许是完整 ISO(围度的 measuredAt)或 YYYY-MM-DD(体重记录),这里统一取日期位再比;
 * 默认 'all' = 以前的行为,不偷偷把用户的数据藏起来,想细看的人自己往里缩。
 */
export function spanFilter<T extends { date: string }>(rows: readonly T[], span: BodySpan, today: string): T[] {
  if (span === 'all') return [...rows];
  const days = Number(span);
  return rows.filter((r) => dayDiff(r.date.slice(0, 10), today) <= days);
}

/* ============ 腰臀比 ============ */

/** 高危参考线:男性 0.9、女性 0.85 —— 这里取宽松的一条做统一提示,不猜用户性别 */
export const WHR_HIGH = 0.9;
export const WHR_MID = 0.85;

export interface Whr {
  value: number;
  date: string;
  tone: 'ok' | 'mid' | 'high';
}

/** 取最近一次「腰围和臀围都量了」的记录算腰臀比 */
export function whrOf(records: BodyMeasurement[]): Whr | null {
  const asc = ascOf(records);
  for (let i = asc.length - 1; i >= 0; i--) {
    const w = num(asc[i].waistCm);
    const h = num(asc[i].hipCm);
    if (w != null && h != null && h > 0) {
      const value = Math.round((w / h) * 100) / 100;
      return {
        value,
        date: asc[i].measuredAt,
        tone: value >= WHR_HIGH ? 'high' : value >= WHR_MID ? 'mid' : 'ok'
      };
    }
  }
  return null;
}

/* ============ 输入 ============ */

/** 输入框文本 → 数值;空串当没量,超范围的返回 'bad'。带 site 就按它的单位区间校验 */
export function parseGirth(text: string, site?: Site): number | null | 'bad' {
  const t = text.trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return 'bad';
  const r = Math.round(v * 10) / 10;
  const min = site?.min ?? MIN_CM;
  const max = site?.max ?? MAX_CM;
  if (r < min || r > max) return 'bad';
  return r;
}
