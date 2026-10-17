/**
 * 导出/导入备份 —— 训练数据最后一道保险。
 *
 * 云同步(M7.1)已经能换设备了,但它依赖登录和网络:号被限制了、服务器抽风、用户不想登录,
 * 数据就出不来。这里把本机的训练数据摊成一段**纯文本**:复制走、存进备忘录、发给自己都行,
 * 换机或清缓存之后粘回来即可复原。格式就是带个头的 JSON,人能读懂,也不怕以后解不开。
 *
 * 不含什么:照片的**图片文件**。图片是二进制,塞进剪贴板不现实;导出的是照片索引
 * (日期/姿势/云端地址),重新登录同步后云端那份还能显示,但本机没传过的照片就只剩一条记录。
 *
 * 导入一律走「合」而不是「替」:本机有的东西不该因为粘错一段文本就没了。
 * 真要覆盖,页面上有明确的一次确认。
 */
import Taro from '@tarojs/taro';
import { todayStr } from '../../utils/date';
import { loadPhotos, savePhotos, type PhotoEntry } from '../../utils/photos';
import { markTouched } from '../../utils/sync-marks';
import { allCustom, sanitizeCustom, saveCustom, type CustomExercise } from './custom';
import { applyKitDoc, kitDocEmpty, loadKitDoc, type KitDoc } from './kit';
import { loadMaxes, saveMaxes, type MaxMap } from './max';
import {
  LOG_CAP, loadLogs, loadNotes, loadPlan, loadProgress,
  saveLogs, saveNotes, savePlan, saveProgress, type ExerciseNotes
} from './store';
import type { ProgressState, TrainingPlan, WorkoutLog } from './types';

/** 文本开头的标记:粘回来的东西对不对,一眼就能看出来 */
export const BACKUP_HEAD = 'BODYOS-TRAINING-1';
export const BACKUP_VERSION = 1;

export interface BackupBundle {
  v: number;
  at: string;
  plan?: TrainingPlan | null;
  progress?: ProgressState;
  logs?: WorkoutLog[];
  notes?: ExerciseNotes;
  /** 几套器材 + 哪套在用(见 kit.ts)。老备份里这一格是裸的 `Kit`,导入时同一个迁移口收下 */
  kit?: KitDoc;
  maxes?: MaxMap;
  photos?: PhotoEntry[];
  /** 自定义动作(含已退场的那些 —— 它们撑着历史训练的统计,见 custom.ts) */
  custom?: CustomExercise[];
}

export interface BackupCounts {
  plan: number;
  logs: number;
  notes: number;
  kit: number;
  maxes: number;
  photos: number;
  custom: number;
}

// ---------- 导出 ----------

/** 把本机数据收成一个可序列化的包(照片只收索引) */
export function buildBundle(): BackupBundle {
  const photos = loadPhotos().map((p) => ({ ...p, path: undefined }));
  return {
    v: BACKUP_VERSION,
    at: new Date().toISOString(),
    plan: loadPlan(),
    progress: loadProgress(),
    logs: loadLogs(),
    notes: loadNotes(),
    // 器材是**整份**(几套 + 哪套在用)—— 只导当前那套等于把别的几套丢了
    kit: loadKitDoc(),
    maxes: loadMaxes(),
    photos,
    // 自定义动作是**用户自己写的东西**,和照片一样属于「换手机就没了」的那一类
    // (收藏/请假条是设置,不在备份里 —— 这条线是按「丢了要重做多久」划的)
    custom: allCustom()
  };
}

export const bundleText = (b: BackupBundle): string => `${BACKUP_HEAD}\n${JSON.stringify(b)}`;

export const countsOf = (b: BackupBundle): BackupCounts => ({
  plan: b.plan ? 1 : 0,
  logs: b.logs?.length ?? 0,
  notes: Object.keys(b.notes ?? {}).length,
  // 老备份里这一格是裸的 `Kit` —— `kitDocEmpty` 自己会归一,不用在这里分辨是哪一版
  kit: kitDocEmpty(b.kit) ? 0 : 1,
  maxes: Object.keys(b.maxes ?? {}).length,
  photos: b.photos?.length ?? 0,
  custom: b.custom?.length ?? 0
});

/** 有没有值得导出的东西 —— 决定页面是引导态还是可导出态 */
export function hasAnything(b: BackupBundle): boolean {
  const c = countsOf(b);
  return Object.values(c).some((n) => n > 0);
}

// ---------- 解析 ----------

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export type ParseResult = { ok: true; bundle: BackupBundle } | { ok: false; error: string };

/**
 * 解析粘回来的文本。宽容一点:允许带/不带抬头、前后有空白或引号、
 * 甚至只粘 JSON 本体 —— 用户是复制粘贴,不是填表单,格式卡太死只会让人放弃。
 */
export function parseBundle(text: string): ParseResult {
  if (!text || !text.trim()) return { ok: false, error: '先粘贴备份文本' };
  let s = text.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (s.startsWith(BACKUP_HEAD)) s = s.slice(BACKUP_HEAD.length).trim();

  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return { ok: false, error: '这段文本不是备份内容(可能是复制时被截断了)' };
  }
  if (!isMap(raw)) return { ok: false, error: '这段文本不是备份内容' };
  // 版本比本机新 → 可能有本机看不懂的字段,宁可说清楚也不猜着读
  const v = Number(raw.v);
  if (!Number.isFinite(v) || v < 1) return { ok: false, error: '备份内容缺少版本信息,认不出来' };
  if (v > BACKUP_VERSION) return { ok: false, error: '这份备份来自更新版本的小程序,先升级再导入' };

  const bundle: BackupBundle = {
    v,
    at: typeof raw.at === 'string' ? raw.at : '',
    plan: isMap(raw.plan) ? (raw.plan as unknown as TrainingPlan) : null,
    progress: isMap(raw.progress) ? (raw.progress as ProgressState) : {},
    logs: Array.isArray(raw.logs) ? (raw.logs as WorkoutLog[]).filter((l) => !!l?.id && !!l?.date) : [],
    notes: isMap(raw.notes) ? (raw.notes as ExerciseNotes) : {},
    // 只做「是不是个对象」这一道判断,形状交给 kit.ts 的归一(老备份是裸 Kit、新的是 v2)
    kit: isMap(raw.kit) ? (raw.kit as unknown as KitDoc) : undefined,
    maxes: isMap(raw.maxes) ? (raw.maxes as MaxMap) : {},
    photos: Array.isArray(raw.photos) ? (raw.photos as PhotoEntry[]).filter((p) => !!p?.id && !!p?.date) : [],
    // 和其它字段一个路子:认不出来的条目在这一步就丢掉(清洗规则在 custom.ts,不在这儿再写一份)
    custom: sanitizeCustom(raw.custom)
  };
  if (!hasAnything(bundle)) return { ok: false, error: '这份备份里没有训练数据' };
  return { ok: true, bundle };
}

// ---------- 导入 ----------

export interface ImportResult {
  mode: 'merge' | 'replace';
  logsAdded: number;
  notesAdded: number;
  plan: boolean;
  kit: boolean;
  maxes: number;
  photosAdded: number;
  customAdded: number;
}

const byDateDesc = <T extends { date: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/**
 * 把备份写回本机。
 * merge(默认):本机没有的才补,有的原样不动 —— 导入是来救数据的,不是来改数据的。
 * replace:整份覆盖(页面必须让用户明确选过)。
 */
export function applyBundle(b: BackupBundle, mode: 'merge' | 'replace' = 'merge'): ImportResult {
  const res: ImportResult = {
    mode, logsAdded: 0, notesAdded: 0, plan: false, kit: false, maxes: 0, photosAdded: 0, customAdded: 0
  };

  // 日志:按 id 取并集,并按日期倒序保留最近 LOG_CAP 条(本机 key 有大小上限)
  const mine = mode === 'replace' ? [] : loadLogs();
  const ids = new Set(mine.map((l) => l.id));
  const incoming = (b.logs ?? []).filter((l) => !ids.has(l.id));
  res.logsAdded = incoming.length;
  if (incoming.length || mode === 'replace') {
    saveLogs(byDateDesc([...incoming, ...mine]).slice(0, LOG_CAP));
  }

  // 计划/渐进/器材:合的模式下只在本机空着时补,避免把用户当前在练的计划换掉
  const hasPlan = !!loadPlan();
  if (b.plan && (mode === 'replace' || !hasPlan)) {
    savePlan(b.plan);
    res.plan = true;
    if (b.progress) saveProgress(mode === 'replace' ? b.progress : { ...b.progress, ...loadProgress() });
  }

  // 器材:整份替换/补齐(来源可能是老版本那个裸 Kit —— `applyKitDoc` 是同一个收口)
  if (!kitDocEmpty(b.kit) && (mode === 'replace' || kitDocEmpty(loadKitDoc()))) {
    applyKitDoc(b.kit);
    res.kit = true;
  }

  // 力量基准:逐条补,本机已有的不动(手上的基准比备份里的旧数据准)
  const maxes = mode === 'replace' ? {} : loadMaxes();
  for (const [id, m] of Object.entries(b.maxes ?? {})) {
    if (!maxes[id]) { maxes[id] = m; res.maxes++; }
  }
  if (res.maxes) saveMaxes(maxes);

  // 备注:逐条补
  const notes = mode === 'replace' ? {} : { ...loadNotes() };
  for (const [id, t] of Object.entries(b.notes ?? {})) {
    if (!notes[id]) { notes[id] = t; res.notesAdded++; }
  }
  if (res.notesAdded) saveNotes(notes);

  // 自定义动作:按 id 取并集(本机有的原样不动 —— 手上的那份才是最新的,
  // 而且同名的两条不合并:名字能重见,id 不会)
  const customs = mode === 'replace' ? [] : allCustom();
  const customIds = new Set(customs.map((c) => c.id));
  const newCustom = (b.custom ?? []).filter((c) => !customIds.has(c.id));
  res.customAdded = newCustom.length;
  if (newCustom.length || mode === 'replace') {
    saveCustom([...newCustom, ...customs]);
    // saveCustom 不记时间(云同步写回时由调用方盖云端时间戳);这里是用户主动导入,
    // 不记的话这批动作永远比云端旧,换设备登录后会被云端那份覆盖掉
    markTouched('custom', 'main');
  }

  // 照片:按 id 取并集;本地文件路径在上传成功后由同步补上
  const own = mode === 'replace' ? [] : loadPhotos();
  const ownIds = new Set(own.map((p) => p.id));
  const newPhotos = (b.photos ?? []).filter((p) => !ownIds.has(p.id));
  res.photosAdded = newPhotos.length;
  if (newPhotos.length || mode === 'replace') savePhotos(byDateDesc([...newPhotos, ...own]));

  return res;
}

/** 导出文本的空重:超过这个字数的备份,手机剪贴板可能吞不下,提示用户改用文件存 */
export const BIG_BACKUP_CHARS = 100000;

/**
 * 写到小程序自己的文件空间(电脑端微信能直接另存到磁盘)。
 * 走回调式包装而不是 await —— FileSystemManager 是 wx 原生对象,Taro 不会把它 promise 化,
 * 不同基础库对「不传回调就返回 Promise」的支持也不一致。
 */
export function saveToFile(text: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      // 文件名按**本地**那一天:toISOString 是 UTC,UTC+8 的早上 8 点前导出的文件名
      // 会写昨天的日期(用户在那天找文件就会找不到)
      const name = `bodyos-training-${todayStr()}.txt`;
      const filePath = `${Taro.env.USER_DATA_PATH}/${name}`;
      Taro.getFileSystemManager().writeFile({
        filePath,
        data: text,
        encoding: 'utf8',
        success: () => resolve(filePath),
        fail: () => resolve('')
      });
    } catch {
      resolve('');
    }
  });
}
