import { useState } from 'react';
import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { addDays, mondayOf, todayStr } from '@/utils/date';
import { navigate } from '@/utils/nav';
import planIcon from '@/assets/icons/plan.png';
import logIcon from '@/assets/icons/log.png';
import statsIcon from '@/assets/icons/stats.png';
import compassIcon from '@/assets/icons/compass.png';
import timerIcon from '@/assets/icons/timer.png';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import heroBg from '@/assets/training-hero.png';
import quoteBg from '@/assets/quote-bg.png';
import {
  STATE_TONE, TRAINING_LOGS_URL, TRAINING_PLAN_URL, digestView,
  loadTrainingDigest, weekDotMap, type TrainingDigest, type WeekState
} from '@/utils/training-digest';
import { loadTrainingProgress, progressView, type TrainingProgress } from '@/utils/training-progress';
import { clearDraft, draftAlreadyDone, draftBrief, loadDraft, type WorkoutDraft } from '@/utils/workout-draft';
import './index.scss';

/**
 * 训练 —— tabBar 正中间那一格,也是训练这摊事在主包唯一的落脚点。
 *
 * ## 为什么中间这一格要给训练
 * 训练是这一版里唯一有**整套流程**的东西(计划 → 开练 → 逐组记 → 渐进),可它原先
 * 只能从首页一张卡进,连自己的落脚点都没有;而中间那一格记的是喝水/体重 —— 两件
 * 一下记完、记完就完的事。按「谁需要被反复回来」排,中间该是训练。
 *
 * ## 它不练,它把人送进分包
 * 真正的训练页(`pkg-exercise/workout`)在**分包**里,而小程序的规矩是 tabBar 页
 * 必须落在主包。所以这一页是**开练台**:今天该练什么、要练的那几个动作叫什么、
 * 一个「开始练」的按钮 —— 按下去才进分包。
 *
 * ## 数据从哪来
 * 主包**引不到**分包的 engine(引了就等于把 1.6MB 的分包整坨搬进主包),
 * 所以这一页读的是分包算完留下的两张小抄:`utils/training-digest`(今天)
 * 和 `utils/training-progress`(攒下来的)。两张都是「读不到就说一句不会错的话」,
 * 见各自的文件头。
 *
 * ## 和首页那张卡的关系
 * 话是**同一套**(`digestView`)—— 同一个状态在两个地方说成两句不同的话,用户会
 * 以为是两件事。差别在**别的**:那张卡只有一行字,摆不下今天的动作表,而「今天
 * 要练的六个动作叫什么」恰恰是决定要不要现在开练的那点信息。
 */

/** 周条上那七格的标 —— 周一起头(和 `mondayOf` 一个口径) */
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const DOT_TONE: Record<WeekState, string> = { done: 'is-done', off: 'is-off', moved: 'is-moved' };

/** 页尾那几格 —— 训练这摊事里除了「开练」之外最常去的地方 */
const LINKS: { name: string; desc: string; url: string; icon: string }[] = [
  { name: '训练计划', desc: '这套怎么排的 · 改动作改组次', url: TRAINING_PLAN_URL, icon: planIcon },
  { name: '训练记录', desc: '练过的每一次 · 请假的日子', url: TRAINING_LOGS_URL, icon: logIcon },
  { name: '训练统计', desc: '打卡热力 · 纪录 · 力量曲线', url: '/pkg-exercise/stats/index', icon: statsIcon },
  { name: '动作库', desc: '按部位 / 器械挑动作', url: '/pkg-exercise/library/index', icon: compassIcon }
];

export default function Training() {
  const today = todayStr();
  const [digest, setDigest] = useState<TrainingDigest | null>(null);
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [prog, setProg] = useState<TrainingProgress | null>(null);

  /**
   * 每次落到这一页都重读。**必须用 useDidShow 而不是 useEffect**:从训练页退回来、
   * 从计划页改完回来,那份小抄已经改过口了,而这一页并没有被卸载 ——
   * 只挂载时读一次的话,练完回来这儿还写着「今天练「推日」」。
   */
  useDidShow(() => {
    track('training_tab_view', 'other');
    const dg = loadTrainingDigest();
    setDigest(dg);
    // 与首页同一条对账:旧版本练完关汇总时会把草稿写回来(见 utils/workout-draft.ts),
    // 不清掉的话这一页也会一边写「今天练完了」、一边摆「还没练完」。
    const d = loadDraft();
    if (d && draftAlreadyDone(d, dg)) {
      clearDraft();
      setDraft(null);
    } else {
      setDraft(d);
    }
    setProg(loadTrainingProgress());
  });

  const state = digest?.state ?? 'todo';
  const view = digestView(digest);
  const brief = draftBrief(draft);
  /** 动作表只在「今天要练」和「今天练过了」两种状态下摆 —— 请假那天摆出来是在催他 */
  const items = digest && (digest.state === 'todo' || digest.state === 'done') ? digest.items : [];

  // 本周七格:记号是小抄上留下的(练过/请假/改练),没有记号的就是普通一天 ——
  // 轮转制算不出「下周三该练什么」,所以不编(见 training-digest 的 WeekDot)
  const dots = weekDotMap(digest);
  const mon = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const weekDone = week.filter((d) => dots[d] === 'done').length;
  const cumulative = prog ? progressView(prog, 7, today).total : '';

  const resume = () => {
    track('training_tab_resume', 'other', { sets: brief?.sets ?? 0 });
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
    clearDraft();
    setDraft(null);
  };

  return (
    <Screen className="training-page">
      {/* 上次那场没练完 —— 系统回收、从小程序列表里划掉,那两条路都没有页面回调,
          唯一留下痕迹的就是训练页每组写下的草稿(见 utils/workout-draft.ts)。
          摆在「今天练什么」上面:已经付出过的一组一组先收尾,再谈今天该练什么 */}
      {brief && (
        <View className="card tr-live" onClick={resume}>
          <View className="tr-live-main">
            <View className="tr-live-icon-wrap"><Image className="tr-live-icon" src={timerIcon} mode="aspectFit" /></View>
            <View className="tr-live-copy">
              <Text className="tr-live-title">{brief.title || '上次那场'}还没练完</Text>
              <Text className="fs-mini text-secondary">
                {brief.date === today ? '今天' : fmtDay(brief.date)}开始 · 已练 {brief.sets}/{brief.total} 组
              </Text>
            </View>
          </View>
          <View className="tr-live-foot">
            <Text className="tr-live-go">接着练 ›</Text>
            {/* 「放弃」要吃下这次点击,不然顺手就把训练页打开了 */}
            <Text className="tr-live-drop" onClick={(e) => { e.stopPropagation(); void dropDraft(); }}>放弃</Text>
          </View>
        </View>
      )}

      {/* 今天这一套 —— 这一页的主角。话说的是 digestView 那一套(和首页同一份),
          下面那张动作表是这一页多出来的东西:首页那张卡摆不下它 */}
      <View className={`card tr-hero${STATE_TONE[state]}`}>
        {/* 页头的叶子:只做背景。设计稿里它从右侧探进来,让这块渐变不是一张纯色卡 */}
        <Image className="tr-hero-bg" src={heroBg} mode="widthFix" />
        <View className="tr-hero-head">
          <View className="tr-hero-icon"><Image className="tr-hero-icon__img" src={dumbbellIcon} mode="aspectFit" /></View>
          <View className="tr-hero-copy">
            <Text className="tr-hero-title">力量训练</Text>
            <Text className="tr-hero-sub">
              {[digest?.title, view.sub].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* 动作名压成一行 —— 首页那张卡摆不下,这一页给一句就够;详细的组次开练以后看 */}
        {items.length > 0 && (
          <Text className="tr-hero-items">
            {items.slice(0, 3).join(' · ')}{items.length > 3 ? ` 等 ${items.length} 个动作` : ''}
          </Text>
        )}

        <Button className="btn btn--primary btn--block tr-go" onClick={() => navigate(view.href)}>
          {view.action} →
        </Button>

        {/* 今天该练、但今天练不了 —— 和首页那两条是同一件事、同一条路:
            记请假/改练那套在分包里(主包引不到 engine),所以把人送到计划页再走一遍。
            **门开在 `digest.state` 上,不是上面那个兜底的 `state`**:小抄没读到的时候
            我们并不知道今天该不该练,摆一条「今天不练」等于替他认定了 —— 首页
            (`digest?.state === 'todo'`)也是这么开的,两处得是同一个门 */}
        {digest?.state === 'todo' && (
          <View className="tr-ops">
            <Text
              className="tr-op"
              onClick={(e) => { e.stopPropagation(); track('training_tab_switch', 'other'); navigate(`${TRAINING_PLAN_URL}?switch=1`); }}
            >
              今天改练 ›
            </Text>
            <Text
              className="tr-op"
              onClick={(e) => { e.stopPropagation(); track('training_tab_off', 'other'); navigate(`${TRAINING_PLAN_URL}?off=1`); }}
            >
              今天不练 ›
            </Text>
          </View>
        )}
      </View>

      {/* 这周 —— 只有「有说头」的几天有记号,练过=绿、请假=灰、改练=另一种。
          未来那几格不画:轮转制下「下周三练什么」取决于你接下来练不练,算不出来 */}
      <View className="card tr-week">
        <View className="tr-week-head">
          <Text className="tr-week-title">本周运动</Text>
          <Text className="tr-week-meta">
            {weekDone > 0 ? `练了 ${weekDone} 天` : '还没开张'}
          </Text>
        </View>
        <View className="tr-week-row">
          {week.map((d, i) => {
            const mark = dots[d];
            return (
              <View className={`tr-day${d === today ? ' is-today' : ''}`} key={d}>
                <Text className="tr-day-label">{WEEK_LABELS[i]}</Text>
                {/* 今天还没留下记号时画一个空心圈(设计稿里那一枚) ——
                    它标的是「你在这儿」,不是「你练了」,所以不能和练过的实心点同形 */}
                <View className={`tr-day-dot${mark ? ' ' + DOT_TONE[mark] : ''}${d === today && !mark ? ' is-today-ring' : ''}`} />
              </View>
            );
          })}
        </View>
        {/* 攒下来的那些数 —— 分包每次进训练区会刷新这张小抄,没有就是还没到过训练区 */}
        {!!cumulative && <Text className="fs-mini text-secondary tr-week-total">{cumulative}</Text>}
      </View>

      {/* 页尾入口 —— 只留最常去的四个。整份工具(九格)在计划页页脚,
          那儿是这摊事的目录;这一页是开练台,摆多了又变成一屏目录 */}
      <View className="card tr-links">
        {LINKS.map((l) => (
          <View className="tr-link" key={l.url} onClick={() => navigate(l.url)}>
            <View className="tr-link-icon"><Image className="tr-link-icon__img" src={l.icon} mode="aspectFit" /></View>
            <View className="tr-link-copy">
              <Text className="tr-link-name">{l.name}</Text>
              <Text className="tr-link-desc">{l.desc}</Text>
            </View>
            <Text className="tr-link-arrow">›</Text>
          </View>
        ))}
      </View>

      {/* 页脚的一句 —— 训练页是「准备开练」的地方,留一句轻的比再摆一张卡好。
          淡绿底上一幅小景,和首页同一套山水语言 */}
      <View className="tr-quote-card">
        <Image className="tr-quote-bg" src={quoteBg} mode="widthFix" />
        <View className="tr-quote">
          <Text className="tr-quote__title">真正的改变</Text>
          <Text className="tr-quote__sub">始于坚持的每一次训练。</Text>
        </View>
      </View>
    </Screen>
  );
}

/** 「10月13日」—— 草稿卡上用,只给不是今天的那种 */
function fmtDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m} 月 ${d} 日`;
}
