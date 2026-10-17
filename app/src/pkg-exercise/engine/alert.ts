import Taro from '@tarojs/taro';

/**
 * 训练提示 —— 屏幕别睡过去 + 组间震一下。
 *
 * 来源是 openGym 的 `lib/wakelock.js`(训练中保屏)与 `lib/sound.js` 里震动那一半,
 * 提示点照它 `views/Workout.jsx` / `store/useUI.js` 的调用抄齐:勾完一组、休息剩 3/2/1 秒、
 * 休息结束。它那份 `lib/rest-alert.js`(安卓本地闹钟)**不移植** —— 小程序离开前台
 * 就没有代码在跑,没有闹钟可定,这件事 M8.1 已经如实说明过了。
 *
 * ## 两处**必须**改的地方(不是取舍,是平台没有)
 *
 * ① **保屏是「一次性的」。** Web 的 Wake Lock 由浏览器自己丢掉(sentinel 在文档不可见时
 *    解掉),所以那边要监听 `visibilitychange` 重取;小程序的 `setKeepScreenOn`
 *    **离开小程序即失效**,回到前台(`useDidShow`)必须重设一遍 —— 形状一样,机制不同。
 *    条件也照搬:`正在练 && 设置里没关`,不是「这个页面开着就常亮」。
 * ② **震动只有两档。** `navigator.vibrate` 能写任意节奏,openGym 的休息结束用的是
 *    `[200,100,200]`(专挑一个比普通提示更急的节奏);小程序只有 `vibrateShort`
 *    (约 15ms)与 `vibrateLong`(约 400ms)。所以「急」这件事的翻译就是**长震**。
 *    刻意**不**拿两个短震去拼那三段节奏:间隔得靠 `setTimeout`,而小程序切后台就把
 *    定时器冻住,结果是半截节奏停在最不该停的地方。
 *
 * ## 四个提示点(一个不多一个不少,和 openGym 对齐)
 *
 *   勾完一组      → 短震(它那边是 `beep(1040) + vibrate(30)`)
 *   休息剩 3/2/1 秒 → 短震(它那边**只有** `beep(660)`,不震)
 *   休息结束      → 长震(它那边是结束音 + `alertBuzz([200,100,200])`)
 *   取消勾选      → 不响(它那边只在 `done` 由假变真时响)
 *
 * 第三行那个「只剩 3 秒」在小程序里必须反过来:**震动是唯一还走得通的通道**
 * (手机在兜里、静音、周围很吵),照搬「只响不震」等于把这三声预告一起砍掉,
 * 而这三声的全部意义就是「下一组要来了」。所以这里按**幅度**分档,不按通道分。
 *
 * 还有一条**门槛**是从那边学来的:休息结束那一下只在「人正看着」时响
 * (它那边是 `seenLive`,靠 `document.hidden` 判)。锁屏/切走的时候那一震发不出去,
 * 而人回来时它已经过去了 —— 这时候再补一下,信号的就不是「到点了」而是「吓你一跳」。
 * 所以训练页回到前台那一路**故意不补震**(它那边同样的位置也不响,改成弹一句提示)。
 *
 * **声音这一档没做**,不是漏了:小程序的 `createInnerAudioContext` 只认文件、不认
 * Web Audio 的振荡器,要真做得先合成一段音频进包(主包 1009KB / 分包 1652KB,各还剩
 * 不到 400KB)。而它换来的东西很薄 —— 小程序一退到后台就没有代码在跑,声音只在用户
 * 正盯着屏幕时响,而那正是他能看到倒计时的时候。震动在静音下照样有,才是这一层的主力。
 *
 * ## 这一份设置**只在本机**(不上云、不进备份)
 *
 * 它管的是**这台手机**:这块屏亮不亮、这部机器震不震得动。换设备本来就该重新定一次,
 * 而收藏、请假条那些是「你的训练怎么安排」,跟着人走。同类的本机设置还有删除的撤销底稿
 * (`purge_undo`)。这是分类,不是「忘了同步」。
 */

export interface AlertPrefs {
  /** 训练中让屏幕保持常亮 */
  keepAwake: boolean;
  /** 勾组与休息结束时震一下 */
  vibrate: boolean;
}

export const ALERT_KEY = 'bodyos.training.alert';

/** 两项默认都开 —— openGym 也是这么定的(`vibrate` 默认 on、`keepAwake` 只在明确为 false 时才不保屏) */
export const ALERT_DEFAULT: AlertPrefs = { keepAwake: true, vibrate: true };

/**
 * 读不懂的项**退回默认值**,不丢整份 —— 和收藏/请假条那种「数据」不同,这是一份**设置**:
 * 退回默认的后果是「提示响得跟出厂一样」,不是「东西没了」。所以这里只逐项判类型。
 */
export function sanitizeAlert(raw: unknown): AlertPrefs {
  if (!raw || typeof raw !== 'object') return { ...ALERT_DEFAULT };
  const o = raw as Record<string, unknown>;
  return {
    keepAwake: typeof o.keepAwake === 'boolean' ? o.keepAwake : ALERT_DEFAULT.keepAwake,
    vibrate: typeof o.vibrate === 'boolean' ? o.vibrate : ALERT_DEFAULT.vibrate
  };
}

export function loadAlert(): AlertPrefs {
  try { return sanitizeAlert(Taro.getStorageSync(ALERT_KEY)); } catch { return { ...ALERT_DEFAULT }; }
}

/** 存一份(可只给要改的那项)。存不下就只本次生效,不拦用户 */
export function saveAlert(patch: Partial<AlertPrefs>): AlertPrefs {
  const next = sanitizeAlert({ ...loadAlert(), ...patch });
  try { Taro.setStorageSync(ALERT_KEY, next); } catch { /* 本次生效即可 */ }
  return next;
}

/** 提示点 —— 和 openGym 那几处调用一一对应 */
export type Cue = 'setDone' | 'tick' | 'restEnd';

/**
 * 每个提示点震多长。`restEnd` 用长震,是那个「更急的节奏」在这个平台上的唯一翻译
 * ——「急」留下来了,节奏没有(见模块头 ②)。
 */
export const CUE_BUZZ: Record<Cue, 'short' | 'long'> = {
  setDone: 'short',
  tick: 'short',
  restEnd: 'long'
};

/**
 * 休息剩 3/2/1 秒各报一次。**0 不是预告,是结束**(走 `restEnd`),4 及以上还没到。
 * 页面那边一秒只调一次 —— 定时器是 250ms 一跳,同一个秒数上会跳好几下。
 */
export function isTickSecond(remain: number): boolean {
  return remain >= 1 && remain <= 3;
}

/**
 * 震一下。关掉就一个字都不发;接口缺失 / 机型不支持 / 失败一律静默
 * (页面正事是记录训练,提示响不响都不该打断它——和 openGym 那边整个 `vibrate()` 套 try 一个道理)。
 */
export function buzz(cue: Cue, prefs: AlertPrefs = loadAlert()): void {
  if (!prefs.vibrate) return;
  try {
    // 两个接口的入参形状不一样(长震不收 type),分开写 —— 合成一个变量就得替那个可选字段做类型体操,
    // 而这里本来就只有两行
    if (CUE_BUZZ[cue] === 'long') {
      if (typeof Taro.vibrateLong !== 'function') return;
      Promise.resolve(Taro.vibrateLong({})).catch(() => {});
    } else {
      if (typeof Taro.vibrateShort !== 'function') return;
      Promise.resolve(Taro.vibrateShort({ type: 'medium' })).catch(() => {});
    }
  } catch { /* 静默 */ }
}

/**
 * 屏幕常亮。**离开小程序即失效**,所以回到前台要重设一遍(见模块头 ①)。
 * 关掉设置项时下一次调用就把它关回去了(传 false 也一样关)。
 */
export function keepAwake(on: boolean, prefs: AlertPrefs = loadAlert()): void {
  try {
    if (typeof Taro.setKeepScreenOn !== 'function') return;
    Promise.resolve(Taro.setKeepScreenOn({ keepScreenOn: on && prefs.keepAwake })).catch(() => {});
  } catch { /* 静默 */ }
}
