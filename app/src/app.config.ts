export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/record/index',
    'pages/quick-record/index',
    'pages/food/index',
    'pages/exercise/index',
    'pages/trends/index',
    'pages/weekly-report/index',
    'pages/ai-coach/index',
    'pages/data-sources/index',
    'pages/profile/index',
    'pages/onboarding/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'Body OS',
    navigationBarTextStyle: 'black',
    backgroundColor: '#ffffff'
  },
  tabBar: {
    color: '#9AA3AF',
    selectedColor: '#10B981',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/home/index', text: '首页', iconPath: 'assets/tabbar/home.png', selectedIconPath: 'assets/tabbar/home-active.png' },
      { pagePath: 'pages/record/index', text: '记录', iconPath: 'assets/tabbar/record.png', selectedIconPath: 'assets/tabbar/record-active.png' },
      { pagePath: 'pages/quick-record/index', text: '速记', iconPath: 'assets/tabbar/quick.png', selectedIconPath: 'assets/tabbar/quick.png' },
      { pagePath: 'pages/trends/index', text: '趋势', iconPath: 'assets/tabbar/trends.png', selectedIconPath: 'assets/tabbar/trends-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/tabbar/profile.png', selectedIconPath: 'assets/tabbar/profile-active.png' }
    ]
  }
});
