/**
 * 激活埋点 —— 「第一次记了饮食 / 第一次记了运动 / 第一次记了体重」各报一次。
 *
 * 为什么这三件事值得单独一个模块(docs/03 的「激活」一节就是它们):
 * 留存、D1/D7、「每周有效记录天数」这些指标的**分母**是「激活过的用户」,而激活的定义
 * 就是「第一次真的记了一笔」。少了它,新用户用了三天就走了这件事在数据上完全看不见 ——
 * 只有一个 `home_view` 说明他打开过。
 *
 * **收口在 service 层,不在页面里**:能写第一条饮食记录的地方现在就有两处(记录页、
 * 食谱页「记为这一餐」),以后只会更多;写在页面里就是「新加了入口忘了埋」,而这类漏
 * 不报错、只让分母变小 —— 数据错了没人会发现。所以挂在 `createFoodLog` /
 * `createActivity` / `createBodyMeasurement` 这三个**唯一**的写入函数上。
 *
 * 两条规矩:
 *  ① **报一次,记一次**。「报过没」落在本机 storage(和队列同一层,不怕重启)。
 *     注意这只管**一台设备**:换手机之后这三件事会各再报一次,服务端按
 *     「用户 + 事件名」去重即可 —— 客户端做不到跨设备去重,不该假装做得到。
 *  ② **先记下,再入队**。用的是可重试的队列(`track`,切后台时统一 flush),不是
 *     直接发送:新用户第一条记录很可能是**在地铁上**记的,发失败就该留在队列里下次补,
 *     不能因为一次断网让「这个人激活了」这件事永远消失。
 */
import Taro from '@tarojs/taro';
import { track } from '../services/analytics';

const K_FIRST = 'bodyos.activation.first';

/** 三件「第一次」。(体重那条只在**真的填了体重**时才报 —— 只量腰围不算记体重) */
export type FirstKind = 'food' | 'activity' | 'weight';

const EVENT: Record<FirstKind, string> = {
  food: 'first_food_log',
  activity: 'first_activity_log',
  weight: 'first_weight_log'
};

/** 纯的部分:给一份已经报过的名单,判断这次该不该报、报完名单变成什么(好单测) */
export function claimFirst(kind: FirstKind, done: unknown): { fire: boolean; next: FirstKind[] } {
  const list = (Array.isArray(done) ? done : [])
    .filter((k): k is FirstKind => k === 'food' || k === 'activity' || k === 'weight');
  if (list.includes(kind)) return { fire: false, next: list };
  return { fire: true, next: [...list, kind] };
}

function readDone(): unknown {
  return Taro.getStorageSync(K_FIRST);
}

/**
 * 第一次做成这件事时记一笔。已经报过的直接返回,不做任何事。
 * 传入的是**已经成功**的动作(food/activity 在请求成功后才调,体重在有体重值时才调)。
 */
export function markFirst(kind: FirstKind): void {
  const { fire, next } = claimFirst(kind, readDone());
  if (!fire) return;
  Taro.setStorageSync(K_FIRST, next);
  track(EVENT[kind], 'activation');
}

/** 清空(调试用;用户可见入口不开这个口子) */
export function resetFirst(): void {
  Taro.removeStorageSync(K_FIRST);
}
