export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/record/index',
    'pages/quick-record/index',
    'pages/food/index',
    'pages/exercise/index',
    'pages/trends/index',
    'pages/weekly-report/index',
    'pages/data-sources/index',
    'pages/data-export/index',
    'pages/profile/index',
    'pages/onboarding/index',
    'pages/tools/index',
    'pages/recipes/index',
    'pages/assessment/index',
    'pages/food-tools/index',
    'pages/food-rank/index',
    'pages/ingredient/index',
    'pages/qa/index',
    'pages/toolbox/index',
    'pages/weight/index',
    'pages/measure/index',
    'pages/photos/index',
    'pages/plan/index',
    'pages/training/index',
    'pages/feedback/index'
  ],
  subPackages: [
    {
      root: 'pkg-exercise',
      pages: [
        'library/index',
        'muscle-explore/index',
        'ex-new/index',
        'plan-create/index',
        'plan-view/index',
        'plan-edit/index',
        'plan-share/index',
        'workout/index',
        'log-edit/index',
        'muscles/index',
        'stats/index',
        'log-history/index',
        'exercise-history/index',
        'kit/index',
        'sync/index',
        'backup/index',
        'share/index',
        'daily-share/index',
        'reminder/index',
        'coach/index'
      ]
    }
  ],
  preloadRule: {
    /* 首页、记录页、训练 tab 都通向训练:首页那张「今天练什么」卡、记录页那格
       「力量训练」、训练 tab 上那个「开始练」。**训练 tab 是最要紧的一个**：
       它整页就是为了按下去开练,而那一下如果还要等分包下载,人已经站到杠铃前面了。
       **「我的」也必须在这里**:动作库和「我的器材」的入口就在那一页的格子列表里
       (pages/profile/index.tsx),而它不在这个名单上的那段时间,从「我的」点动作库 =
       先站在那儿等整个分包下完 —— 用户报的「动作库经常打不开 / 打开很慢」多半就是这一段。
       只在这台设备连着 wifi 时预下,流量下就等用户真点了再下 ——
       预下载替用户花流量这种事不能替他决定。
       (以前这里写的是 toolbox:训练子页都从工具箱进。搬进计划页页脚之后,
       工具箱已经到不了分包了,预下载挂在它身上等于白下。)
       —— 分包多大?**别再写死一个数**:开发构建(带 sourcemap、不压缩)在盘上是 4.7MB,
       发布构建压完约 1.2MB。这个数每加一页就会再变,写死只会像上一版那句「1.6MB」一样过期。 */
    'pages/home/index': { network: 'wifi', packages: ['pkg-exercise'] },
    'pages/record/index': { network: 'wifi', packages: ['pkg-exercise'] },
    'pages/training/index': { network: 'wifi', packages: ['pkg-exercise'] },
    'pages/profile/index': { network: 'wifi', packages: ['pkg-exercise'] }
  },
  /**
   * 组件代码按需注入。
   *
   * 除了缩短启动时间,它也是微信社区里对
   * `routeDone with a webviewId … is not found` 这一类路由/webview 错位报错最常见的收敛手段:
   * 启动时不再把手头所有组件一起塞进每个 webview,页面切换期间少一大截注入竞争。
   * (触发时通常只是控制台噪音;真正危险的是底栏点不动、页面白屏 —— 那是 webview 真丢了。)
   */
  lazyCodeLoading: 'requiredComponents',
  /* 深色模式:页面样式靠 styles/tokens.scss 的 @media 切换;
     导航栏/标签栏这些**原生**外观只能走 theme.json 的 @变量(见 src/theme.json,
     经 config/index.ts 的 copy 原样拷进 dist)。 */
  darkmode: true,
  themeLocation: 'theme.json',
  window: {
    backgroundTextStyle: '@bgTxtStyle',
    navigationBarBackgroundColor: '@navBgColor',
    navigationBarTitleText: '轻身记',
    navigationBarTextStyle: '@navTxtStyle',
    backgroundColor: '@bgColor'
  },
  tabBar: {
    color: '@tabColor',
    selectedColor: '@tabSelectedColor',
    backgroundColor: '@tabBgColor',
    /* borderStyle 的类型被 Taro 收窄成 'white'|'black',但微信本身支持 @变量
       (theme.json 里浅色=black 深色=white 的发丝线),这里只能骗一下类型 */
    borderStyle: '@tabBorderStyle' as 'black',
    list: [
      { pagePath: 'pages/home/index', text: '首页', iconPath: '@iconHome', selectedIconPath: '@iconHomeActive' },
      { pagePath: 'pages/record/index', text: '记录', iconPath: '@iconRecord', selectedIconPath: '@iconRecordActive' },
      /* 中间这一格以前是「速记」(喝水、体重两件事)。它让给训练的理由不是速记没用,
         是**中间这一格的分量**:喝水/体重记完就完了,而训练是这一版里唯一有整套流程的东西,
         它原先只能从首页一张卡进,连个自己的落脚点都没有。速记那两件事记录页本来就有
         (喝水打卡、体重记录两格),速记页也还在(见 pages/record 顶部那条「一下记完」)。 */
      { pagePath: 'pages/training/index', text: '训练', iconPath: '@iconTrain', selectedIconPath: '@iconTrainActive' },
      { pagePath: 'pages/trends/index', text: '趋势', iconPath: '@iconTrends', selectedIconPath: '@iconTrendsActive' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: '@iconProfile', selectedIconPath: '@iconProfileActive' }
    ]
  }
});
