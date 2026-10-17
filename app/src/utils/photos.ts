import Taro from '@tarojs/taro';
import { markTouched } from './sync-marks';
import { mediaUrl } from './media';

/**
 * 进度照片。
 *
 * 体重和围度是数字,照片是证据 —— 减脂期「看不出变化」是最常见的放弃原因,
 * 把两个月前的照片和今天并排放在一起,变化往往比想象中明显。
 *
 * 存哪:先调 `saveFile` 存到小程序自己的本地空间(快、离线可看),同步时再传一份到服务器,
 * 换设备后拉回来只有 URL、没有本地文件 —— 所以渲染一律走 `srcOf()`,不直接读 path。
 */

export type Pose = 'front' | 'side' | 'back';

export const POSES: Pose[] = ['front', 'side', 'back'];
export const POSE_ZH: Record<Pose, string> = { front: '正面', side: '侧面', back: '背面' };
export const POSE_TIP: Record<Pose, string> = {
  front: '正面站直,双臂自然下垂或微微张开',
  side: '侧面对着镜头,能看出腰腹厚度',
  back: '背面站立,看背部的轮廓'
};

/** 拍照建议 —— 前后可比的前提是每次都一样 */
export const SHOOT_TIPS = [
  '同一个位置、同一面镜子,手机别歪',
  '光线尽量一样,别一次背光一次顺光',
  '固定早上空腹拍,这是体重最稳定的时候',
  '穿同样的衣服或干脆一样少,衣服比脂肪更会骗人'
];

export interface PhotoEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  pose: Pose;
  /** 本地文件路径(saveFile 返回值)。同步过来的照片只有 url,没有本地文件 */
  path?: string;
  /** 云端地址(/media/xxx)。传过一次就记下来,以后不再重复上传 */
  url?: string;
  note?: string;
}

const KEY = 'bodyos.photos';

/**
 * 这张照片该拿什么渲染 —— 本地文件优先(快、不依赖网络),没有就取云端那份。
 *
 * 云端存的是 `/media/xxx` 这种**根相对地址**,直接交给 Image 会按小程序自己的包
 * 去解析,换设备/备份恢复回来的照片全是空白。必须过 `mediaUrl()` 拼上 API 域名。
 */
export const srcOf = (p: PhotoEntry): string => p.path || (p.url ? mediaUrl(p.url) : '');

export function loadPhotos(): PhotoEntry[] {
  try {
    const raw = Taro.getStorageSync(KEY);
    const list: PhotoEntry[] = Array.isArray(raw) ? raw : [];
    // 只认「有本地文件或云端地址」的条目:换设备同步回来的照片只带 url
    return sortDesc(list.filter((p) => p && (p.path || p.url) && p.date && POSE_ZH[p.pose]));
  } catch { return []; }
}

export function savePhotos(list: PhotoEntry[]): void {
  try {
    Taro.setStorageSync(KEY, list);
    markTouched('photos', 'main');
  } catch { /* 空间满了也不能让页面崩 */ }
}

/** 记下某张照片的云端地址(上传成功后调用,下次同步不再重传) */
export function setPhotoUrl(id: string, url: string): PhotoEntry[] {
  const list = loadPhotos().map((p) => (p.id === id ? { ...p, url } : p));
  savePhotos(list);
  return list;
}

/** 还没上传过的照片 —— 云同步时逐张传 */
export function pendingUploads(list: PhotoEntry[]): PhotoEntry[] {
  return list.filter((p) => !p.url && !!p.path);
}

/** 新的在前 */
export function sortDesc(list: PhotoEntry[]): PhotoEntry[] {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function photosOf(list: PhotoEntry[], pose: Pose): PhotoEntry[] {
  return sortDesc(list.filter((p) => p.pose === pose));
}

export function countOf(list: PhotoEntry[], pose: Pose): number {
  return list.filter((p) => p.pose === pose).length;
}

/**
 * id 必须唯一 —— 连着拍两张的时间戳可能落在同一毫秒里,
 * 撞了 id 之后删一张会把两张一起删掉。
 */
function newId(): string {
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 存一张照片(把临时文件搬进持久空间) */
export async function addPhoto(tempFilePath: string, pose: Pose, date: string): Promise<PhotoEntry> {
  let savedFilePath = tempFilePath;
  try {
    const res = (await Taro.saveFile({ tempFilePath })) as { savedFilePath?: string };
    if (res.savedFilePath) savedFilePath = res.savedFilePath;
  } catch (e) {
    const msg = String((e as { errMsg?: string })?.errMsg ?? e);
    if (msg.includes('limit') || msg.includes('exceed')) {
      throw new Error('本机存照片的地方满了,先删掉几张旧照片再拍');
    }
    throw new Error('照片保存失败,请再试一次');
  }
  const entry: PhotoEntry = { id: newId(), date, pose, path: savedFilePath };
  savePhotos(sortDesc([entry, ...loadPhotos()]));
  return entry;
}

export function removePhoto(id: string): PhotoEntry[] {
  const list = loadPhotos();
  const hit = list.find((p) => p.id === id);
  const rest = list.filter((p) => p.id !== id);
  if (hit?.path) {
    // 文件删不掉不影响记录删除,忽略即可(只有云端那份的照片本来就没有本地文件)
    Taro.removeSavedFile({ filePath: hit.path }).catch(() => undefined);
  }
  savePhotos(rest);
  return rest;
}

/* ============ 对比 ============ */

export interface Pair { before: PhotoEntry | null; after: PhotoEntry | null }

/** 默认拿这个姿势里最早的一张和最新的一张比 */
export function defaultPair(list: PhotoEntry[], pose: Pose): Pair {
  const items = photosOf(list, pose);   // 新的在前
  if (!items.length) return { before: null, after: null };
  return { before: items[items.length - 1], after: items[0] };
}

export function samePair(a: PhotoEntry | null, b: PhotoEntry | null): boolean {
  return !!a && !!b && a.id === b.id;
}

export function dayGap(before: PhotoEntry | null, after: PhotoEntry | null): number | null {
  if (!before || !after) return null;
  const ms = new Date(`${after.date}T00:00:00`).getTime() - new Date(`${before.date}T00:00:00`).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

/** 「相隔 42 天」这种话怎么说才不啰嗦 */
export function gapText(days: number | null): string {
  if (days == null) return '';
  if (days <= 0) return '同一天拍的,比不出变化';
  if (days < 7) return `相隔 ${days} 天`;
  if (days < 60) return `相隔 ${Math.round(days / 7)} 周`;
  return `相隔 ${Math.round(days / 30)} 个月`;
}

/** 按月份分组(新的月份在前),给时间线用 */
export function byMonth(list: PhotoEntry[]): { month: string; items: PhotoEntry[] }[] {
  const out: { month: string; items: PhotoEntry[] }[] = [];
  for (const p of sortDesc(list)) {
    const month = p.date.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.month === month) last.items.push(p);
    else out.push({ month, items: [p] });
  }
  return out;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

/** 这张照片离同一姿势的第一张过了多少天 —— 时间线上比绝对日期更有实感 */
export function ageOf(list: PhotoEntry[], photo: PhotoEntry): string {
  const items = photosOf(list, photo.pose);   // 新的在前
  const first = items[items.length - 1];
  if (!first || first.id === photo.id) return '第一张';
  const d = dayGap(first, photo);
  if (d == null || d <= 0) return '';
  return `+${d} 天`;
}
