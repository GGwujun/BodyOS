/**
 * 本地修改时间戳 —— 云同步判断「谁改得晚」的唯一依据。
 *
 * 训练域的本地数据(计划/渐进/日志/备注/器材/照片索引)原本都没有修改时间:
 * 计划的 createdAt 是生成时间、日志的 date 只到天、渐进状态连时间都没有。
 * 光看内容无法判断两台设备哪份更新,所以每次写入顺手记一笔 time。
 * 放在主包(而不是训练分包里):照片索引在主包,两处都要写。
 */
import Taro from '@tarojs/taro';

const KEY = 'bodyos.sync.marks';
/** 只留最近这么多条:日志会一条条累积,不能用无上限的 map 撑爆 storage */
const CAP = 600;

export type MarkKind =
  'plan' | 'progress' | 'logs' | 'notes' | 'kit' | 'photos' | 'maxes' | 'daynotes' | 'favs' | 'custom'
  /** 按天改练(哪一天练哪一套)—— 和 daynotes(请假条)是两份,别合并见 engine/dayassign.ts */
  | 'dayassign'
  /** 围度部位偏好(自建部位 + 显隐)—— 在主包 utils/girth-prefs.ts,但跟着这份同步走 */
  | 'girth';

export function loadMarks(): Record<string, string> {
  const raw = Taro.getStorageSync(KEY);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
}

/** 该文档本机最后修改时间(ISO);没记过返回 null,调用方回落到内容自带的日期 */
export function touchedAt(kind: MarkKind, docKey: string): string | null {
  return loadMarks()[`${kind}|${docKey}`] ?? null;
}

/** 记一笔修改时间。写入失败不能影响主流程(标记只是同步用的辅助信息) */
export function markTouched(kind: MarkKind, docKey: string, at = new Date().toISOString()): void {
  try {
    const marks = loadMarks();
    marks[`${kind}|${docKey}`] = at;
    const keys = Object.keys(marks);
    if (keys.length > CAP) {
      // 按时间排序留下最新的 CAP 条(日志 id 的插入顺序不等于时间顺序,得真排序)
      const kept: Record<string, string> = {};
      for (const k of keys.sort((a, b) => (marks[a] < marks[b] ? 1 : -1)).slice(0, CAP)) kept[k] = marks[k];
      Taro.setStorageSync(KEY, kept);
      return;
    }
    Taro.setStorageSync(KEY, marks);
  } catch {
    // 忽略:标记丢了最多让这次同步多推一份,不会丢数据
  }
}

/** 清理某条文档的痕迹(日志被裁掉时顺手删掉,避免 marks 里留一堆死 id) */
export function clearMarks(kinds: MarkKind[]): void {
  const marks = loadMarks();
  for (const k of Object.keys(marks)) if (kinds.includes(k.split('|')[0] as MarkKind)) delete marks[k];
  Taro.setStorageSync(KEY, marks);
}
