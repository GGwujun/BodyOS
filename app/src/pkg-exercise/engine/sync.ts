/**
 * 训练数据云同步 —— 把只在本机 storage 里的训练数据(计划/渐进/日志/备注/器材/照片索引)
 * 镜像到账号下,换设备、清缓存之后还能拉回来。
 *
 * 服务端是哑存储(逐条 last-write-wins),合并规则在 sync-merge.ts(纯函数,单测覆盖)。
 * 这里只做「读本机 → 拉云端 → 合并 → 推回 → 按服务端的结果改写本机」这条流水线。
 *
 * 三条要守住的底线:
 *  1. **只增不删**:推送是 upsert,云端不会因为本机裁掉旧日志而丢历史;
 *     照片删了只删索引,云端文件不动(彻底删文件是另一件事)。
 *  2. **失败的批次不动本机数据**:网络断了最多是这次没传上去,绝不会反向覆盖。
 *  3. **本机路径不上云**:照片只把 URL 传上去,本机路径换台设备毫无意义。
 */
import Taro from '@tarojs/taro';
import { trainingApi } from '@/services';
import type { TrainingDocDto } from '@/services/training';
import { markTouched, touchedAt } from '@/utils/sync-marks';
import { loadPhotos, pendingUploads, savePhotos, setPhotoUrl, type PhotoEntry } from '@/utils/photos';
import { loadGirthPrefs, sanitizeGirthPrefs, saveGirthPrefs } from '@/utils/girth-prefs';
import { allCustom, saveCustom } from './custom';
import { applyKitDoc, kitDocEmpty, loadKitDoc } from './kit';
import { loadDayNotes, sanitizeDayNotes, saveDayNotes } from './daynote';
import { loadDayAssigns, sanitizeDayAssigns, saveDayAssigns } from './dayassign';
import { loadFavs, sanitizeFavs, saveFavs } from './fav';
import { loadMaxes, saveMaxes, type MaxMap } from './max';
import {
  LOG_CAP, loadLogs, loadNotes, loadPlan, loadProgress,
  saveLogs, saveNotes, savePlan, saveProgress,
  dropPlan, type ExerciseNotes
} from './store';
import { capDocs, docId, mergeDocs, type SyncDoc } from './sync-merge';
import type { ProgressState, TrainingPlan, WorkoutLog } from './types';

export const SYNCED_AT_KEY = 'bodyos.training.syncedAt';
const AUTO_KEY = 'bodyos.training.autosync';

/** 本机删过某份单例文档时的占位内容 —— 云端据此一起删,否则下次同步又拉回来 */
export const DELETED = { __deleted: true };
export function isDeleted(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && (payload as { __deleted?: boolean }).__deleted === true;
}

/** 时间戳都解不出来的（老数据没记过修改时间）当最旧 —— 服务端比它新的会自动赢 */
const EPOCH = new Date(0).toISOString();
/** 没记过修改时间的日志,用当天正午兜底,保证不同日期的日志排序稳定 */
const dayFallback = (date: string): string => (date ? `${date}T12:00:00.000Z` : EPOCH);

/** 一次推送塞多少条 —— 分批:单批失败不会拖垮整次同步,单次请求体也不至于过大 */
const PUSH_CHUNK = 40;

export type SyncStep = (text: string) => void;

// ---------- 本机 → 文档 ----------

const photoForCloud = (p: PhotoEntry) => ({
  id: p.id, date: p.date, pose: p.pose, url: p.url, note: p.note
});

/**
 * 把本机数据摊成一串文档。
 * 老数据(功能上线前就存在、没记过修改时间)也照推,时间戳给 EPOCH ——
 * 服务端只在「本机这份更新」时才覆盖,所以这种推送只会新建、不会误伤云端的新数据。
 */
export function collectDocs(): SyncDoc[] {
  const docs: SyncDoc[] = [];

  const plan = loadPlan();
  const planAt = touchedAt('plan', 'main');
  if (plan) {
    docs.push({ kind: 'plan', docKey: 'main', payload: plan, clientUpdatedAt: planAt ?? plan.createdAt ?? EPOCH });
  } else if (planAt) {
    docs.push({ kind: 'plan', docKey: 'main', payload: DELETED, clientUpdatedAt: planAt });
  }

  const progAt = touchedAt('progress', 'main');
  const prog = loadProgress();
  if (progAt || Object.keys(prog).length) {
    docs.push({ kind: 'progress', docKey: 'main', payload: prog, clientUpdatedAt: progAt ?? EPOCH });
  }

  const notesAt = touchedAt('notes', 'main');
  const notes = loadNotes();
  if (notesAt || Object.keys(notes).length) {
    docs.push({ kind: 'notes', docKey: 'main', payload: notes, clientUpdatedAt: notesAt ?? EPOCH });
  }

  // 请假条:替手机换一台也能保住 —— 否则新设备上会重新开始催你,而你还在外地
  const dayNotesAt = touchedAt('daynotes', 'main');
  const dayNotes = loadDayNotes();
  if (dayNotesAt || Object.keys(dayNotes).length) {
    docs.push({ kind: 'daynotes', docKey: 'main', payload: dayNotes, clientUpdatedAt: dayNotesAt ?? EPOCH });
  }

  // 按天改练:和请假条同理,换台手机也该还在 —— 不然新设备上今天会按轮转给你排另一套
  const assignsAt = touchedAt('dayassign', 'main');
  const assigns = loadDayAssigns();
  if (assignsAt || Object.keys(assigns).length) {
    docs.push({ kind: 'dayassign', docKey: 'main', payload: assigns, clientUpdatedAt: assignsAt ?? EPOCH });
  }

  const favsAt = touchedAt('favs', 'main');
  const favs = loadFavs();
  if (favsAt || favs.length) {
    docs.push({ kind: 'favs', docKey: 'main', payload: favs, clientUpdatedAt: favsAt ?? EPOCH });
  }

  // 器材推的是**整份**(几套 + 哪套在用),不是当前那套 —— 只推当前那套的话,
  // 另一台拉回去就把它的几套压成一套,而且不报错(见 kit.ts 的「几套器材」)
  const kitDoc = loadKitDoc();
  const kitAt = touchedAt('kit', 'main');
  if (kitAt || !kitDocEmpty(kitDoc)) {
    docs.push({ kind: 'kit', docKey: 'main', payload: kitDoc, clientUpdatedAt: kitAt ?? EPOCH });
  }

  // 自定义动作:**整份**(含已退场的)推上去。退场的那些也得跟着走 ——
  // 另一台设备上「上个月用它的那些训练」还要在肌群统计里算数,不推过去那边就少一块
  const customs = allCustom();
  const customsAt = touchedAt('custom', 'main');
  if (customsAt || customs.length) {
    docs.push({ kind: 'custom', docKey: 'main', payload: customs, clientUpdatedAt: customsAt ?? EPOCH });
  }

  // 力量基准:大部分是日志推算出来的,但手填过的那几条(测过极限)只有本机有
  const maxes = loadMaxes();
  const maxesAt = touchedAt('maxes', 'main');
  if (maxesAt || Object.keys(maxes).length) {
    docs.push({ kind: 'maxes', docKey: 'main', payload: maxes, clientUpdatedAt: maxesAt ?? EPOCH });
  }

  // 围度部位偏好(自建部位 + 显隐):换台设备要是没把它带过去,那边围度记录里
  // extras 那张键值表就成了没人认领的列 —— 数还在,但哪个数是哪个部位再没人说得清
  const girthPrefs = loadGirthPrefs();
  const girthAt = touchedAt('girth', 'main');
  if (girthAt || girthPrefs.custom.length || girthPrefs.hidden.length) {
    docs.push({ kind: 'girth', docKey: 'main', payload: girthPrefs, clientUpdatedAt: girthAt ?? EPOCH });
  }

  for (const log of loadLogs()) {
    docs.push({
      kind: 'logs', docKey: log.id, payload: log,
      clientUpdatedAt: touchedAt('logs', log.id) ?? dayFallback(log.date)
    });
  }

  const photos = loadPhotos();
  if (photos.length || touchedAt('photos', 'main')) {
    docs.push({
      kind: 'photos', docKey: 'main', payload: photos.map(photoForCloud),
      clientUpdatedAt: touchedAt('photos', 'main') ?? EPOCH
    });
  }

  return docs;
}

// ---------- 文档 → 本机 ----------

const byDateDesc = <T extends { date: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/**
 * 把（服务端确认过的）最终文档写回本机。
 * 每个 setter 都会顺手记一笔「现在改的」—— 这里紧接着用文档自带的时间戳盖回去,
 * 否则本机会看起来比云端新,下次同步又会把同一份推一遍(rev 无限上涨)。
 */
export function applyDocs(docs: SyncDoc[]): void {
  const pick = (kind: string): SyncDoc | undefined => docs.filter((d) => d.kind === kind).pop();

  const planDoc = pick('plan');
  if (planDoc) {
    if (isDeleted(planDoc.payload)) dropPlan();
    else if (planDoc.payload) savePlan(planDoc.payload as TrainingPlan);
    markTouched('plan', planDoc.docKey, planDoc.clientUpdatedAt);
  }

  const progDoc = pick('progress');
  if (progDoc) {
    saveProgress((progDoc.payload as ProgressState) ?? {});
    markTouched('progress', progDoc.docKey, progDoc.clientUpdatedAt);
  }

  const notesDoc = pick('notes');
  if (notesDoc) {
    saveNotes((notesDoc.payload as ExerciseNotes) ?? {});
    markTouched('notes', notesDoc.docKey, notesDoc.clientUpdatedAt);
  }

  const dayNotesDoc = pick('daynotes');
  if (dayNotesDoc) {
    // 存进去会再过一遍清洗,所以同步下来的脏数据落不了地
    saveDayNotes(sanitizeDayNotes(dayNotesDoc.payload));
    markTouched('daynotes', dayNotesDoc.docKey, dayNotesDoc.clientUpdatedAt);
  }

  const assignsDoc = pick('dayassign');
  if (assignsDoc) {
    saveDayAssigns(sanitizeDayAssigns(assignsDoc.payload));
    markTouched('dayassign', assignsDoc.docKey, assignsDoc.clientUpdatedAt);
  }

  const favsDoc = pick('favs');
  if (favsDoc) {
    saveFavs(sanitizeFavs(favsDoc.payload));
    markTouched('favs', favsDoc.docKey, favsDoc.clientUpdatedAt);
  }

  const kitDoc = pick('kit');
  if (kitDoc) {
    // 整份落盘(老设备推上来的那份是裸的 Kit,`applyKitDoc` 就地包成一套 —— 同一个迁移口)
    applyKitDoc(kitDoc.payload);
    markTouched('kit', kitDoc.docKey, kitDoc.clientUpdatedAt);
  }

  const maxesDoc = pick('maxes');
  if (maxesDoc) {
    saveMaxes((maxesDoc.payload as MaxMap) ?? {});
    markTouched('maxes', maxesDoc.docKey, maxesDoc.clientUpdatedAt);
  }

  const customDoc = pick('custom');
  if (customDoc) {
    // saveCustom 里再清洗一遍:云端那份可能是别的版本写的,形状不对的记录直接丢
    saveCustom(customDoc.payload);
    markTouched('custom', customDoc.docKey, customDoc.clientUpdatedAt);
  }

  const girthDoc = pick('girth');
  if (girthDoc) {
    saveGirthPrefs(sanitizeGirthPrefs(girthDoc.payload));
    markTouched('girth', girthDoc.docKey, girthDoc.clientUpdatedAt);
  }

  // 日志:整批合一次再写 —— 一条一次 setStorageSync 的话,几百条日志就是几百次整份序列化
  const logDocs = docs.filter((d) => d.kind === 'logs');
  if (logDocs.length) {
    const byId = new Map(loadLogs().map((l) => [l.id, l]));
    for (const d of logDocs) {
      const log = d.payload as WorkoutLog | null;
      if (log?.id) byId.set(log.id, log);   // 云端可能有本机没有的历史(换设备后靠这里补)
    }
    saveLogs(byDateDesc([...byId.values()]).slice(0, LOG_CAP));
    for (const d of logDocs) markTouched('logs', d.docKey, d.clientUpdatedAt);
  }

  // 照片整份替换,但保住本机的文件路径:本机还有那份文件就继续用它(快、离线可看)
  const photoDoc = pick('photos');
  if (photoDoc) {
    const remote = Array.isArray(photoDoc.payload) ? (photoDoc.payload as PhotoEntry[]) : [];
    const localById = new Map(loadPhotos().map((p) => [p.id, p]));
    savePhotos(remote.map((r) => {
      const l = localById.get(r.id);
      return l ? { ...r, path: l.path ?? r.path } : r;
    }));
    markTouched('photos', photoDoc.docKey, photoDoc.clientUpdatedAt);
  }
}

// ---------- 照片上传 ----------

const mimeOf = (filePath: string): string =>
  /\.png$/i.test(filePath) ? 'image/png' : /\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg';

function readBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => {
        const data = (r as { data?: unknown }).data;
        if (typeof data === 'string' && data) resolve(data);
        else reject(new Error('照片读不出来'));
      },
      fail: () => reject(new Error('照片读不出来(文件可能已被系统清理)'))
    });
  });
}

/** 把还没传过的照片传上去。单张失败不影响其它张,也不影响整次同步 */
async function uploadPhotos(onStep?: SyncStep): Promise<{ done: number; failed: number }> {
  const todo = pendingUploads(loadPhotos());
  let done = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    onStep?.(`正在上传照片 ${i + 1}/${todo.length}`);
    const p = todo[i];
    try {
      if (!p.path) continue;
      const { url } = await trainingApi.uploadMedia(await readBase64(p.path), mimeOf(p.path));
      setPhotoUrl(p.id, url);
      done++;
    } catch {
      failed++;
    }
  }
  return { done, failed };
}

// ---------- 一次同步 ----------

export interface SyncSummary {
  /** 云端有、本机没有,补回来的条数 */
  pulled: number;
  /** 云端版本更新、本机被替换掉的条数 */
  adopted: number;
  created: number;
  updated: number;
  kept: number;
  photosUploaded: number;
  photosFailed: number;
  /** 没传上去的批次数(网络问题居多);> 0 就不更新「上次同步」时间 */
  failed: number;
  at: string;
}

export const lastSyncedAt = (): string | null => Taro.getStorageSync(SYNCED_AT_KEY) || null;
/** 本机有没有值得同步的东西 —— 决定页面是引导态还是有数据可同步 */
export const hasLocalData = (): boolean => collectDocs().length > 0;

export const autoSyncOn = (): boolean => !!Taro.getStorageSync(AUTO_KEY);
export function setAutoSync(on: boolean): void {
  if (on) Taro.setStorageSync(AUTO_KEY, true);
  else Taro.removeStorageSync(AUTO_KEY);
}

let autoRunning = false;
/**
 * 练完顺手同步一次 —— 完全静默:用户没主动点同步,不该被进度、失败弹窗打断。
 * 同一时刻只跑一次,连着练两组不会叠出一串请求。
 */
export async function autoSync(): Promise<void> {
  if (autoRunning || !autoSyncOn()) return;
  autoRunning = true;
  try {
    await syncNow();
  } catch {
    // 静默:这次没传上去,下次同步会一起带上(本机数据一条没动)
  } finally {
    autoRunning = false;
  }
}

const toSyncDoc = (d: TrainingDocDto): SyncDoc => ({
  kind: d.kind, docKey: d.docKey, payload: d.payload, clientUpdatedAt: d.clientUpdatedAt
});

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * 完整走一遍同步。任何一步失败都抛出去,由页面提示 —— 但**本机数据一律不动**
 * (唯一的写入是 applyDocs,而它只吃服务端确认过的结果)。
 */
export async function syncNow(onStep?: SyncStep): Promise<SyncSummary> {
  // 先传照片:传完的照片带上 URL,下面的 collectDocs 才会把它一起同步出去
  onStep?.('正在上传照片');
  const photoRes = await uploadPhotos(onStep);

  onStep?.('正在读取本机数据');
  const local = collectDocs();

  onStep?.('正在拉取云端数据');
  const pulled = await trainingApi.pullDocs();
  const remote = (pulled.docs ?? []).map(toSyncDoc);

  const merged = mergeDocs(local, remote);

  onStep?.(`正在同步 ${merged.docs.length} 条数据`);
  let created = 0;
  let updated = 0;
  let kept = 0;
  let failed = 0;
  const final: SyncDoc[] = [];
  for (const batch of chunk(merged.docs, PUSH_CHUNK)) {
    try {
      const res = await trainingApi.pushDocs(batch);
      created += res.created ?? 0;
      updated += res.updated ?? 0;
      kept += res.kept ?? 0;
      for (const d of res.docs ?? []) final.push(toSyncDoc(d));
    } catch {
      failed++;   // 这一批留在本机,下次再传
    }
  }

  // 服务端回传的才是最终状态(并发写时可能与本机推的不一样)。
  // 一批都没推成功也照样写回本机:拉下来的云端数据该合进来,推不上去只是下次再传。
  applyDocs(capDocs(final.length ? final : merged.docs, LOG_CAP, ['logs']));

  const at = new Date().toISOString();
  if (!failed) Taro.setStorageSync(SYNCED_AT_KEY, at);

  // 本机原来没有的 = 这次从云端补回来的;剩下的 fromRemote 是「云端那份更新,本机被换掉」
  const localIds = new Set(local.map(docId));
  const pulledCount = merged.docs.filter((d) => !localIds.has(docId(d))).length;

  return {
    pulled: pulledCount,
    adopted: Math.max(0, merged.fromRemote - pulledCount),
    created, updated, kept,
    photosUploaded: photoRes.done,
    photosFailed: photoRes.failed,
    failed, at
  };
}
