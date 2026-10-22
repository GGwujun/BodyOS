import Taro from '@tarojs/taro';
import { RoutePath } from '@/constants/routes';
import { switchTab } from '@/utils/nav';

/**
 * 「去补身体资料」的一步到位入口。
 *
 * 首页发现资料不全(没有消耗/评分)时不能只是把用户扔到「我的」页 ——
 * 他还得自己找到「身体数据」那一行再点一次;而 tab 页之间 `switchTab` 带不了参数。
 * 所以用一枚一次性标记,资料页 show 的时候消费它并直接拉起编辑面板。
 */
const EDIT_BODY_FLAG = 'bodyos.profile.editBody';

export function openBodyEditor(): void {
  try {
    Taro.setStorageSync(EDIT_BODY_FLAG, 1);
  } catch {
    /* 存储不可用也照样跳资料页 —— 只是少弹一层 */
  }
  switchTab(`/${RoutePath.Profile}`);
}

/** 只在资料页调用:有请求就消费掉(一次只弹一次) */
export function consumeBodyEditRequest(): boolean {
  try {
    if (!Taro.getStorageSync(EDIT_BODY_FLAG)) return false;
    Taro.removeStorageSync(EDIT_BODY_FLAG);
    return true;
  } catch {
    return false;
  }
}
