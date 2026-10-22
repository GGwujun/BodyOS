import { View, Text, Button, Image } from '@tarojs/components';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import { switchTab } from '@/utils/nav';
/* 图标**直接复用 tabBar 那五张 PNG**,不再用图标字体画一套。
   原先这里挂的是 taroify 的线性图标(HomeOutlined/BarChartOutlined/…),而原生 tabBar
   那五张是实心的 —— 于是同一条底栏在「tab 页」和「非 tab 页」上是两种画风;中间那一格
   更明显:这边是绿圆底 + 准星(Aim),那边是一个哑铃。同一个位置两个长相,用户会以为是
   两个不同的东西。用同一份资源是唯一能保证两处**永远一致**的写法。 */
import homeIcon from '@/assets/tabbar/home.png';
import homeActive from '@/assets/tabbar/home-active.png';
import homeActiveDark from '@/assets/tabbar/home-active-dark.png';
import recordIcon from '@/assets/tabbar/record.png';
import recordActive from '@/assets/tabbar/record-active.png';
import recordActiveDark from '@/assets/tabbar/record-active-dark.png';
import trainIcon from '@/assets/tabbar/train.png';
import trainActive from '@/assets/tabbar/train-active.png';
import trainActiveDark from '@/assets/tabbar/train-active-dark.png';
import trendsIcon from '@/assets/tabbar/trends.png';
import trendsActive from '@/assets/tabbar/trends-active.png';
import trendsActiveDark from '@/assets/tabbar/trends-active-dark.png';
import profileIcon from '@/assets/tabbar/profile.png';
import profileActive from '@/assets/tabbar/profile-active.png';
import profileActiveDark from '@/assets/tabbar/profile-active-dark.png';
import { confirmLeave } from '@/utils/leave-guard';
import { currentPagePath } from '@/utils/page-path';
import { currentTheme } from '@/utils/theme';
import './PageNavigation.scss';

/** Secondary screens share the design's persistent navigation; root tabs remain native. */
export default function PageNavigation({page}: {page: string}) {
  // 判定「这一页是不是 tab 页」用的是**真实注册路径**(见 utils/page-path):
  // 以前靠 className 反推,`pages/quick-record/index` 反推成 `pages/quick/index` 没匹配上,
  // 于是速记页同时长了原生 tabBar 和这条浮动导航 —— 底下两排一模一样的图标。
  const current = currentPagePath(page);
  if (TAB_PAGES.includes(current as RoutePath) || current === 'pages/onboarding/index') return null;
  /* 训练分包里的每一页都算「训练」那一格 —— 和食物几页算「记录」是同一条规矩:
     用户在哪一摊事里,底栏就该亮哪一格。 */
  const inTraining = current.startsWith('pkg-exercise/');
  const active = current === RoutePath.WeeklyReport ? RoutePath.Trends
    : current === RoutePath.Food || current === RoutePath.Exercise
      || current === 'pages/food-tools/index' || current === 'pages/food-rank/index' || current === 'pages/ingredient/index' ? RoutePath.Record
    : inTraining ? RoutePath.Training
    : current === RoutePath.DataSources || current === 'pages/assessment/index' ? RoutePath.Profile : null;
  const items = [
    {path:RoutePath.Home,label:'首页',icon:homeIcon,iconActive:homeActive,iconActiveDark:homeActiveDark},
    {path:RoutePath.Record,label:'记录',icon:recordIcon,iconActive:recordActive,iconActiveDark:recordActiveDark},
    /* 正中间那一格照着 tabBar 来(训练)。以前它是「记一笔」→ 速记页,而速记
       现在已经不是 tab 了 —— 一个不在底栏里的页面占着底栏正中间,点下去还会
       落到一个底栏上不存在的页面,用户找不到回来的路。四格 + 中间那一格
       必须和原生 tabBar **逐格对得上**,这一条没有例外:图标是同一张 PNG、
       也不给它单独的造型(以前是绿圆底、还不带字,而原生那边是普通一格)。
       小程序的原生 tabBar 做不出「凸起一个圆」,所以能对齐的方向是这一边。 */
    {path:RoutePath.Training,label:'训练',icon:trainIcon,iconActive:trainActive,iconActiveDark:trainActiveDark},
    {path:RoutePath.Trends,label:'趋势',icon:trendsIcon,iconActive:trendsActive,iconActiveDark:trendsActiveDark},
    {path:RoutePath.Profile,label:'我的',icon:profileIcon,iconActive:profileActive,iconActiveDark:profileActiveDark}
  ];
  /**
   * 底栏走的是 `switchTab`,而它的语义是**关掉所有非 tabBar 页面** —— 正在训练、
   * 表单填了一半的时候点一下它就等于无声丢弃(见 utils/leave-guard)。
   * 所以点下去先问一句页面上还有没有没落盘的东西,页面同意(或者压根没有)才切。
   */
  const go = async (target: string) => {
    if (!(await confirmLeave())) return;
    switchTab(`/${target}`);
  };
  return <View className="page-navigation" role="navigation" aria-label="底部导航">
    {items.map(({path:target,label,icon,iconActive,iconActiveDark}) => <Button key={label}
      className={`page-navigation__item${active === target ? ' is-active' : ''}`}
      aria-label={label}
      {...{role:'button'}}
      onClick={() => { void go(target); }}>
      {/* 选中态换的是**另一张图**(和原生 tabBar 用 selectedIconPath 是同一套做法),
          不是给同一张图染色 —— 灰色的图染不成绿色那个色号。
          深色模式再换一张:浅色的森林绿在深色底上发黑,渲染时按系统主题挑 */}
      <Image className="page-navigation__icon" src={active === target
        ? (currentTheme() === 'dark' ? iconActiveDark : iconActive)
        : icon} />
      <Text className="page-navigation__label">{label}</Text>
    </Button>)}
  </View>;
}
