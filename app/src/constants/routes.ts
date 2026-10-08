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
  Recipes = 'pages/recipes/index'
}

/** TabBar 页面(底部导航) — 与 app.config.ts tabBar.list 保持一致 */
export const TAB_PAGES: RoutePath[] = [
  RoutePath.Home,
  RoutePath.Record,
  RoutePath.QuickRecord,
  RoutePath.Trends,
  RoutePath.Profile
];
