import { useMemo, useState } from 'react';
import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import statsIcon from '@/assets/icons/stats.png';
import { track } from '@/services/analytics';
import { loadLogs } from '../engine/store';
import { backfillWorkoutEnergy } from '../engine/workout-energy';
import {
  HEAT_METRICS,
  dayStats,
  effortStat,
  heatmap,
  metricDef,
  personalRecords,
  summaryOf,
  type HeatCell,
  type HeatMetric
} from '../engine/history';
import { EFFORT_BANDS, HARD_RIR, MIN_RATED, avgRir, effortColor, effortVerdict } from '../engine/effort';
import { clearDayNote, isExcused, loadDayNotes, noteOf, noteText, type DayNotes } from '../engine/daynote';
import { recordDayOff } from '../engine/daynote-sheet';
import { autoSync } from '../engine/sync';
import { fadedRows, fadedVerdict, restText, strengthRows } from '../engine/strength';
import { loadText } from '../engine/load';
import { progressOf } from '../engine/progress';
import { saveTrainingProgress } from '@/utils/training-progress';
import { sideRepsLabel } from '../engine/sided';
import { holdText } from '../engine/timed';
import { localDayOf, mondayOf, todayStr } from '@/utils/date';
import { bodyApi } from '@/services';
import type { WorkoutLog } from '../engine/types';
import { fmtSpan } from '@/utils/duration';
import { GROUP_ORDER, GROUP_ZH, loadsOf, type MuscleGroup } from '../engine/muscles';
import BodyMap, { type Tone } from '../muscles/BodyMap';
import LogCard from '../log-card';
import LineChart from '@/components/LineChart';
import { THEME } from '@/constants/theme';
import './index.scss';
import { navigate } from '@/utils/nav';

/** 热力图显示多少周 —— 半年,横滑一屏能看完,再多就没人在看了 */
const WEEKS = 26;
const WEEK_ZH = ['一', '二', '三', '四', '五', '六', '日'];

const RANGES: { key: '30' | '90' | 'all'; label: string }[] = [
  { key: '30', label: '最近 30 天' },
  { key: '90', label: '最近 90 天' },
  { key: 'all', label: '全部' }
];

const isoDaysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 训练统计 — 这一年练了几天、练到了什么程度 */
export default function Stats() {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [range, setRange] = useState<'30' | '90' | 'all'>('30');
  const [picked, setPicked] = useState<HeatCell | null>(null);
  /** 热力图色阶口径 —— 换它只改颜色深浅,格子图本身(哪天练了)不动 */
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('sets');
  const [dayNotes, setDayNotes] = useState<DayNotes>({});
  /** 肌肉平衡图上点中的部位(再点一下取消)—— 它就是这张图的读数 */
  const [mgPicked, setMgPicked] = useState<MuscleGroup | null>(null);
  /** 体重曲线(升序)—— 训练统计里放它,是为了「练得怎么样」能对着体重看 */
  const [weights, setWeights] = useState<{ date: string; value: number }[]>([]);

  useDidShow(() => {
    const list = loadLogs();
    setLogs(list);
    setDayNotes(loadDayNotes());
    // 体重是另一条数据线(趋势页有更全的一份),这一页只读不写:拿不到就不画,不打扰主线
    void bodyApi
      .listBodyMeasurements({ pageSize: 100 })
      .then((r) => {
        setWeights(
          r.items
            .filter((m) => m.weightKg != null && m.weightKg > 0)
            .map((m) => ({ date: localDayOf(m.measuredAt), value: m.weightKg as number }))
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        );
      })
      .catch(() => undefined);
    // 用户正看着统计,顺手把趋势页读的那张快照刷成此刻的数(见 @/utils/training-progress)
    saveTrainingProgress(progressOf(list));
    // 同一个道理,顺手把「以前练过、账上还没算消耗」的那些补进热量引擎 ——
    // 训练分包里的页面都是入口,谁先开谁补,补过一次本会话就不再补(见 engine/workout-energy)
    void backfillWorkoutEnergy(list);
    track('training_stats', 'other');
  });

  const hm = useMemo(() => heatmap(logs, WEEKS, todayStr(), heatMetric), [logs, heatMetric]);
  /** 当前口径的定义(图例上那两个门槛数要从它来,别在页面里另写一份) */
  const heatDef = metricDef(heatMetric);
  const sum = useMemo(
    () => summaryOf(logs, range === 'all' ? null : isoDaysAgo(Number(range))),
    [logs, range]
  );
  /** 同一个窗口的强度画像(和上面那一块共用 from,见 engine/history.ts 的 effortStat) */
  const eff = useMemo(
    () => effortStat(logs, range === 'all' ? null : isoDaysAgo(Number(range))),
    [logs, range]
  );
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';
  const prs = useMemo(() => personalRecords(logs), [logs]);
  const days = useMemo(() => dayStats(logs), [logs]);
  /** 力量保持:每个动作自己的成绩衰减(和上面「最好成绩」是两回事 —— 那个是历史最好,这个是今天还剩多少) */
  const kept = useMemo(() => strengthRows(logs), [logs]);
  const faded = useMemo(() => fadedRows(kept), [kept]);
  const fadeVerdict = useMemo(() => fadedVerdict(kept), [kept]);
  const hasLogs = logs.length > 0;
  const bestDay = days.length ? days.reduce((a, b) => (b.volumeKg > a.volumeKg ? b : a)) : null;

  /* ---------- 仪表盘上半部分 ---------- */
  /** 当前时间档的起点(所有卡片共用;`null` = 全部) */
  const fromDate = range === 'all' ? null : isoDaysAgo(Number(range));
  const thisMonth = useMemo(() => {
    const m = todayStr().slice(0, 7);
    return logs.filter((l) => l.date.slice(0, 7) === m).length;
  }, [logs]);

  /**
   * 肌肉平衡 —— 和时间档同一份窗口。
   *
   * 这里**不按「建议组数」上色**(那是肌群页的按周口径,窗口一拉长每块都会是「超量」),
   * 而是按**这一窗口里的相对量**分三档:练得最少的一档、中间、最多的一档。
   * 图答的问题是「我偏在练哪几块」,不是「够不够」—— 后者在肌群页按 7 天算。
   */
  const balance = useMemo(() => {
    const list = fromDate ? logs.filter((l) => l.date >= fromDate) : logs;
    return loadsOf(list);
  }, [logs, fromDate]);
  const balMax = Math.max(1, ...balance.map((s) => s.sets));
  const setsOf = (g: MuscleGroup) => balance.find((s) => s.group === g)?.sets ?? 0;
  const toneOf = (g: MuscleGroup): Tone => {
    const n = setsOf(g);
    if (n <= 0) return 'none';
    const r = n / balMax;
    return r < 1 / 3 ? 'low' : r < 2 / 3 ? 'fresh' : 'high';
  };
  const balanceTone = GROUP_ORDER.reduce((m, g) => {
    m[g] = toneOf(g);
    return m;
  }, {} as Record<MuscleGroup, Tone>);
  /** 再点一下同一个部位 = 取消,不然选中状态没有退路 */
  const pickMg = (g: MuscleGroup) => setMgPicked((cur) => (cur === g ? null : g));

  /**
   * 「练得多狠」的周曲线 —— 每周平均 RIR。
   * 只画评过分的周;一周里评过的组少于一组的直接跳过(那是噪声不是走势)。
   */
  const effWeeks = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const l of logs) {
      if (fromDate && l.date < fromDate) continue;
      for (const e of l.entries ?? []) {
        for (const s of e.sets ?? []) {
          if (s.rir == null) continue;
          const wk = mondayOf(l.date);
          const arr = buckets.get(wk);
          if (arr) arr.push(s.rir); else buckets.set(wk, [s.rir]);
        }
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([wk, rs]) => ({ label: wk.slice(5), value: avgRir(rs) ?? 0 }))
      .filter((p) => p.value > 0);
  }, [logs, fromDate]);

  /**
   * 体重曲线的点 —— 和上面共用同一个时间档。
   * 条数多的时候等距抽稀到 30 个以内(首末两个一定留着):横轴只标首末日期,
   * 但 100 个点挤在 300px 里连成一片,点选也戳不准。
   */
  const weightPts = useMemo(() => {
    const list = weights.filter((w) => !fromDate || w.date >= fromDate);
    const step = Math.ceil(list.length / 30);
    const shown = step > 1
      ? list.filter((_, i) => i % step === 0 || i === list.length - 1)
      : list;
    return shown.map((w) => ({ label: w.date.slice(5), value: w.value }));
  }, [weights, fromDate]);

  /** 最近几次训练 —— 统计页看的是「怎么样」,底下这几条是「每一次」的入口 */
  const recent = useMemo(
    () => [...logs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 6),
    [logs]
  );

  /** 每列顶部要不要写月份:该周第一天进入新月份就标一次 */
  const monthMarks = useMemo(() => {
    let last = '';
    return hm.weeks.map((w) => {
      const m = w.start.slice(0, 7);
      if (m !== last && Number(w.start.slice(8, 10)) <= 7) { last = m; return `${Number(w.start.slice(5, 7))}月`; }
      return '';
    });
  }, [hm]);

  const today = todayStr();
  // 没练的日子也能点开 —— 点开才能补记「那天在发烧」,不然请假只能从今天往后记
  const pickDay = (cell: HeatCell) => {
    setPicked(cell.trained || isExcused(dayNotes, cell.date) ? cell : null);
  };
  const dayOf = (date: string) => days.find((d) => d.date === date);

  const toggleNote = async (date: string) => {
    if (noteOf(dayNotes, date)) {
      setDayNotes(clearDayNote(dayNotes, date));
    } else {
      const next = await recordDayOff(dayNotes, date, today);
      if (next === dayNotes) return; // 用户取消
      setDayNotes(next);
    }
    // 请假/销假立刻上云:服务端提醒任务只认云端那份请假条
    void autoSync().catch(() => undefined);
    setPicked(null); // 这一格的「请假/没练」状态变了,面板上的旧结论不能再留着
  };

  return (
    <Screen className="st-page">
      {!hasLogs && (
        <View className="card st-empty">
          <Image className="st-empty-icon" src={statsIcon} mode="aspectFit" />
          <Text className="fs-h1">还没有训练记录</Text>
          <Text className="fs-mini text-secondary">完成一次训练后,这里会开始记录你的打卡和成绩</Text>
          <Button
            className="btn btn--primary st-empty-cta"
            onClick={() => navigate('/pkg-exercise/plan-view/index')}
          >
            去我的训练计划
          </Button>
        </View>
      )}

      {hasLogs && (
        <>
          {/* ===== 顶上这四个数 =====
              进来先给结论:练了多少次、这个月练了几次、现在连着几天、总共几天。
              这四个数以前挤在热力图卡里(连续/最长/累计),一张卡同时管图和数,
              图被挤到下面去了 —— 现在拆开,图只管图 */}
          <View className="card st-tiles">
            <View className="st-tile">
              <Text className="st-tile-v">{logs.length}</Text>
              <Text className="fs-mini text-secondary">训练次数</Text>
            </View>
            <View className="st-tile">
              <Text className="st-tile-v">{thisMonth}</Text>
              <Text className="fs-mini text-secondary">本月</Text>
            </View>
            <View className="st-tile">
              <Text className="st-tile-v st-tile-v--accent">{hm.streak}</Text>
              <Text className="fs-mini text-secondary">连续训练 · 天</Text>
            </View>
            <View className="st-tile">
              <Text className="st-tile-v">{hm.totalDays}</Text>
              <Text className="fs-mini text-secondary">累计天数</Text>
            </View>
          </View>

          {/* ===== 打卡热力图 ===== */}
          <View className="card st-block">
            {/* 卡片标题不跟着口径变:「练了多久」在换成容量口径时就是句错话,
                而这几个数(连续天数/累计天数)本来就与口径无关 —— 色阶是什么,由下面那排开关自己说 */}
            <View className="st-head">
              <Text className="fs-h1">打卡热力图</Text>
              <Text className="st-legend">最近 {WEEKS} 周</Text>
            </View>

            {/* 色阶口径 —— 同一张格子图,组数/时长/容量看的是三件事(见 engine/history.ts 的 HEAT_METRICS)。
                换它**不动**格子图本身:哪天练了是事实,深浅才是口径 */}
            <View className="st-heat-metrics">
              {HEAT_METRICS.map((m) => (
                <Text
                  className={`st-chip${heatMetric === m.k ? ' st-chip--on' : ''}`}
                  key={m.k}
                  onClick={() => {
                    setHeatMetric(m.k);
                    track('training_heat_metric', 'other', { metric: m.k });
                  }}
                >
                  {m.label}
                </Text>
              ))}
            </View>

            <ScrollView className="st-heat" scrollX>
              <View className="st-heat-inner">
                <View className="st-heat-months">
                  {monthMarks.map((m, i) => (
                    <Text className="st-heat-month" key={hm.weeks[i].start}>{m}</Text>
                  ))}
                </View>
                <View className="st-heat-body">
                  <View className="st-heat-rows">
                    {WEEK_ZH.map((d) => <Text className="st-heat-row" key={d}>{d}</Text>)}
                  </View>
                  <View className="st-heat-grid">
                    {hm.weeks.map((w) => (
                      <View className="st-heat-col" key={w.start}>
                        {w.cells.map((c) => (
                          <View
                            className={
                              `st-cell st-cell--${c.level}`
                              + (isExcused(dayNotes, c.date) ? ' st-cell--off' : '')
                              + (picked?.date === c.date ? ' st-cell--on' : '')
                            }
                            key={c.date}
                            onClick={() => pickDay(c)}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </ScrollView>

            <View className="st-heat-foot">
              {/* 图例两端写的是**门槛的数字**(「≤3 组 / 16 组+」),不是一个「少 / 多」——
                  绝对门槛不说给用户听,颜色深浅就只剩个感觉 */}
              <View className="st-heat-scale">
                <Text className="fs-mini text-secondary">{heatDef.lo}</Text>
                {[0, 1, 2, 3, 4].map((lv) => <View className={`st-cell st-cell--${lv}`} key={lv} />)}
                <Text className="fs-mini text-secondary">{heatDef.hi}</Text>
                <View className="st-cell st-cell--off st-heat-offkey" />
                <Text className="fs-mini text-secondary">请假</Text>
              </View>
              <Text className="fs-mini text-secondary">横滑看更早</Text>
            </View>

            <View className="st-pick">
              {picked ? (() => {
                const d = dayOf(picked.date);
                const note = noteOf(dayNotes, picked.date);
                return (
                  <>
                    <Text className="st-pick-k">{picked.date.slice(5)} 那天</Text>
                    {note && <Text className="fs-mini st-pick-off">请假:{noteText(note)}</Text>}
                    {d && (
                      <Text className="fs-mini text-secondary">
                        {`${d.sets} 组 · ${d.reps} 次 · ${Math.round(d.volumeKg)} kg · ${d.exercises} 个动作 · ${fmtSpan(d.durationSec)}`}
                      </Text>
                    )}
                    {!d && !note && <Text className="fs-mini text-secondary">没有记录</Text>}
                    {/* 练过的那天不给「请假」—— 那叫补录,不叫请假;但请过的假随时能销 */}
                    {picked.date <= today && (note || !d) && (
                      <Text className="st-pick-op" onClick={() => void toggleNote(picked.date)}>
                        {note ? '销假' : '这天没练,记一天请假'}
                      </Text>
                    )}
                  </>
                );
              })() : (
                <Text className="fs-mini text-secondary">点格子看那天的数据</Text>
              )}
            </View>
          </View>

          {/* 时间档从「练了多少」那张卡里搬出来,单独一行摆在它上面 ——
              它现在管着**下面两张卡**(练了多少 / 练得多狠),再留在其中一张的标题底下,
              另一张上的数就成了「不知道按哪个窗口算的」 */}
          <View className="st-ranges">
            {RANGES.map((r) => (
              <Text
                className={`st-chip${range === r.key ? ' st-chip--on' : ''}`}
                key={r.key}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </Text>
            ))}
          </View>

          {/* ===== 肌肉平衡 =====
              这一页以前全是「数」,没有一张「图」—— 而「我偏在练哪几块」是数据本身
              回答不了的问题:七行条形图也能看,但要先在脑子里排一次序。
              身体图把这件事变成一眼:哪块深、哪块灰。
              按**这一窗口里的相对量**分档,不按建议组数(理由见上面的 balance 注释) */}
          <View className="card st-block">
            <View className="st-head">
              <Text className="fs-h1">肌肉平衡</Text>
              <Text className="st-legend">{rangeLabel}</Text>
            </View>
            <View className="st-bal">
              <BodyMap tone={balanceTone} side="front" active={mgPicked} onPick={pickMg} />
              <BodyMap tone={balanceTone} side="back" active={mgPicked} onPick={pickMg} />
            </View>
            <View className="st-bal-legend">
              <View className="st-bal-key"><View className="st-bal-dot st-bal-dot--low" /><Text className="fs-mini text-secondary">偏少</Text></View>
              <View className="st-bal-key"><View className="st-bal-dot st-bal-dot--ok" /><Text className="fs-mini text-secondary">适中</Text></View>
              <View className="st-bal-key"><View className="st-bal-dot st-bal-dot--high" /><Text className="fs-mini text-secondary">偏多</Text></View>
              <View className="st-bal-key"><View className="st-bal-dot st-bal-dot--none" /><Text className="fs-mini text-secondary">没练到</Text></View>
            </View>
            <View className="st-bal-rows">
              {GROUP_ORDER.map((g) => {
                const n = setsOf(g);
                return (
                  <View className="st-bal-row" key={g} onClick={() => pickMg(g)}>
                    <Text className={`st-bal-name${mgPicked === g ? ' is-on' : ''}`}>{GROUP_ZH[g]}</Text>
                    <View className="st-bal-bar">
                      <View className={`st-bal-fill st-bal-fill--${toneOf(g)}`} style={{ width: `${(n / balMax) * 100}%` }} />
                    </View>
                    <Text className="st-bal-v">{n || '—'}</Text>
                  </View>
                );
              })}
            </View>
            <Text className="fs-mini text-secondary st-foot">
              {mgPicked
                ? `${GROUP_ZH[mgPicked]}:这段时间 ${setsOf(mgPicked)} 组(主动肌算 1 组、协同肌算半组)。`
                : '点图上的部位,看它这段时间练了多少组。'}
            </Text>
            <Text className="fs-mini st-bal-more" onClick={() => navigate('/pkg-exercise/muscles/index')}>
              看每个部位缓过来没有 ›
            </Text>
          </View>

          {/* ===== 阶段汇总 ===== */}
          <View className="card st-block">
            <View className="st-head">
              <Text className="fs-h1">练了多少</Text>
              <Text className="st-legend">{rangeLabel}</Text>
            </View>
            <View className="st-nums">
              <View className="st-num"><Text className="st-num-v">{sum.sessions}</Text><Text className="fs-mini text-secondary">训练次数</Text></View>
              <View className="st-num"><Text className="st-num-v">{sum.days}</Text><Text className="fs-mini text-secondary">训练天数</Text></View>
              <View className="st-num"><Text className="st-num-v">{sum.sets}</Text><Text className="fs-mini text-secondary">总组数</Text></View>
              <View className="st-num"><Text className="st-num-v">{sum.reps}</Text><Text className="fs-mini text-secondary">总次数</Text></View>
              {/* 纯自重训练容量是 0 —— 写一个「0 kg」会被读成「什么都没练」,不如给一个「—」 */}
              <View className="st-num">
                <Text className="st-num-v">
                  {sum.volumeKg <= 0 ? '—' : sum.volumeKg >= 1000 ? `${(sum.volumeKg / 1000).toFixed(1)}t` : sum.volumeKg}
                </Text>
                <Text className="fs-mini text-secondary">总容量</Text>
              </View>
              <View className="st-num"><Text className="st-num-v">{sum.minutes}</Text><Text className="fs-mini text-secondary">总分钟</Text></View>
              {/* 计时型动作对「总次数」的贡献是 0(见 types.ts),所以单独给一格 ——
                  不练平板支撑的人看见的是一个恒为 0 的格子,那就不显示 */}
              {sum.holdSec > 0 && (
                <View className="st-num">
                  <Text className="st-num-v">{holdText(sum.holdSec)}</Text>
                  <Text className="fs-mini text-secondary">保持</Text>
                </View>
              )}
            </View>
            <Text className="fs-mini text-secondary st-foot">
              {bestDay && bestDay.volumeKg > 0
                ? `单次容量最大的是 ${bestDay.date.slice(5)},那天 ${Math.round(bestDay.volumeKg)} kg。`
                : ''}
              {sum.volumeKg <= 0 && sum.sets > 0
                ? '这段时间练的都是自重动作 —— 容量只算负重,所以是「—」;组数和次数照常算。'
                : '容量 = 重量 × 次数,涨得比体重快是正常的。'}
            </Text>
          </View>

          {/* ===== 练得多狠 =====
              「练了多少」答的是量,这一块答的是**狠** —— 一个人练得再勤,组组留三次余量
              也长不了肌肉,而这件事以前这一页一个字都没有(整页只有组数、容量、次数这些量)。
              数据一直有:每一组都能评「还剩几次」(sets.rir),只是从没被汇总过。
              上面那排时间档管着这一块(range 是整页的,不另立一套窗口) */}
          <View className="card st-block">
            <View className="st-head">
              <Text className="fs-h1">练得多狠</Text>
              <Text className="st-legend">{rangeLabel}</Text>
            </View>
            {eff.rated < MIN_RATED ? (
              /* 少于 MIN_RATED 组就**不给结论**(见 effort.ts):「平均 RIR 1.0」只来自两组,
                 读起来像结论其实是一次点击。这里给的是「去哪儿评」,不是「数据不够」 */
              <Text className="fs-mini text-secondary st-foot">
                {eff.rated === 0
                  ? '还没评过强度。练的时候每一组右边能点一下,选「还能再做几次」——'
                    + '评过之后这里就能看出你这段时间的组离力竭有多远。'
                  : `这段时间只有 ${eff.rated} 组评了强度,还看不出什么。多评几组(至少 ${MIN_RATED} 组)再来这里。`}
              </Text>
            ) : <>
              <View className="st-nums">
                <View className="st-num">
                  <Text className="st-num-v">{eff.hardPct}%</Text>
                  <Text className="fs-mini text-secondary">接近力竭的组</Text>
                </View>
                <View className="st-num">
                  <Text className="st-num-v" style={{ color: effortColor(eff.avgRir) ?? undefined }}>{eff.avgRir}</Text>
                  <Text className="fs-mini text-secondary">平均 RIR</Text>
                </View>
                <View className="st-num">
                  <Text className="st-num-v">{eff.rated}</Text>
                  <Text className="fs-mini text-secondary">评过强度的组</Text>
                </View>
              </View>
              {/* 五档占比条 —— 颜色直接取评分色带那一份(engine/effort.ts),
                  不在这里另写一组色值:同一个人练完看到的那条色带必须和这里的分布是同一套 */}
              <View className="st-eff-bar">
                {eff.bands.map((n, i) => (n > 0 ? (
                  <View
                    className="st-eff-seg"
                    key={EFFORT_BANDS[i].rir}
                    style={{ width: `${(n / eff.rated) * 100}%`, background: EFFORT_BANDS[i].color }}
                  />
                ) : null))}
              </View>
              <View className="st-eff-legend">
                {eff.bands.map((n, i) => (
                  <View className="st-eff-item" key={EFFORT_BANDS[i].rir}>
                    <View className="st-eff-dot" style={{ background: EFFORT_BANDS[i].color }} />
                    <Text className="fs-mini text-secondary">{EFFORT_BANDS[i].label}{n > 0 ? ` ${n}` : ''}</Text>
                  </View>
                ))}
              </View>
              {/* 周曲线:分布条说的是「这段时间整体」,曲线才看得出**在变好还是在松** ——
                  只有一周数据就不画(那是一个点,不是走势) */}
              {effWeeks.length >= 2 && (
                <View className="st-chart">
                  <Text className="fs-mini text-secondary">每周平均 RIR —— 线往下走,说明组离力竭越来越近</Text>
                  <LineChart
                    canvasId="st-eff-chart"
                    points={effWeeks}
                    height={110}
                    color={THEME.warning}
                    unit=" RIR"
                  />
                </View>
              )}
              <Text className="fs-mini text-secondary st-foot">
                {eff.hard} / {eff.rated} 组接近力竭(RIR {HARD_RIR} 以内)。{effortVerdict(eff.avgRir)}
              </Text>
              <Text className="fs-mini text-secondary st-foot">
                RIR 是「这一组还能再做几次」:0 就是力竭。每组都留三次以上余量,刺激就一直在偏轻的那一档 ——
                增肌通常把大部分组放在 0-3 之间。{eff.rated < eff.sets ? `这段时间做掉的 ${eff.sets} 组里有 ${eff.rated} 组评了强度,` : ''}没评的组不进这里的任何比例。
              </Text>
            </>}
          </View>

          {/* ===== 个人纪录 ===== */}
          <View className="card st-block">
            <View className="st-head">
              <Text className="fs-h1">最好成绩</Text>
              <Text className="st-legend">{prs.length} 个动作</Text>
            </View>
            {prs.length === 0 && (
              <Text className="fs-mini text-secondary st-foot">
                还没练出纪录。负重动作练过之后,这里会记下每个动作的最大重量与最佳单组估算。
              </Text>
            )}
            <View className="st-prs">
              {prs.slice(0, 12).map((p) => (
                <View
                  className="st-pr"
                  key={p.exerciseId}
                  onClick={() => navigate(`/pkg-exercise/exercise-history/index?exerciseId=${p.exerciseId}`)}
                >
                  <View className="st-pr-copy">
                    <Text className="st-pr-name">{p.nameZh}</Text>
                    <Text className="fs-mini text-secondary">
                      {p.topKg > 0 ? `最大 ${loadText(p.exerciseId, p.topKg)} × ${sideRepsLabel(p.exerciseId, p.topReps)}` : '自重'}
                      {p.bestE1rm > 0 ? ` · 估 1RM ${p.bestE1rm}kg` : ''}
                    </Text>
                  </View>
                  <View className="st-pr-right">
                    <Text className="fs-mini text-secondary">{p.date.slice(5)}</Text>
                    <Text className="fs-mini text-secondary">练过 {p.times} 次</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text className="fs-mini text-secondary st-foot">
              估算 1RM 是「这个重量你尽全力能做一次」的推算值,只取 12 次以内的组来算。
              补录或事后改过的记录不计入纪录 —— 记得不准的成绩不该拿来当目标。
            </Text>
          </View>

          {/* ===== 力量保持 =====
              只在真有动作掉下来的时候出现 —— 一个都没停过的用户看到这张卡只是噪音 */}
          {faded.length > 0 && (
            <View className="card st-block">
              <View className="st-head">
                <Text className="fs-h1">力量保持</Text>
                <Text className="st-legend">{faded.length} 个动作停久了</Text>
              </View>
              <View className="st-prs">
                {faded.slice(0, 8).map((r) => (
                  <View
                    className="st-pr"
                    key={r.exerciseId}
                    onClick={() => navigate(`/pkg-exercise/exercise-history/index?exerciseId=${r.exerciseId}`)}
                  >
                    <View className="st-pr-copy">
                      <Text className="st-pr-name">{r.nameZh}</Text>
                      <Text className="fs-mini st-keep-v">
                        {r.bestE1rm}kg → {r.currentE1rm}kg
                      </Text>
                    </View>
                    <View className="st-pr-right">
                      <Text className="fs-mini text-secondary">{restText(r.restDays)}</Text>
                      <Text className="fs-mini text-secondary">约剩 {Math.round(r.retained * 100)}%</Text>
                    </View>
                  </View>
                ))}
              </View>
              <Text className="fs-mini text-secondary st-foot">{fadeVerdict}</Text>
              <Text className="fs-mini text-secondary st-foot">
                成绩按停练多久折算:两周以内不扣,之后每四周掉一半,最多按一半算 —— 是个起步参考,不是精确值。
                一直有练的动作不会出现在这里。
              </Text>
            </View>
          )}

          {/* ===== 体重 =====
              练得怎么样要看两样:训练量在涨、体重朝目标走。后者以前只在趋势页,
              统计页的用户得切一个 tab 再自己回来对 —— 这条线摆在这里才连得起来。
              只读展示:体重该在哪儿录还在哪儿录 */}
          <View className="card st-block">
            <View className="st-head">
              <Text className="fs-h1">体重</Text>
              <Text className="st-legend">{rangeLabel}</Text>
            </View>
            {weightPts.length >= 2 ? (
              <LineChart canvasId="st-weight-chart" points={weightPts} height={120} color={THEME.primary} unit=" kg" />
            ) : (
              <Text className="fs-mini text-secondary st-foot">
                {weightPts.length === 1
                  ? '只有一次体重记录,还连不成曲线。下次称完再来。'
                  : '这段时间没有体重记录。称一次,就能把体重和训练量对着看。'}
              </Text>
            )}
            <View className="st-links">
              <Text className="fs-mini st-link" onClick={() => navigate('/pages/measure/index')}>量一次围度 ›</Text>
              <Text className="fs-mini st-link" onClick={() => navigate('/pages/photos/index')}>进度照片 ›</Text>
            </View>
          </View>

          {/* ===== 最近训练 =====
              上面几块都在回答「最近怎么样」,这里把最近几次摊开:同一个 LogCard,
              和计划页、训练记录页是同一张卡 —— 说的是同一条历史 */}
          <View className="card st-block">
            <View className="st-head">
              <Text className="fs-h1">最近训练</Text>
              <Text
                className="st-legend st-legend-link"
                onClick={() => navigate('/pkg-exercise/log-history/index')}
              >
                全部 ›
              </Text>
            </View>
            {recent.map((l) => <LogCard log={l} key={l.id} />)}
          </View>

          {/* 那两句「这一页怎么看」原先顶在最上面(一段话挡在所有数字前面),
              搬到底下:进来先看见数,看完了才需要知道口径 */}
          <Text className="fs-mini text-secondary st-foot">
            打卡看的是「有没有练」,纪录看的是「练到什么程度」。次数上不去不是意志问题,
            多数时候是重量、组数或恢复没安排对 —— 点开单个动作能看到它的每一次变化。
          </Text>
        </>
      )}
    </Screen>
  );
}
