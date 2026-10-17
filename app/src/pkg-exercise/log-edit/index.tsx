import { useEffect, useRef, useState } from 'react';
import { View, Text, Input, Button, Picker } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { appendLog, loadLogs, loadPlan, updateLog } from '../engine/store';
import { loadPrefix } from '../engine/load';
import { round2 } from '../engine/onerm';
import { repStepOf, sidedInPlan } from '../engine/sided';
import { HOLD_STEP_SEC, clampHoldSec, holdRangeText, holdSecOfSets, holdText, timedInPlan } from '../engine/timed';
import { syncWorkoutActivity } from '../engine/workout-energy';
import type { PlanDay, PlannedExercise, TrainingPlan, WorkoutLog } from '../engine/types';
import { SPAN_STEP_MIN, fmtSpan, spanMinutes, spanSeconds } from '@/utils/duration';
import { setLeaveGuard } from '@/utils/leave-guard';
import { saveTrainingDigest } from '@/utils/training-digest';
import { todayDigest } from '../engine/digest';
import { loadDayAssigns } from '../engine/dayassign';
import { loadDayNotes } from '../engine/daynote';
import { progressOf } from '../engine/progress';
import { saveTrainingProgress } from '@/utils/training-progress';
import { autoSync } from '../engine/sync';
import { todayStr } from '@/utils/date';
import './index.scss';
import { navigate } from '@/utils/nav';

interface EditSet {
  reps: number;
  weightKg: number | null;
  /**
   * 计时组的实际时长(秒)。**这一格必须原样带进带出** —— 补录/改一次日志时
   * 把 `sec` 丢掉,用户改完一个错别字,那天的平板支撑就从「撑了 90 秒」变成「0 次」。
   * 计时型的动作 `reps` 恒为 0(见 engine/timed.ts)。
   */
  sec?: number;
}
interface EditRow { exerciseId: string; nameZh: string; sets: EditSet[]; sided: boolean; timed: boolean }

/* 本地日期,不是 UTC 那天 —— 原来那句 toISOString().slice(0,10) 在东八区凌晨
   0–8 点会让补录页默认成**昨天**(见 utils/date.ts 开头那段) */
const today = todayStr;

/**
 * 计划里的一项 → 一行可编辑的组。
 * **补录、换训练日、从列表里加动作**三处都走它 —— 以前是各写一遍 `Array.from(...)`,
 * 三份里只要有一份忘了带计时组的 `sec`,那条路补出来的平板支撑就变成「0 次」,
 * 而且不会报错(和 engine/timed.ts 头注释里那条是同一个坑)。
 */
function rowOfItem(it: PlannedExercise): EditRow {
  return {
    exerciseId: it.exerciseId,
    nameZh: it.nameZh,
    // 计时项铺的是**秒数**(reps 归 0),次数型铺区间下限
    sets: Array.from({ length: it.sets }, () => (it.holdSec
      ? { reps: 0, weightKg: it.weightKg, sec: it.holdSec.max }
      : { reps: it.repsMin, weightKg: it.weightKg })),
    sided: Boolean(it.sided),
    timed: Boolean(it.holdSec)
  };
}

/**
 * 估算时长:每组 35s 动作 + 组间休息。
 * **只用来给个起点**(补录那次没有墙钟,总得先填个数),不覆盖已经记着的时长 ——
 * 见下面 `durMin` 与 save() 里的用法。
 */
function estSec(rows: EditRow[], day: PlanDay | null): number {
  const rests = new Map((day?.items ?? []).map((it) => [it.exerciseId, it.restSec]));
  const sec = rows.reduce((a, r) => a + r.sets.length * (35 + (rests.get(r.exerciseId) ?? 90)), 0);
  return Math.max(60, Math.round(5 * 60 + sec));
}

/**
 * 补录 / 修改一次训练。
 *
 * `manual` 这一档是「这份数据记不准,别拿它调下次重量」(见 types.ts 的 countsForProgress):
 * 新补录的一律打上;但**改一条已经在的记录时沿用原来那一档** —— 练完当场记的那次是真的,
 * 进来修个错别字(或改时长)不该把它降级成补录,那会让它从纪录榜和力量基准里悄悄消失。
 */
export default function LogEdit() {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [date, setDate] = useState(today());
  const [dayKey, setDayKey] = useState('');
  const [rows, setRows] = useState<EditRow[]>([]);
  /**
   * 这一页有没有**用户改过的东西**没落盘。
   *
   * 为什么不能拿「有没有填」来判断:补录页一打开就按计划铺满 3 组,空不空看不出
   * 用户做没做过事 —— 得等他自己动过才算数,所以是**动一下记一下**。
   *
   * 为什么非要记:底部那条浮动导航走的是 switchTab,微信的语义是关掉所有非 tab 页。
   * 补录一整天的训练本来就慢一步(数着组数填),填到一半误点一下底栏就全没了、一声不吭。
   */
  const dirtyRef = useRef(false);
  const touch = () => { dirtyRef.current = true; };
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * 正在改的这条日志**原本是哪天**。补录页允许改训练日期,而跟着这条日志走的那条
   * 消耗记录(见 engine/workout-energy)还挂在旧日期上 —— 保存时要拿这个去把它挪过来,
   * 不然会变成「新日期多一笔、旧日期留一笔」。
   */
  const originalDate = useRef<string | null>(null);
  /**
   * 时长(分钟)。改一条已有的记录时是**它记着的那一个**(原样带进带出);
   * 补录(以及老日志里没记过时长的)是 `null` —— 那个位置显示按计划估的数,可以照实改。
   * 手改的收口在 utils/duration.ts。
   */
  const [durMin, setDurMin] = useState<number | null>(null);
  /** 这一条算不算补录 —— 新补录 true,改已有的沿用原值(见头上那段注释) */
  const [manual, setManual] = useState(true);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  useDidShow(() => {
    // 刚进来还没动过;底部导航的守卫问的是「现在有没有没落盘的」
    dirtyRef.current = false;
    const p = loadPlan();
    setPlan(p);
    const existing = params.id ? loadLogs().find((l) => l.id === params.id) : null;
    if (existing) {
      setEditingId(existing.id);
      originalDate.current = existing.date;
      setDate(existing.date);
      setDayKey(existing.dayKey);
      setNote(existing.note ?? '');
      setManual(Boolean(existing.manual));
      /* 时长也照原样带过来 —— 以前这里只读日期/训练日/备注/组数,**时长整格不读**,
         保存时现算一个 `estSec`。后果是:进来改个错别字,那次课的 52 分钟
         (墙钟实打实记的)就被换成一个按组数估出来的数,而且一个字都不提示。
         老日志(没有时长,`0`)才退回估算 —— 那种确实没东西可带。 */
      setDurMin(existing.durationSec > 0 ? spanMinutes(existing.durationSec) : null);
      setRows(existing.entries.map((e) => ({
        exerciseId: e.exerciseId,
        nameZh: e.nameZh,
        // 老日志(没有 sec)原样带过:那些组本来就是次数型,不会凭空多出个 0 秒
        sets: e.sets.map((s) => ({
          reps: s.reps, weightKg: s.weightKg,
          ...(s.sec != null ? { sec: s.sec } : {})
        })),
        sided: sidedInPlan(p, e.exerciseId),
        // 以**这条日志里有没有 sec**为准:用户当初怎么记的,事后编辑就怎么显示。
        // 拿动作库的分类去猜,会把一条手填的 12 次平板支撑改写成「12 秒」。
        timed: e.sets.some((s) => s.sec != null) || timedInPlan(p, e.exerciseId)
      })));
      track('training_log_edit', 'other');
      return;
    }
    // 补录:默认挑计划里第一个训练日,动作按计划铺 3 组,次数取区间下限
    const d = p?.days[0] ?? null;
    setDayKey(d?.key ?? '');
    setRows((d?.items ?? []).map(rowOfItem));
    // 没有墙钟可带,时长那一格留给「按计划估的数」,用户照实改
    setDurMin(null);
    setManual(true);
    track('training_log_backfill', 'other');
  });

  if (!plan) {
    return (
      <Screen className="le-page">
        <View className="card le-empty">
          <Text className="fs-h1">先有一个训练计划</Text>
          <Text className="fs-mini text-secondary">补录要按计划里的动作来记,先去生成一份计划</Text>
          <Button className="btn btn--primary le-empty-cta" onClick={() => navigate('/pkg-exercise/plan-create/index')}>
            去生成计划
          </Button>
        </View>
      </Screen>
    );
  }

  const day = plan.days.find((d) => d.key === dayKey) ?? null;
  /** 可添加的动作:计划里出现过的全部动作(按 id 去重) */
  const pool = (() => {
    const seen = new Set<string>();
    const out: { id: string; nameZh: string }[] = [];
    for (const d of plan.days) {
      for (const it of d.items) {
        if (seen.has(it.exerciseId)) continue;
        seen.add(it.exerciseId);
        out.push({ id: it.exerciseId, nameZh: it.nameZh });
      }
    }
    return out;
  })();

  const patchSet = (ri: number, si: number, patch: Partial<EditSet>) => {
    touch();
    setRows((rs) => rs.map((r, i) => (i !== ri ? r : {
      ...r, sets: r.sets.map((s, j) => (j !== si ? s : { ...s, ...patch }))
    })));
  };
  const addSet = (ri: number) => { touch(); setRows((rs) => rs.map((r, i) => (i !== ri ? r : {
    ...r, sets: [...r.sets, { ...(r.sets[r.sets.length - 1] ?? { reps: 10, weightKg: null }) }]
  }))); };
  const delSet = (ri: number, si: number) => { touch(); setRows((rs) => rs.map((r, i) => (i !== ri ? r : {
    ...r, sets: r.sets.length <= 1 ? r.sets : r.sets.filter((_, j) => j !== si)
  }))); };
  /**
   * 移掉一行。以前是一按就没 —— 连同这一行已经填好的组数、次数、重量。
   * 整行没了没法后悔,所以问一句;同页「切换训练日」也是这么办的。
   */
  const delRow = async (ri: number) => {
    const r = rows[ri];
    const filled = r && r.sets.some((s) => s.weightKg != null || (s.sec ?? 0) > 0);
    if (filled) {
      const { confirm } = await Taro.showModal({
        title: `移除${r.nameZh}?`,
        content: '这一行记着的组数、次数、重量会一起没了。',
        confirmText: '移除',
        cancelText: '留着'
      });
      if (!confirm) return;
    }
    touch();
    setRows((rs) => rs.filter((_, i) => i !== ri));
  };

  /** 切换训练日:用该日的动作重建(已填数据不保留,避免动作对不上) */
  const switchDay = async (key: string) => {
    if (key === dayKey) return;
    if (rows.length) {
      const { confirm } = await Taro.showModal({ title: '换成这一天?', content: '当前录入的动作会被这一天的动作覆盖。', confirmText: '换', cancelText: '保持' });
      if (!confirm) return;
    }
    const d = plan.days.find((x) => x.key === key);
    if (!d) return;
    touch();
    setDayKey(key);
    setRows(d.items.map(rowOfItem));
  };

  useEffect(() => {
    setLeaveGuard({
      dirty: () => dirtyRef.current,
      title: '还没保存',
      content: manual
        ? '这条补录还没保存,离开的话刚填的组数、次数、重量就没了。'
        : '这条改动还没保存,离开的话就白改了。',
      confirmText: '放弃'
    });
    return () => setLeaveGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = (() => {
    const sets = rows.reduce((a, r) => a + r.sets.length, 0);
    const reps = rows.reduce((a, r) => a + r.sets.reduce((x, s) => x + s.reps, 0), 0);
    const volume = round2(rows.reduce((a, r) => a + r.sets.reduce((x, s) => x + s.reps * (s.weightKg ?? 0), 0), 0));
    // 计时组的秒数不进「次」也不进「容量」,单列一个 —— 不列的话补一节核心课看起来像啥都没练
    const hold = holdSecOfSets(rows.flatMap((r) => r.sets));
    return { sets, reps, volume, hold };
  })();

  /**
   * 时长那一格:手填过就用他填的,否则是**按计划估**的那个(补录没有墙钟,总得先有个数)。
   * 补录的那次是估的,改一条已有的记录则是这条日志里记着的真实时长 —— 见 `durMin`。
   */
  const estSecNow = estSec(rows, day);
  const durShown = durMin ?? spanMinutes(estSecNow);

  const save = () => {
    if (saving) return;
    if (!rows.length) { Taro.showToast({ title: '至少记一个动作', icon: 'none' }); return; }
    setSaving(true);
    try {
      // 用户填过就用他填的;没填过(新补录)才拿计划估的那个当数
      const durationSec = spanSeconds(durMin ?? spanMinutes(estSec(rows, day)));
      // 编辑已有日志时拿原条目:有些字段编辑页不展示(比如「这个动作这次不算进步」),
      // 重建 entries 时得把它们带过去,否则改个错别字就把那个标记洗掉了
      const original = editingId ? loadLogs().find((l) => l.id === editingId) : null;
      const payload = {
        planId: plan.id,
        dayKey: day?.key ?? dayKey,
        dayTitle: day?.title ?? '自由训练',
        date,
        durationSec,
        totalSets: total.sets,
        totalReps: total.reps,
        totalVolumeKg: total.volume,
        note: note.trim() ? note.trim().slice(0, 100) : null,
        manual,
        entries: rows.map((r) => {
          // 超级组照计划那天的结构带过来:那次确实是按超级组练的,
          // 复制出来的文字不该因为是补录就少一行「超级组」
          const sg = (day?.items ?? []).find((it) => it.exerciseId === r.exerciseId)?.superset;
          const kept = original?.entries.find((e) => e.exerciseId === r.exerciseId);
          return {
            exerciseId: r.exerciseId,
            nameZh: r.nameZh,
            ...(sg ? { superset: sg } : {}),
            // 「这次不算进步」是用户对**那个动作**做过的判断,编辑页没有这一格;
            // 不带着走的话,保存一次就等于偷偷撤销了它,那条重量会被当成新纪录。
            ...(kept?.noProg ? { noProg: true as const } : {}),
            sets: r.sets.map((s) => ({
              reps: r.timed ? 0 : s.reps,
              weightKg: s.weightKg,
              rir: null,
              // 计时组把秒数原样带走 —— 这一格丢了,改个错别字就把那天练的抹平了
              ...(s.sec != null && s.sec > 0 ? { sec: clampHoldSec(s.sec) } : {})
            }))
          };
        })
      };
      // 存下来的那条(新建或改过之后的)要拿去回写消耗 —— 补录的那次也该计入
      // 当天的消耗,否则「上周四补记的腿课」永远不出现在热量账上
      const saved: WorkoutLog = { id: `wo-${Date.now()}`, avgRir: null, ...payload };
      let latestLogs: WorkoutLog[] = [];
      if (editingId) {
        const after = updateLog(editingId, payload);
        latestLogs = after;
        const hit = after.find((l) => l.id === editingId);
        // movedFrom:日期被改过时才带上(见 originalDate)
        const from = originalDate.current && originalDate.current !== payload.date ? originalDate.current : undefined;
        if (hit) void syncWorkoutActivity(hit, { movedFrom: from });
        track('training_log_edit_save', 'other');
      } else {
        latestLogs = appendLog(saved);
        void syncWorkoutActivity(saved);
        track('training_log_backfill_save', 'other');
      }
      // 补录/编辑会改变「攒下来的」那些数(累计、周条、纪录),重算一次快照。
      // 以前只有训练完成/计划页/统计页会刷新,补录一条往日训练后训练 tab 一直少算。
      saveTrainingProgress(progressOf(latestLogs));
      // 首页那张小抄按**日志重算**,不是只在「改的是今天」时写一句 done:
      // 把今天这条改到昨天,原来那句「今天练完了」必须撤销;
      // 补录往日训练则不该动今天的说法。判断交给 todayDigest(和计划页同一套)。
      if (date === today() || originalDate.current === today()) {
        saveTrainingDigest(todayDigest(plan, latestLogs, loadDayNotes(), loadDayAssigns(), today()));
      }
      // 日志/进度变了就顺手推一次云端:服务端的训练提醒靠它判断「今天已经练过」,
      // 不推的话晚上可能照样推一条「今天该练了」。失败静默,不挡保存。
      void autoSync().catch(() => undefined);
      dirtyRef.current = false;
      Taro.showToast({ title: editingId ? '已更新' : '已补录', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen className="le-page">
      <View className="card le-head">
        <View className="le-field">
          <Text className="le-field-k">训练日期</Text>
          <Picker mode="date" value={date} end={today()} onChange={(e) => { touch(); setDate(e.detail.value); }}>
            <Text className="le-pick">{date} ▾</Text>
          </Picker>
        </View>
        <View className="le-field">
          <Text className="le-field-k">训练日</Text>
          <Text className="le-pick le-total-muted">{day?.title ?? '自由训练'}</Text>
        </View>
        <View className="le-days">
          {plan.days.map((d) => (
            <Text
              key={d.key}
              className={`le-chip${d.key === dayKey ? ' on' : ''}`}
              onClick={() => switchDay(d.key)}
            >
              {d.title}
            </Text>
          ))}
        </View>
      </View>

      <View className="card le-total">
        <Text className="le-total-v">{total.sets}</Text>
        <Text className="fs-mini text-secondary">组</Text>
        <Text className="le-total-v">{total.reps}</Text>
        <Text className="fs-mini text-secondary">次</Text>
        <Text className="le-total-v">{total.volume >= 1000 ? `${(total.volume / 1000).toFixed(1)}t` : total.volume}</Text>
        <Text className="fs-mini text-secondary">容量kg</Text>
        {total.hold > 0 && <>
          <Text className="le-total-v">{holdText(total.hold)}</Text>
          <Text className="fs-mini text-secondary">保持</Text>
        </>}
        {/* 时长单独占一行:它能改,和上面几个只读的数字长在一起会让人以为它也是算出来的 */}
        <View className="le-dur">
          <Text className="le-dur-k">本次时长</Text>
          <View className="le-dur-step">
            <Text className="le-step-btn" onClick={() => { touch(); setDurMin(spanMinutes((durShown - SPAN_STEP_MIN) * 60)); }}>−</Text>
            {/* 键盘直接填 —— 从 65 分钟改到 45 分钟,连点四下不如输两个数字 */}
            <Input
              className="le-step-val le-step-val-in"
              type="number"
              value={String(durShown)}
              onBlur={(e) => {
                const v = parseInt(e.detail.value, 10);
                if (v > 0) { touch(); setDurMin(spanMinutes(v * 60)); }
              }}
            />
            <Text className="le-step-unit">分钟</Text>
            <Text className="le-step-btn" onClick={() => { touch(); setDurMin(spanMinutes((durShown + SPAN_STEP_MIN) * 60)); }}>＋</Text>
          </View>
        </View>
        {durMin == null && (
          <Text className="fs-mini text-secondary le-dur-hint">
            {fmtSpan(estSecNow)}是按计划估的,不是实际用时 —— 照实改
          </Text>
        )}
      </View>

      {rows.map((r, ri) => {
        // 单侧动作的次数按 2 走(±1 会分不匀);键盘直接输入的不拦 ——
        // 真做了 15 次(左 8 右 7)也是事实,照记
        const rep = repStepOf(r.sided);
        return (
        <View className="card le-row" key={`${r.exerciseId}-${ri}`}>
          <View className="le-row-head">
            <View className="le-row-title">
              <Text className="le-row-name">{r.nameZh}</Text>
              {/* 单侧动作的次数是两侧合计 —— 在行头说一次,底下每格都按这个读 */}
              {r.sided && !r.timed && <Text className="le-sided">左右交替 · 每侧算</Text>}
              {r.timed && <Text className="le-sided">按时长记(秒)</Text>}
            </View>
            <Text className="le-row-del" onClick={() => delRow(ri)}>移除</Text>
          </View>
          {r.sets.map((s, si) => (
            <View className="le-set" key={si}>
              <Text className="le-set-no">{si + 1}</Text>
              {r.timed ? (
                /* 计时行:这一格填的是**秒数**,不是次数 —— 别让用户对着平板支撑数次数 */
                <View className="le-step">
                  <Text className="le-step-btn" onClick={() => patchSet(ri, si, { sec: clampHoldSec((s.sec ?? 0) - HOLD_STEP_SEC), reps: 0 })}>−</Text>
                  <Input
                    className="le-step-val le-step-val-in"
                    type="number"
                    value={String(s.sec ?? 0)}
                    onBlur={(e) => {
                      const v = parseInt(e.detail.value, 10);
                      patchSet(ri, si, { sec: v > 0 ? clampHoldSec(v) : (s.sec ?? 0), reps: 0 });
                    }}
                  />
                  <Text className="le-step-btn" onClick={() => patchSet(ri, si, { sec: clampHoldSec((s.sec ?? 0) + HOLD_STEP_SEC), reps: 0 })}>＋</Text>
                  <Text className="le-step-unit">秒</Text>
                </View>
              ) : (
              <View className="le-step">
                <Text className="le-step-btn" onClick={() => patchSet(ri, si, { reps: Math.max(rep, s.reps - rep) })}>−</Text>
                {/* 次数可直接键盘输入 — 补录时比连点快 */}
                <Input
                  className="le-step-val le-step-val-in"
                  type="number"
                  value={String(s.reps)}
                  onBlur={(e) => {
                    const v = parseInt(e.detail.value, 10);
                    patchSet(ri, si, { reps: v > 0 ? Math.min(99, v) : s.reps });
                  }}
                />
                <Text className="le-step-btn" onClick={() => patchSet(ri, si, { reps: Math.min(99, s.reps + rep) })}>＋</Text>
              </View>
              )}
              <View className="le-step">
                {s.weightKg != null ? <>
                  <Text className="le-step-btn" onClick={() => patchSet(ri, si, { weightKg: round2(Math.max(0.5, s.weightKg! - 2.5)) })}>−</Text>
                  <Text className="le-step-val">
                    {loadPrefix(r.exerciseId)}{s.weightKg}<Text className="le-step-unit">kg</Text>
                  </Text>
                  <Text className="le-step-btn" onClick={() => patchSet(ri, si, { weightKg: round2(Math.min(500, s.weightKg! + 2.5)) })}>＋</Text>
                </> : <Text className="le-step-val le-step-bw">自重</Text>}
              </View>
              <Text className="le-set-del" onClick={() => delSet(ri, si)}>✕</Text>
            </View>
          ))}
          <Text className="le-addset" onClick={() => addSet(ri)}>＋ 加一组</Text>
        </View>
        );
      })}

      <Text className="le-addrow" onClick={() => setPicking(true)}>＋ 添加计划里的动作</Text>

      <View className="card le-note">
        <Text className="le-field-k">本次感受(可选)</Text>
        <Input
          className="le-note-input"
          value={note}
          maxlength={100}
          placeholder="例:状态一般,卧推降了 2.5kg"
          placeholderClass="le-ph"
          onInput={(e) => { touch(); setNote(e.detail.value); }}
        />
      </View>

      <Button className="btn btn--primary btn--block" loading={saving} onClick={save}>
        {editingId ? '保存修改' : '保存这次训练'}
      </Button>
      {/* 这一句两种情形说的不是一回事:补录只进历史,改一条练完当场记的则照常算成绩 */}
      <Text className="fs-mini text-secondary le-foot">
        {manual
          ? '补录只进历史与统计,不会改动下次的训练目标(凭着记忆填的重量拿来调重量反而添乱)。'
          : '改的是这一次的记录本身:这条是练完当场记的,改动照常参与纪录与力量基准。'}
      </Text>

      {/* 添加动作 */}
      {picking && (
        <>
          <View className="le-mask" onClick={() => setPicking(false)} catchMove />
          <View className="le-sheet" catchMove>
            <View className="le-sheet-head">
              <View className="le-sheet-title">
                <Text className="fs-h1">添加动作</Text>
                <Text className="fs-mini text-secondary">来自你计划里的动作</Text>
              </View>
              <Text className="le-sheet-close" onClick={() => setPicking(false)}>✕</Text>
            </View>
            <View className="le-pool">
              {pool.map((p) => {
                const on = rows.some((r) => r.exerciseId === p.id);
                const planItem = plan.days.flatMap((d) => d.items).find((it) => it.exerciseId === p.id);
                return (
                  <View
                    className={`le-pool-row${on ? ' on' : ''}`}
                    key={p.id}
                    onClick={() => {
                      if (on) { Taro.showToast({ title: '已经在列表里了', icon: 'none' }); return; }
                      touch();
                      setRows((rs) => [...rs, planItem
                        ? rowOfItem(planItem)
                        : {
                          exerciseId: p.id,
                          nameZh: p.nameZh,
                          sets: Array.from({ length: 3 }, () => ({ reps: 10, weightKg: null })),
                          sided: sidedInPlan(plan, p.id),
                          timed: false
                        }]);
                      setPicking(false);
                    }}
                  >
                    <Text className="le-pool-name">{p.nameZh}</Text>
                    {on && <Text className="le-pool-tick">已添加</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}
