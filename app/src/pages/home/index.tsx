import { themedColor } from '@/utils/theme';
import { useState } from 'react';
import { Image, Picker, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { ArrowRight, ArrowDown } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import { summaryApi, trendsApi, userApi } from '@/services';
import { track } from '@/services/analytics';
import { todayStr } from '@/utils/date';
import { THEME } from '@/constants/theme';
import TrainStateIcon from '@/components/TrainStateIcon';
import LineChart from '@/components/LineChart';
import dropIcon from '@/assets/icons/drop.png';
import timerIcon from '@/assets/icons/timer.png';
import foodIcon from '@/assets/icons/food.png';
import runIcon from '@/assets/icons/run.png';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import scaleIcon from '@/assets/icons/scale.png';
import heroBg from '@/assets/home-hero.jpg';
import {
  STATE_TONE, TRAINING_LOGS_URL, TRAINING_PLAN_URL, digestView, loadTrainingDigest, weekDotMap,
  type TrainingDigest, type TrainingState
} from '@/utils/training-digest';
import { clearDraft, draftAlreadyDone, draftBrief, loadDraft, type WorkoutDraft } from '@/utils/workout-draft';
import { onIf } from '@/utils/taro-events';
import { toast } from '@/utils/ui';
import type { DailyAnalysis } from '@/services/types';
import { openBodyEditor } from '@/utils/profile-edit';
import { statusBarHeight } from '@/utils/status-bar';
import './index.scss';
import { navigate, switchTab } from '@/utils/nav';

/** 自定义导航:状态栏高度只和这台设备有关,进来量一次就够 */
const STATUS_BAR = statusBarHeight();

/** 资料缺项的人话名字 —— 顺序跟服务端 `missingProfile` 一致 */
const PROFILE_FIELD_LABEL: Record<'birthDate' | 'heightCm' | 'weightKg', string> = {
  birthDate: '出生日期',
  heightCm: '身高',
  weightKg: '体重'
};

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
  icon: 'done' | 'off' | 'moved'; tone: string; title: string; sub: string;
} | null {
  if (dot === 'done') {
    return { icon: 'done', tone: STATE_TONE.done, title: '这天练过了', sub: '训练记录里能看到这次练了什么' };
  }
  if (dot === 'off') {
    return { icon: 'off', tone: STATE_TONE.off, title: '这天请假了', sub: '不算欠账,也不催你' };
  }
  if (dot === 'moved') {
    return { icon: 'moved', tone: '', title: '这天改过安排', sub: '当天没有留下训练记录' };
  }
  return null;
}


export default function Home() {
  const today = todayStr();
  // 顶部日期条:默认今天,可切换查看本周任意一天/历史日期
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;
  const { data, loading, error, refresh } = useAsync(() => summaryApi.getDailySummary(viewDate), [viewDate]);

  /* 转发/分享到朋友圈 —— 右上角菜单默认没有这两个口子,挂上钩子才有。
     落地页固定是首页:被分享进来的人第一眼看到的是「这是个记录工具」,不是某张海报 */
  useShareAppMessage(() => ({ title: '轻身记 · 记录，是改变的开始', path: '/pages/home/index' }));
  useShareTimeline(() => ({ title: '轻身记 · 记录，是改变的开始' }));

  /** 步数目标:服务端档案里的值 + 本地即时回显(改完不等重拉就变)。1000 一档,4k~20k 盖住从散步到暴走 */
  const STEP_GOAL_OPTIONS = [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 20000];
  const [stepGoalOverride, setStepGoalOverride] = useState<number | null>(null);
  const stepGoal = stepGoalOverride ?? data?.stepGoal ?? 8000;

  /* 近 7 天的体重 —— 首页那张趋势卡和「体重」那一行都从这里取。
     拉失败就当没有:它不该把整页变成「数据暂未更新」,因为主数据(汇总)其实是好的 */
  const trend = useAsync(() => trendsApi.getTrends(7).catch(() => null), []);
  const weights = trend.data?.weights ?? [];
  const currentWeight = trend.data?.stats.currentWeight ?? null;
  const weightChange = trend.data?.stats.weightChange ?? null;
  const intakeTarget = trend.data?.macroTarget?.calories ?? null;
  /** 正在看的那一天称了多少 —— 翻到过去时看那天的记录,今天看最新一条 */
  const dayWeight = weights.find((w) => w.date === viewDate)?.weightKg
    ?? (isToday ? currentWeight : null);

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
    track('daily_ai_regen', 'home');
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
    void trend.refresh();
  });
  // config 已开启 enablePullDownRefresh:下拉手势刷新当日数据
  usePullDownRefresh(async () => {
    await Promise.all([refresh(), trend.refresh()]);
    Taro.stopPullDownRefresh();
  });

  const go = (path: RoutePath) => TAB_PAGES.includes(path)
    ? switchTab(`/${path}`) : navigate(`/${path}`);
  /* 拉失败时 data 是 null,而**「没有数据」和「没拉到数据」在文案上是两句话**。
     以前两者共用同一个分支,于是屏幕上一边说「数据暂未更新」,一边说「今天还没有能量记录」
     「去连数据源」—— 后者是在指控用户没记东西,而他可能刚记完。 */
  const failed = Boolean(error) && !loading;

  const hasScore = data?.bodyScore != null;
  /**
   * 没分不一定是「没记录」—— 身高/体重/出生日期缺一项,记了也不会有分。
   * 以前两种空态共用一句「记录饮食、运动后可查看」,对没填资料的人是句错话:
   * 他照做了,这里还是空。现在服务端把缺项一起返回,这里直接把人送去补。
   */
  const profileIncomplete = !failed && data?.profileReady === false;
  const missingProfile = data?.missingProfile ?? [];
  const missingProfileText = missingProfile.length
    ? missingProfile.map((field) => PROFILE_FIELD_LABEL[field]).join('、')
    : '身体资料';
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
  /** 消耗为空且是资料没填全 —— 这一句既是解释,也是入口 */
  const burnNeedsProfile = profileIncomplete && data?.burnCalories == null;
  const burnNote = burnNeedsProfile
    ? `补全${missingProfileText}后，自动算出基础代谢和总消耗`
    : burnParts;
  /** 空态(读了、但今天什么都没有)—— 只有这时那句提示才是一个入口 */
  const noEnergy = !!data && !failed && !data.intakeCalories;

  /* ---- 今日概览:身体评分 + 能量,合成一张卡 ---- */
  const hasEnergy = !!data && !failed && ((data.intakeCalories ?? 0) > 0 || data.burnCalories != null || data.netCalories != null);
  const intakeText = hasEnergy ? format(data?.intakeCalories) : '—';
  const burnText = hasEnergy && data?.burnCalories != null ? format(data.burnCalories) : '—';
  const netText = hasEnergy && data?.netCalories != null
    ? `${(data.netCalories ?? 0) > 0 ? '+' : ''}${format(data.netCalories)}`
    : '—';
  /* 摄入的进度优先对「今日热量目标」;目标没算出来时才退回消耗,别让进度条空着 */
  const intakeBase = intakeTarget ?? data?.burnCalories ?? 0;
  const intakePct = hasEnergy && intakeBase > 0
    ? Math.min(100, Math.max(0, ((data?.intakeCalories ?? 0) / intakeBase) * 100))
    : 0;
  /* 消耗的进度对 TDEE(基础代谢 × 活动系数) —— 这就是「今天该消耗多少」 */
  const burnBase = data?.tdee ?? 0;
  const burnPct = data?.burnCalories != null
    ? (burnBase > 0 ? Math.min(100, Math.max(0, (data.burnCalories / burnBase) * 100)) : 100)
    : 0;
  /* 环心的百分数要如实:弧封顶在一圈,数字超了就写真数(112%)。
     只在摄入侧把超出的数字标黄 —— 消耗超过 TDEE 是好事,不该长一张警示的脸 */
  const intakePctLabel = hasEnergy && intakeBase > 0
    ? Math.round(((data?.intakeCalories ?? 0) / intakeBase) * 100)
    : 0;
  const burnPctLabel = data?.burnCalories != null && burnBase > 0
    ? Math.round((data.burnCalories / burnBase) * 100)
    : 0;
  const scoreNote = failed
    ? '数据暂未更新，下拉可重试'
    : profileIncomplete
      ? `补全${missingProfileText}后，自动算出消耗和身体评分 ›`
      : !hasScore ? '记录饮食、运动后可查看身体评估' : '';

  /* ---- 今日习惯打卡 ----
     五个格子都从当天已有的数据里读,不额外问用户任何事。练没练只认小抄里
     「done」那一档 —— 「今天该练」不代表练了。 */
  const trainDone = isToday ? digest?.state === 'done' : dots[viewDate] === 'done';
  const habits: {
    key: string; icon: string; title: string; desc: string; done: boolean;
  }[] = [
    { key: 'food', icon: foodIcon, title: '饮食记录', desc: '记录今天吃了什么', done: (data?.intakeCalories ?? 0) > 0 },
    {
      key: 'move', icon: runIcon, title: '运动记录', desc: '完成今日运动 · 走够步数',
      done: (data?.steps ?? 0) > 0 || (data?.activeCalories ?? 0) > 0 || (data?.exerciseCalories ?? 0) > 0
    },
    /* 前三项就是设计稿里露出来的那三行(吃 / 动 / 称),力量训练和饮水收在「展开」里。
       顺序是内容的一部分,别按 key 的字母排 */
    { key: 'weight', icon: scaleIcon, title: '体重记录', desc: '早起称重 · 记录变化', done: weights.some((w) => w.date === viewDate) },
    { key: 'train', icon: dumbbellIcon, title: '力量训练', desc: '按计划完成一次训练', done: trainDone },
    { key: 'water', icon: dropIcon, title: '饮水打卡', desc: '给身体补点水', done: (data?.waterMl ?? 0) > 0 }
  ];
  const [habitOpen, setHabitOpen] = useState(false);
  /* 默认只露三行:五行全铺出来会把这张卡撑成半屏,而设计稿里它是一张轻卡 */
  const shownHabits = habitOpen ? habits : habits.slice(0, 3);
  const habitDoneCount = habits.filter((h) => h.done).length;
  /** 环里写的是「今日完成」—— 五件小事做了几件,不是身体评分。和下面那张打卡卡同一份数,不另算一套 */
  const completionPct = Math.round((habitDoneCount / habits.length) * 100);
  const openHabit = (key: string) => {
    if (key === 'food') return go(RoutePath.Food);
    if (key === 'move') return go(RoutePath.Exercise);
    if (key === 'train') return go(RoutePath.Training);
    if (key === 'weight') return navigate('/pages/weight/index');
    return go(RoutePath.Record);
  };

  const weightPoints = weights.map((w) => ({ label: w.date.slice(5), value: w.weightKg }));
  const weightDelta = weightChange == null || Math.abs(weightChange) < 0.05 ? null : weightChange;
  /**
   * 完成度环的两个端帽。conic-gradient 的弧是「一刀切」的平头,
   * 环上再放两枚小圆点,弧尾才是圆的(参考稿那个环就是圆头)。
   * 圆点在 112px 的环上走半径 51.5px —— 换成百分比就是 46%。
   */
  const ringDeg = loading || failed ? 0 : completionPct * 3.6;
  const ringRad = ((ringDeg - 90) * Math.PI) / 180;
  const ringCap = {
    left: `${50 + Math.cos(ringRad) * 46}%`,
    top: `${50 + Math.sin(ringRad) * 46}%`
  };

  const switchDate = (d: string) => {
    if (d === viewDate) return;
    track('home_date_switch', 'home', { to: d });
    setViewDate(d);
  };

  return (
    <View className="home-page">
      <View className="home-header" style={{ paddingTop: STATUS_BAR + 8 }}>
        {/* 页头的那幅山水:只做背景,不参与点击;文字压在它上面 */}
        <Image className="home-hero-bg" src={heroBg} mode="widthFix" />
        <View className="home-header-copy">
          {/* 品牌两行 —— 设计稿里它在原生的位置上是左对齐的,所以这一页用了自定义导航。
              右边那块胶囊是微信自己的,页面不往那儿摆东西 */}
          <View className="home-brand-row">
            <Text className="home-brand">轻身记</Text>
            <Text className="home-tagline">记录每一次变好的自己</Text>
          </View>
          <View className="home-eyebrow-row">
            <Text className="home-eyebrow">
              {isToday ? `${formatDate(viewDate)} ${weekday(viewDate)}` : `回看 · ${formatDate(viewDate)} ${weekday(viewDate)}`}
            </Text>
            <Text className="home-greeting">{isToday ? greeting() : '历史记录'}</Text>
          </View>
          <Text className="home-title">{isToday ? '今天，慢慢来。' : formatDate(viewDate)}</Text>
          <Text className="home-subtitle">{isToday ? '健康不是一蹴而就，而是日积月累。' : '那天的记录与身体状态'}</Text>
        </View>
      </View>

      {/* 日期条:今天(可展开日历) + 本周七日切换,绿色为选中 */}
      <View className="date-strip">
        {isToday ? (
          <Picker mode="date" end={today} value={today} onChange={(e) => switchDate(String(e.detail.value))}>
            <View className="strip-today"><Text className="strip-today__text">今天</Text><Text className="strip-caret">▾</Text></View>
          </Picker>
        ) : (
          <View className="strip-today is-back" onClick={() => switchDate(today)}><Text className="strip-today__text">回今天</Text></View>
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
            <View className="live-icon-wrap"><Image className="live-icon" src={timerIcon} mode="aspectFit" /></View>
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

      {/* 今日概览 —— 参照设计稿:左边一个完成环,右边三行读数。
          摄入/消耗两行的进度从横条换成了右端的小环(收支各一枚,和大环同一手艺),
          第三行是体重。净值收进底下那行小字,不再单独占一行。 */}
      <View className="dashboard-card overview-card">
        <View className="overview-main">
          <View
            className="overview-ring"
            style={{ '--score': `${ringDeg}deg` } as React.CSSProperties}
            onClick={() => go(RoutePath.Trends)}
          >
            <View className="overview-ring__inner">
              <Text className="overview-score">{loading || failed ? '—' : `${completionPct}%`}</Text>
              <Text className="overview-score-label">{loading ? '读取中' : failed ? '未读取' : '今日完成'}</Text>
            </View>
            {/* 两枚端帽:起点固定在 12 点,终点跟着进度走。0% 时一个都不画 ——
                一颗孤零零的起点会被读成「已经有进度了」 */}
            {ringDeg > 0 && (
              <>
                <View className="overview-ring__cap is-start" />
                <View className="overview-ring__cap" style={ringCap} />
              </>
            )}
          </View>

          <View className="overview-metrics">
            <View className="ov-row" onClick={() => go(RoutePath.Food)}>
              <View className="ov-row__main">
                <Text className="ov-label">摄入热量</Text>
                <View className="ov-value">
                  <Text className={`ov-value__num${intakeText === '—' ? ' is-empty' : ''}`}>{intakeText}</Text>
                  <Text className="ov-value__unit">{intakeTarget ? `/ ${format(intakeTarget)} kcal` : 'kcal'}</Text>
                </View>
              </View>
              <View
                className={`ov-ring${hasEnergy && intakeBase > 0 ? '' : ' is-empty'}`}
                style={{ '--score': `${Math.round(intakePct) * 3.6}deg` } as React.CSSProperties}
              >
                <View className="ov-ring__inner">
                  <Text className={`ov-ring__pct${intakePctLabel > 100 ? ' is-over' : ''}`}>
                    {hasEnergy && intakeBase > 0 ? `${intakePctLabel}%` : '—'}
                  </Text>
                </View>
              </View>
            </View>

            <View className="ov-row" onClick={() => (burnNeedsProfile ? openBodyEditor() : go(RoutePath.Exercise))}>
              <View className="ov-row__main">
                <Text className="ov-label">消耗热量</Text>
                <View className="ov-value">
                  <Text className={`ov-value__num${burnText === '—' ? ' is-empty' : ''}`}>{burnText}</Text>
                  <Text className="ov-value__unit">kcal</Text>
                </View>
              </View>
              <View
                className={`ov-ring is-burn${data?.burnCalories != null && burnBase > 0 ? '' : ' is-empty'}`}
                style={{ '--score': `${Math.round(burnPct) * 3.6}deg` } as React.CSSProperties}
              >
                <View className="ov-ring__inner">
                  <Text className="ov-ring__pct">
                    {data?.burnCalories != null && burnBase > 0 ? `${burnPctLabel}%` : '—'}
                  </Text>
                </View>
              </View>
            </View>

            <View className="ov-row is-static" onClick={() => navigate('/pages/weight/index')}>
              <View className="ov-row__main">
                <Text className="ov-label">体重</Text>
                <View className="ov-value">
                  <Text className={`ov-value__num${dayWeight == null ? ' is-empty' : ''}`}>
                    {dayWeight == null ? '—' : dayWeight.toFixed(1)}
                  </Text>
                  <Text className="ov-value__unit">kg</Text>
                  {weightDelta != null && (
                    <Text className={`ov-delta ${weightDelta > 0 ? 'is-up' : 'is-down'}`}>
                      {weightDelta > 0 ? '↑' : '↓'}{Math.abs(weightDelta).toFixed(1)}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        </View>

        {!!scoreNote && (
          <Text
            className={`overview-note${profileIncomplete ? ' is-action' : ''}`}
            onClick={onIf(profileIncomplete, openBodyEditor)}
          >{scoreNote}</Text>
        )}
        {hasEnergy && netText !== '—' ? (
          <Text className="overview-net">
            热量净值 <Text className={`overview-net__v${(data?.netCalories ?? 0) > 0 ? ' is-pos' : ''}`}>{netText}</Text> kcal
            {burnParts ? ` · ${burnParts}` : ''}
          </Text>
        ) : (
          !!burnNote && !profileIncomplete && <Text className="overview-note">{burnNote}</Text>
        )}
        {noEnergy && !failed && (
          <Text className="overview-note is-action" onClick={() => go(RoutePath.Record)}>
            {dayLabel}还没有能量记录，点击去记一笔 ›
          </Text>
        )}
        {/* 每日分享卡的入口:这张卡晒的就是上面的数,从这儿进最顺。
            只有「正在看今天」时才给 —— 卡上印的是今天的成绩单,回看别的日子进去对不上 */}
        {isToday && (
          <View className="overview-share" onClick={() => navigate('/pkg-exercise/daily-share/index')}>
            <Text className="overview-share__text">把今天做成分享卡 ›</Text>
          </View>
        )}
      </View>

      {/* 今日习惯打卡 —— 设计稿里第二张卡。做的事全是用户当天已经做过的,
          这里只负责把「做了几件」摆出来,点一行就进对应那一页。 */}
      <View className="dashboard-card habit-card">
        <View className="habit-head">
          <Text className="section-title">{isToday ? '今日习惯打卡' : '当日习惯打卡'}</Text>
          <Text className="habit-count">{habitDoneCount}/{habits.length}</Text>
        </View>
        <View className="habit-list">
          {shownHabits.map((h) => (
            <View key={h.key} className={`habit-row${h.done ? ' is-done' : ''}`} onClick={() => openHabit(h.key)}>
              <View className="habit-icon"><Image className="habit-icon__img" src={h.icon} mode="aspectFit" /></View>
              <View className="habit-copy">
                <Text className="habit-title">{h.title}</Text>
                <Text className="habit-desc">{h.desc}</Text>
              </View>
              <View className={`habit-check${h.done ? ' is-on' : ''}`}>
                {h.done && <Text className="habit-check-mark">✓</Text>}
              </View>
            </View>
          ))}
        </View>
        {habits.length > 3 && (
          <Text className="habit-more" onClick={() => setHabitOpen((open) => !open)}>
            {habitOpen ? '收起' : `展开其余 ${habits.length - 3} 项`}
            <Text className={`habit-more__caret${habitOpen ? ' is-open' : ''}`}>▾</Text>
          </Text>
        )}
      </View>

      {/* 体重趋势 —— 设计稿里第三张卡。图是可点选读数的同一套 LineChart,
          标题右边直接给最新体重和近 7 天的变化。 */}
      <View className="dashboard-card weight-card">
        <View className="weight-head">
          <View className="weight-head__copy">
            <Text className="section-title">体重趋势</Text>
            <Text className="weight-range">近7天</Text>
          </View>
          <Text className="weight-more" onClick={() => go(RoutePath.Trends)}>查看详情 ›</Text>
        </View>
        {/* 有图 / 没图是同一个容器:同位置摆两个分支时,两边的 onClick 必须都在
            (Taro 的事件属性位置不一致会点废整棵子树,见 utils/taro-events)。
            所以事件永远绑着,用 `onIf` 在没有数据时才生效 */}
        <View
          className={weightPoints.length ? 'weight-body' : 'weight-empty'}
          onClick={onIf(!weightPoints.length, () => navigate('/pages/weight/index'))}
        >
          {trend.loading && !weightPoints.length ? (
            <Text className="weight-loading">正在读取体重…</Text>
          ) : weightPoints.length ? (
            <>
              {/* 最新体重不另起一行大数字,让曲线自己把它标在末点上 ——
                  设计稿里这张卡的主角是「在往下走」这条线,不是一个孤零零的数 */}
              <LineChart
                canvasId="home-weight-chart"
                points={weightPoints}
                height={140}
                color={themedColor(THEME.primary)}
                unit="kg"
                endBadge
                hint={false}
              />
            </>
          ) : (
            <>
              <View className="weight-empty__icon-wrap">
                <Image className="weight-empty__icon" src={scaleIcon} mode="aspectFit" />
              </View>
              <View className="weight-empty__copy">
                <Text className="weight-empty__title">还没有体重记录</Text>
                <Text className="weight-empty__hint">称一次，趋势就从今天开始 ›</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* 今天练什么 —— 设计稿把它放在最后,做成一张「计划入口」行卡。
          这里保留原有的一套状态文案,只把长相换成:图标 + 标题/副标题 + 箭头。 */}
      {isToday ? (
        <View className={`dashboard-card train-card${STATE_TONE[digest?.state ?? 'todo']}`} onClick={() => openTraining(train.href)}>
          <View className="train-head">
            <View className="train-icon-wrap"><TrainStateIcon state={digest?.state ?? 'todo'} size={26} /></View>
            <View className="train-copy">
              <Text className="train-title">{train.title}</Text>
              <Text className="train-sub">{train.sub}</Text>
            </View>
            <Text className="train-arrow">›</Text>
          </View>
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
        <View className={`dashboard-card train-card${past.tone}`} onClick={() => openTraining(TRAINING_LOGS_URL)}>
          <View className="train-head">
            <View className="train-icon-wrap"><TrainStateIcon state={past.icon} size={26} /></View>
            <View className="train-copy">
              <Text className="train-title">{past.title}</Text>
              <Text className="train-sub">{past.sub}</Text>
            </View>
            <Text className="train-arrow">›</Text>
          </View>
        </View>
      ) : null}

      <View className="dashboard-card activity-card" onClick={() => go(RoutePath.Exercise)}>
        <Heading title={`${dayLabel}活动`} />
        <View className="activity-stats">
          <View><Text className={`activity-value${data?.steps == null ? ' is-empty' : ''}`}>{format(data?.steps)}</Text><Text className="activity-unit">步</Text></View>
          <View><Text className={`activity-value${data?.activeCalories == null ? ' is-empty' : ''}`}>{format(data?.activeCalories)}</Text><Text className="activity-unit">kcal</Text></View>
        </View>
        {data?.steps != null && (
          <View className="steps-progress">
            <View className="steps-progress__track"><View className="steps-progress__fill" style={{ width: `${Math.min(100, Math.round(((data.steps ?? 0) / Math.max(stepGoal, 1)) * 100))}%` }} /></View>
            {/* 目标自己定:点这行数字就能改。整卡点击进运动页,所以这里先拦住冒泡 */}
            <Picker
              mode="selector"
              range={STEP_GOAL_OPTIONS.map((v) => `${format(v)} 步`)}
              value={STEP_GOAL_OPTIONS.indexOf(stepGoal) >= 0 ? STEP_GOAL_OPTIONS.indexOf(stepGoal) : 6}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = STEP_GOAL_OPTIONS[Number(e.detail.value)] ?? stepGoal;
                if (next === stepGoal) return;
                userApi.updateProfile({ stepGoal: next })
                  .then(() => { setStepGoalOverride(next); track('home_step_goal_change', 'home', { goal: next }); })
                  .catch(() => toast('没能保存,请重试', 'error'));
              }}
            >
              <Text className="steps-progress__label">{format(data.steps)} / {format(stepGoal)} 步 · 点我改</Text>
            </Picker>
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
          <View className={`insight-chevron${insightOpen ? ' is-open' : ''}`}><ArrowDown size={16} color="#8a958f" /></View>
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
  return <View className="card-heading"><Text>{title}</Text><ArrowRight size={14} color="#8a958f" /></View>;
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
