/* 自定义导航:设计稿里深绿页头是铺到状态栏后面的,原生导航会先压一条纸色横条。
   状态栏高度由页面自己让出来(utils/status-bar);文字也得改成白色 ——
   黑字压在深绿上读不出来。 */
export default definePageConfig({
  navigationStyle: 'custom',
  navigationBarTextStyle: 'white'
});
