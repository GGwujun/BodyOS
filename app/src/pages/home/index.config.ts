/* 自定义导航:设计稿里「轻身记 / 记录每一次变好的自己」是左对齐的品牌头,
   而原生导航只能居中一行标题 —— 那条两行字是首页气质的起点,所以整条自己画。
   状态栏高度在页面里按设备补(utils/status-bar)。 */
export default definePageConfig({
  navigationStyle: 'custom',
  enablePullDownRefresh: true
});
