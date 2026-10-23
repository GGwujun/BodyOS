import { useMemo, useState } from 'react';
import { Button, Image, Picker, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import statsIcon from '@/assets/icons/stats.png';
import LineChart from '@/components/LineChart';
import { track } from '@/services/analytics';
import { loadLogs } from '../engine/store';
import {
  dropHint, dropOff, dropSamples, dropTrend, exerciseHistory, hasTrend, holdDrop, nameOf,
  type ExercisePoint
} from '../engine/history';
import { findExercise } from '../engine/generator';
import { isAssisted, loadText, weightNoun } from '../engine/load';
import { isFaded, retainedText, strengthOf } from '../engine/strength';
import { isSided, sideRepsText } from '../engine/sided';
import { holdText, isTimed } from '../engine/timed';
import { EQUIPMENT_ZH, MUSCLE_ZH, BODYPART_ZH } from '../data/exercises';
import { dayDiff, todayStr } from '@/utils/date';
import type { WorkoutLog } from '../engine/types';
import './index.scss';
import { THEME } from '@/constants/theme';
import { navigate } from '@/utils/nav';

type Metric = 'topKg' | 'bestE1rm' | 'volumeKg' | 'reps' | 'holdSec' | 'avgRir';

const METRICS: { k: Metric; label: string; unit: string }[] = [
  { k: 'topKg', label: '最大重量', unit: 'kg' },
  { k: 'bestE1rm', label: '估 1RM', unit: 'kg' },
  { k: 'volumeKg', label: '容量', unit: 'kg' },
  { k: 'reps', label: '最重一组次数', unit: '次' },
  // 计时型动作的唯一条曲线(见 engine/timed.ts)。别的动作这一列恒为 0,
  // 会被下面的 usable 筛掉,不会多出一个点了没反应的选项。
  { k: 'holdSec', label: '最长保持', unit: '秒' },
  // 强度走 RIR:重量曲线答「举了多少」,这条答「离极限多近」——
  // 同一个重量 RIR 从 2 爬到 5,也是进步,而重量那条线是平的。
  { k: 'avgRir', label: '强度 RIR', unit: ' 次' }
];

type Span = '90' | '180' | '365' | 'all';

/**
 * 曲线看多远。**只作用于那张曲线图** —— 这一页的成绩格说的是「历史最好」、
 * 记录列表说的是「每一次」,它们本来就该看全程,跟着窗口缩就答错了问题。
 * 默认「全部」= 和以前一模一样(不偷偷把用户的数据藏起来),想细看的人自己往里缩。
 */
const SPANS: { k: Span; label: string }[] = [
  { k: '90', label: '近 3 个月' },
  { k: '180', label: '近 6 个月' },
  { k: '365', label: '近 1 年' },
  { k: 'all', label: '全部' }
];

/** 动作记录 — 这个动作每一次练成什么样,以及为什么最近上不去了 */
export default function ExerciseHistory() {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const exerciseId = params.exerciseId ?? '';
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [metric, setMetric] = useState<Metric>('topKg');
  /** 曲线的区间(只作用于曲线那张卡,见 SPANS)。默认「全部」= 和以前一样 */
  const [span, setSpan] = useState<Span>('all');
  const today = todayStr();

  useDidShow(() => {
    setLogs(loadLogs());
    track('training_exercise_history', 'other');
  });

  const points = useMemo(() => exerciseHistory(logs, exerciseId), [logs, exerciseId]);
  const ex = findExercise(exerciseId);
  /** 单侧动作(单臂划船、弓步…):库里的次数是两侧合计,给用户看要说「每侧几次」 */
  const sided = isSided(exerciseId);
  /** 整页只有这一个动作,口径就在这两句里翻,别到处写条件 */
  const per = (n: number) => (sided ? `每侧 ${sideRepsText(n)}` : String(n));
  const repsVal = (n: number) => (sided ? n / 2 : n);
  const name = nameOf(logs, exerciseId);
  /**
   * 重量口径(见 engine/load.ts)—— 整页只有这两句在翻,别到处写条件:
   *   · 助力器械的「最重」其实是助力最大,越小反而越强,名词要换成「助力」;
   *   · 附加重量(负重引体)的数字是加在自重之上的,显示要带 +。
   */
  const assisted = isAssisted(exerciseId);
  const noun = weightNoun(exerciseId);
  const wt = (kg: number) => loadText(exerciseId, kg);
  /** 这个动作自己的力量保持情况 —— 「多久没练」和曲线上的成绩是两回事 */
  const st = useMemo(() => strengthOf(logs, exerciseId), [logs, exerciseId]);

  /** 曲线画的是这一段时间里的记录(见 SPANS)—— 别的地方仍然按全部记录算 */
  const winPoints = useMemo(
    () => (span === 'all' ? points : points.filter((p) => dayDiff(p.date, today) <= Number(span))),
    [points, span, today]
  );

  /** 只留真有数据的指标 —— 自重动作没有重量、助力动作没有 1RM,画一条 0 的线没意义。
      看的是**窗口里**有没有数:缩到 3 个月之后,那个区间没练过的指标就不该再摆出来。
      RIR 是唯一例外:0 不是「没数」(0 = 刚好做到力竭),判据得用「评没评」而不是「大于 0」 */
  const metrics = METRICS.map((m) => (m.k === 'topKg' ? { ...m, label: `最大${noun}` } : m));
  const usable = metrics.filter((m) => (m.k === 'avgRir'
    ? winPoints.some((p) => p.avgRir != null)
    : winPoints.some((p) => (p[m.k] as number) > 0)));
  const active = usable.some((m) => m.k === metric) ? metric : (usable[0]?.k ?? 'volumeKg');
  const cfg = metrics.find((m) => m.k === active) as typeof METRICS[number];
  /** RIR 只画评过强度的那几次;别的口径每次训练都是一个点 */
  const srcPoints = active === 'avgRir' ? winPoints.filter((p) => p.avgRir != null) : winPoints;
  // 次数这条曲线也跟着折成每侧 —— 否则曲线上的点是下面列表里的两倍,同一个数看着像对不上
  const series = srcPoints.map((p) => ({
    label: p.date.slice(5),
    value: active === 'reps' ? repsVal(p.reps) : (p[active] as number)
  }));
  const spanLabel = SPANS.find((s) => s.k === span)?.label ?? '全部';
  /**
   * 曲线画不出来时那句话。空窗口和「只有一次」是两种不同的处境,该说的话不一样:
   * 空窗口要指出去哪儿找(用户缩得太狠了),而不是让他以为记录没了 —— 所以只在**还能往外缩**时提这句。
   * RIR 的空又是另一种:练了但没评过 —— 那句「没有练过这个动作」会把人指去翻训练记录,
   * 可他的记录就在下面,缺的是每组结束后的那一下评分。
   */
  const canZoom = span === 'all' ? '' : '换个更长的区间能看到之前练的。';
  const onRir = active === 'avgRir';
  const curveEmpty = hasTrend(srcPoints)
    ? ''
    : srcPoints.length === 0
      ? onRir
        ? `${spanLabel}没有评过强度的组 —— 每组做完在「还能再做几次」里选一下,评过的次数才画得上这条线。${canZoom}`
        : `${spanLabel}没有练过这个动作。${canZoom}`
      : span === 'all'
        ? onRir
          ? '只有一次评过强度,再多评几次就能看到走势。'
          : '只有一次记录,再练一次就能看到走势。同一动作连着练,曲线才有参考价值。'
        /* 窗口里只有一次、但更早还练过 —— 这话不能说成「再练一次就有了」,他有的是记录,只是不在这个窗口里 */
        : onRir
          ? `${spanLabel}只有这一次评过强度。${canZoom}`
          : `${spanLabel}只练过这一次。${canZoom}`;

  const last = points.length ? points[points.length - 1] : null;
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const best = points.reduce<ExercisePoint | null>((a, b) => (!a || b.bestE1rm > a.bestE1rm ? b : a), null);
  const bestTop = points.reduce<ExercisePoint | null>((a, b) => (!a || b.topKg > a.topKg ? b : a), null);
  const bestVol = points.reduce<ExercisePoint | null>((a, b) => (!a || b.volumeKg > a.volumeKg ? b : a), null);
  const bestHold = points.reduce<ExercisePoint | null>((a, b) => (!a || b.holdSec > a.holdSec ? b : a), null);
  const bestHoldTotal = points.reduce<ExercisePoint | null>((a, b) => (!a || b.holdTotalSec > a.holdTotalSec ? b : a), null);
  /**
   * 这个动作是不是**计时型** —— 以**日志里有没有秒数**为准,不去问动作库。
   * 一个动作可能两个用户记法不同(有人把平板支撑记成次数),而这里画的是**这个人练的记录**:
   * 库里的分类是别人定的,日志里的事实是自己的。和 log-edit 的判断同一条口径。
   */
  const timed = points.some((p) => p.holdSec > 0);

  /** 掉力分析用最近一次「有重量且不只一组」的记录 */
  const lastSets = useMemo(() => {
    const ord = [...logs].sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const l of ord) {
      const e = l.entries.find((x) => x.exerciseId === exerciseId);
      if (e && e.sets.length >= 2) return { date: l.date, sets: e.sets };
    }
    return null;
  }, [logs, exerciseId]);
  // 掉力分析分两条路:计时型看**秒数**在不在掉,次数型看次数 —— 两者量纲不同,
  // 交给 dropOff 去算的话,一个撑得越来越短的平板支撑会得到「末组比首组做得还多」。
  const drop = !timed && lastSets ? dropOff(lastSets.sets) : null;
  const hdrop = timed && lastSets ? holdDrop(lastSets.sets) : null;
  const bodyOnly = !timed && lastSets ? dropHint(lastSets.sets) : null;
  /**
   * 跨次趋势 —— 上面那句只看得见一次,所以它只会说「这重量偏重」;
   * 而「偶尔一次掉得多」的处置恰恰是**别动重量**(动了就是把一个状态差的日子当成长期结论)。
   * 这句补的就是这个分别。采样和单次分析同一套口径(计时看秒数,次数看同重量组)。
   */
  const trend = useMemo(
    () => dropTrend(dropSamples(logs, exerciseId, timed ? 'sec' : 'reps')),
    [logs, exerciseId, timed]
  );

  // 「多少天前」按本地日历天算 —— 用 UTC 的今天去减,UTC+8 的早上会整体多算一天
  // (「上次练是 3 天前」其实是 2 天前)。utils/date.dayDiff 就是干这个的。
  const daysAgo = (date: string): number => dayDiff(date, todayStr());

  const delta = (a: number, b: number, unit: string): string => {
    const d = Math.round((a - b) * 10) / 10;
    if (d === 0) return '和上次一样';
    return `比上次 ${d > 0 ? '+' : ''}${d}${unit}`;
  };

  return (
    <Screen className="eh-page">
      <View className="card eh-intro">
        <Text className="fs-h1">{name}</Text>
        <Text className="fs-mini text-secondary">
          {[
            ex ? BODYPART_ZH[ex.bodyPart as keyof typeof BODYPART_ZH] ?? ex.bodyPart : '',
            ex ? EQUIPMENT_ZH[ex.equipment as keyof typeof EQUIPMENT_ZH] ?? ex.equipment : '',
            ex ? MUSCLE_ZH[ex.target as keyof typeof MUSCLE_ZH] ?? ex.target : ''
          ].filter(Boolean).join(' · ') || '动作库外添加的动作'}
        </Text>
        {points.length > 0 && (
          <Text className="fs-mini text-secondary">
            练过 {points.length} 次{last ? ` · 最近一次 ${last.date.slice(5)}${daysAgo(last.date) === 0 ? '(今天)' : `(${daysAgo(last.date)} 天前)`}` : ''}
          </Text>
        )}
      </View>

      {points.length === 0 && (
        <View className="card eh-empty">
          <Image className="eh-empty-icon" src={statsIcon} mode="aspectFit" />
          <Text className="fs-h1">还没练过这个动作</Text>
          {/* 还没有日志可看,就只能问动作库它是不是按秒记的 —— 上面那张图和掉力是按**日志**里的
              秒数判断的(见 timed),这里没有日志,库是唯一的依据 */}
          <Text className="fs-mini text-secondary">
            {isTimed(exerciseId)
              ? '练过之后,这里会显示保持时长与组数的变化'
              : '练过之后,这里会显示重量、容量与估算 1RM 的变化'}
          </Text>
          <Button
            className="btn btn--primary eh-empty-cta"
            onClick={() => navigate('/pkg-exercise/plan-view/index')}
          >
            去我的训练计划
          </Button>
        </View>
      )}

      {points.length > 0 && (
        <>
          {/* ===== 曲线 ===== */}
          <View className="card eh-block">
            {/* 区间选择在卡片头上(它只管这张图),不用再摆一排和指标 chip 长一样的开关 ——
                两种开关长得像就会互相混淆,而它们管的是两件事(看什么 / 看多远) */}
            <View className="eh-head">
              <Text className="fs-h1">变化曲线</Text>
              <Picker
                mode="selector"
                range={SPANS.map((s) => s.label)}
                value={SPANS.findIndex((s) => s.k === span)}
                onChange={(e) => setSpan(SPANS[Number(e.detail.value)]?.k ?? 'all')}
              >
                <Text className="eh-legend">{spanLabel} ⌄</Text>
              </Picker>
            </View>
            <View className="eh-chips">
              {usable.map((m) => (
                <Text
                  className={`eh-chip${active === m.k ? ' eh-chip--on' : ''}`}
                  key={m.k}
                  onClick={() => setMetric(m.k)}
                >
                  {m.label}{m.k === 'reps' && sided ? '(每侧)' : ''}
                </Text>
              ))}
            </View>
            {assisted && (
              <Text className="fs-mini text-secondary eh-foot">
                助力器械:{noun}是器械替你分担的力,越小越接近自己拉起来 —— 曲线往下走才是进步。
                这里不估 1RM(助力越大数字越高,拿它算会算出假的纪录),练法按次数往上推。
              </Text>
            )}
            {curveEmpty ? (
              <Text className="fs-mini text-secondary eh-foot">{curveEmpty}</Text>
            ) : (
              <>
                {/* 首末日期画在图里了(见 components/LineChart),下面只留「这是什么数、几次、最近一条」——
                    区间写在这一行而不是只写在头上的选择器里:横轴只有两个日期,用户看不出这张图是多久的。
                    RIR 用琥珀色和重量曲线区分开:同一条绿线一会儿是「举了多少」一会儿是「离极限多近」,读不动
                    (深色提亮 LineChart 内部自己会做,传浅色那套就行) */}
                <LineChart
                  canvasId="eh-chart"
                  points={series}
                  height={170}
                  color={onRir ? THEME.warning : THEME.primary}
                  unit={cfg.unit}
                />
                <Text className="fs-mini text-secondary eh-foot">
                  {cfg.label} · {spanLabel} {srcPoints.length} 次 · 最近 {series[series.length - 1].value}{cfg.unit}
                </Text>
                {onRir && (
                  <Text className="fs-mini text-secondary eh-foot">
                    RIR = 那次结束后平均还剩几次力气:0 是刚好力竭,数字越大越轻松。
                    曲线往下走是好事 —— 同样的负担越来越接近极限,或者重量加了。
                  </Text>
                )}
              </>
            )}
          </View>

          {/* ===== 最好成绩 ===== */}
          <View className="card eh-block">
            <View className="eh-head">
              <Text className="fs-h1">这个动作的成绩</Text>
            </View>
            <View className="eh-grid">
              {/* 计时型动作的成绩在秒数上,不在重量上 —— 撑了 90 秒的平板支撑,
                  「单次最大容量」写的是 0kg、「最佳 1RM 估算」是空,那不是它的成绩,
                  是它的口径(见 types.ts 的容量定义)。所以那两格对它不显示,
                  只把「最大负重」留给搬东西这类带配重的计时动作。 */}
              {timed ? (
                <>
                  <View className="eh-cell">
                    <Text className="eh-cell-k">最长保持</Text>
                    <Text className="eh-cell-v">{bestHold && bestHold.holdSec > 0 ? holdText(bestHold.holdSec) : '—'}</Text>
                    <Text className="fs-mini text-secondary">{bestHold && bestHold.holdSec > 0 ? bestHold.date.slice(5) : ''}</Text>
                  </View>
                  <View className="eh-cell">
                    <Text className="eh-cell-k">单次总保持</Text>
                    <Text className="eh-cell-v">{bestHoldTotal ? holdText(bestHoldTotal.holdTotalSec) : '—'}</Text>
                    <Text className="fs-mini text-secondary">
                      {bestHoldTotal ? `${bestHoldTotal.sets} 组 · ${bestHoldTotal.date.slice(5)}` : ''}
                    </Text>
                  </View>
                  {bestTop && bestTop.topKg > 0 && (
                    <View className="eh-cell">
                      <Text className="eh-cell-k">最大{noun}</Text>
                      <Text className="eh-cell-v">{wt(bestTop.topKg)}</Text>
                      <Text className="fs-mini text-secondary">{bestTop.date.slice(5)}</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View className="eh-cell">
                    <Text className="eh-cell-k">最大{noun}</Text>
                    <Text className="eh-cell-v">{bestTop && bestTop.topKg > 0 ? wt(bestTop.topKg) : '自重'}</Text>
                    <Text className="fs-mini text-secondary">
                      {bestTop && bestTop.topKg > 0 ? `做了 ${per(bestTop.reps)} 次 · ${bestTop.date.slice(5)}` : `没有${noun}记录`}
                    </Text>
                  </View>
                  <View className="eh-cell">
                    <Text className="eh-cell-k">最佳 1RM 估算</Text>
                    <Text className="eh-cell-v">{best && best.bestE1rm > 0 ? `${best.bestE1rm}kg` : '—'}</Text>
                    <Text className="fs-mini text-secondary">{best && best.bestE1rm > 0 ? best.date.slice(5) : ''}</Text>
                  </View>
                  <View className="eh-cell">
                    <Text className="eh-cell-k">单次最大容量</Text>
                    <Text className="eh-cell-v">{bestVol ? `${bestVol.volumeKg}kg` : '—'}</Text>
                    <Text className="fs-mini text-secondary">{bestVol ? `${bestVol.sets} 组 · ${bestVol.date.slice(5)}` : ''}</Text>
                  </View>
                </>
              )}
            </View>
            {/* 停久了才说 —— 一直在练的动作没什么好提醒的,那叫噪音 */}
            {st && isFaded(st) && (
              <View className="eh-keep">
                <View className="eh-keep-row">
                  <Text className="eh-keep-k">今天大概能做</Text>
                  <Text className="eh-keep-v">{st.currentE1rm}kg</Text>
                </View>
                <Text className="fs-mini text-secondary eh-keep-note">
                  {retainedText(st)} —— 拿你历史最好的 {st.bestE1rm}kg 折算的起步参考,不是精确值。
                  停久了先按这个重量找手感,别直接照旧目标上。
                </Text>
              </View>
            )}
            {prev && last && (
              <Text className="fs-mini text-secondary eh-foot">
                最近一次 {last.date.slice(5)}:{last.sets} 组,
                {timed
                  ? `最长保持 ${last.holdSec > 0 ? holdText(last.holdSec) : '—'}`
                  : `${noun}最大 ${last.topKg > 0 ? wt(last.topKg) : '自重'}`}
                {last.avgRir != null ? `,平均还剩 ${last.avgRir} 次力气` : ''}。
                {timed && active === 'holdSec' && last.holdSec > 0 && prev.holdSec > 0
                  ? `${delta(last.holdSec, prev.holdSec, ' 秒')}。`
                  : ''}
                {!timed && active === 'topKg' && last.topKg > 0 && prev.topKg > 0
                  ? `${delta(last.topKg, prev.topKg, 'kg')}${assisted ? '(助力变大 = 这次更轻松)' : ''}。`
                  : ''}
              </Text>
            )}
          </View>

          {/* ===== 掉力分析 =====
              计时型画的是秒数在不在掉,次数型画的是次数 —— 同一张卡,两种读数 */}
          {lastSets && (drop || hdrop) && (
            <View className="card eh-block">
              <View className="eh-head">
                <Text className="fs-h1">每组掉力</Text>
                <Text className="eh-legend">{lastSets.date.slice(5)} 那次</Text>
              </View>
              {drop && drop.sets.length > 0 && (
                <View className="eh-bars">
                  {drop.sets.map((s) => {
                    const max = Math.max(...drop.sets.map((x) => x.reps), 1);
                    return (
                      <View className="eh-bar" key={s.index}>
                        <Text className="eh-bar-k">第 {s.index} 组</Text>
                        <View className="eh-bar-track">
                          <View className="eh-bar-fill" style={{ width: `${Math.round((s.reps / max) * 100)}%` }} />
                        </View>
                        <Text className="eh-bar-v">{s.weightKg > 0 ? `${wt(s.weightKg)} × ` : ''}{per(s.reps)}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              {hdrop && hdrop.bars.length > 0 && (
                <View className="eh-bars">
                  {hdrop.bars.map((b) => {
                    const max = Math.max(...hdrop.bars.map((x) => x.sec), 1);
                    return (
                      <View className="eh-bar" key={b.index}>
                        <Text className="eh-bar-k">第 {b.index} 组</Text>
                        <View className="eh-bar-track">
                          <View className="eh-bar-fill" style={{ width: `${Math.round((b.sec / max) * 100)}%` }} />
                        </View>
                        <Text className="eh-bar-v">{holdText(b.sec)}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <Text className="fs-mini text-secondary eh-foot">{drop ? drop.verdict : hdrop?.verdict}</Text>
              {/* 同一次掉得多 ≠ 每次都掉得多 —— 上一句只看得到一次,这一句看的是这几次 */}
              {trend && <Text className="fs-mini eh-trend">{trend.verdict}</Text>}
              {bodyOnly && <Text className="fs-mini text-secondary eh-foot">{bodyOnly}</Text>}
            </View>
          )}

          {/* ===== 每次记录 ===== */}
          <View className="card eh-block">
            <View className="eh-head">
              <Text className="fs-h1">每次记录</Text>
              <Text className="eh-legend">最近的在前</Text>
            </View>
            {[...points].reverse().slice(0, 12).map((p) => (
              <View className="eh-row" key={p.date}>
                <Text className="eh-row-date">{p.date.slice(5)}</Text>
                <View className="eh-row-copy">
                  <Text className="eh-row-main">
                    {p.sets} 组
                    {p.holdSec > 0
                      ? ` · 最长 ${holdText(p.holdSec)}`
                      : p.topKg > 0 ? ` · ${noun}最大 ${wt(p.topKg)} × ${per(p.reps)}` : ' · 自重'}
                  </Text>
                  <Text className="fs-mini text-secondary">
                    {p.holdSec > 0 ? `共保持 ${holdText(p.holdTotalSec)}` : `容量 ${p.volumeKg}kg`}
                    {p.bestE1rm > 0 ? ` · 估 1RM ${p.bestE1rm}kg` : ''}
                    {p.avgRir != null ? ` · RIR ${p.avgRir}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
