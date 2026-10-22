import { useState } from 'react';
import { View, Text, Button, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import statsIcon from '@/assets/icons/stats.png';
import { track } from '@/services/analytics';
import { addDays, todayStr } from '@/utils/date';
import { loadLogs, loadPlan } from '../engine/store';
import { applyCycle } from '../engine/cycle';
import {
  GROUP_ZH, GROUP_ORDER, WEEK_TARGET, balanceOf, planLoads, planVerdict, recentLoads, trained,
  volumeVerdict, type MuscleGroup, type MuscleStat, type SetMetric
} from '../engine/muscles';
import { canFilterHard, HARD_RIR } from '../engine/effort';
import { effortStat } from '../engine/history';
import { READY_AT, recoveryOf, recoveryTone, recoveryVerdict, relevant } from '../engine/recovery';
import type { WorkoutLog } from '../engine/types';
import BodyMap, { type Tone } from './BodyMap';
import './index.scss';
import { navigate } from '@/utils/nav';

const WEEK = 7;

/** 图上配色档 → 图例文案 */
const LEGEND: Record<'recovery' | 'volume', Array<[Tone, string]>> = {
  recovery: [
    ['fresh', '已恢复'],
    ['ok', '还差一点'],
    ['tired', '还没缓过来'],
    ['none', '这些天没练']
  ],
  volume: [
    ['low', '练得偏少'],
    ['fresh', '量正合适'],
    ['high', '练得偏多'],
    ['none', '没练到']
  ]
};

/** 肌群与恢复 — 这周每个部位练了多少、现在缓过来没有 */
export default function Muscles() {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [planned, setPlanned] = useState<MuscleStat[]>([]);
  const [mode, setMode] = useState<'recovery' | 'volume'>('recovery');
  const [picked, setPicked] = useState<MuscleGroup | null>(null);
  /** 用户想按有效组看 —— 能不能真按(评分覆盖率够不够)由 canHard 说了算,见下面 */
  const [wantHard, setWantHard] = useState(false);

  useDidShow(() => {
    setLogs(loadLogs());
    /**
     * 计划的量要**套过周期**再算:减载周处方本来就降了一档,拿原样去比,
     * 用户刚按计划做完,这张卡却说他每个部位都差一截(`planLoads` 的注释里写着这条)。
     */
    const p = loadPlan();
    setPlanned(p ? planLoads(applyCycle(p).days) : []);
    track('training_muscles', 'other');
  });

  // 窗口起点跟 recentLoads 同一套(本地日历天)—— 两处各写一个 UTC 版本迟早差一天
  const from = addDays(todayStr(), -WEEK);
  const windowLogs = logs.filter((l) => l.date >= from);
  /**
   * 这 7 天的组数与评分覆盖 —— 和统计页那张强度卡读的是同一份统计(`effortStat`),
   * 所以「评过 5 组」在两页上是同一个意思,不会各算各的。
   */
  const eff = effortStat(windowLogs);
  const canHard = canFilterHard(eff);
  /**
   * 真按哪个口径算:**能切**才切。评过分的组不够时仍然给「全部组」——
   * 这不是防手滑,是那一半没评过的组没法判断,按有效组数出来的是个会骗人的小数字。
   */
  const metric: SetMetric = canHard && wantHard ? 'hard' : 'all';
  const week = recentLoads(logs, WEEK, metric);
  /**
   * 同一窗口的「全部组」那一份 —— 只在按有效组看的时候用得上:点开某个部位时,
   * 那句话要说成「8 组有效(一共 14 组)」。少了后半个数,用户看到的是自己这周的量
   * 莫名其妙掉了四成,而不知道差在哪;这两个数摆在一起,那 6 组白练的部分自己就说话了。
   */
  const weekAll = metric === 'hard' ? recentLoads(logs, WEEK, 'all') : week;
  const done = trained(week);
  const maxSets = Math.max(1, ...done.map((s) => s.sets));
  const recovery = relevant(recoveryOf(logs));
  const bal = balanceOf(windowLogs, metric);
  /**
   * 这一窗口有没有东西可展示 —— 判据用**「全部组」那一份**,不是当前口径。
   * 按有效组看时可能一组有效的都没有(评过的组全留了四次以上余量),那也是一种答案,
   * 卡片要把它说出来;若拿 `done` 当门槛,切一下开关就有两块内容整块消失 ——
   * 用户看到的是页面塌了,不是一个「0」。
   */
  const hasWindow = weekAll.some((s) => s.rawSets > 0);
  /** 推拉/上下肢的可见性同理:这一项按有效组算恰好是 0 组时,卡片还得在(上面的数就是 0) */
  const balAny = metric === 'all' ? bal : balanceOf(windowLogs, 'all');
  const hasLogs = logs.length > 0;

  /**
   * 「练得和计划一样吗」—— **只在「全部组」下摆**。
   *
   * 计划那一栏是处方的组数,处方里没有 RIR 这回事,所以它**不存在**「有效/全部」两个口径:
   * 拿它去比有效组,比出来的差是假的(用户会以为「计划只完成了一半」,其实是另一半留了余量)。
   * 与其换个算法继续比,不如让这块跟着口径一起收起来 —— 切到有效组时那段说明在
   * 「组数怎么算」那张卡里(口径变了得说一句,不能凭空少一块)。
   */
  const hasPlan = planned.some((s) => s.rawSets > 0);
  const cmpRows = metric !== 'all' || !hasPlan ? [] : GROUP_ORDER
    .map((g) => {
      const act = (week.find((x) => x.group === g) as MuscleStat).sets;
      const plan = (planned.find((x) => x.group === g) as MuscleStat).sets;
      return { g, act, plan, v: planVerdict(act, plan), ratio: plan > 0 ? act / plan : null };
    })
    .filter((r) => r.act > 0 || r.plan > 0)
    // 差得最多的排最前面 —— 这张卡是拿来对账的,第一步就是看欠得最多的那一格
    // (计划里没有的排最后:它不是「欠」,是另一回事)
    .sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity));
  /** 达成档 → 条形/数字的配色档(条形只有 fresh/ok/tired/high 四档,这里复用前三档) */
  const GAP_TONE = { fresh: 'fresh', warning: 'ok', danger: 'tired', none: 'ok' } as const;

  /** 身体图配色:按当前模式把每个部位折成一档 */
  const toneOf = (g: MuscleGroup): Tone => {
    if (mode === 'recovery') {
      const r = recovery.find((x) => x.group === g);
      if (!r) return 'none';
      const t = recoveryTone(r.recovered);
      return t === 'fresh' ? 'fresh' : t === 'ok' ? 'ok' : 'tired';
    }
    const s = week.find((x) => x.group === g);
    if (!s || s.sets === 0) return 'none';
    const t = volumeVerdict(g, s.sets).tone;
    return t === 'ok' ? 'fresh' : t === 'high' ? 'high' : 'low';
  };
  const tone = GROUP_ORDER.reduce((m, g) => {
    m[g] = toneOf(g);
    return m;
  }, {} as Record<MuscleGroup, Tone>);

  /** 点开某个部位时给一行实话 */
  const detailOf = (g: MuscleGroup): string => {
    if (mode === 'recovery') {
      const r = recovery.find((x) => x.group === g);
      if (!r) return '最近没练到,不影响什么';
      return r.etaHours === 0
        ? `已恢复 ${r.recovered}%,今天可以练`
        : `只恢复了 ${r.recovered}%,大约还需 ${r.etaHours} 小时`;
    }
    const s = week.find((x) => x.group === g);
    const all = weekAll.find((x) => x.group === g);
    const [lo, hi] = WEEK_TARGET[g];
    if (!s || s.sets === 0) {
      // 「练没练」和「算不算有效」是两件事:按有效组看时这一格是空的,可能因为压根没练,
      // 也可能因为练了但全留了余量 —— 后者得说清楚,不然用户会以为自己的记录丢了
      const any = all ? all.sets : 0;
      return metric === 'hard' && any > 0
        ? `近 7 天做了 ${any} 组但都留了余量,按有效组算是 0 组(建议 ${lo}-${hi} 组)`
        : `近 7 天没练到,建议 ${lo}-${hi} 组`;
    }
    // 按有效组看时把「一共做了几组」也带上 —— 差的那部分正是这个读法要说的事
    const total = all && all.sets > s.sets ? `(一共 ${all.sets} 组)` : '';
    return `近 7 天 ${s.sets} 组${metric === 'hard' ? '有效' : ''}${total} · `
      + `${volumeVerdict(g, s.sets).label}(建议 ${lo}-${hi} 组)`;
  };

  /**
   * 比值算不出来时那句话。按有效组看时「样本还少」会变成一句错话 ——
   * 用户这几项是**有**组的,只是一组都没算数(全留了余量),两件事得分开说。
   */
  const skewNote = (n: number, who: string): string =>
    metric === 'hard' && n === 0
      ? `按有效组算,${who}这 7 天一组都没有`
      : '样本还少,多练几次再看';

  return (
    <Screen className="ms-page">
      <View className="card ms-intro">
        <Text className="fs-h1">肌群与恢复</Text>
        <Text className="fs-mini text-secondary">
          按最近 7 天算每个部位练了多少组(主动肌算 1 组、协同肌算半组),以及现在缓过来没有。
          练得勤不如练得准 —— 同一个部位连着两天上强度,长的是疲劳不是肌肉。
        </Text>
      </View>

      {/* 组数怎么算 —— 这个口径管着下面三块(肌群配色、练了多少、练得均衡吗),
          所以它自己占一行摆在这三块**上面**:口径变了而界面不说,用户只会觉得数在乱跳。
          「缓过来没有」不受它影响(那一栏按每组离力竭有多远算疲劳,不是数组数)。 */}
      {hasWindow && (
        <View className="card ms-block ms-metric">
          <View className="ms-block-head">
            <Text className="fs-h1">组数怎么算</Text>
            {canHard ? (
              <View className="ms-modes">
                <Text
                  className={`ms-mode${metric === 'all' ? ' ms-mode--on' : ''}`}
                  onClick={() => { setWantHard(false); track('training_muscles_metric', 'other', { metric: 'all' }); }}
                >
                  全部组
                </Text>
                <Text
                  className={`ms-mode${metric === 'hard' ? ' ms-mode--on' : ''}`}
                  onClick={() => { setWantHard(true); track('training_muscles_metric', 'other', { metric: 'hard' }); }}
                >
                  只看有效组
                </Text>
              </View>
            ) : (
              <Text className="ms-legend">还差一点</Text>
            )}
          </View>
          <Text className="fs-mini text-secondary ms-foot">
            {canHard
              ? (metric === 'hard'
                ? `现在只数有效组:练到还剩 ${HARD_RIR} 次以内(RIR ≤ ${HARD_RIR})的那些。`
                  + '肌群配色、「练了多少」、「练得均衡吗」都按这个口径 —— 留太多余量的组占时间,'
                  + '推动进步的主要不是它们。「和计划比」不跟着切(计划是处方定的组数,没有「有效」'
                  + '这一档),所以那一块这会儿收起来了,要对账切回全部组。'
                : '全部组 = 做过的每一组。切到「只看有效组」,只数练到还剩 '
                  + `${HARD_RIR} 次以内(RIR ≤ ${HARD_RIR})的那些。`)
              : `这 7 天做掉的 ${eff.sets} 组里只有 ${eff.rated} 组评过强度,还不够按有效组看 ——`
                + '没评的组没法判断算不算数,数出来会凭空少一截。练的时候每组右边点一下选「还能再做几次」,'
                + '评过半之后这里就能切。'}
          </Text>
        </View>
      )}

      {!hasLogs && (
        <View className="card ms-empty">
          <Image className="ms-empty-icon" src={statsIcon} mode="aspectFit" />
          <Text className="fs-h1">还没有训练记录</Text>
          <Text className="fs-mini text-secondary">
            完成一次训练后,这里会显示每个部位的训练量与恢复进度
          </Text>
          <Button
            className="btn btn--primary ms-empty-cta"
            onClick={() => navigate('/pkg-exercise/plan-view/index')}
          >
            去我的训练计划
          </Button>
        </View>
      )}

      {/* ===== 身体肌群图 ===== */}
      {hasLogs && (
        <View className="card ms-block">
          <View className="ms-block-head">
            <Text className="fs-h1">身体肌群图</Text>
            <View className="ms-modes">
              <Text
                className={`ms-mode${mode === 'recovery' ? ' ms-mode--on' : ''}`}
                onClick={() => setMode('recovery')}
              >
                看恢复
              </Text>
              <Text
                className={`ms-mode${mode === 'volume' ? ' ms-mode--on' : ''}`}
                onClick={() => setMode('volume')}
              >
                看训练量
              </Text>
            </View>
          </View>

          <View className="bm-row">
            <BodyMap tone={tone} side="front" active={picked} onPick={setPicked} />
            <BodyMap tone={tone} side="back" active={picked} onPick={setPicked} />
          </View>

          <View className="bm-legend">
            {LEGEND[mode].map(([t, label]) => (
              <View className="bm-legend-item" key={t}>
                <View className={`bm-dot bm-dot--${t}`} />
                <Text className="fs-mini text-secondary">{label}</Text>
              </View>
            ))}
          </View>

          <View className="bm-detail">
            {picked ? (
              <>
                <Text className="bm-detail-name">{GROUP_ZH[picked]}</Text>
                <Text className="fs-mini text-secondary">{detailOf(picked)}</Text>
                {/* 「背练得偏少」之后的下一步就是「哪些动作练背」—— 不带这条,
                    这一页只能说出一句结论,补救动作(翻动作库、找背的动作)全得自己走过去。
                    带过去的筛子是**肌群**,不是动作库那排「部位」:这一页说的「臂」含前臂、
                    「臀腿」含小腿,和动作库的十档对不上(那边小臂、小腿是分开的),见 library 的 mg */}
                <Text
                  className="bm-detail-more"
                  onClick={() => {
                    track('training_muscles_to_lib', 'other', { group: picked });
                    navigate(`/pkg-exercise/library/index?mg=${picked}`);
                  }}
                >
                  练得到{GROUP_ZH[picked]}的动作 ›
                </Text>
              </>
            ) : (
              <Text className="fs-mini text-secondary">
                点身体上的部位,看它最近练了多少、缓过来没有
              </Text>
            )}
          </View>

          <Text className="fs-mini text-secondary ms-foot">
            {/* 配色口径跟着上面那个开关走 —— 「看训练量」这一档尤其要说,不然用户会以为
                切了有效组而图没变 */}
            {mode === 'volume' && metric === 'hard' ? `配色按有效组算(只看练到还剩 ${HARD_RIR} 次以内的组)。` : ''}
            图是示意,位置对了就行。颜色分档只反映最近的训练安排,不是身体好坏的评价。
          </Text>
        </View>
      )}

      {/* ===== 恢复情况 ===== */}
      {recovery.length > 0 && (
        <View className="card ms-block">
          <View className="ms-block-head">
            <Text className="fs-h1">缓过来没有</Text>
            <Text className="ms-legend">≥ {READY_AT * 100}% 视为已恢复</Text>
          </View>
          <Text className="fs-mini text-secondary ms-verdict">{recoveryVerdict(recovery)}</Text>
          <View className="ms-rows">
            {recovery.map((r) => {
              const tone = recoveryTone(r.recovered);
              return (
                <View className="ms-row" key={r.group}>
                  <Text className="ms-row-name">{GROUP_ZH[r.group]}</Text>
                  <View className="ms-bar">
                    <View className={`ms-bar-fill ms-bar-fill--${tone}`} style={{ width: `${r.recovered}%` }} />
                  </View>
                  <View className="ms-row-right">
                    <Text className={`ms-row-pct ms-row-pct--${tone}`}>{r.recovered}%</Text>
                    <Text className="fs-mini text-secondary">
                      {r.etaHours === 0 ? '可以练' : `还需 ${r.etaHours}h`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Text className="fs-mini text-secondary ms-foot">
            半衰期估算:大肌群约 2 天、小肌群 1 天。练到力竭的那组比留余力的那组更占恢复。
          </Text>
        </View>
      )}

      {/* ===== 本周训练量 ===== */}
      {hasWindow && (
        <View className="card ms-block">
          <View className="ms-block-head">
            <Text className="fs-h1">最近 7 天练了多少</Text>
            <Text className="ms-legend">单位:计权{metric === 'hard' ? '有效' : ''}组数</Text>
          </View>
          <View className="ms-rows">
            {GROUP_ORDER.map((g) => {
              const s = week.find((x) => x.group === g) as typeof week[number];
              const v = volumeVerdict(g, s.sets);
              const [lo, hi] = WEEK_TARGET[g];
              return (
                <View className="ms-row" key={g}>
                  <Text className="ms-row-name">{GROUP_ZH[g]}</Text>
                  <View className="ms-bar">
                    <View
                      className={`ms-bar-fill ms-bar-fill--${v.tone === 'ok' ? 'fresh' : v.tone === 'high' ? 'high' : 'tired'}`}
                      style={{ width: `${Math.min(100, (s.sets / maxSets) * 100)}%` }}
                    />
                  </View>
                  <View className="ms-row-right">
                    <Text className="ms-row-pct">{s.sets > 0 ? s.sets : '—'}</Text>
                    <Text className={`fs-mini ms-vol ms-vol--${v.tone}`}>{v.label}</Text>
                  </View>
                  <Text className="fs-mini ms-target">{lo}-{hi} 组</Text>
                </View>
              );
            })}
          </View>
          <Text className="fs-mini text-secondary ms-foot">
            {metric === 'hard' && !done.length
              ? `这 7 天评过的组都留了 ${HARD_RIR} 次以上余量,按有效组算是 0 组 —— `
                + '切回「全部组」看练了多少,想让它算数就把重量加到还剩 3 次左右。'
              : ''}
            区间是大众健身的常用范围,不是硬指标。练得比上限多不等于更好,加量不加恢复最容易卡住。
          </Text>
        </View>
      )}

      {/* ===== 计划 vs 实际 =====
          上面那张问「够不够」(跟大众建议区间比),这张问「说好要做的做了没」(跟自己的计划比)。
          两把尺子摆在一起才看得出来差在哪:量在建议区间里、却只有计划的六成,那是「计划跟不上自己」;
          两只都低,那才是真练少了。 */}
      {cmpRows.length > 0 && (
        <View className="card ms-block">
          <View className="ms-block-head">
            <Text className="fs-h1">练得和计划一样吗</Text>
            <Text className="ms-legend">近 7 天 / 计划一轮</Text>
          </View>
          <View className="ms-rows">
            {cmpRows.map((r) => {
              const tone = GAP_TONE[r.v.tone];
              return (
                <View className="ms-row" key={r.g}>
                  <Text className="ms-row-name">{GROUP_ZH[r.g]}</Text>
                  <View className="ms-bar">
                    <View
                      className={`ms-bar-fill ms-bar-fill--${tone}`}
                      style={{ width: `${r.ratio == null ? 0 : Math.min(100, r.ratio * 100)}%` }}
                    />
                  </View>
                  <View className="ms-row-right">
                    <Text className={`ms-row-pct ms-row-pct--${tone}`}>
                      {r.plan > 0 ? `${r.act}/${r.plan}` : r.act}
                    </Text>
                    {/* 达成档只说词、不上色:颜色留给上面那个数,两处都染色反而看不出谁是主 */}
                    <Text className="fs-mini text-secondary">{r.v.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Text className="fs-mini text-secondary ms-foot">
            {/* 拆成加号拼的:JSX 里跨行的文本会把换行压成一个空格,中文里那个空格会真的显示出来 */}
            {'「计划」= 手上这份计划按当前周次练完一轮的组数(轮到减载周会跟着降,所以这里也跟着变)。'
              + '这一栏只跟自己的计划比 —— 和上面那条大众建议区间是两把尺子:一个问「说好要做的做了没」,'
              + '一个问「够不够」。差得最多的排在最前面;少练了一次、把某个动作换过、或者刚改过计划,'
              + '都会一起落在同一个差里。'}
          </Text>
        </View>
      )}

      {/* ===== 推拉 / 上下肢平衡 ===== */}
      {(balAny.pushSets + balAny.pullSets + balAny.upperSets + balAny.lowerSets) > 0 && (
        <View className="card ms-block">
          <View className="ms-block-head">
            <Text className="fs-h1">练得均衡吗</Text>
            <Text className="ms-legend">最近 7 天{metric === 'hard' ? ' · 只看有效组' : ''}</Text>
          </View>
          <View className="ms-split">
            <View className="ms-split-item">
              <Text className="ms-split-k">推 / 拉</Text>
              <Text className="ms-split-v">{bal.pushSets} : {bal.pullSets}</Text>
              <Text className="fs-mini text-secondary">
                {bal.pushPullSkew == null ? skewNote(bal.pushSets + bal.pullSets, '推拉')
                  : Math.abs(bal.pushPullSkew) < 25 ? '基本均衡' : bal.pushPullSkew > 0 ? `推多 ${bal.pushPullSkew}%` : `拉多 ${-bal.pushPullSkew}%`}
              </Text>
            </View>
            <View className="ms-split-item">
              <Text className="ms-split-k">上肢 / 下肢</Text>
              <Text className="ms-split-v">{bal.upperSets} : {bal.lowerSets}</Text>
              <Text className="fs-mini text-secondary">
                {bal.upperLowerSkew == null ? skewNote(bal.upperSets + bal.lowerSets, '上下肢')
                  : Math.abs(bal.upperLowerSkew) < 40 ? '基本均衡' : bal.upperLowerSkew > 0 ? `上肢多 ${bal.upperLowerSkew}%` : `下肢多 ${-bal.upperLowerSkew}%`}
              </Text>
            </View>
          </View>
          {bal.tips.map((t) => (
            <Text className="fs-mini ms-tip" key={t}>{t}</Text>
          ))}
          {!bal.tips.length && (bal.pushSets + bal.pullSets) > 0 && (
            <Text className="fs-mini text-secondary ms-tip">推拉与上下肢的分配都在合理范围,保持就行。</Text>
          )}
        </View>
      )}

      <View className="ms-actions">
        <Button
          className="btn btn--secondary btn--block"
          onClick={() => navigate('/pkg-exercise/plan-view/index')}
        >
          回我的训练计划
        </Button>
        <Text
          className="ms-link"
          onClick={() => navigate('/pkg-exercise/log-edit/index')}
        >
          补录一次练过的训练
        </Text>
      </View>
    </Screen>
  );
}
