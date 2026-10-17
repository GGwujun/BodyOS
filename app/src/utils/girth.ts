import type { BodyMeasurement } from '@/services/types';

/**
 * 围度:腰、胸、臀、上臂、大腿。
 *
 * 体重只说明「重了多少」,不说明「变在哪」—— 减脂期体重不变、腰围小两厘米是常有的事,
 * 增肌期体重涨了、腰围没动才叫练对了地方。这份逻辑负责把一串测量记录摊成
 * 「每个部位最新多少、比上次/比第一次变了多少、走势如何」。
 */

export type GirthKey = 'waistCm' | 'chestCm' | 'hipCm' | 'armCm' | 'thighCm';

export interface Site {
  k: GirthKey;
  label: string;
  hint: string;
}

export const SITES: Site[] = [
  { k: 'waistCm', label: '腰围', hint: '肚脐水平绕一圈,自然呼气,别吸肚子' },
  { k: 'chestCm', label: '胸围', hint: '胸部最丰满处水平绕一圈,自然呼吸' },
  { k: 'hipCm', label: '臀围', hint: '臀部最凸处水平绕一圈,双脚并拢' },
  { k: 'armCm', label: '上臂围', hint: '手臂最粗处,发力绷紧量同一边' },
  { k: 'thighCm', label: '大腿围', hint: '大腿最粗处,站直放松量同一边' }
];

/** 合理区间(厘米)—— 和接口校验保持一致,量错一位数能当场看出来 */
export const MIN_CM = 10;
export const MAX_CM = 300;

export interface SiteSeries {
  k: GirthKey;
  label: string;
  /** 时间升序 */
  points: { label: string; value: number }[];
  latest: number | null;
  /** 上一次量到的值(不是上一条记录 —— 中间那次可能没量这个部位) */
  prev: number | null;
  /** 第一次量到的值 */
  first: number | null;
  lastDate: string | null;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 按测量时间升序(字符串 ISO 直接比字典序即可) */
export function ascOf(records: BodyMeasurement[]): BodyMeasurement[] {
  return [...records].sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0));
}

/** 每个部位一条序列(只取最近 30 个点画图,但「第一次」取全量) */
export function seriesOf(records: BodyMeasurement[]): SiteSeries[] {
  const asc = ascOf(records);
  return SITES.map((site) => {
    const all = asc
      .map((r) => ({ date: r.measuredAt, value: num(r[site.k]) }))
      .filter((x): x is { date: string; value: number } => x.value != null);
    const tail = all.slice(-30);
    return {
      k: site.k,
      label: site.label,
      points: tail.map((x) => ({ label: x.date.slice(5, 10), value: x.value })),
      latest: all.length ? all[all.length - 1].value : null,
      prev: all.length > 1 ? all[all.length - 2].value : null,
      first: all.length ? all[0].value : null,
      lastDate: all.length ? all[all.length - 1].date : null
    };
  });
}

/** 有数据的部位(按记录顺序排) */
export function measuredSites(records: BodyMeasurement[]): SiteSeries[] {
  return seriesOf(records).filter((s) => s.latest != null);
}

export const DELTA_AT = 0.2;

/**
 * 变化量怎么念。围度有 1 厘米上下的日常浮动,所以:
 * 不足 0.2 厘米当没变;一次变化超过 5 厘米的多半是量错了地方,提示重测。
 */
export function deltaText(from: number, to: number): { text: string; dir: -1 | 0 | 1 } {
  const d = Math.round((to - from) * 10) / 10;
  if (Math.abs(d) < DELTA_AT) return { text: '没变', dir: 0 };
  const dir: -1 | 1 = d > 0 ? 1 : -1;
  const text = `${d > 0 ? '+' : ''}${d} cm`;
  return { text: Math.abs(d) > 5 ? `${text}(差这么多,是不是量错位置了)` : text, dir };
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

/** 输入框文本 → 厘米数;空串当没量,超范围的返回 'bad' */
export function parseGirth(text: string): number | null | 'bad' {
  const t = text.trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return 'bad';
  const r = Math.round(v * 10) / 10;
  if (r < MIN_CM || r > MAX_CM) return 'bad';
  return r;
}
