import { useEffect, useRef, useState } from 'react';
import { View, Text, Button, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { THEME } from '@/constants/theme';
import planIcon from '@/assets/icons/plan.png';
import { track } from '@/services/analytics';
import { loadPlan, loadProgress, loadLogs, loadNotes, savePlan, type ExerciseNotes } from '../engine/store';
import { backfillWorkoutEnergy } from '../engine/workout-energy';
import { GOAL_ZH, LEVEL_ZH, ACCESS_ZH, type PlanDay, type PlannedExercise, type ProgressState, type TrainingPlan, type WorkoutLog } from '../engine/types';
import { SETTYPE_ZH } from '../engine/settype';
import { schemeText } from '../engine/timed';
import { applyCycle, advanceCycle, cycleSummary, cycleWeeks, CYCLE_ZH } from '../engine/cycle';
import { loadText } from '../engine/load';
import LogCard from '../log-card';
import { loadMaxes, pctOfWeight, tmOf, type MaxMap } from '../engine/max';
import { loadKit, loadHint, type Kit } from '../engine/kit';
import { findExercise } from '../engine/generator';
import { loadCoach } from '../engine/coach';
import { gapText, nudgeFor } from '../engine/nudge';
import {
  assignOf, clearDayAssign, loadDayAssigns, resolveDayKey, setDayAssign, type DayAssigns
} from '../engine/dayassign';
import {
  WEEKDAY_ONE, WEEKDAY_ZH, dayForKeys, dayOfKey, moveInRotation, removeFromRotation,
  restartRotation, rotationState, scheduleDayKeys, scheduleOf, setRotation, setScheduleMode,
  setWeekday, splitDayKey, weekdaysOf, weekdayOf, weekPlan
} from '../engine/schedule';
import * as E from '../engine/editor';
import {
  clearDayNote, excusedRunLen, isExcused, loadDayNotes, noteOf, noteText, type DayNotes
} from '../engine/daynote';
import { editDayNoteText, recordDayOff } from '../engine/daynote-sheet';
import { loadReminder } from '@/utils/reminder';
import { saveTrainingDigest } from '@/utils/training-digest';
import { todayDigest } from '../engine/digest';
import { saveTrainingProgress } from '@/utils/training-progress';
import { progressOf } from '../engine/progress';
import { autoSync } from '../engine/sync';
import { addDays, mondayOf, todayStr } from '@/utils/date';
import { toast } from '@/utils/ui';
import './index.scss';
import { navigate } from '@/utils/nav';

/**
 * 训练这摊事一共十几个页面,以前它们**只在「我的 → 健康工具箱」里有一格**,
 * 和「每日一答」平级摆着。练完想看结果的人不会想到去杂物间找 —— 那是入口深,
 * 但更要紧的是**归属错了**:这些页是训练自己的子页,该从训练的地盘进。
 *
 * 分三组写清「它是干嘛的」,而不是摊成一排等用户猜:看结果 / 配好它 / 数据。
 */
const TRAINING_TOOLS: { title: string; items: { name: string; desc: string; url: string }[] }[] = [
  {
    title: '看结果',
    items: [
      { name: '训练统计', desc: '打卡热力 · 纪录 · 力量曲线', url: '/pkg-exercise/stats/index' },
      { name: '训练记录', desc: '练过的每一次 · 请假的日子', url: '/pkg-exercise/log-history/index' },
      { name: '肌群与恢复', desc: '各部位练了多少 · 缓过来没', url: '/pkg-exercise/muscles/index' }
    ]
  },
  {
    title: '配好它',
    items: [
      { name: '我的器材', desc: '配片计算 · 哑铃档位', url: '/pkg-exercise/kit/index' },
      { name: '动作库', desc: '按部位 / 器械挑动作', url: '/pkg-exercise/library/index' },
      { name: '训练提醒', desc: '该练了叫你一声', url: '/pkg-exercise/reminder/index' }
    ]
  },
  {
    title: '数据',
    items: [
      { name: '训练数据同步', desc: '换手机不丢 · 计划与日志', url: '/pkg-exercise/sync/index' },
      { name: '导出与备份', desc: '复制一段文本带走', url: '/pkg-exercise/backup/index' },
      { name: '训练分享卡', desc: '把一次训练发出去', url: '/pkg-exercise/share/index' }
    ]
  }
];

/** 计划页上次看的是日程还是日常 —— 只记在这台设备上,不参与同步 */
const TAB_KEY = 'bodyos.training.planTab';
type Tab = 'schedule' | 'routines';
const readTab = (): Tab => {
  try {
    return Taro.getStorageSync(TAB_KEY) === 'routines' ? 'routines' : 'schedule';
  } catch {
    return 'schedule';
  }
};

/** 某动作的实时目标(渐进状态优先,无记录时用初始值) */
function liveTarget(item: PlannedExercise, prog: ProgressState) {
  const p = prog[item.exerciseId];
  return {
    weightKg: p ? p.weightKg : item.weightKg,
    repsMin: p ? p.repsMin : item.repsMin,
    repsMax: p ? p.repsMax : item.repsMax,
    // 计时项的当前目标在秒上,而且它会随渐进变(撑满上限 +5 秒)—— 计划页显示的就是
    // 用户下一次要撑多久,不带上它的话这里永远停在计划刚生成时的那个数
    holdSec: p?.holdSec ?? item.holdSec,
    streak: p ? p.successStreak : 0,
    suggestion: p?.suggestion ?? null
  };
}

/** 我的训练计划 —— 日程(怎么练/何时练)+ 日常(练什么) */
export default function PlanView() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [prog, setProg] = useState<ProgressState>({});
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [notes, setNotes] = useState<ExerciseNotes>({});
  const [maxes, setMaxes] = useState<MaxMap>({});
  /** 我的器材 — 计划里显示「每边挂什么」,让用户站到杠铃前不用再心算 */
  const [kit, setKit] = useState<Kit>({});
  /** 请假条(哪天不练) — 注意别和上面那个 notes(每个动作的备注)搞混 */
  const [dayNotes, setDayNotes] = useState<DayNotes>({});
  /** 按天改练(今天练哪一套) — 和请假条是两份,一个管「练不练」一个管「练哪天」 */
  const [assigns, setAssigns] = useState<DayAssigns>({});
  /** 首页的「今天不练」带过来的那个参数,只认一次 */
  const offAsked = useRef(false);
  /** 同样只认一次:首页的「今天改练」带过来的参数 */
  const switchAsked = useRef(false);
  /** 首页点「今天改练」进来时,在日程上挂一句「挑一个」 */
  const [switchTip, setSwitchTip] = useState(false);
  /** 训练日那一摞哪个摊开着 —— 点过才有值(用 `?? false` 取默认) */
  const [dayOpen, setDayOpen] = useState<Record<string, boolean>>({});
  /** 页尾「训练工具」那三组 —— 默认折着,点开才摊 */
  const [toolsOpen, setToolsOpen] = useState(false);
  /** 日程 / 日常 —— 和 openGym 的两个视图同一件事 */
  const [tab, setTabState] = useState<Tab>(readTab);
  /** 轮转的调整模式(出现上移/下移/移除) */
  const [editLoop, setEditLoop] = useState(false);
  /** 固定周某一天的选择器:开着时保存用户点的星期几和勾选草稿 */
  const [assignSheet, setAssignSheet] = useState<{ dow: number; keys: string[] } | null>(null);
  /** 「加到轮转」的选择器(只列还没进轮转的) */
  const [addLoop, setAddLoop] = useState(false);
  /** 日常列表的编辑模式(上移/下移/复制/删除) */
  const [editDays, setEditDays] = useState(false);
  /** 教练留了一版没决定的方案 —— 页头那个入口上点一颗,别让用户忘了它 */
  const [coachPending, setCoachPending] = useState(false);
  /** storage 读进来没有:下面那个 effect 的第一写要等它,不然会先把一张空小抄写下去 */
  const loaded = useRef(false);
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const today = todayStr();

  const setTab = (v: Tab) => {
    setTabState(v);
    try { Taro.setStorageSync(TAB_KEY, v); } catch { /* 存不下只是下次回到日程,不影响功能 */ }
  };

  /**
   * 记一天请假。`base` 默认用页面手上这份,但**从 useDidShow 里调时必须把刚读出来的那份传进来** ——
   * 那一刻 state 还没落地,读 `dayNotes` 拿到的是上一轮的值,新记的假条会被旧值覆盖。
   */
  const markOff = async (base: DayNotes = dayNotes) => {
    if (isExcused(base, today)) {
      toast('今天已经记过请假了', 'none');
      return;
    }
    const next = await recordDayOff(base, today, today);
    if (next === base) return; // 用户中途取消
    setDayNotes(next);
    // 请假条要立刻上云:服务端的提醒任务只认云端那份(见 reminderRunner.isExcusedToday),
    // 等下次练完才同步的话,请假当天恰好不练 —— 晚上照样会收到「今天该练了」。
    void autoSync().catch(() => undefined);
    track('training_day_off', 'other');
    toast('记下了,这几天不催你', 'none');
  };

  useDidShow(() => {
    const nextPlan = loadPlan();
    const nextLogs = loadLogs();
    const nextNotes = loadNotes();
    const nextDayNotes = loadDayNotes();
    const nextAssigns = loadDayAssigns();
    setPlan(nextPlan);
    setProg(loadProgress());
    setLogs(nextLogs);
    setNotes(nextNotes);
    setMaxes(loadMaxes());
    setKit(loadKit());
    setDayNotes(nextDayNotes);
    setAssigns(nextAssigns);
    setCoachPending(!!loadCoach().pending);
    loaded.current = true;
    void backfillWorkoutEnergy(nextLogs);
    if (params.off === '1' && !offAsked.current) {
      offAsked.current = true;
      void markOff(nextDayNotes);
    }
    if (params.switch === '1' && !switchAsked.current) {
      switchAsked.current = true;
      setSwitchTip(true);
    }
    saveTrainingDigest(todayDigest(nextPlan, nextLogs, nextDayNotes, nextAssigns, today));
    saveTrainingProgress(progressOf(nextLogs));
    track('training_plan_view', 'other');
  });

  useEffect(() => {
    if (!loaded.current) return;
    saveTrainingDigest(todayDigest(plan, logs, dayNotes, assigns, todayStr()));
  }, [plan, logs, dayNotes, assigns]);

  if (!plan) {
    return (
      <Screen className="pview-page">
        <View className="card pv-empty">
          <Image className="pv-empty-icon" src={planIcon} mode="aspectFit" />
          <Text className="fs-h1">还没有训练计划</Text>
          <Text className="fs-mini text-secondary">
            一分钟配置目标与器械,自动编排每周训练,完成后自动渐进
          </Text>
          <Button
            className="btn btn--primary pv-empty-cta"
            onClick={() => navigate('/pkg-exercise/plan-create/index')}
          >
            去生成计划
          </Button>
          {/* 教练也是一条「从没有计划到有计划」的路,空态里不能只剩生成器一条 */}
          <Button
            className="btn btn--ghost"
            onClick={() => navigate('/pkg-exercise/coach/index')}
          >
            让教练排一版
          </Button>
        </View>
      </Screen>
    );
  }

  const sched = scheduleOf(plan);
  const rot = rotationState(plan, logs, today);
  const resolved = resolveDayKey(plan, logs, assigns, today);
  const todayKeys = splitDayKey(resolved);
  const todayDay = dayOfKey(plan, resolved);
  const assignedToday = assignOf(plan, assigns, today);
  const todayLog = logs.find((l) => l.date === today) ?? null;
  const todayDow = weekdayOf(today);

  /**
   * 所有日程/日常改动:改内存 + 立即落库(和计划编辑器同一个语义,所见即所得)。
   * **返回改完的那份** —— 调用方要接着从它里面取新建/删掉之后的结果,
   * 不能靠回调里往外赋值:TypeScript 看不见闭包里的赋值,而且拿渲染时那份旧 plan 也对不上。
   */
  const mutate = (fn: (p: TrainingPlan) => TrainingPlan): TrainingPlan => {
    const next = fn(plan);
    if (next === plan) return plan;
    setPlan(next);
    savePlan(next);
    return next;
  };

  /**
   * 开练。点的**不是**日程建议的那一套时,顺手把「今天改练这个」记下来 ——
   * 这个动作本身就是那个意思,不必再让用户去别处声明一次。
   * 合并训练(两套一起练)不判断「改练」:它本来就包含日程给的下一套。
   */
  const start = (keys: string[]) => {
    const clean = keys.filter(Boolean);
    if (!clean.length) return;
    setSwitchTip(false);
    if (sched.mode === 'rotation' && clean.length === 1 && clean[0] !== rot.nextKey) {
      const next = setDayAssign(assigns, today, clean[0], plan, today);
      if (next !== assigns) setAssigns(next);
    }
    navigate(`/pkg-exercise/workout/index?keys=${clean.map(encodeURIComponent).join(',')}`);
  };

  /** 改回日程建议的那一套 */
  const backToRotation = () => {
    const next = clearDayAssign(assigns, today);
    if (next === assigns) return;
    setAssigns(next);
    toast('改回日程建议的训练日了', 'none');
  };

  const todayNote = noteOf(dayNotes, today);
  const offDays = todayNote ? excusedRunLen(dayNotes, today) : 0;
  const nudge = nudgeFor({ plan, logs, tone: loadReminder().tone, notes: dayNotes, assigns }, today);
  const nudgeDay = nudge ? dayOfKey(plan, nudge.dayKey) : null;

  const cancelOff = async () => {
    const { confirm } = await Taro.showModal({
      title: '销假?',
      content: '销了假就照常提醒你今天该练了。',
      confirmText: '销假'
    });
    if (!confirm) return;
    setDayNotes(clearDayNote(dayNotes, today));
    // 销假同样要立刻上云:云端还留着「今天请假」的话,今晚的提醒仍然不会发
    void autoSync().catch(() => undefined);
  };

  // 本周实际要练的样子:开了周期就按波次/减载套一层(存下来的计划不变)
  const view = applyCycle(plan, maxes);
  const weeks = view.cycle ? cycleWeeks(view.cycle.style) : [];
  const weekTip = view.cycle ? weeks[view.cycle.week - 1]?.tip : '';

  const nextWeek = async () => {
    if (!view.cycle) return;
    const { confirm } = await Taro.showModal({
      title: '进入下一周?',
      content: view.cycle.week >= weeks.length
        ? '这一轮就走完了。主项的力量基准会上调一档,下周从第 1 周重新开始。'
        : `下周:${weeks[view.cycle.week]?.label ?? ''}。`,
      confirmText: '进入'
    });
    if (!confirm) return;
    const next = advanceCycle(plan, maxes);
    savePlan(next);
    setPlan(next);
    setMaxes(loadMaxes());
    Taro.showToast({
      title: next.cycle?.week === 1 ? '一轮走完,基准已上调' : `进入${cycleSummary(next) ?? ''}`,
      icon: 'none'
    });
  };

  const openAssign = (dow: number) => setAssignSheet({ dow, keys: sched.week[dow].slice() });
  const toggleAssignKey = (key: string) => setAssignSheet((s) => {
    if (!s) return s;
    return {
      ...s,
      keys: s.keys.includes(key) ? s.keys.filter((k) => k !== key) : [...s.keys, key]
    };
  });
  const saveAssign = (keys: string[]) => {
    const sheet = assignSheet;
    if (!sheet) return;
    mutate((p) => setWeekday(p, sheet.dow, keys));
    setAssignSheet(null);
    toast(keys.length ? `周${WEEKDAY_ONE[sheet.dow]}已排好` : `已把周${WEEKDAY_ONE[sheet.dow]}留作休息`, 'none');
  };

  /** 加到轮转末尾;已经在里面的不重复加 */
  const addToLoop = (key: string) => {
    if (rot.seq.includes(key)) return;
    mutate((p) => setRotation(p, [...rot.seq, key]));
    setAddLoop(false);
    const d = plan.days.find((x) => x.key === key);
    toast(`「${d?.title ?? '训练日'}」已加到轮转`, 'none');
  };

  const addDayToSchedule = () => {
    // 先建出来,再把人送进编辑器 —— 新的一天是空的,「去编排」是最自然的下一步
    const before = new Set(plan.days.map((d) => d.key));
    const next = mutate((p) => E.addDay(p));
    const created = next.days.find((d) => !before.has(d.key));
    navigate(`/pkg-exercise/plan-edit/index?day=${encodeURIComponent(created?.key ?? '')}`);
  };

  const duplicateDayAt = (di: number) => {
    const before = new Set(plan.days.map((d) => d.key));
    const next = mutate((p) => E.duplicateDay(p, di));
    const created = next.days.find((d) => !before.has(d.key));
    // 复制品不进轮转/固定周:它是一份待编排的副本,用户自己决定排到哪天
    if (created) toast(`已复制「${created.title}」,排进日程由你决定`, 'none');
  };

  const deleteDayAt = async (di: number) => {
    const d = plan.days[di];
    if (!d || plan.days.length <= 1) {
      toast('至少留一个训练日', 'none');
      return;
    }
    const { confirm } = await Taro.showModal({
      title: `删除「${d.title}」?`,
      content: '这一天的动作和组次会一起删掉;练过的记录仍然留在历史里。',
      confirmText: '删除',
      confirmColor: THEME.danger
    });
    if (!confirm) return;
    // 删人和清日程引用必须**在同一次变换里**做完:分两次 mutate 的话,
    // 第二次还会拿渲染时那份旧 plan(里面的人还在),等于把刚删的又写回去
    mutate((p) => {
      const removed = E.removeDay(p, di);
      const clean = scheduleOf(removed).rotation;
      return setRotation(removed, clean);
    });
    toast(`「${d.title}」已删除`, 'none');
  };

  const loopDays = rot.seq
    .map((k) => plan.days.find((d) => d.key === k))
    .filter((d): d is PlanDay => !!d);
  const notInLoop = plan.days.filter((d) => !rot.seq.includes(d.key));
  const extras = weekPlan(plan)
    .map((w) => ({ ...w, keys: w.keys.filter((k) => !rot.seq.includes(k)) }))
    .filter((w) => w.keys.length > 0);

  return (
    <Screen className="pview-page">
      {/* 标题 + 教练入口(openGym 的 Schedule 页头也是这两样) */}
      <View className="pv-hdr">
        <View className="pv-hdr-copy">
          <Text className="pv-hdr-title">训练计划</Text>
          <Text className="fs-mini text-secondary">
            {sched.mode === 'rotation'
              ? (rot.seq.length ? `轮转 · 本轮 ${rot.doneCount}/${rot.seq.length}` : '轮转 · 还没排顺序')
              : `固定周 · 每周 ${plan.daysPerWeek} 练`}
          </Text>
        </View>
        <View className="pv-coach" onClick={() => navigate('/pkg-exercise/coach/index')}>
          <Text>教练 ›</Text>
          {coachPending && <View className="pv-coach-dot" />}
        </View>
      </View>

      {/* 日程 / 日常 —— 两个视图管的是两件事:什么时候练,和练什么 */}
      <View className="pv-tabs">
        <Text
          className={`pv-tab${tab === 'schedule' ? ' on' : ''}`}
          onClick={() => setTab('schedule')}
        >
          日程
        </Text>
        <Text
          className={`pv-tab${tab === 'routines' ? ' on' : ''}`}
          onClick={() => setTab('routines')}
        >
          日常
        </Text>
      </View>

      {tab === 'schedule' ? <>
        {/* 今天请了假 —— 提醒卡片让它让位 */}
        {todayNote && (
          <View className="card pv-off">
            <View className="pv-off-head">
              <Text className="pv-off-title">今天{noteText(todayNote)}</Text>
              {offDays > 1 && <Text className="fs-mini pv-off-run">连着第 {offDays} 天</Text>}
            </View>
            <Text className="fs-mini text-secondary">
              这几天不算欠账,也不会来催你。计划、动作、重量都原样留着 —— 回来那天接着练就行。
            </Text>
            <View className="pv-off-ops">
              <Text
                className="pv-off-op"
                onClick={() => void editDayNoteText(dayNotes, today, todayNote, today).then(setDayNotes)}
              >
                {todayNote.text ? '改说明' : '补一句'}
              </Text>
              <Text className="pv-off-op pv-off-op--danger" onClick={cancelOff}>销假</Text>
            </View>
          </View>
        )}

        {/* 今天 —— 这一页最该回答的那件事。以前只有「该催你」的时候才出现一张卡,
            不该催的日子(轮转刚练完、固定周的休息日)就什么都不说,用户得自己往下翻。 */}
        {!todayNote && (todayLog ? (
          <View className="card pv-today is-done">
            <View className="pv-today-head">
              <Text className="pv-today-title">今天练完了 · {todayLog.dayTitle}</Text>
              <Text className="fs-mini text-secondary">{todayLog.totalSets} 组</Text>
            </View>
            <Text className="fs-mini text-secondary">已记下,下次接着来。</Text>
            <View className="pv-today-ops">
              <Text className="pv-today-link" onClick={() => navigate('/pkg-exercise/log-history/index')}>
                看这次练了什么 ›
              </Text>
            </View>
          </View>
        ) : todayDay ? (
          <View className={`card pv-today${nudge?.kind === 'back' ? ' is-back' : ''}`}>
            <View className="pv-today-head">
              <Text className="pv-today-title">
                {nudge ? nudge.title : (assignedToday ? '今天改练' : '今天练')} · {todayDay.title}
              </Text>
              {nudge && <Text className="fs-mini pv-today-gap">{gapText(nudge.gapDays, nudge.missedCount)}</Text>}
            </View>
            <Text className="pv-today-line">{nudge ? nudge.line : todayDay.focus || '按日程来'}</Text>
            <Text className="fs-mini text-secondary">
              {todayDay.items.length ? `${todayDay.items.length} 个动作 · ` : ''}约 {todayDay.estMin} 分钟
              {todayKeys.length > 1 ? ` · ${todayKeys.length} 套合并` : ''}
            </Text>
            <Button className="btn btn--primary pv-today-go" onClick={() => start(todayKeys)}>
              开始练「{todayDay.title}」
            </Button>
            <View className="pv-today-ops">
              {assignedToday && <Text className="pv-today-link" onClick={backToRotation}>改回日程建议的</Text>}
              <Text className="pv-today-link" onClick={() => void markOff()}>今天不练</Text>
              <Text className="pv-today-link" onClick={() => navigate('/pkg-exercise/reminder/index')}>提醒设置</Text>
            </View>
            {nudge && <Text className="fs-mini pv-today-hint">出差、生病、想歇几天 —— 记一天就不再催你,也不打断节奏</Text>}
          </View>
        ) : (
          <View className="card pv-rest">
            <Text className="pv-rest-title">今天休息</Text>
            <Text className="fs-mini text-secondary">
              {sched.mode === 'week'
                ? '固定周把今天留白了。想练的话,点下面的那天改成训练日。'
                : '轮转里还没有能练的训练日。先把训练日加进轮转顺序。'}
            </Text>
            <Text
              className="pv-rest-link"
              onClick={() => (sched.mode === 'week' ? openAssign(todayDow) : setAddLoop(true))}
            >
              {sched.mode === 'week' ? '安排今天 ›' : '添加训练日 ›'}
            </Text>
          </View>
        ))}

        {/* 今天改练了 —— 只改这一天,明天照常 */}
        {assignedToday && !todayLog && todayDay && (
          <View className="card pv-assign">
            <Text className="fs-mini text-secondary">
              今天改练了「{todayDay.title}」—— 只改这一天,明天照常。
            </Text>
            <Text className="pv-assign-undo" onClick={backToRotation}>改回建议的</Text>
          </View>
        )}

        {/* 首页「今天改练」带过来的提示 */}
        {switchTip && (
          <View className="card pv-assign">
            <Text className="fs-mini text-secondary">
              下面挑今天要练的那套(轮转里点「练这套」,固定周点那天的「开始练」)——
              只改今天,明天照常。
            </Text>
            <Text className="pv-assign-undo" onClick={() => setSwitchTip(false)}>知道了</Text>
          </View>
        )}

        {/* 怎么练 —— 固定周 / 轮转,两套日程都保留,切来切去不用重排 */}
        <View className="card pv-mode">
          <View className="pv-mode-head">
            <Text className="fs-h1">怎么练</Text>
            <View className="pv-seg">
              <Text
                className={`pv-seg-item${sched.mode === 'week' ? ' on' : ''}`}
                onClick={() => mutate((p) => setScheduleMode(p, 'week'))}
              >
                固定周
              </Text>
              <Text
                className={`pv-seg-item${sched.mode === 'rotation' ? ' on' : ''}`}
                onClick={() => mutate((p) => setScheduleMode(p, 'rotation'))}
              >
                轮转
              </Text>
            </View>
          </View>
          <Text className="fs-mini text-secondary">
            {sched.mode === 'week'
              ? '每周固定哪天练哪套,到那天就练那天。'
              : '一套套按顺序轮,不看星期几;做完最后一套再从第一套开始。'}
          </Text>
        </View>

        {sched.mode === 'week' ? (
          <View className="card pv-week">
            <View className="pv-sec-head">
              <Text className="fs-h1">这周</Text>
              <Text className="fs-mini text-secondary">{WEEKDAY_ZH[todayDow]} · 今天</Text>
            </View>
            {weekPlan(plan).map((w) => {
              const isToday = w.dow === todayDow;
              return (
                <View
                  key={w.dow}
                  className={`pv-week-row${isToday ? ' is-today' : ''}`}
                  onClick={() => openAssign(w.dow)}
                >
                  <Text className="pv-week-day">{WEEKDAY_ONE[w.dow]}</Text>
                  <View className="pv-week-main">
                    <Text className="pv-week-title">{w.day ? w.day.title : '休息日'}</Text>
                    <Text className="fs-mini text-secondary">
                      {w.day
                        ? `${w.day.items.length} 个动作 · 约 ${w.day.estMin} 分钟${w.keys.length > 1 ? ` · ${w.keys.length} 套` : ''}`
                        : '点一下安排,或留作休息'}
                    </Text>
                  </View>
                  {isToday && w.day && (
                    <Text
                      className="pv-week-go"
                      onClick={(ev) => {
                        // 整行是「安排这一天」;「开始练」只吃自己那一下,别顺手把选择器也打开
                        ev.stopPropagation();
                        start(w.keys);
                      }}
                    >
                      开始练
                    </Text>
                  )}
                  <Text className="pv-week-tail">{w.day ? '›' : '＋'}</Text>
                </View>
              );
            })}
            <Text className="fs-mini text-secondary pv-week-foot">
              一天想练两套?点开那一天多选,开练时会合并成一次训练。
            </Text>
          </View>
        ) : (
          <>
            <View className="card pv-loop">
              <View className="pv-sec-head">
                <Text className="fs-h1">轮转顺序</Text>
                <View className="pv-sec-acts">
                  {rot.seq.length > 0 && (
                    <Text className="pv-textbtn" onClick={() => setEditLoop((v) => !v)}>
                      {editLoop ? '完成' : '调整'}
                    </Text>
                  )}
                  {notInLoop.length > 0 && (
                    <Text className="pv-textbtn pv-textbtn--add" onClick={() => setAddLoop(true)}>＋ 添加</Text>
                  )}
                </View>
              </View>

              {loopDays.length ? loopDays.map((d, i) => {
                const key = d.key;
                const done = rot.done.has(key);
                const isNext = key === rot.nextKey && !rot.complete;
                const at = rot.seq.indexOf(key);
                return (
                  <View className={`pv-loop-row${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`} key={key}>
                    {editLoop && (
                      <Text className="pv-loop-minus" onClick={() => mutate((p) => removeFromRotation(p, key))}>
                        −
                      </Text>
                    )}
                    <Text className={`pv-loop-n${isNext ? ' next' : ''}`}>{done ? '✓' : i + 1}</Text>
                    <View className="pv-loop-main">
                      <Text className="pv-loop-title">{d.title}</Text>
                      <Text className="fs-mini text-secondary">
                        {done
                          ? '本轮已完成'
                          : isNext
                            ? '接下来练'
                            : rot.complete
                              ? '下一轮从这套开始'
                              : '本轮之后'}
                        {d.items.length ? ` · ${d.items.length} 个动作 · 约 ${d.estMin} 分钟` : ''}
                      </Text>
                    </View>
                    {editLoop ? (
                      <View className="pv-loop-move">
                        <Text
                          className={`pv-iconbtn${at <= 0 ? ' off' : ''}`}
                          onClick={() => { if (at > 0) mutate((p) => moveInRotation(p, key, -1)); }}
                        >
                          ↑
                        </Text>
                        <Text
                          className={`pv-iconbtn${at < 0 || at >= rot.seq.length - 1 ? ' off' : ''}`}
                          onClick={() => { if (at < rot.seq.length - 1) mutate((p) => moveInRotation(p, key, 1)); }}
                        >
                          ↓
                        </Text>
                      </View>
                    ) : (
                      <Text
                        className="pv-loop-go"
                        onClick={() => start([key])}
                      >
                        练这套
                      </Text>
                    )}
                  </View>
                );
              }) : (
                <View className="pv-loop-empty">
                  <Text className="fs-mini text-secondary">
                    还没有轮转顺序。把训练日按想练的顺序加进来,第一个没练的会一直排在最前。
                  </Text>
                  <Text className="pv-loop-add" onClick={() => setAddLoop(true)}>添加训练日 ›</Text>
                </View>
              )}

              {rot.seq.length > 0 && (
                <View className="pv-loop-foot">
                  <Text className="fs-mini text-secondary">
                    {rot.complete
                      ? `本轮 ${rot.doneCount}/${rot.seq.length} 完成 · 下一轮从「${loopDays.find((d) => d.key === rot.nextKey)?.title ?? ''}」开始`
                      : `本轮 ${rot.doneCount}/${rot.seq.length} · ${loopDays.find((d) => d.key === rot.nextKey)?.title ? `下一套「${loopDays.find((d) => d.key === rot.nextKey)!.title}」` : '还没有下一套'}`}
                  </Text>
                  {rot.doneCount > 0 && (
                    <Text
                      className="pv-loop-restart"
                      onClick={() => {
                        mutate((p) => restartRotation(p, today));
                        toast('这一轮从头开始', 'none');
                      }}
                    >
                      从头开始这一轮
                    </Text>
                  )}
                </View>
              )}
              <Text className="fs-mini text-secondary pv-loop-hint">
                练的顺序和轮转不一样?直接点「练这套」就行,做了的那套会从本轮划掉,顺序不受影响。
              </Text>
            </View>

            {/* 也固定练的日子 —— 轮转里没排到的固定日,当天会叠加在轮转下一套上 */}
            {extras.length > 0 && (
              <View className="card pv-week">
                <View className="pv-sec-head">
                  <Text className="fs-h1">也固定练的日子</Text>
                  <Text className="fs-mini text-secondary">在轮转之上叠加</Text>
                </View>
                {extras.map((w) => (
                  <View className="pv-week-row" key={w.dow} onClick={() => openAssign(w.dow)}>
                    <Text className="pv-week-day">{WEEKDAY_ONE[w.dow]}</Text>
                    <View className="pv-week-main">
                      <Text className="pv-week-title">{w.day?.title ?? ''}</Text>
                      <Text className="fs-mini text-secondary">
                        {WEEKDAY_ZH[w.dow]}也练 · 点一下改
                      </Text>
                    </View>
                    <Text className="pv-week-tail">›</Text>
                  </View>
                ))}
                <Text className="fs-mini text-secondary pv-week-foot">
                  这些训练日不在轮转里,到那天会接在轮转的下一套后面一起练。
                </Text>
              </View>
            )}
          </>
        )}

        {/* 计划概要 */}
        <View className="card pv-sum">
          <View className="pv-sum-head">
            <Text className="fs-h1">{GOAL_ZH[plan.goal]} · 每周 {plan.daysPerWeek} 练</Text>
            <Text className="fs-mini text-secondary">已坚持完成 {plan.doneCount} 次</Text>
          </View>
          <View className="pv-badges">
            <Text className="pv-badge">{LEVEL_ZH[plan.level]}</Text>
            <Text className="pv-badge">{ACCESS_ZH[plan.access]}</Text>
            <Text className="pv-badge">单次约 {plan.sessionMin} 分钟</Text>
          </View>
          <Text className="fs-mini text-secondary pv-note">{plan.lastNote}</Text>
        </View>

        {/* 本周周期 */}
        {view.cycle && (
          <View className="card pv-cycle">
            <View className="pv-cycle-head">
              <Text className="fs-h1">{CYCLE_ZH[view.cycle.style]}</Text>
              <Text className="pv-cycle-week">{cycleSummary(view)}</Text>
            </View>
            <Text className="fs-mini text-secondary">{weekTip}</Text>
            <Button className="btn btn--secondary btn--block pv-cycle-next" onClick={nextWeek}>
              {view.cycle.week >= weeks.length ? '这一轮练完了,开始下一轮' : '这周练完了,进入下一周'}
            </Button>
          </View>
        )}
      </> : <>
        {/* ================= 日常:练什么 ================= */}
        <View className="pv-routine-bar">
          {plan.days.length > 0 && (
            <Text className="pv-textbtn" onClick={() => setEditDays((v) => !v)}>
              {editDays ? '完成' : '调整'}
            </Text>
          )}
          <Text className="pv-textbtn pv-textbtn--add" onClick={addDayToSchedule}>＋ 新建训练日</Text>
        </View>

        {plan.days.map((d, di) => {
          const open = !!dayOpen[d.key];
          const days = weekdaysOf(plan, d.key);
          const loopAt = rot.seq.indexOf(d.key);
          return (
            <View className={`card pv-routine${open ? '' : ' pv-routine--row'}`} key={d.key}>
              <View className="pv-routine-head">
                <View
                  className="pv-routine-main"
                  onClick={() => setDayOpen((m) => ({ ...m, [d.key]: !open }))}
                >
                  <View className="pv-day-mark"><Text>{d.title.slice(0, 1)}</Text></View>
                  <View className="pv-day-copy">
                    <Text className="fs-h1">{d.title}</Text>
                    <Text className="fs-mini text-secondary">
                      {d.items.length} 个动作 · {d.focus || '自由编排'} · 约 {d.estMin} 分钟
                    </Text>
                    <View className="pv-routine-tags">
                      {days.length ? (
                        days.map((w) => <Text className="pv-routine-tag" key={w}>{WEEKDAY_ZH[w]}</Text>)
                      ) : (
                        <Text className="pv-routine-tag is-dim">未排进固定周</Text>
                      )}
                      {loopAt >= 0 && (
                        <Text className="pv-routine-tag is-loop">轮转第 {loopAt + 1} 位</Text>
                      )}
                    </View>
                  </View>
                  <Text className="pv-day-chev">{open ? '▴' : '▾'}</Text>
                </View>
              </View>

              {editDays ? (
                <View className="pv-routine-ops">
                  <Text
                    className={`pv-routine-op${di <= 0 ? ' off' : ''}`}
                    onClick={() => { if (di > 0) mutate((p) => E.moveDay(p, di, -1)); }}
                  >
                    上移
                  </Text>
                  <Text
                    className={`pv-routine-op${di >= plan.days.length - 1 ? ' off' : ''}`}
                    onClick={() => { if (di < plan.days.length - 1) mutate((p) => E.moveDay(p, di, 1)); }}
                  >
                    下移
                  </Text>
                  <Text className="pv-routine-op" onClick={() => duplicateDayAt(di)}>复制</Text>
                  <Text
                    className="pv-routine-op"
                    onClick={() => navigate(`/pkg-exercise/plan-edit/index?day=${encodeURIComponent(d.key)}`)}
                  >
                    编排
                  </Text>
                  <Text className="pv-routine-op is-danger" onClick={() => void deleteDayAt(di)}>删除</Text>
                </View>
              ) : open && (
                <>
                  <Button className="btn btn--secondary btn--block pv-start" onClick={() => start([d.key])}>
                    练 {d.title}
                  </Button>
                  {d.items.map((it, ii) => {
                    const t = it.cycleLocked
                      ? { weightKg: it.weightKg, repsMin: it.repsMin, repsMax: it.repsMax, holdSec: it.holdSec, streak: 0, suggestion: null }
                      : liveTarget(it, prog);
                    const pct = pctOfWeight(t.weightKg, tmOf(maxes, it.exerciseId));
                    return (
                      <View className="pv-item" key={`${it.exerciseId}-${ii}`}>
                        <View className="pv-item-main">
                          <Text className="pv-item-name">{it.nameZh}</Text>
                          {it.setType && it.setType !== 'normal' && <Text className="pv-type">{SETTYPE_ZH[it.setType]}</Text>}
                          {it.amrapLast && <Text className="pv-amrap">末组尽力</Text>}
                          {t.streak >= 2 && <Text className="pv-streak">连达标 ×{t.streak}</Text>}
                        </View>
                        <Text className="fs-mini text-secondary">
                          {schemeText({ sets: it.sets, repsMin: t.repsMin, repsMax: t.repsMax, holdSec: t.holdSec, sided: it.sided })}
                          {t.weightKg != null ? ` · ${loadText(it.exerciseId, t.weightKg)}` : ' · 自重'}
                          {pct != null ? `(≈${pct}% 基准)` : ''}
                        </Text>
                        {loadHint(kit, t.weightKg, findExercise(it.exerciseId)) && (
                          <Text className="fs-mini text-secondary pv-plate">
                            {loadHint(kit, t.weightKg, findExercise(it.exerciseId))}
                          </Text>
                        )}
                        {t.suggestion && <Text className="fs-mini pv-suggest">建议进阶:{t.suggestion}</Text>}
                        {it.note && <Text className="fs-mini pv-note-line">今天:{it.note}</Text>}
                        {notes[it.exerciseId] && <Text className="fs-mini pv-note-line">备注:{notes[it.exerciseId]}</Text>}
                      </View>
                    );
                  })}
                  <Text
                    className="pv-routine-edit"
                    onClick={() => navigate(`/pkg-exercise/plan-edit/index?day=${encodeURIComponent(d.key)}`)}
                  >
                    编排这套动作 / 组次 ›
                  </Text>
                </>
              )}
            </View>
          );
        })}
      </>}

      {/* 最近记录 —— 只有 5 行,看全部去训练记录页 */}
      {logs.length > 0 && (
        <View className="card">
          <View className="pv-hist-head">
            <Text className="fs-h1">最近训练</Text>
            <Text
              className="pv-hist-all"
              onClick={() => navigate('/pkg-exercise/log-history/index')}
            >
              全部 {logs.length} 次 ›
            </Text>
          </View>
          {logs.slice(0, 5).map((l) => <LogCard log={l} key={l.id} />)}
        </View>
      )}

      <View className="pv-actions">
        <Button
          className="btn btn--primary btn--block"
          onClick={() => navigate('/pkg-exercise/plan-edit/index')}
        >
          编排动作 / 改组次
        </Button>
        <Button
          className="btn btn--secondary btn--block pv-regen"
          onClick={() => navigate('/pkg-exercise/plan-create/index')}
        >
          重新生成 / 换计划
        </Button>
        <Text
          className="pv-backfill"
          onClick={() => navigate('/pkg-exercise/log-edit/index')}
        >
          补录一次练过的训练
        </Text>
        <Text
          className="pv-backfill"
          onClick={() => navigate('/pkg-exercise/plan-share/index')}
        >
          分享 / 存下这份计划
        </Text>
        {!todayNote && (
          <Text className="pv-backfill" onClick={() => void markOff()}>
            今天不练:记一天请假
          </Text>
        )}
      </View>

      {/* 训练工具 */}
      <View className={`card pv-tools${toolsOpen ? '' : ' pv-tools--row'}`}>
        <View className="pv-tool-head" onClick={() => setToolsOpen((v) => !v)}>
          <View className="pv-day-copy">
            <Text className="fs-h1">训练工具</Text>
            <Text className="fs-mini text-secondary">
              统计 · 记录 · 恢复 · 器材 · 动作库 · 提醒 · 同步 · 导出 · 分享卡
            </Text>
          </View>
          <Text className="pv-day-chev">{toolsOpen ? '▴' : '▾'}</Text>
        </View>
        {!toolsOpen ? null : TRAINING_TOOLS.map((group) => (
          <View className="pv-tool-group" key={group.title}>
            <Text className="pv-tool-group__title">{group.title}</Text>
            {group.items.map((it) => (
              <View
                className="pv-tool"
                key={it.url}
                onClick={() => navigate(it.url)}
              >
                <View className="pv-tool__copy">
                  <Text className="pv-tool__name">{it.name}</Text>
                  <Text className="pv-tool__desc">{it.desc}</Text>
                </View>
                <Text className="pv-tool__arrow">›</Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      {/* ============ 固定周:这一天练什么 ============ */}
      {assignSheet && <>
        <View className="pv-sheet-mask" onClick={() => setAssignSheet(null)} catchMove />
        <View className="pv-sheet" catchMove>
          <View className="pv-sheet-head">
            <View>
              <Text className="fs-h1">{WEEKDAY_ZH[assignSheet.dow]}练什么?</Text>
              <Text className="fs-mini text-secondary">可以多选 —— 同一天两套会合并成一次训练。</Text>
            </View>
            <Text className="pv-sheet-close" onClick={() => setAssignSheet(null)}>✕</Text>
          </View>

          {plan.days.map((d) => {
            const on = assignSheet.keys.includes(d.key);
            return (
              <View
                className={`pv-pick-row${on ? ' on' : ''}`}
                key={d.key}
                onClick={() => toggleAssignKey(d.key)}
              >
                <View className={`pv-pick-check${on ? ' on' : ''}`}>{on && <Text className="pv-pick-tick">✓</Text>}</View>
                <View className="pv-pick-main">
                  <Text className="pv-pick-title">{d.title}</Text>
                  <Text className="fs-mini text-secondary">
                    {d.items.length} 个动作 · {d.focus || '自由编排'}
                  </Text>
                </View>
              </View>
            );
          })}

          <View className="pv-sheet-ops">
            <Text className="pv-sheet-btn" onClick={() => saveAssign([])}>设为休息日</Text>
            <Text className="pv-sheet-btn" onClick={() => setAssignSheet(null)}>取消</Text>
            <Text className="pv-sheet-btn pv-sheet-btn--ok" onClick={() => saveAssign(assignSheet.keys)}>
              保存{assignSheet.keys.length ? `(${assignSheet.keys.length})` : ''}
            </Text>
          </View>
        </View>
      </>}

      {/* ============ 加到轮转 ============ */}
      {addLoop && <>
        <View className="pv-sheet-mask" onClick={() => setAddLoop(false)} catchMove />
        <View className="pv-sheet" catchMove>
          <View className="pv-sheet-head">
            <View>
              <Text className="fs-h1">加到轮转</Text>
              <Text className="fs-mini text-secondary">按你想要的顺序一组组加,之后还能调整。</Text>
            </View>
            <Text className="pv-sheet-close" onClick={() => setAddLoop(false)}>✕</Text>
          </View>
          {notInLoop.length ? notInLoop.map((d) => (
            <View className="pv-pick-row" key={d.key} onClick={() => addToLoop(d.key)}>
              <View className="pv-pick-main">
                <Text className="pv-pick-title">{d.title}</Text>
                <Text className="fs-mini text-secondary">{d.items.length} 个动作 · 约 {d.estMin} 分钟</Text>
              </View>
              <Text className="pv-pick-plus">＋</Text>
            </View>
          )) : (
            <Text className="fs-mini text-secondary">所有训练日都已在轮转里了。</Text>
          )}
        </View>
      </>}
    </Screen>
  );
}
