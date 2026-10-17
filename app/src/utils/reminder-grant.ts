/**
 * 订阅消息额度:练完顺手补领一条。
 *
 * 微信的一次性订阅是「授权一次 = 服务端只能发一条」,而客户端**没法在后台执行**,
 * 所以额度用完以后只能等用户下次回到小程序。以前补领入口只在提醒页的「再要一条」,
 * 用户不专门去点,推送就会安静地停掉 —— 他还以为提醒开着。
 *
 * 现在把补领挂在「完成训练」这个动作上:
 *   1. 只有提醒开着、模板 id 已知、而且本机记着的额度是 0 时才问(见 needsReminderTopUp);
 *   2. 用户勾过「总是保持以上选择」时微信不再弹窗,直接返回 accept —— 对他是无感的;
 *   3. 没勾过就弹一次授权框,这是补额度绕不开的,但只在真没额度时弹。
 *
 * **调用位置有硬性要求**:微信只允许在用户点击的调用链里调 requestSubscribeMessage。
 * 所以顶层必须是同步进入的,在 requestSubscribeMessage 之前不能先 await 网络请求 ——
 * 模板 id 和额度才要提前缓存在本机(utils/reminder.ts)。
 */
import Taro from '@tarojs/taro';
import { trainingApi } from '@/services';
import { loadReminder, loadReminderServer, needsReminderTopUp, saveReminderServer } from './reminder';

/** 微信订阅消息的申请结果:每个模板 id 一个 'accept' | 'reject' | 'ban' */
type SubResult = Record<string, string>;

/**
 * 把服务端最新的模板 id / 额度记到本机。
 * 训练页每次回到前台调一次 —— 期间可能刚好发过一条提醒,额度已经扣掉了。
 * 失败就保留本机上一份:离线不该把已知的模板 id 抹掉。
 */
export async function refreshReminderGrant(): Promise<void> {
  // 没开提醒就不必为它多发一个请求,也不该在没授权过的设备上留下模板 id
  if (!loadReminder().enabled) return;
  try {
    const dto = await trainingApi.getReminder();
    saveReminderServer({ tmplId: dto.tmplId, grants: dto.grants });
  } catch {
    /* 离线/未登录:用上一份缓存,练完再试 */
  }
}

/**
 * 补领一条。返回是否真的拿到并记上了。
 * 不抛异常:这是练完的收尾动作,失败不该挡在训练记录前面。
 */
export async function topUpReminderGrant(): Promise<boolean> {
  if (!needsReminderTopUp()) return false;
  const { tmplId } = loadReminderServer();

  // 基础库太老没有这个接口 → 当作拿不到,提醒页会如实说明只有小程序内提醒
  const fn = (Taro as unknown as {
    requestSubscribeMessage?: (o: { tmplIds: string[] }) => Promise<SubResult>;
  }).requestSubscribeMessage;
  if (!fn) return false;

  try {
    const res = await fn.call(Taro, { tmplIds: [tmplId] });
    if (res?.[tmplId] !== 'accept') return false;
    const dto = await trainingApi.grantReminder(1);
    saveReminderServer({ tmplId: dto.tmplId, grants: dto.grants });
    return true;
  } catch {
    // 授权拿到了但没存上(网络断了):这一次额度算丢,下次练完再补;
    // 已经发出的提醒不受影响,不值得为它弹错误提示打断刚练完的人
    return false;
  }
}
