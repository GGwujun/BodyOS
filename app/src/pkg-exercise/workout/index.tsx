import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Button, Switch, Textarea } from '@tarojs/components';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import Screen from '@/components/Screen';
/* 体重弹层是**主包**那个组件(体重页/方案页也用同一个)—— 重量的取值与校验只有那一处 */
import WeightSheet from '@/components/WeightSheet';
import { track } from '@/services/analytics';
import { applyWorkout, canProgress, type WorkoutEntry } from '../engine/progression';
import { loadPrefix, loadText, liftE1rm, warmupFor } from '../engine/load';
import { repStepOf, sideRepsText, sidedInPlan } from '../engine/sided';
import { expandSets, SETTYPE_ZH, type SetType } from '../engine/settype';
import { EFFORT_PRESETS, effortColor, effortVerdict } from '../engine/effort';
import { findExercise, patternPool, buildItem } from '../engine/generator';
import { refLine, refText } from '../engine/history';
import { demoUrl } from '../engine/ex-media';
import { PATTERNS } from '../engine/patterns';
import { applyCycle, cycleSummary } from '../engine/cycle';
import { GROUP_ZH, groupsOf } from '../engine/muscles';
import { canMoveWorkoutRow, cleanUnits, inUnit, insertWorkoutRow, moveWorkoutRow } from '../engine/order';
import { READY_AT, recoveryOf } from '../engine/recovery';
import {
  EXTEND_SEC, extendRest as extendRestTimer, restOver, restPct, restRemain as remainOf,
  restStart, toggleRestPause as togglePause, type RestTimer
} from '../engine/rest';
import { loadMaxes, pctOfWeight, syncMaxesFromLogs, tmOf, type MaxMap } from '../engine/max';
import { loadKit, loadHint, snappedByPlates, stepOwned, usesBar, type Kit } from '../engine/kit';
import { EQUIPMENT_ZH, MUSCLE_ZH, type ExerciseEntry } from '../data/exercises';
import { appendLog, loadPlan, loadProgress, loadLogs, savePlan, saveProgress, loadNotes, setNote, updateLog, type ExerciseNotes } from '../engine/store';
import { loadFavs, sortedByFav, usageOf } from '../engine/fav';
import { ALERT_DEFAULT, buzz, isTickSecond, keepAwake, loadAlert, type AlertPrefs } from '../engine/alert';
import { loadDayAssigns, resolveDayKey } from '../engine/dayassign';
import ExHowTo, { DemoImage, FigureImage } from '../howto';
import { figureUrl } from '../engine/ex-figure';
import {
  HOLD_MAX_SEC, HOLD_STEP_SEC, clampHoldSec, holdRangeText, holdSecOfSets, holdText
} from '../engine/timed';
import { todayStr } from '@/utils/date';
import { autoSync } from '../engine/sync';
import { syncWorkoutActivity } from '../engine/workout-energy';
import { logDayKeys, type PlanDay, type PlannedExercise, type ProgressState, type TrainingPlan, type WorkoutLog } from '../engine/types';
import { dayForKeys, splitDayKey } from '../engine/schedule';
import { param } from '@/utils/url-param';
import { workoutText } from '../engine/workout-text';
import { SPAN_STEP_MIN, fmtDuration, fmtSpan, spanMinutes, spanSeconds } from '@/utils/duration';
import { setLeaveGuard, syncNativeGuard } from '@/utils/leave-guard';
import { loadTrainingDigest, saveTrainingDigest } from '@/utils/training-digest';
import { saveTrainingProgress } from '@/utils/training-progress';
import { progressOf } from '../engine/progress';
import { clearDraft, draftAlreadyDone, draftBrief, loadDraft, saveDraft, type DraftRow, type WorkoutDraft } from '@/utils/workout-draft';
import { copyText } from '@/utils/ui';
import './index.scss';
import { THEME } from '@/constants/theme';
import { navigate } from '@/utils/nav';
import { onIf } from '@/utils/taro-events';

interface SetRow {
  reps: number;
  weightKg: number | null;
  done: boolean;
  rir: number | null;
  /** 组型标签(递减/力竭/降重/金字塔档位),空串=普通组 */
  tag?: string;
  /** 该组的额外提示 */
  note?: string;
  /**
   * 计时组的**实际**时长(秒)。次数型的组没有这个字段。
   * 未开始计时 = undefined(那一行显示处方秒数当占位);计时中 = 还在走;
   * 按停之后 = 记下来的实际值,可以再用 −/＋ 手动改(见 engine/timed.ts)。
   */
  sec?: number;
  /**
   * 这一组是训练中临时加的(点了「＋ 加一组」),不是计划里本来就有的 ——
   * 意义见 utils/workout-draft.DraftSet.added:只有加出来的那一组能撤。
   */
  added?: true;
}
interface Row {
  exerciseId: string;
  nameZh: string;
  /** 动作模式 id(换动作/历史面板用) */
  patternId: string;
  restSec: number;
  weightStepKg: number;
  isBodyweight: boolean;
  /** 单侧动作(次数记两侧合计,显示每侧,步进按 2)— 见 engine/sided.ts */
  sided?: boolean;
  /**
   * 计时型动作的处方(秒)。有它 = 这一行按**时长**练:交互是「开始 → 撑 → 按停」,
   * 次数步进器换成秒数步进器,「做完了没有」也不看 reps(它恒为 0)。见 engine/timed.ts。
   */
  holdSec?: { min: number; max: number };
  /** 进阶组型(常规组为 'normal') */
  setType: SetType;
  /** 超级组标识(同 id 的动作交替做);非超级组为 undefined */
  superset?: string;
  /**
   * 这个动作**本次不计入进阶**(⋯ 面板里那个开关):组数容量照记,但下次目标不动。
   * 用「这次」这个粒度解决的事:换了台器械(重量不可比)、这一组只是热身性质的轻重量、
   * 动作没做标准不想让它记账 —— 这些情况下其余动作的数据都是好的,
   * 不该像整场「不算进步」那样一起作废。见 engine/types 的 entries[*].noProg。
   */
  noProg?: boolean;
  /** 热身组数(0 = 不热身;缺省按自动推,最多 3 组)—— 见 engine/types.warmupSets */
  warmupSets?: number;
  /** 这一天的安排备注,和动作常驻备注(notes[exerciseId])分开显示 */
  note?: string;
  sets: SetRow[];
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;
const fmtW = (n: number | null) => (n == null ? '自重' : `${n % 1 === 0 ? n : n.toFixed(1)}kg`);
/** 休息处方:0 秒是「不休息」(超级组、拉伸),不是「休息 0s」—— 与计划的念法一致(见 utils/duration) */
const restText = (sec: number) => fmtDuration(sec, '不休息');

/** 一句话说清「上次那场还剩多少」—— 这里和首页那张「继续」卡用同一份数(draftBrief) */
const draftProgress = (d: WorkoutDraft) => {
  const b = draftBrief(d);
  return `${b?.title || '上次那场'}练到一半(已练 ${b?.sets ?? 0}/${b?.total ?? 0} 组)`;
};

/** 训练执行 — 勾组、调次数重量、组间休息倒计时,完成后渐进引擎算下次目标 */
export default function Workout() {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  /** 存下来的计划(完成训练时回写它的 doneCount/lastNote;波次只套在 day/rows 上,不改它) */
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  /** 本周实际要练的训练日(已按周期套过波次/减载) */
  const [day, setDay] = useState<PlanDay | null>(null);
  /** 本周周期文案(第 N/4 周 · …),没开周期为 null */
  const [cycleLabel, setCycleLabel] = useState<string | null>(null);
  const [maxes, setMaxes] = useState<MaxMap>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [elapsed, setElapsed] = useState(0);          // 本次训练时长
  /** 休息状态 — 墙钟模型:只存结束时刻,剩余秒数由当前时间反算(见下方 effect) */
  /**
   * 休息计时。`pausedAt` 有值 = 暂停中(存的是按下暂停的那一刻,见下面的 effect)——
   * 器材被人占着、教练叫你说两句话,这些都是**休息还在继续但你不该被计时**的时刻。
   */
  const [rest, setRest] = useState<RestTimer | null>(null);
  const [restRemain, setRestRemain] = useState(0);
  /**
   * 提示设置(保屏 / 震动),见 engine/alert.ts。放在 ref 里是因为它要在两个不重订阅的
   * effect(休息 tick、卸载兜底)里读到**最新**那一份 —— 每次回到前台 `useDidShow` 重读。
   * 初值给默认那份而不是当场 `loadAlert()`:这页休息时每 250ms 重渲染一次,
   * 把一次存储读塞进渲染函数就是每秒四次白读(真正那份在 `useDidShow` 里落进来)。
   */
  const alertRef = useRef<AlertPrefs>(ALERT_DEFAULT);
  /** 上一次播报过的剩余秒数 —— 定时器 250ms 一跳,同一个秒数上会跳好几下,靠它做到一秒只响一次 */
  const tickedRef = useRef(0);
  const [summary, setSummary] = useState<{
    logId: string; notes: string[];
    /**
     * 这次标了「不算进步」的**动作名**(从落下来的日志里取,不从页面状态取)——
     * 汇总页要拿它点名说一句,见下面那段注释
     */
    progOff: string[];
    sets: number; reps: number; volume: number; holdSec: number; sec: number; avgRir: number | null; sessionNote: string | null; noProg: boolean;
  } | null>(null);
  /**
   * 完成汇总页上正在手改的时长(分钟);`null` = 没在改,显示墙钟算出来的那个数。
   * 见 utils/duration.ts 的收口与下面的 `saveDuration` —— 计时是墙钟算的,被打断那次会虚高。
   */
  const [durMin, setDurMin] = useState<number | null>(null);
  /** 正在打分的组:{ri, si} | null — 打开自感强度选择器 */
  const [rating, setRating] = useState<{ ri: number; si: number } | null>(null);
  /** 是否显示强度列(用户第一次打分后自动开启并记住) */
  const [showEffort, setShowEffort] = useState(false);
  /** 已勾选的热身组 key:`${行号}-${热身序号}`(热身不落日志,只做打勾引导) */
  const [warmDone, setWarmDone] = useState<Set<string>>(new Set());
  /** 展开了热身区的动作行号 */
  const [openWarm, setOpenWarm] = useState<Record<number, boolean>>({});
  /**
   * 用户**手动展开过**的、已经练完的动作行号 —— 已练完的默认折成一行(见下方 wk-fold)。
   * 只在「点开过」时记一笔,不做反向记账:一整天里把某一行重新打开来看过(核对自己的组、
   * 或者要取消一个勾),那一行就保持展开 —— 取消勾之后整行会正常展开,再勾回来**不重新折**,
   * 因为那一下的时机正是他的手指还停在勾上,突然阖上会像是点错了。
   */
  const [doneOpen, setDoneOpen] = useState<Record<number, boolean>>({});
  /**
   * 手动收起过演示图的动作行号(见下方 wk-demo)。
   * 收起来是「我知道这个动作怎么做,把地方让给组数」—— 换个动作又是新的一行,自动重新摆出来。
   */
  const [demoShut, setDemoShut] = useState<Record<number, boolean>>({});
  /** 历史训练日志(动作历史面板用) */
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  /** 动作操作面板:行号 | null */
  const [ops, setOps] = useState<number | null>(null);
  /** 换动作面板:行号 | null */
  const [swap, setSwap] = useState<number | null>(null);
  /** 换动作面板里选中的动作模式(默认当前动作的模式) */
  const [swapPid, setSwapPid] = useState<string>('');
  /**
   * 这个面板是「换掉当前这个」还是「加练一个」—— 两个入口共用同一份选动作的界面
   * (器械筛选、收藏优先、模式 chips 都一样),差别只在标题和点下去是替换还是插入。
   */
  const [swapAdd, setSwapAdd] = useState(false);
  /** 动作历史面板:行号 | null */
  const [hist, setHist] = useState<number | null>(null);
  /**
   * 动作速查栏:行号 | null —— 「这个动作怎么做」。
   * 以前只能退出去翻动作库:push 过去的页面回来会重挂载,而这一场的组数只活在本页内存里
   * (`rows`),所以要么丢掉刚练的那几组、要么被离开守卫拦一下 —— 两条路都不该出现在
   * 「站着、手上带着镁粉、只想确认一下手肘朝哪」的那一刻。步骤与动作库详情弹层同一份
   * (见 howto/HowTo.tsx)。
   */
  const [howTo, setHowTo] = useState<number | null>(null);
  /** 体重弹层开着 | 已保存过(见 wk-weigh)—— 只在本次训练里为真 */
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighed, setWeighed] = useState(false);
  /** 动作常驻备注(exerciseId → 文本) */
  const [notes, setNotes] = useState<ExerciseNotes>({});
  /** 收藏的动作 id(换动作面板里优先顶上来) */
  const [favs, setFavs] = useState<string[]>([]);
  /** 专注模式:当前全屏展示的动作行号 | null */
  const [focus, setFocus] = useState<number | null>(null);
  /** 正在编辑备注的动作 id | null */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  /** 我的器材(杠铃片/杆重/哑铃档位)— 只用来把重量翻译成「每边挂什么」和让步进落在真有的重量上 */
  const [kit, setKit] = useState<Kit>({});
  /** 本次训练的感受(完成时写进日志) */
  const [sessionNote, setSessionNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  /** 这次不算进步(伤后/状态很差的那次)—— 只在这一屏能设,见 types.WorkoutLog.noProg */
  const [noProg, setNoProg] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const startedAt = useRef<number>(Date.now());
  /**
   * 这一场**属于哪一天**(草稿里那个 date)。
   * 默认是今天开练那天;续上一场时用草稿原来那一天 —— 隔夜接着练的话,
   * 这一场仍然算昨天开始的那一场,首页那句「10月13日那场」才不会随着跨零点变成「今天」。
   */
  const draftDate = useRef<string>(todayStr());
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 载入计划与实时目标,初始化可编辑组行。
   *
   * **三条入口**:新开一场 / 「照上次再来一遍」/ 接着练上一次没结束的那场。
   * 前两条各自铺底(计划处方、上一次日志),第三条整场搬回来(见 utils/workout-draft.ts)。
   */
  const boot = async () => {
    const p = loadPlan();
    if (!p) {
      navigate('/pkg-exercise/plan-view/index', { replace: true });
      return;
    }
    const prog: ProgressState = loadProgress();
    // 本周实际要练的样子:开了周期就按波次/减载套一层(不动存下来的计划)
    const applied = applyCycle(p, loadMaxes());
    const cycleLbl = cycleSummary(p);
    /** 三条入口的收尾都一样;`at` 是这一场的墙钟起点 */
    const settle = (d: PlanDay, rs: Row[], at: number) => {
      setPlan(p);
      setDay(d);
      setRows(rs);
      setCycleLabel(cycleLbl);
      setMaxes(loadMaxes());
      setLogs(loadLogs());
      setNotes(loadNotes());
      startedAt.current = at;
    };
    /**
     * 接着练。`startedAt` 是**反推**出来的:`Date.now() - 已经走过的那段`。
     * 不能拿草稿里原始的 startedAt —— 被系统回收后隔一夜再打开,那一场会变成
     * 「已经练了 14 小时」,而这个数要进日志、进「本周练了多久」(见 utils/workout-draft.ts)。
     */
    const resume = (draft: WorkoutDraft): boolean => {
      // 合并训练的草稿没有一条现成的 PlanDay —— 按存下来的 dayKeys 重新拼
      const keys = draft.dayKeys?.length ? draft.dayKeys : splitDayKey(draft.dayKey);
      const d = dayForKeys(applied, keys) ?? applied.days[0];
      // 一份草稿却在计划里找不到那天(计划被大改过)—— 退回第一套,总比丢掉整场强
      if (!d) return false;
      draftDate.current = draft.date;
      settle(d, draft.rows.map(rowOf), Date.now() - draft.sec * 1000);
      setWarmDone(new Set(draft.warmDone));
      setShowEffort(draft.showEffort);
      setSessionNote(draft.sessionNote);
      setNoProg(draft.noProg);
      setWeighed(draft.weighed);
      return true;
    };
    /**
     * 这一次练哪几套。三个来源,优先级从高到低:
     *   ① 计划页/首页带过来的 `keys=a,b`(固定周一天排了两套,合并训练);
     *   ② 单套的 `key=a`;
     *   ③ 什么都不带 —— 问日程(resolveDayKey:改练优先,否则轮转下一套)。
     * ③ 也可能给出合成 key(`a+b`),所以最后还是拆成数组。
     */
    const asked = params.keys
      ? params.keys.split(',').map((k) => param(k)).filter(Boolean)
      : params.key
        ? splitDayKey(param(params.key))
        : splitDayKey(resolveDayKey(p, loadLogs(), loadDayAssigns(), todayStr()));
    /**
     * 上一次没结束就被系统回收(或从小程序列表里划掉)的那一场。
     * 首页那张「继续」卡带 `resume=1` 进来;不带参数时只在**今天同一套**上自动续 ——
     * 从原生返回键退出再进来,他看到的就是「我刚才那一场」。
     * 日期对不上的旧草稿不自动续:隔了两天再进训练页,人要的是新的一场。
     * 「照上次再来一遍」是明确的另一件事,那条路上不碰草稿。
     */
    let draft = params.repeat ? null : loadDraft();
    // 旧版本练完关汇总时会把刚清掉的草稿写回来(见 utils/workout-draft.ts)。
    // 首页会自愈,但从训练 tab / 分享链接直接进训练页时首页可能根本没开过 —— 同样先认一下:
    // 已经全勾完、今天这一套又确实进了日志,就不该再摆出一场「还没练完」。
    if (draft && draftAlreadyDone(draft, loadTrainingDigest())) {
      clearDraft();
      draft = null;
    }
    if (draft) {
      const draftKeys = draft.dayKeys?.length ? draft.dayKeys : splitDayKey(draft.dayKey);
      const same = draftKeys.length === asked.length && draftKeys.every((k) => asked.includes(k));
      if (params.resume || (same && draft.date === todayStr())) {
        if (resume(draft)) return;
      } else {
        /**
         * 手上还有一场没结束,这次要练的却是另一套 —— 覆盖之前先问一句。
         * 不问的话,新一场勾第一组就把旧的盖掉了,而首页那句「继续」会变成谎话。
         * (openGym 在今日行上摆的是 Resume 而不是 Start,问的就是同一件事。)
         */
        const res = await Taro.showModal({
          title: '还有一场没练完',
          content: `${draftProgress(draft)},继续那一场,还是放弃它、练这一场?`,
          confirmText: '继续那场',
          cancelText: '放弃,练这场'
        });
        if (res.confirm && resume(draft)) return;
        clearDraft();
      }
    }
    // 「照上次再来一遍」:用上一次日志的实际重量/次数铺底
    const repeatLog = params.repeat ? loadLogs().find((l) => l.id === params.repeat) : null;
    if (repeatLog) {
      const d = dayForKeys(applied, logDayKeys(repeatLog)) ?? applied.days[0];
      if (!d) return;
      const rows: Row[] = d.items.map((it) => rowsOf(it, prog));
      const seen = new Set(rows.map((r) => r.exerciseId));
      for (const e of repeatLog.entries) {
        const seed = e.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg, done: false, rir: s.rir }));
        const hit = rows.find((r) => r.exerciseId === e.exerciseId);
        if (hit) { hit.sets = seed; continue; }          // 计划里还有这个动作 → 照上次的实际数据铺
        if (seen.has(e.exerciseId)) continue;
        rows.push({                                  // 计划里已没有 → 临时补一行
          exerciseId: e.exerciseId,
          nameZh: e.nameZh,
          patternId: '',
          restSec: 90,
          weightStepKg: 2.5,
          isBodyweight: e.sets.every((s) => s.weightKg == null),
          setType: 'normal',
          sets: seed
        });
      }
      settle(d, rows, Date.now());
      return;
    }
    const d = dayForKeys(applied, asked) ?? applied.days[0];
    if (!d) return;
    settle(d, d.items.map((it) => rowsOf(it, prog)), Date.now());
  };

  /** 保存动作常驻备注(空文本 = 删除) */
  const saveNote = () => {
    if (!noteFor) return;
    setNotes(setNote(noteFor, noteDraft));
    setNoteFor(null);
  };

  /**
   * 草稿里那一行搬回页面。组型要**认一遍**:它是从存储里读回来的,
   * 一个不认识的值会让那一行取不到标签/组型文案(手改过存储、或将来删掉某个组型都会这样)。
   * 只认当前这套组型,不认识的当常规组 —— 宁可少一个标签,也不能让整页崩掉。
   */
  const rowOf = (r: DraftRow): Row => ({
    ...r,
    setType: (SETTYPE_ZH as Record<string, string>)[r.setType] ? (r.setType as SetType) : 'normal'
  });

  /** 把计划槽位 + 实时渐进目标展开成可编辑的组行 */
  const rowsOf = (it: PlannedExercise, prog: ProgressState): Row => {
    // 波次锁定的动作按本周处方走,不看渐进状态(两者的重量不是一个来源)
    const live = it.cycleLocked ? undefined : prog[it.exerciseId];
    const w = live ? live.weightKg : it.weightKg;
    const rMin = live ? live.repsMin : it.repsMin;
    const rMax = live ? live.repsMax : it.repsMax;
    const stepKg = it.weightStepKg || 2.5;
    // 计时型动作的秒数目标随渐进走(progress 里有就用它那份),和次数型取 rMin/rMax 同理
    const holdSec = it.holdSec ? (live?.holdSec ?? it.holdSec) : undefined;
    const seeds = expandSets(
      {
        sets: it.sets, repsMin: rMin, repsMax: rMax, weightKg: w, sided: it.sided,
        // 计时动作**不带**末组尽力:它那个「超过目标继续撑」的语义正好就是 amrap 想表达的东西,
        // 挂上去只会在行尾多一个「尽力」标签、再附一句说「把实际次数记下来」的话(而它没有次数)
        amrapLast: holdSec ? false : it.amrapLast
      },
      it.setType ?? 'normal',
      stepKg
    );
    return {
      exerciseId: it.exerciseId,
      nameZh: it.nameZh,
      patternId: it.patternId,
      restSec: it.restSec,
      weightStepKg: stepKg,
      isBodyweight: w == null,
      sided: it.sided,
      holdSec,
      setType: it.setType ?? 'normal',
      superset: it.superset,
      // 这两个是「这一天的安排」,不是动作属性:热身的组数在计划里可以按动作单独设
      // (大重量自由重量 3 组、小肌群器械 1 组、拉伸 0 组),备注也是这一天的事
      warmupSets: it.warmupSets,
      note: it.note,
      // 计时组的次数一律归 0(见 engine/timed.ts):`expandSets` 的组型是按次数算的
      // (金字塔取 `Math.max(1, …)`、减重组取 `min(30, repsMax + 4)`),
      // 一个组型挂在平板支撑上会凭空造出「1 次」「4 次」—— 界面上看不出来(那一格显示的是秒),
      // 但它会顺着日志写进统计。归零放在这里,和「完成时写 0」是同一个约定的两道口子。
      sets: seeds.map((s) => ({
        reps: holdSec ? 0 : s.reps, weightKg: s.weightKg, done: false, rir: null, tag: s.tag, note: s.note
      }))
    };
  };

  /**
   * 顺序变了 → 把「按行号记着」的临时状态跟着搬(order[新位置] = 旧位置)。
   * 热身打勾(键是「行号-热身序号」)、展开了哪几行的热身区、手动展开过哪几个已完成的动作、
   * 专注模式在看第几个、正在打分的那一组、正在撑的那一组 —— 这些都不在 rows 里,不搬就会跟错动作。
   *
   * 正在计时的那个(计时型的「按停」)是漏不得的一个:它不搬的话,读数会跳到另一个动作上去,
   * 而按停时写秒数的那一步读的是 `rows[timing.ri]`(见 stopHold)—— 平板撑的 45 秒会记到
   * 旁边那个卧推的组上。行没了(删掉)就干脆停掉计时:那一组已经不在了,秒数没有地方可写。
   */
  const remapIndexes = (order: number[]) => {
    const at = new Map(order.map((old, i) => [old, i]));
    /** 旧行号 → 新行号;那一行没了(null)就把状态一起丢掉 */
    const to = (old: number) => (at.has(old) ? (at.get(old) as number) : null);
    setWarmDone((s) => new Set([...s].flatMap((k) => {
      const p = k.indexOf('-');
      const next = to(Number(k.slice(0, p)));
      return next == null ? [] : [`${next}${k.slice(p)}`];
    })));
    setOpenWarm((m) => Object.fromEntries(
      Object.entries(m).flatMap(([k, v]) => {
        const next = to(Number(k));
        return next == null ? [] : [[String(next), v] as [string, boolean]];
      })
    ));
    setDoneOpen((m) => Object.fromEntries(
      Object.entries(m).flatMap(([k, v]) => {
        const next = to(Number(k));
        return next == null ? [] : [[String(next), v] as [string, boolean]];
      })
    ));
    setHowTo((h) => (h == null ? h : to(h)));
    setFocus((f) => (f == null ? f : to(f)));
    setRating((r) => (r == null ? r : (() => { const ri = to(r.ri); return ri == null ? null : { ...r, ri }; })()));
    setTiming((t) => (t == null ? t : (() => { const ri = to(t.ri); return ri == null ? null : { ...t, ri }; })()));
  };

  /** 行内操作:上移/下移/删除(只改本次训练,不动计划) */
  const moveRow = (ri: number, delta: number) => {
    const moved = moveWorkoutRow(rows, ri, delta);
    if (!moved) return;
    setRows(moved.rows);
    remapIndexes(moved.order);
  };
  /**
   * 「本次不练这个」—— **问一句再移出**。
   *
   * 它是这一屏里唯一不可逆的动作:移出之后这一行连同**已经记下的组**一起没了,
   * 想练回来只能走「加练一个动作」,而加进来的动作是计划外的(`canProgress` 为假)、
   * 那些组也就不再参与下次目标的推导 —— 手抖一下的代价是这一整个动作白记。
   * 所以走全站统一的那套确认(`Taro.showModal`),文案跟着「记了几组」改口:
   * 没记过组的人只需要知道「计划不受影响」,记过组的人得先知道**会丢什么**。
   *
   * 面板不提前关:取消之后用户还在原来那一屏,不用重新点开 ⋯ 再找一遍。
   */
  const delRow = async (ri: number) => {
    const row = rows[ri];
    if (!row) return;
    const done = row.sets.filter((s) => s.done).length;
    const { confirm } = await Taro.showModal({
      title: '本次不练这个',
      content: done > 0
        ? `这个动作已经记了 ${done} 组,移出后这次训练里就没有它了(那些组一起丢)。计划不受影响。`
        : '这次训练里不再安排它。计划不受影响。',
      confirmText: '移出',
      cancelText: '留着'
    });
    if (!confirm) return;
    // 删掉超级组里的一个 → 剩下的那个不再成组,顺手把组号摘掉(否则它挂着「超级组」徽标却没有同伴)
    setRows((rs) => cleanUnits(rs.filter((_, i) => i !== ri)) as Row[]);
    setOps(null);
    remapIndexes(rows.map((_, i) => i).filter((i) => i !== ri));
    Taro.showToast({ title: '本次训练已移除', icon: 'none' });
  };

  /**
   * 切换「本次不计入进阶」。**要在这里设,不能等练完再设**:结束训练那一刻
   * `applyWorkout` 就把下次目标推完了,汇总页上那句「下次目标已更新」也已经印出来了 ——
   * 事后补一个开关,只会让页面上「卧推 加到 65kg」和「卧推不计入进阶」同时挂着,
   * 而这两个说法互相打架(见 docs/04 的「一页上的同一个量只许有一个口径」)。
   */
  const toggleRowProg = (ri: number) => {
    const off = !rows[ri].noProg;
    setRows((rs) => rs.map((r, i) => (i !== ri ? r : { ...r, noProg: off ? true : undefined })));
    setOps(null);
    // 记的是**排除**这个动作:次数多说明「渐进规则不适用」是常态而不是例外
    // (器械换来换去、或者总在做不标准的重量)—— 那是要回计划里调的动作,不是他多按了一下
    if (off) track('training_row_noprog', 'other');
  };

  /** 关掉选动作的面板(两个模式各有一份状态,下次从哪个入口开都得是干净的一份) */
  const closeSwap = () => {
    setSwap(null);
    setSwapAdd(false);
  };

  /** 换动作:按新模式重建组行(本次训练生效,计划本身不变) */
  const swapTo = (ri: number, patternId: string, ex: ExerciseEntry) => {
    setRows((rs) => rs.map((r, i) => (i !== ri ? r : rowsOf(
      // 组号要跟着带过来:换掉超级组里的一个动作,另一个还在原地等着跟它交替做
      { ...buildItem(patternId, ex, plan?.goal ?? 'muscle'), sets: r.sets.length, restSec: r.restSec, superset: r.superset },
      loadProgress()
    ))));
    closeSwap();
  };

  /**
   * 加练一个动作:插在当前动作(整块超级组)之后,后面的动作顺次后移。
   * 和「换个动作」分开是因为语义不同:它**不是**今天该练的清单里那些,是临时加进来的,
   * 所以走 `buildItem` 从零建组行(组数/重量按渐进状态来),不继承任何东西。
   */
  const addTo = (after: number, patternId: string, ex: ExerciseEntry) => {
    const next = insertWorkoutRow(rows, after, rowsOf(buildItem(patternId, ex, plan?.goal ?? 'muscle'), loadProgress()));
    if (!next) return;
    setRows(next.rows);
    remapIndexes(next.order);
    closeSwap();
    track('training_add_exercise', 'other');
    // 新卡插在当前这张的下面:说得清它去哪了(说「不影响计划」是为了别让他以为计划被改了)
    Taro.showToast({ title: `已加练「${ex.nameZh}」,只影响这次`, icon: 'none' });
  };

  /**
   * 加一组:照最后一组的重量/次数再来一次。
   * 刚做完那组是多重,下一组就还是多重 —— 递减组做完想补一组、或者今天状态好想多来一组,
   * 都不该先按一串加减把重量调回去。只有「做没做」和「自感强度」归零:
   * 复制一份已评的档位等于替他决定了这组有多累,而闹钟/打勾那一格本来就不在组对象里。
   */
  const addSet = (ri: number) => {
    setRows((rs) => rs.map((r, i) => (i !== ri ? r : {
      ...r,
      // `added` 是这一组的来路:它是被加出来的,所以只有它能被撤(见下面 delAddedSet)
      sets: [...r.sets, { ...(r.sets[r.sets.length - 1] ?? { reps: 10, weightKg: null }), done: false, rir: null, added: true as const }]
    })));
    track('training_add_set', 'other');
  };

  /**
   * 撤掉一组**临时加的**(「＋ 加一组」按错的那一下)。
   *
   * 为什么不给所有组都配一个删除:
   * 计划里写了三组、今天只做了两组,少做的那组是信息(那个重量的刺激没做完),留着不打勾就行 ——
   * 它不会进统计(见 progression 里 `filter((s) => s.done && didSet(s))`)。
   * 但按错一下多出来的那一组不是计划的一部分:它会在底栏和「结束训练」的确认框里
   * 一直说「还有 1 组没完成」,而用户根本没打算做它。两种组分清,只放前一种走。
   *
   * 只让**最后一组**且**没勾上的**能撤:删中间那一组会让后面每一组的序号前移,
   * 而「正在打分的那一组」「正在撑的那一组」都是按下标记的(见 rating/timing),
   * 挪一格就指到别人身上去了。加出来的组永远在末尾,所以这条限制不会挡到该走的路。
   */
  const delAddedSet = (ri: number, si: number) => {
    setRows((rs) => rs.map((r, i) => {
      if (i !== ri) return r;
      const s = r.sets[si];
      if (!s?.added || s.done || si !== r.sets.length - 1) return r;
      return { ...r, sets: r.sets.filter((_, j) => j !== si) };
    }));
  };

  /**
   * 落盘:每次改动写一份(模块内按内容去重,没变就不写)。
   * 一组都没勾就不写 —— 那是「点进来看了一眼」,首页不该为它摆一个「继续」。
   * 结束训练之后(有 summary)也不写:那一刻这些组已经进了日志,草稿的使命完了。
   *
   * 定义在生命周期钩子**上面**:下面的 `useDidHide` 要读它(见那里)。
   */
  /**
   * 这一场已经收尾 —— 组数进了日志、草稿也清了。从这一刻起任何写入都不许再跑:
   * 汇总页关闭时 `closeSummary` 会先 `setSummary(null)` 再退出,那一帧 rows 还全勾着、
   * `finishing` 也已经复位;没有这道闩,下面的 effect / `useDidHide` 会把刚清掉的草稿
   * 原样写回来 —— 首页就会一边说「今天练完了」、一边摆着「12/12 组还没练完」。
   */
  const finishedRef = useRef(false);
  const writeDraft = () => {
    if (finishedRef.current) return;
    if (!plan || !day || summary || finishing) return;
    if (!rows.some((r) => r.sets.some((s) => s.done))) return;
    saveDraft({
      date: draftDate.current,
      dayKey: day.key,
      // 合并训练的光看 dayKey 分不出有哪些套 —— 恢复时要靠这份重新拼
      dayKeys: splitDayKey(day.key),
      dayTitle: day.title,
      startedAt: startedAt.current,
      rows,
      warmDone: [...warmDone],
      showEffort,
      sessionNote,
      noProg,
      weighed
    });
  };
  /** 钩子拿到的必须是**最新**那一份(切后台那一下再补一次;deps 里刻意没有 elapsed) */
  const writeRef = useRef(writeDraft);
  writeRef.current = writeDraft;
  useEffect(() => {
    writeDraft();
  }, [plan, day, rows, warmDone, showEffort, sessionNote, noProg, weighed, summary, finishing]);

  /** 该动作的历史记录(最近 6 次) */
  const historyOf = (exerciseId: string) => logs
    .map((l) => ({ date: l.date, dayTitle: l.dayTitle, sets: l.entries.find((e) => e.exerciseId === exerciseId)?.sets ?? [] }))
    .filter((h) => h.sets.length > 0)
    .slice(0, 6);

  useDidShow(() => {
    setKit(loadKit());   // 训练中跑去「我的器材」改了库存,回来立刻按新库存算
    setFavs(loadFavs()); // 动作库里刚星过的动作,回来换动作时就该排前面
    if (!plan) { boot(); track('training_workout_start', 'other'); }
    // 保屏是**一次性**的:训练中退到小程序外面就失效,所以每次回到前台都重设一遍
    // (和休息计时同一个道理,不能只在挂载时设一次)。设置项在提醒页那个「练的时候」卡里。
    const prefs = loadAlert();
    alertRef.current = prefs;
    keepAwake(true, prefs);
    // 回到前台:定时器若在后台被系统清除,这里至少能判定"已过点"并收掉休息条。
    // **这一路刻意不震**:那一震的信号是「你正看着,它到点了」,而这一路正是你不在的时候
    // 过去的(锁屏、切去了别的页面),回来再补一下是惊吓不是提示;而且人已经回到页面上了,
    // 休息条消失本身就是他要的那个变化。见 engine/alert.ts 模块头。
    // 暂停中的那份要留住:`pausedAt` 一冻结,`endsAt` 就落到了过去,不排掉的话
    // 「回到前台」这一路会把暂停中的计时当成到点收掉(用户回来一看,暂停没了)—— `restOver` 里
    setRest((r) => (r && restOver(r, Date.now()) ? null : r));

    // 回到前台时,上一轮撑到一半就切走了 —— **按切走的那一刻结账**。
    // 不能拿「现在」当结束时间:切走去接了个电话、十分钟后回来,那一组会记成
    // 「平板支撑 600 秒」。人在后台的那段时间里肌肉并没有在撑,那不是他的成绩。
    // 所以用 useDidHide 存下来的时刻当终点 —— 它才是「他还在撑」的最后证据。
    if (timing && hideAt.current) {
      const sec = clampHoldSec(Math.round((hideAt.current - timing.startedAt) / 1000));
      hideAt.current = 0;
      stopHold(sec);
    }
  });
  useDidHide(() => {
    keepAwake(false, alertRef.current);
    if (timing) hideAt.current = Date.now(); // 见上面 useDidShow 里那一段
    // 这一下可能是最后一次机会:切后台之后小程序随时会被系统回收(那一步没有任何回调)
    writeRef.current();
  });
  // 离开训练页时兜底关掉(从训练页直接跳走不会触发 onHide)
  useEffect(() => () => keepAwake(false, alertRef.current), []);

  /**
   * 这一场有没有**还没记下来**的组 —— 勾过的组就是它的全部。
   *
   * 落盘已经从「结束训练那一刻」提前到**每一次改动**(见下面那个 effect 与
   * utils/workout-draft.ts):系统回收、从小程序列表里划掉,这两条路上任何页面回调都不会跑,
   * 唯一能保证的只有「他一动手,数据就已经在存储里了」。所以这里拦的已经不是「会丢数据」,
   * 而是「他要中途走」这件事本身(底栏那一下 `switchTab` 会关掉所有非 tab 页,
   * 原生返回键也会把这一页拆掉)—— 下一句提示因此照实说自己存着了。
   *
   * 判断放在渲染里算、用 ref 递给守卫:守卫是**点下去那一刻**才问的。
   */
  const dirty = Boolean(plan && day && !summary && rows.some((r) => r.sets.some((s) => s.done)));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const DIRTY_TIP = '这一场还没结束。已经勾过的组都存着了,回首页点「继续」就能接着练。';
  useEffect(() => {
    setLeaveGuard({
      dirty: () => dirtyRef.current,
      title: '先练到这儿?',
      content: DIRTY_TIP,
      confirmText: '先离开'
    });
    return () => setLeaveGuard(null);
  }, []);
  // 勾第一组之前不拦(刚进来还没练,走就走);练完(summary 出来)也让开
  useEffect(() => { syncNativeGuard(dirty, DIRTY_TIP); }, [dirty]);

  // 训练计时
  useEffect(() => {
    elapsedTimer.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => { if (elapsedTimer.current) clearInterval(elapsedTimer.current); };
  }, []);
  /**
   * 休息倒计时 — 墙钟模型。
   * 只存 endsAt,每次 tick 用 Date.now() 反算剩余;小程序切后台会冻结定时器,
   * 但回到前台后第一次 tick 就能算出正确剩余,不会出现"少休息了几分钟"。
   *
   * **暂停**就挂在同一个模型上:不是把秒数存下来,而是记下冻结的那一刻(`pausedAt`),
   * 剩余仍是「endsAt − pausedAt」;继续时把 endsAt 按这份剩余重新推算并去掉 pausedAt。
   * 这样「暂停 → 切出去接个电话 → 回来」不会少休息,因为它压根不认墙钟,只认这两个时刻之差。
   *
   * 两个提示点在这里:剩 3/2/1 秒各短震一次(「下一组要来了」),到点长震一次。
   * 同一个秒数上 250ms 的定时器会跳好几下,靠 `tickedRef` 做到一秒只响一次 ——
   * 少了它一声预告会震四下(而这三声的全部意义就是"要到了",震成一串反而听不出来了)。
   * 暂停时把 `tickedRef` 归零:继续之后那三声要重新数。
   */
  useEffect(() => {
    if (!rest) {
      if (restTimer.current) { clearInterval(restTimer.current); restTimer.current = null; }
      setRestRemain(0);
      tickedRef.current = 0;
      return;
    }
    if (rest.pausedAt != null) {
      // 停表:定时器要真的停掉,不能只是不刷新画面 —— 否则恢复时那几秒已经溜走
      if (restTimer.current) { clearInterval(restTimer.current); restTimer.current = null; }
      setRestRemain(remainOf(rest, Date.now()));
      tickedRef.current = 0;
      return;
    }
    const tick = () => {
      const remain = remainOf(rest, Date.now());
      if (remain <= 0) {
        buzz('restEnd', alertRef.current);
        setRest(null);
        return;
      }
      if (remain !== tickedRef.current) {
        tickedRef.current = remain;
        if (isTickSecond(remain)) buzz('tick', alertRef.current);
      }
      setRestRemain(remain);
    };
    tick();
    restTimer.current = setInterval(tick, 250); // 250ms 保证秒数跳动及时,不累积漂移
    return () => { if (restTimer.current) { clearInterval(restTimer.current); restTimer.current = null; } };
    // pausedAt 也要在依赖里:按下暂停时 endsAt 没变,只挂着 endsAt 的话这个 effect 不会重跑,
    // 表也就停不下来
  }, [rest?.endsAt, rest?.pausedAt]);
  useEffect(() => () => { if (restTimer.current) clearInterval(restTimer.current); }, []);

  /** 每个动作练过几次 —— 换动作面板里「常练的」排在前面(日志本来就在手上,不必再读一遍 storage) */
  const usage = useMemo(() => usageOf(logs), [logs]);
  /**
   * 每张动作卡上那句「上次 / 最好」(见 history.refText)。
   * 挂在 `useMemo` 上而不是渲染里现算:休息计时每 250ms 重渲染一次,现算就是每秒四次
   * 扫全部日志。依赖用拼出来的那一串 id(字符串比较稳定),不跟着 `rows` 的每次改动重算 ——
   * 这句话只跟**日志**有关,勾一组不该让它重算。
   */
  const refIds = rows.map((r) => r.exerciseId).join('|');
  const refs = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const id of new Set(refIds.split('|'))) if (id) map[id] = refText(refLine(logs, id));
    return map;
  }, [refIds, logs]);
  const totalSets = useMemo(() => rows.reduce((a, r) => a + r.sets.length, 0), [rows]);
  const doneSets = useMemo(() => rows.reduce((a, r) => a + r.sets.filter((s) => s.done).length, 0), [rows]);
  /**
   * 现在练到哪一段了 —— 第一个还没做完的动作。这一屏有十来个动作、几十行组,
   * 而其中**只有一行是当下要做的**:以前它和其余每张卡长得一模一样,
   * 中途被打断回来,得自己一行行找上次勾到哪儿。
   */
  const currentRi = rows.findIndex((r) => !(r.sets.length > 0 && r.sets.every((s) => s.done)));

  /** 今天要练的部位里,有没有还没缓过来的(只提醒,不拦着) */
  const recoverWarn = useMemo(() => {
    if (!day || !logs.length) return null;
    const groups = new Set<string>();
    for (const it of day.items) for (const g of groupsOf(it.exerciseId)) groups.add(g.group);
    const tired = recoveryOf(logs)
      .filter((r) => groups.has(r.group) && r.lastDate != null && r.recovered < READY_AT * 100)
      .sort((a, b) => a.recovered - b.recovered)[0];
    return tired
      ? `${GROUP_ZH[tired.group]}上次练完还没缓过来(约还需 ${tired.etaHours} 小时)。今天先按老目标做,状态不好就减一组,别硬冲重量。`
      : null;
  }, [day, logs]);

  const patchSet = (ri: number, si: number, patch: Partial<SetRow>) => {
    setRows((rs) => rs.map((r, i) => i !== ri ? r : {
      ...r, sets: r.sets.map((s, j) => j !== si ? s : { ...s, ...patch })
    }));
  };

  /* ================= 计时组:开始 → 撑 → 按停 ================= */

  /**
   * 正在计时的那一组。同一时刻只可能有一组 —— 一个人没法同时撑两个平板。
   * 所以这里是个单值而不是每行一个标志:两处各存一个的话,同时「撑」两个平板
   * 会静默地只记下后开始的那个。
   */
  const [timing, setTiming] = useState<{ ri: number; si: number; startedAt: number } | null>(null);
  /** 计时窗口里每 250ms 走一格,用来刷新读数(不是权威值,权威值永远是 now − startedAt) */
  const [holdNow, setHoldNow] = useState(0);
  /** 切后台的那一刻 —— 见下面的 useDidHide */
  const hideAt = useRef(0);

  /** 这一组已经撑了多少秒(没在计时就是 0) */
  const holdElapsed = timing ? Math.max(0, Math.floor((holdNow - timing.startedAt) / 1000)) : 0;

  const startHold = (ri: number, si: number) => {
    const now = Date.now();
    setTiming({ ri, si, startedAt: now });
    setHoldNow(now);
    // 开始撑就把组间休息收掉:休息条还挂着的话,两个倒计时同时跳,没人数得清自己在等哪个
    setRest(null);
  };

  /** 按停:把实际秒数记进那一组,然后照常走「完成一组」那一套(震动、超级组、组间休息) */
  const stopHold = (sec: number) => {
    if (!timing) return;
    const { ri, si } = timing;
    setTiming(null);
    const row = rows[ri];
    if (!row) return;
    toggleSet(ri, si, row, sec);
  };

  // 计时器:250ms 一跳只是为了读数跟手,秒数一律由墙上时间反算
  // (定时器被系统降频也不会把 60 秒的平板记成 40 秒 —— 和组间休息用的是同一个道理)
  useEffect(() => {
    if (!timing) return;
    const t = setInterval(() => setHoldNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [timing]);

  /**
   * 手动改秒数(±5 秒)。只改**已经记下来**的那一组 —— 还没撑的时候这一行显示的是
   * 处方秒数,改它等于改处方,那是计划编辑器该管的事,不该在这一屏悄悄改掉。
   */
  const stepHoldSec = (ri: number, si: number, delta: number) => {
    const cur = rows[ri].sets[si];
    const base = cur.sec ?? rows[ri].holdSec?.max ?? 0;
    patchSet(ri, si, { sec: clampHoldSec(base + delta * HOLD_STEP_SEC) });
  };

  /**
   * 圆圈那一下。次数型 = 勾上/取消;计时型 = **开始 / 按停**。
   *
   * 计时型的第一下故意不是「勾上」:那一下如果只是打勾,这一组就会按处方上限记账
   * (「我照目标撑完了」),而用户其实是想现在开始撑。两种意图不能共用一个动作。
   * 想直接记「照目标撑完了」也走得到:再点一下按停,记的就是实际走的秒数。
   */
  const onCheck = (ri: number, si: number, row: Row) => {
    if (!row.holdSec) { toggleSet(ri, si, row); return; }
    const cur = rows[ri].sets[si];
    if (cur.done) { toggleSet(ri, si, row); return; }                       // 再点 = 取消
    if (timing && timing.ri === ri && timing.si === si) { stopHold(holdElapsed); return; }
    startHold(ri, si);
  };

  /**
   * 完成一组 → 启动该动作的组间休息。
   * 超级组:同组的动作交替做,做到组内最后一个动作才休息,中间只提示接着做哪个。
   */
  const toggleSet = (ri: number, si: number, row: Row, sec?: number) => {
    const cur = rows[ri].sets[si];
    if (cur.done) {
      // 取消勾选:次数型的组留着它填的次数(重勾时不用重填),计时型那格得清掉 ——
      // 留着的话这一行会一直显示「上次撑了 58 秒」,而这次还没开始撑
      patchSet(ri, si, row.holdSec ? { done: false, sec: undefined } : { done: false });
      return;
    }
    if (row.holdSec) {
      // 计时组:秒数由计时器给。没走计时器就勾(直接点圆圈)时按处方上限记 ——
      // 那是「我照目标撑完了」的意思,之后还可以用 −/＋ 改成实际值
      patchSet(ri, si, { done: true, reps: 0, sec: clampHoldSec(sec ?? cur.sec ?? row.holdSec.max) });
    } else {
      patchSet(ri, si, { done: true, reps: Math.max(repStepOf(row.sided), cur.reps) });
    }
    // 勾上就震一下 —— 放在超级组判断**之前**:用户看的是"我做完了一组",这件事和后面
    // 接不接着做同伴动作无关(取消勾选在上面就 return 了,所以这里只会响"完成"那一下)。
    buzz('setDone', alertRef.current);

    // 超级组:同伴动作同一序号的那组还没做 → 不休息,直接接上
    const mate = row.superset
      ? rows.findIndex((r, i) => i !== ri && r.superset === row.superset && r.sets[si] && !r.sets[si].done)
      : -1;
    if (mate > -1) {
      Taro.showToast({ title: `接着做:${rows[mate].nameZh} 第 ${si + 1} 组`, icon: 'none', duration: 1500 });
      return;
    }
    // 休息 0 秒 = 不休息(超级组、拉伸这类):别把计时条拉起来 ——
    // 它能亮的时间是 0,用户只会看到一条闪一下就消失的「休息中」。
    setRest(restStart(row.restSec, Date.now()));
  };

  /** 给某组打自感强度分(再点同一档位=取消) */
  const rateSet = (rir: number) => {
    if (!rating) return;
    const { ri, si } = rating;
    const cur = rows[ri].sets[si].rir;
    patchSet(ri, si, { rir: cur === rir ? null : rir });
    setShowEffort(true);
    setRating(null);
  };

  /** +15 秒(算术在 `engine/rest.ts` 的 `extendRest`) */
  const extendRest = () => {
    setRest((r) => (r ? extendRestTimer(r, EXTEND_SEC, Date.now()) : null));
  };

  /**
   * 暂停 / 继续休息计时。休息中被打断是常事(器材被占、有人问话),
   * 而这一份倒计时的意义是「肌肉歇够了没有」—— 你站着等了五分钟,该歇的其实已经歇完了,
   * 所以暂停是**给这段时间免责**,不是让表走得慢一点。
   */
  const toggleRestPause = () => {
    if (!rest) return;
    // 记一笔「按了暂停」:次数多说明这一档休息时长对这个人偏短,那是要调计划里的组间休息的信号
    // (继续那一下不记 —— 有暂停就一定有继续,两条一对只会把分母算两遍)
    if (rest.pausedAt == null) track('training_rest_pause', 'other');
    setRest(togglePause(rest, Date.now()));
  };

  /** 次数步进 —— 单侧动作走 2:总数保持偶数,两侧才分得均匀(见 engine/sided.ts) */
  const stepReps = (ri: number, si: number, delta: number) => {
    const step = repStepOf(rows[ri].sided);
    const cur = rows[ri].sets[si];
    patchSet(ri, si, { reps: Math.min(99, Math.max(step, cur.reps + delta * step)) });
  };
  /**
   * 重量步进 —— 落地在「他真有的重量」上:
   * 哑铃/壶铃走登记的档位(手里只有 10 和 14,就不该让他对着 12 发呆),
   * 杠铃走能配出来的重量(家里只有一副 5 和一副 10,60kg 根本挂不出来)。
   * 档位到顶/到底则退回普通步长:库存是引导不是牢笼,他也许还有别的铃。
   */
  const stepWeight = (ri: number, si: number, delta: number) => {
    const cur = rows[ri].sets[si];
    if (cur.weightKg == null) return;
    let next = roundHalf(Math.min(500, Math.max(0.5, cur.weightKg + delta)));
    const ex = findExercise(rows[ri].exerciseId);
    const bells = kit.dumbbells ?? [];
    if (bells.length && (ex?.equipment === 'dumbbell' || ex?.equipment === 'kettlebell')) {
      const snapped = stepOwned(bells, cur.weightKg, delta);
      if (snapped !== cur.weightKg) next = snapped;
    } else if (usesBar(ex)) {
      next = roundHalf(snappedByPlates(kit, next, ex));
    }
    patchSet(ri, si, { weightKg: next });
  };

  const finish = async () => {
    if (!plan || !day || finishing) return;
    if (doneSets === 0) {
      Taro.showToast({ title: '还没有完成的组', icon: 'none' });
      return;
    }
    if (doneSets < totalSets) {
      const { confirm } = await Taro.showModal({
        title: '提前结束?',
        content: `还有 ${totalSets - doneSets} 组没完成。完成的组会照常记录,未完成的不参与渐进判断。`,
        confirmText: '结束训练',
        cancelText: '继续练'
      });
      if (!confirm) return;
    }
    setFinishing(true);
    try {
      const durationSec = Math.max(60, Math.floor((Date.now() - startedAt.current) / 1000));
      const entries: WorkoutEntry[] = rows.map((r) => ({
        exerciseId: r.exerciseId,
        sets: r.sets.map((s) => ({
          reps: s.reps, weightKg: s.weightKg, done: s.done, rir: s.rir,
          // 计时组的实际秒数必须跟着走 —— 少了这个字段,撑完的平板会变成一组「0 次」
          ...(s.sec != null ? { sec: s.sec } : {})
        })),
        // 不计入进阶的这个动作:目标不动,但组数容量照进日志
        ...(r.noProg ? { noProg: true } : {})
      }));
      /**
       * 合并训练:计划里没有那个合成训练日(`推+拉`),applyWorkout 会退回 plan.days[0] ——
       * 于是两套的动作全部匹配不到处方,渐进一个都不动。把这一场临时塞进一份计划副本里再算,
       * 存盘时用的仍是 `latest`(见下面),合成的训练日不会写进计划。
       */
      const dayKeys = splitDayKey(day.key);
      const woPlan = dayKeys.length > 1 ? { ...plan, days: [...plan.days, day] } : plan;
      const result = applyWorkout(woPlan, day.key, entries, durationSec, loadProgress(), sessionNote, noProg);
      // 轮转/固定周判断「这套练过了没有」按每一套算(见 types.logDayKeys)
      if (dayKeys.length > 1) result.log.dayKeys = dayKeys;
      const nextLogs = appendLog(result.log);
      setLogs(nextLogs);
      /**
       * 这一次的消耗也要进热量引擎 —— 首页那张能量卡的「消耗」是从 `ActivityRecord`
       * 算出来的,而训练日志不在那张表里。不补这一笔,刚练完的人在首页看到的
       * 消耗里**没有自己刚练的那一小时**(见 engine/workout-energy 的说明)。
       *
       * 放在 appendLog 之后、不 await:记录已经落盘了,这次请求发不出去只是
       * 今天的消耗少算一笔,不该让它挡在「练完」这一步前面。
       */
      void syncWorkoutActivity(result.log, { startedAtMs: startedAt.current });
      // 这次练的重量次数会刷新力量基准(训练最大重量)— 周期波次与 %1RM 展示都靠它
      setMaxes(syncMaxesFromLogs(nextLogs));
      saveProgress(result.next);
      /**
       * 回写计划要**拿刚读出来的那一份**打补丁,不能用页面里这份内存快照:
       * 训练过程中云同步(app 切后台就会跑一次)可能已经把云端那份计划落到本机了,
       * 用内存里这份整份覆盖,等于把那些改动**悄悄抹掉**。
       * 训练页自己要动的只有 doneCount 和 lastNote 两格 —— 补丁就该只动这两格。
       * (万一本机的计划已经没了 —— 比如在别处删了 —— 就退回内存这份,别让战绩丢失。)
       */
      const latest = loadPlan() ?? plan;
      const nextPlan: TrainingPlan = {
        ...latest,
        doneCount: latest.doneCount + 1,
        lastNote: result.notes.length ? result.notes[0] : latest.lastNote
      };
      savePlan(nextPlan);
      // 今天从「该练」变成「练完了」—— 首页那张卡读的就是这张小抄(见 utils/training-digest.ts)
      saveTrainingDigest({
        state: 'done',
        dayKey: day.key,
        title: day.title,
        focus: day.focus,
        estMin: day.estMin,
        reassigned: false
      });
      // 趋势页那张长程快照也一起刷新 —— 刚练完就点「趋势」的人不该看到旧的次数
      saveTrainingProgress(progressOf(nextLogs));
      // 这一场有归宿了(组数已经进日志、进度也回写了计划)—— 草稿到此为止。
      // 清在这一步而不是「离开这一页」那一步:离开的路上可能被系统回收,
      // 而那时候数据已经在日志里了,草稿再留着只会让首页多摆一个已经练完的「继续」。
      // 先落闩再清:关汇总那一帧 rows 还全勾着,不挡住的话草稿会被重新写回来。
      finishedRef.current = true;
      clearDraft();
      track('training_workout_done', 'other');
      // 开了「练完自动同步」就顺手传一次(静默,失败不打断刚练完的人)
      autoSync().catch(() => undefined);
      // 汇总页刚开出来,时长是墙钟那个数(还没人改过)
      setDurMin(null);
      setSummary({
        logId: result.log.id,
        notes: result.notes,
        // 从**落下来的那条日志**里读,不从 rows 里读:用户看到的这一句要和他以后回看这条日志
        // 时看到的一致(rows 是内存里那一刻的样子,日志才是存下来的那一份)
        progOff: result.log.entries.filter((e) => e.noProg).map((e) => e.nameZh),
        sets: result.log.totalSets,
        reps: result.log.totalReps,
        volume: result.log.totalVolumeKg,
        // 撑住的秒数不进「次数」也不进「容量」(见 types.ts)—— 一组 90 秒的平板支撑
        // 在这两格里都是 0,不单列一个数的话,一次核心课看起来像什么都没练
        holdSec: holdSecOfSets(result.log.entries.flatMap((e) => e.sets)),
        sec: durationSec,
        avgRir: result.log.avgRir,
        sessionNote: result.log.note ?? null,
        noProg
      });
    } finally {
      setFinishing(false);
    }
  };

  const closeSummary = () => {
    setSummary(null);
    setDurMin(null);
    Taro.navigateBack();
  };

  /**
   * 改这次训练的时长 —— 练完那一刻正好是「我知道刚才那 20 分钟是被电话耽误的」的时候。
   * 计时是**墙钟**算的(`Date.now() - startedAt`),不修就一直是错的,而时长进了
   * 「本周练了多久」「日均时长」这些统计(见 engine/history.ts 的汇总)。
   *
   * 只补 `durationSec` 一格:组数/次数/重量都是当时一组一组勾出来的真数据,动它们等于改战绩。
   * 这里**不**打 `manual` —— 那一档是「这份数据记不准,别拿它调下次重量」(见 types.ts),
   * 而手改时长时次数重量一格没动,渐进推导也从来不看时长,打了反而是白丢一次成绩。
   */
  const saveDuration = () => {
    if (!summary || durMin == null) return;
    const sec = spanSeconds(durMin);
    const after = updateLog(summary.logId, { durationSec: sec });
    // 时长改了,回写给热量引擎的那条活动记录也得跟着改 —— 它记的就是「多久、多少 kcal」,
    // 不改就变成「日志里 45 分钟、首页消耗按 65 分钟算」(见 engine/workout-energy)
    const hit = after.find((l) => l.id === summary.logId);
    if (hit) void syncWorkoutActivity(hit, { startedAtMs: startedAt.current });
    // 内存里这份也要跟着改:底下的「复制成文字」「生成分享卡」都读这条日志,
    // 只写存储不更新这里,汇总页上就会是「显示 45 分钟、复制出来 65 分钟」
    setSummary((s) => (s ? { ...s, sec } : s));
    setDurMin(null);
    track('training_duration_edit', 'other');
    Taro.showToast({ title: `时长已改成 ${fmtSpan(sec)}`, icon: 'none' });
  };

  /**
   * 把刚练完这一次复制成纯文字 —— 图发得好看,文字能改。
   * 从日志里取(刚 appendLog 存进去的那条),不拿内存里的 rows 现拼:两处各拼一遍
   * 迟早会出现「复制出来的组数和完成页对不上」。
   */
  const copySummaryText = async () => {
    if (!summary) return;
    const hit = loadLogs().find((l) => l.id === summary.logId);
    if (!hit) { Taro.showToast({ title: '没找到这次的记录', icon: 'none' }); return; }
    const ok = await copyText(workoutText(hit, { sidedOf: (id) => sidedInPlan(plan, id) }));
    Taro.showToast({ title: ok ? '已复制,可以粘到微信里' : '复制失败,再试一次', icon: 'none' });
  };

  /**
   * 走到这里只有两种情况:boot() 里发现没有计划(catch 会把页面换成计划页,这一帧还在),
   * 或者 querystring 里那个 key 已经不在了(计划在别处被编辑过/删过训练日)。
   * **别只给一块空屏** —— 用户不知道是没加载完还是出错了,也没有出路。
   */
  if (!day) {
    return <Screen className="wk-page">
      <View className="card wk-blank">
        <Text className="fs-h1">这一天的计划打不开了</Text>
        <Text className="fs-mini text-secondary">
          计划可能已经在别处改过(训练日被删了或者换了名字)。去计划页看看现在的编排。
        </Text>
        <Button
          className="btn btn--primary wk-blank-cta"
          onClick={() => navigate('/pkg-exercise/plan-view/index', { replace: true })}
        >
          去看训练计划
        </Button>
      </View>
    </Screen>;
  }

  return (
    <Screen className="wk-page">
      {/* 顶部进度条 */}
      <View className="wk-top">
        <View className="wk-top-copy">
          <Text className="wk-title">{day.title}</Text>
          <Text className="fs-mini text-secondary">{day.focus}</Text>
          {cycleLabel && <Text className="wk-cycle">{cycleLabel}</Text>}
        </View>
        <View className="wk-clock">
          <Text className="wk-clock-time">{fmtDuration(elapsed)}</Text>
          <Text className="fs-mini text-secondary">{doneSets}/{totalSets} 组</Text>
        </View>
      </View>
      {/* 进度条 —— 原先 4px 高,在一屏动作卡里几乎看不见。练到一半最想知道的两件事
          就是「还有多久」和「还剩几组」,这条是它们的图形答案,值得占粗一点 */}
      <View className="wk-progress">
        <View className="wk-progress-fill" style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }} />
      </View>
      {recoverWarn && <Text className="wk-warn">{recoverWarn}</Text>}

      {/* 练前上称 — 健身房的秤就在更衣室门口,而体重那套口径要的正是「固定时间、同一台秤」。
          就地开弹层而不是跳去体重页:push 走再回来会重挂载,这一场已经打过的勾只活在本页内存里。
          弹层与体重的取值/校验跟体重页**同一个**(见 @/components/WeightSheet)。 */}
      {/* 记完体重那一刻 `weighed` 就翻了 —— 两个分支同标签时 React 会把它们当成
          同一个节点改 props,把 onClick 摘掉,那一步会崩掉整棵子树(见 utils/taro-events)。
          所以只留一个 <Text>,差别在 className 和文案上 */}
      <Text
        className={weighed ? 'fs-mini text-secondary wk-weigh-done' : 'wk-weigh'}
        onClick={onIf(!weighed, () => { track('training_weigh_open', 'other'); setWeighOpen(true); })}
      >
        {weighed ? '体重已记 ✓' : '练前上称 · 记一次体重 ›'}
      </Text>

      {/* 动作卡 */}
      {rows.map((row, ri) => {
        const ex = findExercise(row.exerciseId);
        /* 这一行的每一组都打完了 → 折成一行(它已经没用了,而手机屏是给还在练的动作留的)。
           点开过的那几行例外(见 doneOpen):重新打开过一次的动作保持展开。 */
        const folded = row.sets.length > 0 && row.sets.every((s) => s.done) && !doneOpen[ri];
        const unfold = () => setDoneOpen((m) => ({ ...m, [ri]: true }));
        return (
          <View className={`card wk-ex${folded ? ' wk-ex--fold' : ''}${ri === currentRi ? ' wk-ex--now' : ''}`} key={`${row.exerciseId}-${ri}`}>
            <View className="wk-ex-head">
              <View className="wk-ex-title" onClick={() => (folded ? unfold() : setFocus(ri))}>
                <Text className="wk-ex-name">{row.nameZh}</Text>
                {row.setType !== 'normal' && <Text className="wk-type">{SETTYPE_ZH[row.setType]}</Text>}
                {row.superset && <Text className="wk-ss">超级组</Text>}
                {/* 徽标是这一格的**唯一**反馈:⋯ 面板一关,用户只能从这里看出刚才那一下点上了 */}
                {row.noProg && <Text className="wk-noprog">不算进步</Text>}
              </View>
              <View className="wk-ex-right">
                {/* 折起来的时候这一枚就是唯一的展开入口 —— 整行点开会让「点名字进专注模式」
                    这个手势在这两态之间变意思,而 ⋯ 是嵌在里面的,得靠 stopPropagation 分辨。
                    **两个状态合成同一个 <Text>**:拆成两支的话,点「展开 ▾」把 folded 翻回 false
                    时 React 会去摘掉 onClick,那一步会崩掉整棵子树(见 utils/taro-events) */}
                <Text
                  className={folded ? 'fs-mini wk-fold-x' : 'fs-mini text-secondary'}
                  onClick={onIf(folded, unfold)}
                >
                  {folded
                    ? `✓ ${row.sets.length} 组做完 · 展开 ▾`
                    : `休息 ${restText(row.restSec)}${ex?.equipment === 'body weight' ? ' · 徒手' : ''}`}
                </Text>
                <Text className="wk-more" onClick={() => setOps(ri)}>⋯</Text>
              </View>
            </View>
            {folded ? null : <>
            {/* 演示图摆给**现在练到的这一个**动作。
                这东西本来就有(动作库详情、⋯ → 怎么做这个动作),但那都在两跳之外;而「起始位到底是
                什么样的」最想问的时候,正是手上正握着器械、或者刚把上一组的姿势忘掉的那一秒。
                只给当前这一个:一场训练七八个动作,行行都摆一张大图,这一页就变成图册,组数得往下翻半天。
                其余的动作照旧走 ⋯ 那条路 —— 一页里留一处看图,其余地方留给组。 */}
            {ri === currentRi && (() => {
              const demo = demoUrl(row.exerciseId);
              /* 没有演示图的动作退到「练哪儿」那张。**写的字要跟着换** ——
                 底下摆的是肌群图,入口还写「看这个动作怎么练」就是骗人点开
                 (点开发现不是「怎么做」,下次真的那张他也不点了)。
                 两张都没有(自定义动作没填肌群)才是真的不摆这一块。 */
              const hasFigure = !demo && !!figureUrl(ex?.target);
              if (!demo && !hasFigure) return null;
              const entry = demo ? '看这个动作怎么练 ›' : '这个动作练哪儿 ›';
              if (demoShut[ri]) {
                return (
                  <Text className="fs-mini wk-demo-open" onClick={() => setDemoShut((m) => ({ ...m, [ri]: false }))}>
                    {entry}
                  </Text>
                );
              }
              return (
                <View className="wk-demo">
                  {demo ? <DemoImage url={demo} /> : <FigureImage target={ex?.target} />}
                  <Text className="fs-mini wk-demo-shut" onClick={() => setDemoShut((m) => ({ ...m, [ri]: true }))}>收起 ▴</Text>
                </View>
              );
            })()}
            {/* 上次练成什么样 / 至今最好的一组 —— 一行,一整行动作共用一句(见 history.refText)。
                以前这两件事只在历史面板里,而练到一半退出去翻一眼就是断节奏。 */}
            {refs[row.exerciseId] && <Text className="fs-mini wk-ref">{refs[row.exerciseId]}</Text>}
            {/* 这一天的安排备注 —— 放在常驻备注**前面**:它是这次练的时候最该看见的那句
                (「今天用窄握」「膝不舒服就减一组」),常驻备注是背景资料。读来源不同,
                所以两行可以同时出现,不能互相顶掉 */}
            {row.note && <Text className="fs-mini wk-note">今天:{row.note}</Text>}
            {/* 动作常驻备注(跨计划长期有效) */}
            {notes[row.exerciseId] && (
              <Text
                className="fs-mini wk-note"
                onClick={() => { setNoteFor(row.exerciseId); setNoteDraft(notes[row.exerciseId]); }}
              >
                备注:{notes[row.exerciseId]}
              </Text>
            )}
            {/* 热身组 — 按当前正式重量推导,勾选只作引导,不进日志/不算容量 */}
            {(() => {
              // 0 组 = 用户在计划里明说「这个动作不热身」,不能用 `|| 3` 把 0 吃成缺省。
              // 下限也由 warmupFor 自己兜(重量太轻时它本来就返回空)
              const w = warmupFor(
                row.exerciseId, row.sets[0]?.weightKg ?? null, row.weightStepKg,
                row.warmupSets ?? 3, row.sided
              );
              if (!w.length) return null;
              const open = !!openWarm[ri];
              const doneN = w.filter((_, wi) => warmDone.has(`${ri}-${wi}`)).length;
              return (
                <View className="wk-warm">
                  <View className="wk-warm-head" onClick={() => setOpenWarm((m) => ({ ...m, [ri]: !m[ri] }))}>
                    <Text className="wk-warm-title">热身 {w.length} 组</Text>
                    <Text className="fs-mini text-secondary">
                      {loadText(row.exerciseId, w[0].weightKg)} 起 · 已完成 {doneN}/{w.length} {open ? '▴' : '▾'}
                    </Text>
                  </View>
                  {open && w.map((s, wi) => {
                    const key = `${ri}-${wi}`;
                    const on = warmDone.has(key);
                    /* 热身打勾刻意不震:正式组勾完之后总有事发生(起休息、或者接同伴),
                       热身勾完什么都不会发生。同一个手势在不同地方给不同反馈,震这一下就成
                       了误导(用户会等着一个不会来的倒计时)。openGym 那边热身和正式组是同一
                       套行、走同一个 toggle,所以它一起响 —— 那是它把两件事当一件事的缘故,
                       BodyOS 分开,提示也跟着分开。 */
                    return (
                      <View
                        className={`wk-warm-row${on ? ' on' : ''}`}
                        key={key}
                        onClick={() => setWarmDone((set) => {
                          const n = new Set(set);
                          if (n.has(key)) n.delete(key); else n.add(key);
                          return n;
                        })}
                      >
                        <View className={`wk-check wk-check--sm${on ? ' checked' : ''}`}>
                          {on && <Text className="wk-tick">✓</Text>}
                        </View>
                        <Text className="wk-warm-v">
                          {loadText(row.exerciseId, s.weightKg)} × {row.sided ? `每侧 ${sideRepsText(s.reps)}` : s.reps}
                        </Text>
                        <Text className="fs-mini text-secondary">约 {s.pct}%</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })()}
            {row.sets.map((s, si) => (
              <View className={`wk-set${s.done ? ' done' : ''}`} key={si}>
                <View className={`wk-check${s.done ? ' checked' : ''}`} onClick={() => onCheck(ri, si, row)}>
                  {s.done && <Text className="wk-tick">✓</Text>}
                </View>
                <Text className="wk-set-no">{si + 1}</Text>
                {row.holdSec ? (() => {
                  const live = timing?.ri === ri && timing?.si === si;
                  const over = live ? holdElapsed - row.holdSec.max : 0;
                  return (
                    <View
                      className={`wk-ctrl wk-hold${live ? ' is-live' : ''}${over > 0 ? ' is-over' : ''}`}
                      onClick={() => onCheck(ri, si, row)}
                    >
                      {live ? (
                        <>
                          <Text className="wk-val wk-hold-live">{holdText(Math.min(holdElapsed, HOLD_MAX_SEC))}</Text>
                          {/* 超过目标继续走 —— 多撑的这几十秒才是真在长进,单独标出来 */}
                          {over > 0 && <Text className="wk-hold-over">+{holdText(over)}</Text>}
                          <Text className="wk-hold-hint">按停</Text>
                        </>
                      ) : (
                        <>
                          <Text className="wk-btn" onClick={(e) => { e.stopPropagation(); stepHoldSec(ri, si, -1); }}>−</Text>
                          <Text className="wk-val">
                            {s.sec != null ? holdText(s.sec) : holdRangeText(row.holdSec.min, row.holdSec.max)}
                            <Text className="wk-unit">{s.sec != null ? '' : '目标'}</Text>
                          </Text>
                          <Text className="wk-btn" onClick={(e) => { e.stopPropagation(); stepHoldSec(ri, si, 1); }}>＋</Text>
                        </>
                      )}
                    </View>
                  );
                })() : (
                <View className="wk-ctrl">
                  <Text className="wk-btn" onClick={() => stepReps(ri, si, -1)}>−</Text>
                  {/* 单侧动作显示「每侧几次」—— 他数的是每侧,不是两侧加起来的数 */}
                  <Text className="wk-val">
                    {row.sided ? sideRepsText(s.reps) : s.reps}
                    <Text className="wk-unit">{row.sided ? '次/侧' : '次'}</Text>
                  </Text>
                  <Text className="wk-btn" onClick={() => stepReps(ri, si, 1)}>＋</Text>
                </View>
                )}
                <View className="wk-ctrl">
                  {s.weightKg != null ? <>
                    <Text className="wk-btn" onClick={() => stepWeight(ri, si, -row.weightStepKg)}>−</Text>
                    <Text className="wk-val">
                      {loadPrefix(row.exerciseId)}{s.weightKg}<Text className="wk-unit">kg</Text>
                    </Text>
                    <Text className="wk-btn" onClick={() => stepWeight(ri, si, row.weightStepKg)}>＋</Text>
                  </> : <Text className="wk-val wk-val-bw">自重</Text>}
                </View>
                {/* 自感强度:未评显示浅灰短横,已评显示档位数字并着色 */}
                <View
                  className={`wk-eff${s.rir != null ? ' rated' : ''}`}
                  style={s.rir != null ? { background: effortColor(s.rir) ?? undefined } : undefined}
                  onClick={() => setRating({ ri, si })}
                >
                  <Text className="wk-eff-t">{s.rir != null ? s.rir : '—'}</Text>
                </View>
                {/* 组型说明(递减/力竭/降重的做法提示)+ 配片 — 独占一行,不挤占步进器。
                    配片只在每组重量不同的行(降重/递减组)重复给,同重量的一串组说一次就够 */}
                {(() => {
                  const prevW = si > 0 ? row.sets[si - 1].weightKg : null;
                  const first = si === 0 || s.weightKg !== prevW;
                  const plate = first && s.weightKg != null ? loadHint(kit, s.weightKg, ex) : null;
                  const line = [s.tag, s.note, plate].filter(Boolean).join(' · ');
                  return line ? <Text className="wk-set-note">{line}</Text> : null;
                })()}
                {/* 加错的那一组要能撤。只在「最后一组 + 临时加的 + 还没勾」时出现 ——
                    见 delAddedSet 上那段:计划里本来就有的组没有这个口子(少做的那组是信息) */}
                {s.added && !s.done && si === row.sets.length - 1 &&
                  <Text className="wk-set-del" onClick={() => delAddedSet(ri, si)}>撤掉这组(刚加的)</Text>}
              </View>
            ))}
            {/* 加一组:照最后一组的重量次数再来一次(见 addSet)。
                计划里本来就有的组**不提供删除**:写了三组只做两组,少做的那组是信息
                (那个重量的刺激没做完),留着不打勾就行 —— 它不会进统计(见 didSet),
                删掉就等于抹掉「本来该做」。但加出来的那一组不一样,它本来就不在计划里,
                所以那一行自己带一个「撤掉这组」(见 delAddedSet)。 */}
            <Text className="wk-addset" onClick={() => addSet(ri)}>＋ 加一组</Text>
            {(() => {
              // 取完成组中估 1RM 最高的一组展示
              // 助力动作的 1RM 恒为 0(见 load.liftE1rm)—— 不能让它显示成「估 1RM 0kg」
              const best = row.sets
                .filter((s) => s.done && s.weightKg != null)
                .map((s) => ({ w: s.weightKg as number, r: s.reps, e: liftE1rm(row.exerciseId, s.reps, s.weightKg, row.sided) }))
                .filter((x) => x.e > 0)
                .sort((a, b) => b.e - a.e)[0];
              const pct = pctOfWeight(row.sets[0]?.weightKg ?? null, tmOf(maxes, row.exerciseId));
              if (!best && pct == null) return null;
              return (
                <Text className="fs-mini text-secondary wk-e1rm">
                  {pct != null ? `这个重量约是你力量基准的 ${pct}%` : ''}
                  {pct != null && best ? ' · ' : ''}
                  {best ? `估 1RM ${best.e}kg` : ''}
                </Text>
              );
            })()}
            </>}
          </View>
        );
      })}

      {/* 本次感受(可选)— 折叠在完成按钮上方 */}
      <View className="card wk-sn">
        <View className="wk-sn-head" onClick={() => setNoteOpen((v) => !v)}>
          <Text className="fs-mini text-secondary">
            本次感受{sessionNote ? `:${sessionNote}` : '(睡得好不好、哪里别扭、器械够不够)'}
          </Text>
          <Text className="fs-mini text-secondary">{noteOpen ? '▴' : '▾'}</Text>
        </View>
        {noteOpen && (
          <Textarea
            className="wk-sn-input"
            value={sessionNote}
            maxlength={100}
            placeholder="例:今天睡得少,卧推有点飘,下次稳住重量"
            placeholderClass="wk-sn-ph"
            onInput={(e) => setSessionNote(e.detail.value)}
          />
        )}
      </View>

      {/* 这次不算进步 — 伤后复出、带病练、状态很差的那一天 */}
      <View className="card wk-np">
        <View className="wk-np-row">
          <View className="wk-np-copy">
            <Text className="wk-np-title">这次不算进步</Text>
            <Text className="fs-mini text-secondary">
              伤后复出、状态很差时打开 —— 记录照留,但不拿它调下次的目标
            </Text>
          </View>
          <Switch checked={noProg} color={THEME.primary} onChange={(e) => setNoProg(e.detail.value)} />
        </View>
      </View>

      <Button className="btn btn--primary btn--block wk-finish" loading={finishing} onClick={finish}>
        完成训练
      </Button>
      <Text className="fs-mini text-secondary wk-foot">
        重量为单只哑铃/壶铃重量;点每组右侧的圆点可记「还能再做几次」,动作吃力时随时下调,宁轻勿假。
        负重动作建议先走一遍热身组再上正式重量,热身组不记入容量。
      </Text>

      {/* 专注模式 — 全屏大字,一次只盯一个动作 */}
      {focus != null && rows[focus] && (() => {
        const row = rows[focus];
        const doneN = row.sets.filter((s) => s.done).length;
        const curIdx = Math.max(0, row.sets.findIndex((s) => !s.done));
        return (
          <View className="wk-focus">
            <View className="wk-focus-top">
              <Text className="wk-focus-close" onClick={() => setFocus(null)}>退出专注</Text>
              {/* 专注模式是这个动作占满整屏的时候 —— 也正是在这一步最容易想起「等等,手肘朝哪」 */}
              <Text className="wk-focus-how" onClick={() => setHowTo(focus)}>怎么做 ›</Text>
              <Text className="fs-mini text-secondary">第 {focus + 1}/{rows.length} 个动作</Text>
            </View>

            <Text className="wk-focus-name">{row.nameZh}</Text>
            <Text className="fs-mini text-secondary wk-focus-sub">
              {doneN}/{row.sets.length} 组 · 组间休息 {restText(row.restSec)}
              {notes[row.exerciseId] ? ` · ${notes[row.exerciseId]}` : ''}
            </Text>
            {/* 同一句话,这里给一次比列表页里更值 —— 专注模式就是「两组之间盯着这一屏」的时刻。
                放在休息计时**上面**:计时是这一屏的主角,底下那行字不该跟着它忽上忽下。 */}
            {refs[row.exerciseId] && <Text className="fs-mini wk-ref wk-focus-ref">{refs[row.exerciseId]}</Text>}

            {/* 专注模式下把休息计时放大到主角位置 */}
            {rest && (
              <View className={`wk-focus-rest${rest.pausedAt != null ? ' is-paused' : ''}`}>
                <Text className="wk-focus-rest-t">{fmtDuration(restRemain)}</Text>
                <Text className="fs-mini wk-focus-rest-k">
                  {/* 暂停中必须**说出来**:数字停住不动,不说的话看起来就是表坏了 */}
                  {rest.pausedAt != null ? '已暂停' : '休息中'} · 下一组 {row.sided
                    ? `每侧 ${sideRepsText(row.sets[curIdx]?.reps ?? 0)}`
                    : (row.sets[curIdx]?.reps ?? 0)} 次
                </Text>
                <View className="wk-focus-rest-ops">
                  <Text className="wk-rest-op" onClick={toggleRestPause}>
                    {rest.pausedAt != null ? '继续' : '暂停'}
                  </Text>
                  <Text className="wk-rest-op" onClick={extendRest}>+15s</Text>
                  <Text className="wk-rest-op" onClick={() => setRest(null)}>跳过</Text>
                </View>
              </View>
            )}

            <View className="wk-focus-sets">
              {row.sets.map((s, si) => (
                <View className={`wk-fset${s.done ? ' done' : ''}`} key={si}>
                  <Text className="wk-fset-no">{si + 1}</Text>
                  <View className="wk-fset-body">
                    {row.holdSec ? (() => {
                      // 和列表那一行同一套动作(见 onCheck):大的这块点下去就是开始 / 按停
                      const live = timing?.ri === focus && timing?.si === si;
                      const over = live ? holdElapsed - row.holdSec.max : 0;
                      return (
                        <View
                          className={`wk-fset-line wk-fhold${live ? ' is-live' : ''}${over > 0 ? ' is-over' : ''}`}
                          onClick={() => onCheck(focus, si, row)}
                        >
                          {live ? (
                            <>
                              <Text className="wk-fset-v wk-fhold-live">{holdText(Math.min(holdElapsed, HOLD_MAX_SEC))}</Text>
                              {over > 0 && <Text className="wk-fhold-over">+{holdText(over)}</Text>}
                              <Text className="wk-fhold-hint">按停</Text>
                            </>
                          ) : (
                            <>
                              <Text className="wk-fset-btn" onClick={(e) => { e.stopPropagation(); stepHoldSec(focus, si, -1); }}>−</Text>
                              <Text className="wk-fset-v">
                                {s.sec != null ? holdText(s.sec) : holdRangeText(row.holdSec.min, row.holdSec.max)}
                                <Text className="wk-fset-u">{s.sec != null ? '' : '目标'}</Text>
                              </Text>
                              <Text className="wk-fset-btn" onClick={(e) => { e.stopPropagation(); stepHoldSec(focus, si, 1); }}>＋</Text>
                            </>
                          )}
                        </View>
                      );
                    })() : (
                    <View className="wk-fset-line">
                      <Text className="wk-fset-btn" onClick={() => stepReps(focus, si, -1)}>−</Text>
                      <Text className="wk-fset-v">
                        {row.sided ? sideRepsText(s.reps) : s.reps}
                        <Text className="wk-fset-u">{row.sided ? '次/侧' : '次'}</Text>
                      </Text>
                      <Text className="wk-fset-btn" onClick={() => stepReps(focus, si, 1)}>＋</Text>
                    </View>
                    )}
                    <View className="wk-fset-line">
                      {s.weightKg != null ? <>
                        <Text className="wk-fset-btn" onClick={() => stepWeight(focus, si, -row.weightStepKg)}>−</Text>
                        <Text className="wk-fset-v">
                          {loadPrefix(row.exerciseId)}{s.weightKg}<Text className="wk-fset-u">kg</Text>
                        </Text>
                        <Text className="wk-fset-btn" onClick={() => stepWeight(focus, si, row.weightStepKg)}>＋</Text>
                      </> : <Text className="wk-fset-v wk-fset-bw">自重</Text>}
                    </View>
                    {(() => {
                      // 专注模式就是给杠铃前的人看的:每边挂什么挂在这里最有用
                      const plate = s.weightKg != null && (si === 0 || s.weightKg !== row.sets[si - 1].weightKg)
                        ? loadHint(kit, s.weightKg, findExercise(row.exerciseId)) : null;
                      const line = [s.tag, s.note, plate].filter(Boolean).join(' · ');
                      return line ? <Text className="wk-fset-note">{line}</Text> : null;
                    })()}
                  </View>
                  {/* 自感强度:大字模式下也要能打分 */}
                  <View
                    className={`wk-eff${s.rir != null ? ' rated' : ''}`}
                    style={s.rir != null ? { background: effortColor(s.rir) ?? undefined } : undefined}
                    onClick={() => setRating({ ri: focus, si })}
                  >
                    <Text className="wk-eff-t">{s.rir != null ? s.rir : '—'}</Text>
                  </View>
                  <View className={`wk-fset-check${s.done ? ' on' : ''}`} onClick={() => onCheck(focus, si, row)}>
                    {s.done ? <Text className="wk-fset-tick">✓</Text> : <Text className="wk-fset-tick">○</Text>}
                  </View>
                </View>
              ))}
            </View>
            {/* 和普通卡片里那个「＋ 加一组」同一个处理函数 —— 大字模式是给「戴着耳机、只看这一屏」
                的人用的,补一组这事在这一屏里也得能做 */}
            <Text className="wk-faddset" onClick={() => addSet(focus)}>＋ 加一组</Text>

            <View className="wk-focus-nav">
              <Text
                className={`wk-focus-navbtn${focus === 0 ? ' off' : ''}`}
                onClick={() => focus > 0 && setFocus(focus - 1)}
              >
                ← 上一个
              </Text>
              <Text
                className={`wk-focus-navbtn${focus === rows.length - 1 ? ' off' : ''}`}
                onClick={() => focus < rows.length - 1 && setFocus(focus + 1)}
              >
                下一个 →
              </Text>
            </View>
          </View>
        );
      })()}

      {/* 休息倒计时条(专注模式自带计时,这里不重复出现) */}
      {rest && focus == null && (
        <View className={`wk-rest${rest.pausedAt != null ? ' is-paused' : ''}`} catchMove>
          <Text className="wk-rest-label">{rest.pausedAt != null ? '已暂停' : '休息中'}</Text>
          <Text className="wk-rest-time">{fmtDuration(restRemain)}</Text>
          <View className="wk-rest-bar">
            <View
              className="wk-rest-fill"
              style={{ width: `${restPct(rest, Date.now())}%` }}
            />
          </View>
          <View className="wk-rest-ops">
            <Text className="wk-rest-op" onClick={toggleRestPause}>
              {rest.pausedAt != null ? '继续' : '暂停'}
            </Text>
            <Text className="wk-rest-op" onClick={extendRest}>+15s</Text>
            <Text className="wk-rest-op" onClick={() => setRest(null)}>跳过</Text>
          </View>
        </View>
      )}

      {/* 自感强度选择器 — 底部弹层 */}
      {rating && (
        <>
          <View className="wk-mask" onClick={() => setRating(null)} catchMove />
          <View className="wk-rate" catchMove>
            <View className="wk-rate-head">
              <View className="wk-rate-title">
                <Text className="fs-h1">这组还能再做几次?</Text>
                <Text className="fs-mini text-secondary">
                  {rows[rating.ri]?.nameZh} 第 {rating.si + 1} 组
                </Text>
              </View>
              <Text className="wk-rate-close" onClick={() => setRating(null)}>✕</Text>
            </View>
            <View className="wk-rate-opts">
              {EFFORT_PRESETS.map((b) => {
                const cur = rows[rating.ri]?.sets[rating.si]?.rir;
                const on = cur === b.rir;
                return (
                  <View
                    className={`wk-rate-opt${on ? ' active' : ''}`}
                    key={b.rir}
                    onClick={() => rateSet(b.rir)}
                  >
                    <View className="wk-rate-dot" style={{ background: b.color }} />
                    <View className="wk-rate-copy">
                      <Text className="wk-rate-label">{b.label}</Text>
                      <Text className="fs-mini text-secondary">{b.feel}</Text>
                    </View>
                    {on && <Text className="wk-rate-tick">✓</Text>}
                  </View>
                );
              })}
            </View>
            <Text className="fs-mini text-secondary wk-rate-foot">
              评分可选;记了它,才能真正看出练得够不够狠、该不该加重。
            </Text>
          </View>
        </>
      )}

      {/* 动作操作面板 */}
      {ops != null && rows[ops] && (
        <>
          <View className="wk-mask" onClick={() => setOps(null)} catchMove />
          <View className="wk-panel" catchMove>
            <View className="wk-panel-head">
              <View className="wk-panel-title">
                <Text className="fs-h1">{rows[ops].nameZh}</Text>
                <Text className="fs-mini text-secondary">调整只影响本次训练;想长期改去「编排计划」</Text>
              </View>
              <Text className="wk-panel-close" onClick={() => setOps(null)}>✕</Text>
            </View>
            <View className="wk-ops">
              {/* 排第一:这是这一屏里唯一「只想看一眼、什么都不改」的动作(见 howTo 状态) */}
              <Text className="wk-op-row" onClick={() => { const i = ops; setOps(null); setHowTo(i); }}>怎么做这个动作(步骤)</Text>
              <Text className={`wk-op-row${canMoveWorkoutRow(rows, ops, -1) ? '' : ' off'}`} onClick={() => { moveRow(ops, -1); setOps(null); }}>上移</Text>
              <Text className={`wk-op-row${canMoveWorkoutRow(rows, ops, 1) ? '' : ' off'}`} onClick={() => { moveRow(ops, 1); setOps(null); }}>下移</Text>
              {/* 超级组的成员:整个组一起走,别把一轮交替做拆成两半(见 engine/order.ts 开头) */}
              {inUnit(rows, ops) && (
                <Text className="wk-op-hint">超级组是一整块:组内换位,或者两个动作一起挪</Text>
              )}
              <Text className="wk-op-row" onClick={() => { const i = ops; setOps(null); setSwapPid(rows[i].patternId); setSwapAdd(false); setSwap(i); }}>换个动作</Text>
              {/* 排在这:紧挨着「换个动作」—— 一时想不起某个动作叫什么时,那个面板里有器械筛选和收藏,
                  从这儿进去比去动作库翻一趟快(翻过去回来这一场的组就没了,见 howTo 那段) */}
              <Text className="wk-op-row" onClick={() => { const i = ops; setOps(null); setSwapPid(rows[i].patternId); setSwapAdd(true); setSwap(i); }}>加练一个动作</Text>
              <Text className="wk-op-row" onClick={() => { const i = ops; setOps(null); setFocus(i); }}>专注练这个(大字模式)</Text>
              <Text className="wk-op-row" onClick={() => { const i = ops; setOps(null); setHist(i); }}>看这个动作的历史</Text>
              <Text
                className="wk-op-row"
                onClick={() => {
                  const id = rows[ops].exerciseId;
                  setNoteFor(id);
                  setNoteDraft(notes[id] ?? '');
                  setOps(null);
                }}
              >
                {notes[rows[ops].exerciseId] ? '改备注' : '加备注'}
              </Text>
              {/* 只对**计划里有的**动作摆这一条:计划外的(换进来的、加练的)推不动,本来就没在算账。
                  摆了它也什么都改不了 —— 「不可点的不要装可点」的同一个道理(判据见 engine/progression.canProgress) */}
              {day && canProgress(day, rows[ops].exerciseId) && (
                <Text className="wk-op-row" onClick={() => toggleRowProg(ops)}>
                  {rows[ops].noProg ? '恢复计入(下次目标照常更新)' : '这次不算进步'}
                </Text>
              )}
              <Text className="wk-op-row danger" onClick={() => delRow(ops)}>本次不练这个</Text>
            </View>
          </View>
        </>
      )}

      {/* 选动作(本次训练):换个动作 / 加练一个动作 共用这一份界面 */}
      {swap != null && plan && rows[swap] && (() => {
        const r = rows[swap];
        const adding = swapAdd;
        // patternId 可能为空(「重复上次」补进来的临时动作)→ 默认落到水平推,用户可再选模式
        const pid = swapPid || r.patternId || 'hpush';
        const pool = patternPool(plan.access, plan.level);
        const pidList = Object.keys(PATTERNS).filter((x) => (pool[x]?.length ?? 0) > 0);
        // 收藏优先、常练优先 —— 跟动作库/计划编辑器用同一个排序,三处手感一致
        const list = sortedByFav(pool[pid] ?? [], favs, usage);
        return (
          <>
            <View className="wk-mask" onClick={closeSwap} catchMove />
            <View className="wk-panel" catchMove>
              <View className="wk-panel-head">
                <View className="wk-panel-title">
                  <Text className="fs-h1">{adding ? '加练哪个动作?' : '换成哪个动作?'}</Text>
                  <Text className="fs-mini text-secondary">
                    {PATTERNS[pid]?.zhName} · 按你计划里的器械条件筛
                    {/* 加练是插进去的:说清插在哪,免得以为会顶掉当前这个动作 */}
                    {adding ? ' · 排在当前这一块之后' : ''}
                  </Text>
                </View>
                <Text className="wk-panel-close" onClick={closeSwap}>✕</Text>
              </View>
              <View className="wk-chips">
                {pidList.map((x) => (
                  <Text
                    key={x}
                    className={`wk-chip${x === pid ? ' on' : ''}`}
                    onClick={() => setSwapPid(x)}
                  >
                    {PATTERNS[x].zhName}
                  </Text>
                ))}
              </View>
              <View className="wk-exlist">
                {list.map((ex) => {
                  // 只有「换」这一路才有「当前」可言;加练点中当前这个动作是有意义的
                  // (今天再做一遍同一个动作是很正常的事),不该被禁掉
                  const on = !adding && ex.id === r.exerciseId;
                  return (
                    <View
                      className={`wk-ex-opt${on ? ' on' : ''}`}
                      key={ex.id}
                      onClick={() => (adding ? addTo(swap, pid, ex) : !on && swapTo(swap, pid, ex))}
                    >
                      <View className="wk-ex-opt-copy">
                        <Text className="wk-ex-opt-name">{ex.nameZh}</Text>
                        <Text className="fs-mini text-secondary">
                          {EQUIPMENT_ZH[ex.equipment as keyof typeof EQUIPMENT_ZH] ?? ex.equipment}
                          {' · '}
                          {MUSCLE_ZH[ex.target as keyof typeof MUSCLE_ZH] ?? ex.target}
                        </Text>
                      </View>
                      {on && <Text className="wk-ex-opt-tick">当前</Text>}
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        );
      })()}

      {/* 动作备注编辑 */}
      {noteFor && (
        <>
          <View className="wk-mask" onClick={() => setNoteFor(null)} catchMove />
          <View className="wk-panel" catchMove>
            <View className="wk-panel-head">
              <View className="wk-panel-title">
                <Text className="fs-h1">备注「{findExercise(noteFor)?.nameZh ?? ''}」</Text>
                <Text className="fs-mini text-secondary">这条备注会一直跟着这个动作,每次训练都提醒你</Text>
              </View>
              <Text className="wk-panel-close" onClick={() => setNoteFor(null)}>✕</Text>
            </View>
            <Textarea
              className="wk-note-input"
              value={noteDraft}
              maxlength={60}
              placeholder="例:左肩有点紧,重量减一档 / 用斜凳角度 30°"
              placeholderClass="wk-sn-ph"
              onInput={(e) => setNoteDraft(e.detail.value)}
            />
            <Button className="btn btn--primary btn--block" onClick={saveNote}>保存备注</Button>
            <Text className="fs-mini text-secondary wk-panel-empty">清空内容再保存 = 删除这条备注</Text>
          </View>
        </>
      )}

      {/* 动作历史 */}
      {hist != null && rows[hist] && (() => {
        const r = rows[hist];
        const hs = historyOf(r.exerciseId);
        return (
          <>
            <View className="wk-mask" onClick={() => setHist(null)} catchMove />
            <View className="wk-panel" catchMove>
              <View className="wk-panel-head">
                <View className="wk-panel-title">
                  <Text className="fs-h1">{r.nameZh} 的历史</Text>
                  <Text className="fs-mini text-secondary">最近 {hs.length} 次记录(重量 × 次数)</Text>
                </View>
                <Text className="wk-panel-close" onClick={() => setHist(null)}>✕</Text>
              </View>
              <View className="wk-hist">
                {hs.map((h, i) => (
                  <View className="wk-hist-row" key={`${h.date}-${i}`}>
                    <Text className="wk-hist-date">{h.date}</Text>
                    <Text className="fs-mini text-secondary wk-hist-sets">
                      {h.sets.map((s) => `${loadText(r.exerciseId, s.weightKg)}×`
                        + (r.sided ? `每侧 ${sideRepsText(s.reps)}` : s.reps)).join(' · ')}
                    </Text>
                  </View>
                ))}
                {hs.length === 0 && (
                  <Text className="fs-mini text-secondary wk-panel-empty">
                    还没有这个动作的历史记录,这次就是第一次,记下重量下次才有对比。
                  </Text>
                )}
              </View>
              {hs.length > 0 && (
                <Text
                  className="wk-panel-more"
                  onClick={() => {
                    const id = r.exerciseId;
                    setHist(null);
                    navigate(`/pkg-exercise/exercise-history/index?exerciseId=${id}`);
                  }}
                >
                  看完整曲线与掉力分析 ›
                </Text>
              )}
            </View>
          </>
        );
      })()}

      {/* 动作速查(练到一半忘了怎么做)— 步骤与动作库详情弹层同一份,见 howto/HowTo.tsx */}
      {howTo != null && rows[howTo] && (() => {
        const row = rows[howTo];
        const ex = findExercise(row.exerciseId);
        return (
          <>
            <View className="wk-mask" onClick={() => setHowTo(null)} catchMove />
            <View className="wk-panel" catchMove>
              <View className="wk-panel-head">
                <View className="wk-panel-title">
                  <Text className="fs-h1">{row.nameZh}</Text>
                  <Text className="fs-mini text-secondary">动作库里的步骤;看完接着练,不用退出去</Text>
                </View>
                <Text className="wk-panel-close" onClick={() => setHowTo(null)}>✕</Text>
              </View>
              {ex ? (
                <ExHowTo ex={ex} note={notes[row.exerciseId]} />
              ) : (
                <Text className="fs-mini text-secondary wk-panel-empty">
                  动作信息找不到了(多半是「照上次再来一遍」补进来的老动作)——
                  按你的记忆练,或者走「⋯ → 换个动作」换一个。
                </Text>
              )}
            </View>
          </>
        );
      })()}

      {/* 练前上称的弹层(主包那个组件,见上面的 wk-weigh 一行)。
          不要那截历史:这是练到一半顺手站上秤,历史列表会跟「回到训练」抢地方 */}
      <WeightSheet
        open={weighOpen}
        onClose={() => setWeighOpen(false)}
        onSaved={() => { track('training_weigh_save', 'other'); setWeighed(true); }}
        history={false}
      />

      {/* 完成汇总 */}
      {summary && (
        <>
          <View className="wk-mask" onClick={closeSummary} catchMove />
          <View className="wk-sheet" catchMove>
            <Text className="wk-sheet-emoji">🎉</Text>
            <Text className="wk-sheet-title">训练完成!</Text>
            <View className="wk-sheet-stats">
              {/* 改时长时这一格跟着走(改的是同一条记录),不然「上面 45 分钟、下面 72 分」 */}
              <View className="wk-stat"><Text className="wk-stat-v">{fmtSpan(durMin != null ? durMin * 60 : summary.sec)}</Text><Text className="wk-stat-k">时长</Text></View>
              <View className="wk-stat"><Text className="wk-stat-v">{summary.sets}</Text><Text className="wk-stat-k">总组数</Text></View>
              <View className="wk-stat"><Text className="wk-stat-v">{summary.reps}</Text><Text className="wk-stat-k">总次数</Text></View>
              <View className="wk-stat"><Text className="wk-stat-v">{summary.volume >= 1000 ? `${(summary.volume / 1000).toFixed(1)}t` : summary.volume}</Text><Text className="wk-stat-k">容量kg</Text></View>
              {summary.holdSec > 0 && (
                <View className="wk-stat wk-stat--hold"><Text className="wk-stat-v">{holdText(summary.holdSec)}</Text><Text className="wk-stat-k">保持</Text></View>
              )}
            </View>

            {/* 时长的手改出口 —— 计时是墙钟算的,中途被打断那次会虚高(见 saveDuration) */}
            {durMin == null ? (
              <Text
                className="fs-mini text-secondary wk-dur-open"
                onClick={() => {
                  setDurMin(spanMinutes(summary.sec));
                  track('training_duration_open', 'other');
                }}
              >
                接电话/器械被占,时长记多了?点这里改 ›
              </Text>
            ) : (
              <View className="wk-dur">
                <Text className="wk-dur-k">本次时长</Text>
                {/* 这一格**只给加减、不给键盘**:健身房是单手操作,而这里要的是
                    「刚才被电话耽误了大概二十分钟」这种粗修,5 分钟一档够用。
                    键盘输入留在补录页(历史 → 那一天 → 改):那一页的输入框离保存
                    按钮有一屏远,敲完不可能立刻点到提交;放在这里,「敲 45、马上点好了」
                    会赶上输入框还没失焦,存下去的是敲之前那个数(而屏幕上写着 45)。 */}
                <View className="wk-dur-step">
                  <Text
                    className="wk-dur-btn"
                    onClick={() => setDurMin(spanMinutes((durMin - SPAN_STEP_MIN) * 60))}
                  >−</Text>
                  <Text className="wk-dur-val">{durMin}</Text>
                  <Text className="wk-dur-unit">分钟</Text>
                  <Text
                    className="wk-dur-btn"
                    onClick={() => setDurMin(spanMinutes((durMin + SPAN_STEP_MIN) * 60))}
                  >＋</Text>
                </View>
                <Text className="wk-dur-ok" onClick={saveDuration}>好了</Text>
                <Text className="wk-dur-cancel" onClick={() => setDurMin(null)}>算了</Text>
              </View>
            )}
            {summary.avgRir != null && (
              <View className="wk-sheet-eff">
                <View className="wk-rate-dot" style={{ background: effortColor(summary.avgRir) ?? undefined }} />
                <Text className="fs-mini wk-sheet-eff-t">
                  平均强度 RIR {summary.avgRir} · {effortVerdict(summary.avgRir)}
                </Text>
              </View>
            )}
            {summary.sessionNote && (
              <View className="wk-sheet-eff">
                <Text className="fs-mini wk-sheet-eff-t">本次感受:{summary.sessionNote}</Text>
              </View>
            )}
            {/* 开了「不算进步」时明说一句 —— 否则用户看到这页没提「下次目标已更新」会以为坏了 */}
            {summary.noProg && (
              <View className="wk-sheet-eff">
                <Text className="fs-mini wk-sheet-eff-t">
                  这次已标为「不算进步」:记录留着,下次目标没动。等你状态回来了照原来的目标练就行。
                </Text>
              </View>
            )}
            {/* 标了「不算进步」的动作要**点名**说一句 —— 否则它只是从下面那张「下次目标已更新」
                里悄悄消失:用户明明练了卧推,却在那一列里找不到它,只会以为这个 App 漏了它 */}
            {summary.progOff.length > 0 && (
              <View className="wk-sheet-eff">
                <Text className="fs-mini wk-sheet-eff-t">
                  {summary.progOff.join(' · ')} 这次不算进步:记录留着,下次目标没动。
                </Text>
              </View>
            )}
            {summary.notes.length > 0 && (
              <View className="wk-sheet-notes">
                <Text className="fs-mini wk-sheet-notes-title">下次目标已更新</Text>
                {summary.notes.map((n, i) => <Text className="wk-sheet-note" key={i}>{n}</Text>)}
              </View>
            )}
            {/* 练完这一刻分享欲最强:一张图发出去,或者一段文字粘给教练 */}
            <View className="wk-sheet-ops">
              <Button
                className="btn btn--secondary wk-sheet-op"
                onClick={() => navigate(`/pkg-exercise/share/index?logId=${summary.logId}`)}
              >
                生成分享卡
              </Button>
              <Button className="btn btn--secondary wk-sheet-op" onClick={copySummaryText}>复制成文字</Button>
              <Button className="btn btn--primary wk-sheet-op" onClick={closeSummary}>回到计划</Button>
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}
