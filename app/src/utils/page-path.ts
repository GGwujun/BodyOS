import Taro from '@tarojs/taro';

/**
 * 「这一页到底是哪一页」—— 全站只有这一个答案。
 *
 * 以前是靠**页面容器上那个 className 反推路由**:`quick-page` → 去掉 `-page` → `pages/quick/index`。
 * 这套猜法对 `home-page` / `record-page` / `trends-page` 碰巧都对(反推出来的路径和真实路径同形),
 * 于是一直没人发现它其实是**猜**。直到 `pages/quick-record/index` 用了 `quick-page` ——
 * 反推成 `pages/quick/index`,和 `TAB_PAGES` 里那条对不上,于是这一页**不被当成 tab 页**:
 * 底部同时长出原生 tabBar 和浮动的 `PageNavigation`,再加上一段 70px 的占位空白。
 * 一个错名字,屏幕上多一排导航。
 *
 * 病根不是「少了一条特例」,是**拿一个和路由无关的东西去推路由**。所以现在:
 * 1. **先问框架**:`getCurrentInstance().router.path` 就是当前页的注册路径,不用猜;
 * 2. 问不到才回落到 className 反推(极少数上下文里 router 还没就绪),再不行才用特例表兜底。
 *
 * 特例表留着是因为**回落到它的时候**得猜对;新增页面只要 className 和目录不同名,就得往这儿加一条,
 * 或者干脆别指望它 —— 现在真正生效的通常是第 1 条。
 */
const PATH_OVERRIDES: Record<string, string> = {
  'assess-page': 'pages/assessment/index',
  'ing-page': 'pages/ingredient/index',
  'ft-page': 'pages/food-tools/index',
  'rank-page': 'pages/food-rank/index',
  'quick-page': 'pages/quick-record/index'
};

/**
 * 当前页面的注册路径(不带前导斜杠),例如 `pages/quick-record/index`。
 * 判断不出来时返回空串 —— 调用方按「不是任何已知页面」处理,不要瞎猜一个。
 */
export function currentPagePath(className?: string): string {
  // 注意:这里读的是**页面栈栈顶**,不是 `getCurrentInstance()` ——
  // 后者从页面内部的子组件里问,拿到的未必是页面那一层,而底部导航恰好就长在子组件里。
  const stack = Taro.getCurrentPages?.() ?? [];
  const route = (stack[stack.length - 1] as { route?: string } | undefined)?.route;
  if (route) return route.replace(/^\//, '');
  if (!className) return '';
  return PATH_OVERRIDES[className] ?? `pages/${className.replace(/-page$/, '')}/index`;
}
