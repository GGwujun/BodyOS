import { useState } from 'react';
import { Picker, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { ArrowRight, ArrowDown } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import { summaryApi } from '@/services';
import { track } from '@/services/analytics';
import { todayStr } from '@/utils/date';
import {
  STATE_EMOJI, STATE_TONE, TRAINING_LOGS_URL, TRAINING_PLAN_URL, digestView, loadTrainingDigest, weekDotMap,
  type TrainingDigest, type TrainingState
} from '@/utils/training-digest';
import { clearDraft, draftAlreadyDone, draftBrief, loadDraft, type WorkoutDraft } from '@/utils/workout-draft';
import { onIf } from '@/utils/taro-events';
import type { DailyAnalysis } from '@/services/types';
import './index.scss';
import { navigate } from '@/utils/nav';

/* 脸色和话都搬到 utils/training-digest.ts 了 —— 训练 tab 那一页要用同一份
   (同一个状态在两个地方长出两种颜色,比说错话更像两个功能) */

/** 日期格子下面那个小点 —— 见 `strip-day__dot` 那几个类 */
type StripDot = 'due' | 'done' | 'off' | 'moved';

/**
 * 今天那一格点什么。**先看卡片的状态**(它带着请假、改练的上下文,是最完整的判断),
 * 状态说不出话时才退回周条上那个记号 —— 今天被改练过就是改练。
 * 什么都不知道也给一个绿点:那是「你在这儿」的位置标记,不该因为没数据就消失。
 */
function todayDot(state: TrainingState | undefined, week: StripDot | undefined): StripDot {
  if (state === 'done') return 'done';
  // 休息日和请假都不该是一个绿色的「该练了」;周条上那几种点里,灰色那个最接近「今天不用」
  if (state === 'off' || state === 'rest') return 'off';
  return week === 'moved' ? 'moved' : 'due';
}

/**
 * 切到过去某一天时那张训练卡。
 *
 * 小抄只记了**本周**发生过的事(练过 / 请假 / 改过安排,见 utils/training-digest 的 week),
 * 所以只在有记号的那几天敢说「这天…」。不能拿今天那张卡顶上去 —— 今天是「练完了」,
 * 翻到上周三还是同一句话,等于在说谎(这次被用户抓到的就是这一条)。
 *
 * 没有记号时返回 null:周条可能只是「这一周还没算过」,贸然写「这天没练」
 * 同样是在编事实。没有卡,比一句错的卡好。
 */
function pastTrainView(dot: StripDot | undefined): {
  emoji: string; tone: string; title: string; sub: string;
} | null {
  if (dot === 'done') {
    return { emoji: STATE_EMOJI.done, tone: STATE_TONE.done, title: '这天练过了', sub: '训练记录里能看到这次练了什么' };
  }
  if (dot === 'off') {
    return { emoji: STATE_EMOJI.off, tone: STATE_TONE.off, title: '这天请假了', sub: '不算欠账,也不催你' };
  }
  if (dot === 'moved') {
    return { emoji: '🔁', tone: '', title: '这天改过安排', sub: '当天没有留下训练记录' };
  }
  return null;
}


export default function Home() {
  const today = todayStr();
  // 顶部日期条:默认今天,可切换查看本周任意一天/历史日期
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;
  const { data, loading, error, refresh } = useAsync(() => summaryApi.getDailySummary(viewDate), [viewDate]);

  // 今天练什么(训练那半边留下的当天小抄)—— null = 今天还不知道,卡片会说一句不会错的话
  const [digest, setDigest] = useState<TrainingDigest | null>(null);
  const train = digestView(digest);
  /** 本周七天的训练记号 —— 计划页留下的那张小抄,没有就一格都不画 */
  const dots = weekDotMap(digest);
  /**
   * 正在看的是哪一天。今天用今天的小抄;过去的日子只有**周条上真有记号**时才说话,
   * 查不到那天就不摆卡 —— 既不把今天的状态复制过去,也不编一句「这天没练」。
   */
  const past = !isToday ? pastTrainView(dots[viewDate]) : null;
  const openTraining = (href: string) => {
    track('home_training_click', 'home', { state: digest?.state ?? 'unknown' });
    navigate(href);
  };
  /**
   * 今天不练 —— 记请假条那套(选原因 → 可补一句 → 存)在训练分包里,主包引不到,
   * 所以是**把用户送到计划页**再让那边走一遍(见 plan-view 的 `?off=1`)。
   * 不在这儿自己写一个确认框:同一个动作两套写法,两边的假条迟早不一样。
   */
  const markOffToday = () => {
    track('home_training_off', 'home');
    navigate(`${TRAINING_PLAN_URL}?off=1`);
  };
  /**
   * 今天要练的不是卡片上这一套 —— 同样把人送到计划页,由那边挑(计划页每张训练日卡上的按钮
   * 顺手就把「今天改练这个」记下了,见 plan-view 的 `start`)。
   * 首页不自己弹一层选择器,两条硬理由:①主包引不到分包 engine,计划数据不在这儿;
   * ②计划有几天就列几项,而微信的 `showActionSheet` **只给 6 项**(6 天计划就爆了)。
   * 「今天不练」走的是同一条路,两个入口一个长相。
   */
  const switchToday = () => {
    track('home_training_switch', 'home', { state: digest?.state ?? 'unknown' });
    navigate(`${TRAINING_PLAN_URL}?switch=1`);
  };

  /**
   * 上次那场没练完 —— 训练页每一次改动都会把那一场写在本机,这里只读
   * (见 utils/workout-draft.ts:这一份要首页和训练页两处都读得到,所以在主包)。
   *
   * 它排在上面的「今天练什么」之前:那张卡说的是**该做的事**,这一张说的是
   * **已经付出过的一组一组**。同一天里两者都在时,先把做了一半的收尾。
   */
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const brief = draftBrief(draft);
  const resumeTraining = () => {
    track('home_training_resume', 'home', { sets: brief?.sets ?? 0 });
    navigate('/pkg-exercise/workout/index?resume=1');
  };
  const dropDraft = async () => {
    const { confirm } = await Taro.showModal({
      title: '放弃那一场?',
      content: '已经勾过的组会被清掉,不能再恢复。',
      confirmText: '放弃',
      cancelText: '留着'
    });
    if (!confirm) return;
    track('home_training_resume_drop', 'home', { sets: brief?.sets ?? 0 });
    clearDraft();
    setDraft(null);
  };

  // 今日解读:懒加载,用户展开才调用(控制成本);当日结果缓存不再重复请求
  const [insightOpen, setInsightOpen] = useState(false);
  const [insight, setInsight] = useState<DailyAnalysis | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const toggleInsight = async () => {
    if (insightOpen) { setInsightOpen(false); return; }
    setInsightOpen(true);
    if (insight || insightLoading) return;
    setInsightLoading(true);
    setInsightError('');
    track('daily_ai_click', 'home');
    try {
      setInsight(await summaryApi.dailyAnalysis(today));
    } catch (e) {
      setInsightError(e instanceof Error ? e.message : '解读生成失败,请稍后重试');
    } finally {
      setInsightLoading(false);
    }
  };
  const regenInsight = async () => {
    setInsightLoading(true);
    setInsightError('');
    try {
      setInsight(await summaryApi.dailyAnalysis(today));
    } catch (e) {
      setInsightError(e instanceof Error ? e.message : '解读生成失败,请稍后重试');
    } finally {
      setInsightLoading(false);
    }
  };
  // 今天练什么:训练分包每次算完会留一张当天的小抄,这里只读(见 utils/training-digest.ts)。
  // 每次 show 都重读 —— 从计划页/训练页回来时它已经改过口了
  useDidShow(() => {
    track('home_view', 'home');
    const dg = loadTrainingDigest();
    setDigest(dg);
    // 从训练页退回来 / 练完回来,这张卡要立刻跟手。顺手把「今天已经练完、草稿却还全勾着」
    // 的旧残留清掉(旧版本关汇总时会把它写回来,见 utils/workout-draft.ts):
    // 留着它,首页就会一边说「今天练完了」、一边问要不要「接着练」。
    const d = loadDraft();
    if (d && draftAlreadyDone(d, dg)) {
      clearDraft();
      setDraft(null);
    } else {
      setDraft(d);
    }
    void refresh();
  });
  // config 已开启 enablePullDownRefresh:下拉手势刷新当日数据
  usePullDownRefresh(async () => {
    await refresh();
    Taro.stopPullDownRefresh();
  });

  const go = (path: RoutePath) => TAB_PAGES.includes(path)
    ? Taro.switchTab({url:`/${path}`}) : navigate(`/${path}`);
  /* 拉失败时 data 是 null,而**「没有数据」和「没拉到数据」在文案上是两句话**。
     以前两者共用同一个分支,于是屏幕上一边说「数据暂未更新」,一边说「今天还没有能量记录」
     「去连数据源」—— 后者是在指控用户没记东西,而他可能刚记完。 */
  const failed = Boolean(error) && !loading;

  const score = Math.round(data?.bodyScore ?? 0);
  const hasScore = data?.bodyScore != null;
  const scoreTone = failed ? '未读取' : !hasScore ? '暂无评估' : score >= 80 ? '状态良好' : score >= 60 ? '状态一般' : '有待提升';
  /**
   * 目标卡上的百分比。
   * 减脂/增肌看体重进度(服务端按目标日起点与当前体重算);
   * 维持/耐力没有「还要减多少公斤」这回事,用目标评分表示近期达成度,
   * 而不是把一个恒为 0 的体重进度摆在卡片上。
   */
  const goalTracksWeight = data?.goal?.type === 'fat_loss' || data?.goal?.type === 'muscle_gain';
  const goalProgress = !data?.goal
    ? null
    : Math.max(0, Math.min(100, Math.round(
        (goalTracksWeight ? (data.goal.progress ?? 0) : (data.goalScore ?? 0))
      )));
  const goalCaption = !data?.goal
    ? '设置目标后开始记录进度'
    : goalTracksWeight
      ? '根据体重记录更新目标进度'
      : '根据近期记录评估达成度';
  const format = (value?: number | null) => value == null ? '—' : Math.round(value).toLocaleString();
  const dayLabel = isToday ? '今日' : formatDate(viewDate);
  /**
   * 消耗的三个组成项(基础代谢 / 日常活动 / 运动消耗),拼成一句话摆在下面。
   *
   * **只在至少两项有数时写**:只算出一项的话,那一句就是把上面「消耗」那个数
   * 换个说法再说一遍 —— 占一行、不加信息,还让人以为漏了一项。
   */
  const burnParts = (() => {
    if (data?.burnCalories == null) return '';
    const parts = [
      data.bmr ? `基础代谢 ${format(data.bmr)}` : '',
      data.activeCalories ? `日常活动 ${format(data.activeCalories)}` : '',
      data.exerciseCalories ? `运动消耗 ${format(data.exerciseCalories)}` : ''
    ].filter(Boolean);
    return parts.length > 1 ? parts.join(' · ') : '';
  })();
  /** 空态(读了、但今天什么都没有)—— 只有这时那句提示才是一个入口 */
  const noEnergy = !!data && !failed && !data.intakeCalories;
  const switchDate = (d: string) => {
    if (d === viewDate) return;
    track('home_date_switch', 'home', { to: d });
    setViewDate(d);
  };

  return (
    <View className="home-page">
      <View className="home-header">
        <View className="home-header__date">
          <Text className="home-greeting">{greeting()}</Text>
          <Text className="home-date">{formatDate(viewDate)}</Text>
          <Text className="home-week">{weekday(viewDate)}</Text>
        </View>
      </View>

      {/* 日期条:今天(可展开日历) + 本周七日切换,绿色为选中 */}
      <View className="date-strip">
        {isToday ? (
          <Picker mode="date" end={today} value={today} onChange={(e) => switchDate(String(e.detail.value))}>
            <View className="strip-today">今天 <Text className="strip-caret">▾</Text></View>
          </Picker>
        ) : (
          <View className="strip-today is-back" onClick={() => switchDate(today)}>回今天</View>
        )}
        <View className="strip-days">
          {weekDays(viewDate, today).map((d) => {
            const dot = d.isToday ? todayDot(digest?.state, dots[d.dateStr]) : dots[d.dateStr];
            return (
              <View
                key={d.dateStr}
                className={`strip-day${d.dateStr === viewDate ? ' active' : ''}${d.isFuture ? ' future' : ''}${d.isToday ? ' today' : ''}`}
                onClick={() => !d.isFuture && switchDate(d.dateStr)}
              >
                <Text className="strip-day__label">{d.label}</Text>
                <Text className="strip-day__num">{d.dayNum}</Text>
                {dot && <View className={`strip-day__dot is-${dot}`} />}
              </View>
            );
          })}
        </View>
      </View>

      {error && <View className="home-notice" onClick={() => void refresh()}><View className="notice-dot" /><Text>数据暂未更新，点击重试</Text></View>}

      {/* 上次那场没练完 —— 系统回收、从小程序列表里划掉,那两条路都不会有页面回调,
          唯一留下痕迹的就是训练页每勾一组写下的那份草稿(见 utils/workout-draft.ts)。
          摆在「今天练什么」上面:已经付出过的东西先收尾,再谈今天该练什么 */}
      {isToday && brief && (
        <View className="dashboard-card live-card" onClick={resumeTraining}>
          <View className="live-main">
            <Text className="live-emoji">⏱</Text>
            <View className="live-copy">
              <Text className="live-title">{brief.title || '上次那场'}还没练完</Text>
              <Text className="live-sub">
                {brief.date === today ? '今天' : formatDate(brief.date)}开始 · 已练 {brief.sets}/{brief.total} 组
              </Text>
            </View>
          </View>
          <View className="live-foot">
            <Text className="live-action">接着练 ›</Text>
            {/* 「放弃」要吃下这次点击,不然顺手就把训练页打开了 */}
            <Text className="live-drop" onClick={(e) => { e.stopPropagation(); void dropDraft(); }}>放弃</Text>
          </View>
        </View>
      )}

      {/* 今天练什么 —— 训练那半边在主包只有这一张卡是它的。
          放在身体状态**上面**:它是今天要做的一件事,而状态卡是一份读数 ——
          读数是随时能看的,「该练了」是会过期的 */}
      {isToday ? (
        <View className={`dashboard-card train-card${STATE_TONE[digest?.state ?? 'todo']}`} onClick={() => openTraining(train.href)}>
          <View className="train-head">
            <Text className="train-emoji">{STATE_EMOJI[digest?.state ?? 'todo']}</Text>
            <Text className="train-title">{train.title}</Text>
          </View>
          <View className="train-foot">
            <Text className="train-sub">{train.sub}</Text>
            <Text className="train-action">{train.action} ›</Text>
          </View>
          {/* 今天该练、但今天练不了 —— 这句话只在这一页说得出口,而计划页那两处「今天不练」
              埋在下面半屏,想不练的人得先找到它们。只在**今天真的该练**时才出现:
              卡片自己已经说「今天练完了」或「今天请假」的时候,再摆一条请假就是自相矛盾。
              点击要吃掉:整张卡本身就是「去开练」 */}
          {digest?.state === 'todo' && (
            <View className="train-off-row">
              <Text className="train-off" onClick={(e) => { e.stopPropagation(); switchToday(); }}>
                今天改练 ›
              </Text>
              <Text className="train-off" onClick={(e) => { e.stopPropagation(); markOffToday(); }}>
                今天不练 ›
              </Text>
            </View>
          )}
        </View>
      ) : past ? (
        /* 翻到本周里的过去某天 —— 说的是**那天**发生了什么,不是今天的状态。
           跨周就没有可查的记号,`past` 为 null,这张卡不出现(见 pastTrainView) */
        <View className={`dashboard-card train-card${past.tone}`} onClick={() => openTraining(TRAINING_LOGS_URL)}>
          <View className="train-head">
            <Text className="train-emoji">{past.emoji}</Text>
            <Text className="train-title">{past.title}</Text>
          </View>
          <View className="train-foot">
            <Text className="train-sub">{past.sub}</Text>
            <Text className="train-action">看训练记录 ›</Text>
          </View>
        </View>
      ) : null}

      <View className="dashboard-card score-card" onClick={() => go(hasScore ? RoutePath.Trends : RoutePath.Record)}>
        <Heading title="身体状态" />
        <View className="score-main">
          <View className="score-ring" style={{ '--score': `${loading || !hasScore ? 0 : score * 3.6}deg` } as React.CSSProperties}>
            <View className="score-ring__inner">
              <Text className={`score-number${loading || !hasScore ? ' is-empty' : ''}`}>{loading || !hasScore ? '—' : score}</Text>
              <Text className="score-label">{scoreTone}</Text>
            </View>
          </View>
        </View>
        <View className="score-trend">
          <Text className="trend-copy">{failed ? '数据暂未更新,下拉可重试' : hasScore ? '综合最近的记录与身体数据' : '记录饮食、运动后可查看身体评估'}</Text>
        </View>
        <View className="score-dimensions">
          <ScoreDimension label="能量" value={data?.energyScore} />
          <ScoreDimension label="营养" value={data?.nutritionScore} tone="amber" />
          <ScoreDimension label="恢复" value={data?.recoveryScore} tone="slate" />
        </View>
      </View>

      {/* 整张卡**不再**是一个跳「记录」的大按钮 —— 那种写法的下场是
          「我就想看看消耗怎么算的,点了一下被扔进记录页」。现在只有**具体那一格**
          能点,而且点哪儿去哪儿:摄入 → 饮食记录,消耗 → 运动记录。
          净值是两个数相减出来的,没有自己的一份明细可看,所以它不点。 */}
      <View className="dashboard-card energy-card">
        <Text className="section-title">{dayLabel}能量</Text>
        <View className="energy-metrics">
          <EnergyMetric label="摄入" value={format(data?.intakeCalories)} link onTap={() => go(RoutePath.Food)} />
          <EnergyMetric label="消耗" value={format(data?.burnCalories)} link onTap={() => go(RoutePath.Exercise)} />
          <EnergyMetric label="净值" value={`${(data?.netCalories ?? 0) > 0 ? '+' : ''}${format(data?.netCalories)}`} accent />
        </View>
        {/* 消耗是怎么来的要写出来。以前只有孤零零一个 1,792,用户没法知道里面
            有没有算上自己刚练完的那一小时 —— 数字看不懂就等于没有这个数字。 */}
        {burnParts && <Text className="energy-breakdown">{burnParts}</Text>}
        <View className="energy-track">
          <View className="energy-track__fill" style={{ width: `${Math.min(100, Math.max(0, ((data?.intakeCalories ?? 0) / Math.max(data?.burnCalories ?? 1, 1)) * 100))}%` }} />
          <View className="energy-track__marker" />
        </View>
        {/* 空态那一句自己就是入口(「点击去记一笔」不能是一句空话);
            有数据时它只是图例,点了不该有任何反应 —— 所以事件照绑,条件在函数里判 */}
        <Text
          className={`energy-hint${noEnergy && !failed ? ' is-action' : ''}`}
          onClick={onIf(noEnergy && !failed, () => go(RoutePath.Record))}
        >
          {failed ? `${dayLabel}的能量数据没读到` : data?.intakeCalories ? '绿色为已摄入进度，圆点是消耗参考线' : `${dayLabel}还没有能量记录，点击去记一笔`}
        </Text>
        <View className="water-line" onClick={() => isToday && go(RoutePath.Record)}>
          <Text className="water-line__label">💧 {dayLabel}水分 {data?.waterMl ? `${format(data.waterMl)} ml` : '未记录'}</Text>
          {isToday && <Text className="water-line__action">去打卡</Text>}
        </View>
      </View>

      <View className="dashboard-card activity-card" onClick={() => go(RoutePath.Exercise)}>
        <Heading title={`${dayLabel}活动`} />
        <View className="activity-stats">
          <View><Text className={`activity-value${data?.steps == null ? ' is-empty' : ''}`}>{format(data?.steps)}</Text><Text className="activity-unit">步</Text></View>
          <View><Text className={`activity-value${data?.activeCalories == null ? ' is-empty' : ''}`}>{format(data?.activeCalories)}</Text><Text className="activity-unit">kcal</Text></View>
        </View>
        {data?.steps != null && (
          <View className="steps-progress">
            <View className="steps-progress__track"><View className="steps-progress__fill" style={{ width: `${Math.min(100, Math.round(((data.steps ?? 0) / 8000) * 100))}%` }} /></View>
            <Text className="steps-progress__label">{format(data.steps)} / 8,000 步</Text>
          </View>
        )}
        {!failed && data?.steps == null && data?.activeCalories == null && (
          <View className="activity-empty">
            <Text className="activity-empty__title">{dayLabel}暂无活动数据</Text>
            <Text className="activity-empty__hint">去「运动-自动同步」拉取步数，或记录一次运动</Text>
          </View>
        )}
      </View>

      <View className="dashboard-card goal-card" onClick={() => data?.goal ? navigate('/pages/weight/index') : navigate('/pages/onboarding/index?from=nav')}>
        <Heading title="当前目标" />
        <View className="goal-row"><Text className={`goal-name${data?.goal ? '' : ' is-empty'}`}>{failed ? '目标没读到' : goalLabel(data?.goal?.type)}</Text><Text className="goal-meta">{data?.goal?.durationWeeks ? `${data.goal.durationWeeks} 周计划` : ''}</Text></View>
        <View className="goal-detail"><Text className="goal-caption">{failed ? '数据暂未更新,下拉可重试' : goalCaption}</Text><Text className={`goal-percent${goalProgress == null ? ' is-empty' : ''}`}>{goalProgress == null ? '—' : `${goalProgress}%`}</Text></View>
        <View className="goal-track"><View className="goal-track__fill" style={{ width: `${goalProgress ?? 0}%` }} /></View>
      </View>

      {/* 今日解读仅对当天开放(按需调用控制成本) */}
      {isToday && <View className="dashboard-card insight-card" onClick={toggleInsight}>
        <View className="insight-head">
          <Text className="section-title">今日解读</Text>
          <View className={`insight-chevron${insightOpen ? ' is-open' : ''}`}><ArrowDown size={16} color="#94a3b8" /></View>
        </View>
        {!insightOpen && <Text className="insight-hint">结合今天的记录,给出一段身体信号解读与建议</Text>}
        {insightOpen && insightLoading && <Text className="insight-loading">正在生成解读…</Text>}
        {insightOpen && !insightLoading && insightError && <Text className="insight-error" onClick={(e) => { e.stopPropagation(); regenInsight(); }}>{insightError}，点击重试</Text>}
        {insightOpen && !insightLoading && insight && (
          <View className="insight-body">
            <Text className="insight-summary">{insight.summary}</Text>
            {insight.highlights.length > 0 && (
              <View className="insight-tags">
                {insight.highlights.map((h, i) => <Text key={i} className="insight-tag insight-tag--good">{h}</Text>)}
              </View>
            )}
            {insight.issues.length > 0 && (
              <View className="insight-tags">
                {insight.issues.map((s, i) => <Text key={i} className="insight-tag insight-tag--warn">{s}</Text>)}
              </View>
            )}
            {insight.actions.length > 0 && (
              <View className="insight-actions">
                {insight.actions.map((a, i) => (
                  <View key={i} className="insight-action">
                    <Text className="insight-action__title">{i + 1}. {a.title}</Text>
                    <Text className="insight-action__reason">{a.reason}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
        {insightOpen && !insightLoading && insight && <Text className="insight-regen" onClick={(e) => { e.stopPropagation(); regenInsight(); }}>记录有更新？重新生成 ›</Text>}
      </View>}
    </View>
  );
}

function Heading({ title }: { title: string }) {
  return <View className="card-heading"><Text>{title}</Text><ArrowRight size={14} color="#94a3b8" /></View>;
}

function ScoreDimension({ label, value, tone = 'green' }: { label: string; value?: number | null; tone?: 'green' | 'amber' | 'slate' }) {
  const empty = value == null;
  return <View className="score-dimension"><Text className="dimension-label">{label}</Text><View className="dimension-pair"><Text className={`dimension-value dimension-value--${tone}${empty ? ' is-empty' : ''}`}>{empty ? '—' : Math.round(value)}</Text><Text className="dimension-unit">%</Text></View></View>;
}

/** 什么都不做的处理器 —— 见 EnergyMetric 里为什么宁可给它 */
const noop = () => undefined;

/**
 * 一格能量数。`link` 时它是个入口,标签后面缀一个 `›`。
 *
 * 为什么不给整块加个边框/底色来暗示可点:这一行三格并排,谁有边框谁没有会看着像
 * 只有那两格是「重要的」。一个箭头足够说明「这里点得动」,又不动版式。
 *
 * 为什么「不可点」的那格也要给一个 `noop` 而不是留 `undefined`:小程序端
 * 事件属性的值取到非函数会走到崩的那一支(见 utils/taro-events)。这里传的是**裸标识符**,
 * 静态扫不出来 —— 与其赌「undefined 在挂载时不会触发 setEvent」,不如永远给个函数:
 * 收益是零风险的确定性,代价只是一个空函数。
 */
function EnergyMetric({ label, value, accent = false, link = false, onTap }: { label: string; value: string; accent?: boolean; link?: boolean; onTap?: () => void }) {
  const empty = value.includes('—');
  return (
    <View className="energy-metric" onClick={onTap ?? noop}>
      <Text className={`metric-label${link ? ' is-link' : ''}`}>{label}{link ? ' ›' : ''}</Text>
      <View className="metric-pair"><Text className={`metric-value${accent ? ' metric-value--accent' : ''}${empty ? ' is-empty' : ''}`}>{value}</Text><Text className="metric-unit">kcal</Text></View>
    </View>
  );
}

function formatDate(date: string) { const [, month, day] = date.split('-').map(Number); return `${month}月${day}日`; }
/** 锚点日期所在周(周一至周日)的七天,供日期条渲染 */
function weekDays(anchor: string, today: string) {
  const d = new Date(`${anchor}T00:00:00`);
  const mon = new Date(d);
  mon.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
    return { dateStr, label: '一二三四五六日'[i], dayNum: cur.getDate(), isToday: dateStr === today, isFuture: dateStr > today };
  });
}
function greeting() { const h = new Date().getHours(); if (h < 5) return '夜深了'; if (h < 9) return '早上好'; if (h < 12) return '上午好'; if (h < 14) return '中午好'; if (h < 18) return '下午好'; return '晚上好'; }
function weekday(date: string) { return `星期${'日一二三四五六'[new Date(`${date}T00:00:00`).getDay()]}`; }
function goalLabel(type?: string) { return ({ fat_loss: '减脂', muscle_gain: '增肌', maintain: '维持', endurance: '提升体能' } as Record<string, string>)[type ?? ''] ?? '尚未设置目标'; }
