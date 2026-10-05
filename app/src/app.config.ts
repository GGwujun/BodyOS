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
    color: '#888888',
    selectedColor: '#2ecc71',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/record/index', text: '记录' },
      { pagePath: 'pages/quick-record/index', text: '' },
      { pagePath: 'pages/trends/index', text: '趋势' },
      { pagePath: 'pages/profile/index', text: '我的' }
    ]
  }
});
