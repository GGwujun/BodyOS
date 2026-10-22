/**
 * 路由常量 — 对应 docs/01 的 9 个核心页面
 */
export enum RoutePath {
  Home = 'pages/home/index',
  Record = 'pages/record/index',
  QuickRecord = 'pages/quick-record/index',
  Food = 'pages/food/index',
  Exercise = 'pages/exercise/index',
  Trends = 'pages/trends/index',
  WeeklyReport = 'pages/weekly-report/index',
  DataSources = 'pages/data-sources/index',
  Profile = 'pages/profile/index',
  Recipes = 'pages/recipes/index',
  Measure = 'pages/measure/index',
  /**
   * 训练 — tabBar 正中间那一格。
   *
   * 训练真正的正文在**分包**里(pkg-exercise 的动作库/计划/训练页),而小程序的规矩是
   * tabBar 页必须落在主包。所以这一页是**开练台**:它不练,只把今天该练的那一套摆出来,
   * 按下去进分包的训练页。开练台要的数据全在主包有两张小抄(digest / progress),
   * 见 utils/training-digest.ts 的文件头。
   */
  Training = 'pages/training/index',
  Feedback = 'pages/feedback/index'
}

/** TabBar 页面(底部导航) — 与 app.config.ts tabBar.list 保持一致 */
export const TAB_PAGES: RoutePath[] = [
  RoutePath.Home,
  RoutePath.Record,
  RoutePath.Training,
  RoutePath.Trends,
  RoutePath.Profile
];
