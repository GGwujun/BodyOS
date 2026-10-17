/**
 * 删掉一个自定义动作时,把这个 id **从所有按 id 存的地方摘干净**。
 *
 * 为什么单独一个模块:要摘的地方散在五个存储里(计划/渐进/备注/收藏/力量基准),
 * 而它们之间互相 import(比如 max → load → custom),塞进 custom.ts 会绕成环。
 * 更实际的原因是**这是唯一一处「删一个动作」的动作**,散在页面里写就等于:
 * 哪天多一个按 id 存的东西(比如再加一种每动作设置),没人会想起来这里还有一份名单。
 *
 * 摘不掉的只有一处:**历史日志**。日志里的动作 id 是「当时做了什么」的记录,
 * 按设计只增不删(见 store.ts 的 LOG_CAP 注释),而且那些账目本来就该留着 ——
 * 所以退场(retire)而不是抹掉:记录还在,统计照算,只是不再出现在任何选择列表里。
 * 这也顺带解决了「练到一半删掉这个动作」—— openGym 的做法是拒绝删除,
 * 因为它要**毁掉**那份元数据;BodyOS 不毁,训练页手里的那个 id 照样认得出名字与器械。
 */
import Taro from '@tarojs/taro';
import { retireCustom, reviveCustom } from './custom';
import { FAV_CAP, loadFavs, saveFavs } from './fav';
import { clearMax, loadMaxes, saveMaxes, type MaxEntry } from './max';
import { cleanPlanUnits } from './order';
import { loadNotes, loadPlan, loadProgress, saveNotes, savePlan, saveProgress, setNote } from './store';
import type { ProgressItem, TrainingPlan } from './types';

export interface PurgeResult {
  /** 是否真的退场了(false = 本来就不在) */
  retired: boolean;
  /** 计划里摘掉了几个动作(含「换个动作」候选里的) */
  planned: number;
  /** 渐进状态里有没有它 */
  progress: boolean;
  /** 备注、收藏、力量基准各自有没有它 */
  note: boolean;
  fav: boolean;
  max: boolean;
}

/** 从计划里摘掉这个动作:正选和「换个动作」候选都算(候选里留着它,换过去就是一个死 id) */
function stripPlan(plan: TrainingPlan | null, id: string): { plan: TrainingPlan | null; n: number } {
  if (!plan) return { plan: null, n: 0 };
  let n = 0;
  const days = plan.days.map((d) => {
    const items = d.items
      .filter((it) => (it.exerciseId === id ? (n++, false) : true))
      .map((it) => {
        if (!it.alternates?.includes(id)) return it;
        n++;
        return { ...it, alternates: it.alternates.filter((a) => a !== id) };
      });
    // 没动这一天的什么都不换(引用不变):页面按引用比对决定要不要重渲染
    const same = items.length === d.items.length && items.every((it, i) => it === d.items[i]);
    return same ? d : { ...d, items };
  });
  if (!days.some((d, i) => d !== plan.days[i])) return { plan, n: 0 };
  // 摘掉超级组里的一半会留下落单的组号(见 order.ts 的 cleanUnits),顺手一起修
  return { plan: cleanPlanUnits({ ...plan, days }), n };
}

/**
 * 撤销记录 —— **只留最近一次**(单槽,和微信自己的「撤销」一个量级)。
 * 存的是「被摘掉的那几格」而不是五份存储的快照:摘的时候我们本来就知道自己删了什么,
 * 记下来就行,撤销时按 id 放回去,不会碰到别人的东西。
 */
interface PurgeUndo {
  id: string;
  at: number;
  /** 摘完之后那份计划的内容。撤销前拿它跟当前计划比对,见 undoPurge 的 CAS 说明 */
  planAfter: string;
  /** 原来那份计划(没有被摘过的话不存) */
  planBefore?: TrainingPlan;
  /** 渐进状态里原来那一格 */
  progress?: ProgressItem;
  /** 原来那条备注 */
  note?: string;
  /** 原来在收藏里 */
  fav?: boolean;
  /** 原来那一格力量基准 */
  max?: MaxEntry;
}

const K_UNDO = 'bodyos.training.purge_undo';
/**
 * 撤销窗口。模态弹窗是**挡着界面**问的,正常就是几秒的事;
 * 五分钟只是给「删完接了个电话」留的余量,不是给「明天想起来再撤销」用的
 * —— 留太久的话,这份记录会一直躺在 storage 里等一个永远不会来的点击。
 */
const UNDO_TTL = 5 * 60_000;

function readUndo(): PurgeUndo | null {
  const u: PurgeUndo | null = Taro.getStorageSync(K_UNDO) || null;
  return u && u.id && typeof u.at === 'number' ? u : null;
}

/**
 * 退场 + 摘干净。返回值只用来给用户看一句「摘掉了哪些」。
 * 顺序:先摘引用(读的时候各份都在),最后退场 —— 中间任何一步失败,都不该留下
 * 「记录没了但计划里还指着它」这种半截状态。
 *
 * **顺带留一份撤销记录**(见 undoPurge):自己建的动作是手打出来的,误删一下
 * 不只是列表里少一行 —— 计划里那几处编排、参考重量(力量基准)、常驻备注会一起没。
 * 别的地方(收藏、日志)都是点一下就能复原的,这里不是。
 */
export function purgeCustom(id: string): PurgeResult {
  const before = loadPlan();
  const { plan, n: planned } = stripPlan(before, id);
  // 撤销记录在**摘之前**就把要摘的那几格抄下来(下面每删一处都顺手存进 undo)
  const undo: PurgeUndo = {
    id,
    at: Date.now(),
    planAfter: JSON.stringify(plan ?? null),
    // 计划真被摘过才留底稿:没摘过(这个动作不在任何计划里)就没什么可还回去的
    planBefore: plan === before ? undefined : (before ?? undefined)
  };
  if (plan) savePlan(plan);

  const progress = loadProgress();
  const hadProgress = id in progress;
  if (hadProgress) {
    undo.progress = progress[id];
    const next = { ...progress };
    delete next[id];
    saveProgress(next);
  }

  const notes = loadNotes();
  const hadNote = id in notes;
  if (hadNote) {
    undo.note = notes[id];
    const next = { ...notes };
    delete next[id];
    saveNotes(next);
  }

  const favs = loadFavs();
  const hadFav = favs.includes(id);
  if (hadFav) {
    undo.fav = true;
    saveFavs(favs.filter((f) => f !== id));
  }

  // 力量基准:自定义动作不在动作库的助力集合里,所以 max.ts 自己不会清它
  // (那边只清助力动作,见 max.ts 读时的 stale 过滤),必须显式摘 ——
  // 留着它的后果是「这个动作我已经删了,纪录里还挂着它」
  const hadMax = id in loadMaxes();
  if (hadMax) {
    undo.max = loadMaxes()[id];
    clearMax(id);
  }

  const retired = retireCustom(id);
  // 本来就不在的话(比如连点两次删除)不留撤销记录:免得第二次把第一次的底稿冲掉
  if (retired) Taro.setStorageSync(K_UNDO, undo);

  return { retired, planned, progress: hadProgress, note: hadNote, fav: hadFav, max: hadMax };
}

/** 撤销结果 —— 哪些东西真的还回来了 */
export interface UndoResult {
  ok: boolean;
  /** 失败原因(给用户看的一句话) */
  why: string;
  /** 计划里还回去了几处、有没有还回去 */
  plan: boolean;
  progress: boolean;
  note: boolean;
  fav: boolean;
  max: boolean;
}

/**
 * 撤销上次删除的动作 —— 把摘掉的那几格按 id 放回去。
 *
 * **计划那一份要比对之后再写**(CAS):计划是**按位置**存的,底稿是一整份 JSON,
 * 直接覆盖就等于「把这几秒里计划上发生的任何改动一起抹掉」。我们只知道自己是
 * 从哪个位置拿走的,没法把别处的改动留在原位 —— 所以对不上就**不动计划**,
 * 如实告诉用户「动作回来了,但计划得自己加一下」,绝不悄悄回退别人的改动。
 *
 * 渐进/备注/收藏/力量基准都不用这套:它们按 id 存,还回去一格不碰别人。
 */
export function undoPurge(): UndoResult {
  const undo = readUndo();
  if (!undo) return fail('没有可撤销的删除');
  if (Date.now() - undo.at > UNDO_TTL) {
    Taro.removeStorageSync(K_UNDO);
    return fail('隔得太久了,这个动作撤不回来了');
  }

  if (!reviveCustom(undo.id)) {
    Taro.removeStorageSync(K_UNDO);
    return fail('这个动作已经不在了');
  }

  // 计划:CAS 过了才还。对不上就**不动计划**,如实告诉用户(见上面的说明)
  const plan = Boolean(undo.planBefore) && JSON.stringify(loadPlan()) === undo.planAfter;
  if (plan) savePlan(undo.planBefore as TrainingPlan);

  const prog = loadProgress();
  const progress = Boolean(undo.progress) && !(undo.id in prog);
  if (progress) saveProgress({ ...prog, [undo.id]: undo.progress as ProgressItem });

  const note = Boolean(undo.note) && !(undo.id in loadNotes());
  if (note) setNote(undo.id, undo.note as string);

  // 收藏满了就不再往里塞 —— sanitizeFavs 是按顺序截到 100 条的,
  // 硬塞一个进去会把最后那条挤掉,那就成了「撤销一次、丢了另一个收藏」
  const favs = loadFavs();
  const fav = Boolean(undo.fav) && favs.length < FAV_CAP && !favs.includes(undo.id);
  if (fav) saveFavs([undo.id, ...favs]);

  const maxes = loadMaxes();
  const max = Boolean(undo.max) && !(undo.id in maxes);
  if (max) saveMaxes({ ...maxes, [undo.id]: undo.max as MaxEntry });

  Taro.removeStorageSync(K_UNDO);
  return { ok: true, why: '', plan, progress, note, fav, max };
}

function fail(why: string): UndoResult {
  return { ok: false, why, plan: false, progress: false, note: false, fav: false, max: false };
}
