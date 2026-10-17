/**
 * 组间休息的算术 —— 全是纯函数,页面只负责把结果接到定时器和按钮上。
 *
 * **计时用墙钟表示**:存的是结束时刻(`endsAt`),每次 tick 拿「现在」反算剩余。
 * 不存「还剩几秒然后自己减一」是因为小程序切到后台会把定时器冻住 ——
 * 自己数秒的那份回到前台时少算了一整段,人真的歇够了却还在等。
 * 反算法只认两个时刻之差,后台待多久都不影响。
 *
 * **暂停挂在同一个模型上**:不是把秒数抠出来存,而是记下**冻结的那一刻**(`pausedAt`),
 * 剩余仍是 `endsAt − pausedAt`。这样「暂停 → 被叫走五分钟 → 回来继续」不会少休息:
 * 它压根不看墙上时钟走了多久,只看这两个时刻的距离。
 *
 * 为什么值得单独一个文件:这里全是时间算术,而时间算术的错**不报错** ——
 * 它只是让人少歇半分钟、进度条从零开始,没人会觉得那是 bug,只会觉得"这破表不准"。
 * 搬进来就能被冒烟钉住(见 `scripts/smoke-rest.mjs`)。
 */

export interface RestTimer {
  /** 结束时刻(ms)。暂停中它是「冻结前的那个结束时刻」,只用来和 `pausedAt` 相减 */
  endsAt: number;
  /** 总秒数 —— 进度条的分母;加时间时只会抬高,不会缩回去 */
  total: number;
  /** 按暂停的那一刻(ms);有值就是暂停中 */
  pausedAt?: number;
}

/** 「+15 秒」每次加多少 */
export const EXTEND_SEC = 15;

/**
 * 还剩几秒(向上取整,最低 0)。**暂停中停在冻结那一刻** —— 界面上的数字不动,
 * 因为它答的是「歇够了没有」,而暂停的全部意义就是「这段时间不算」。
 */
export const restRemain = (r: RestTimer, now: number): number =>
  Math.max(0, Math.ceil((r.endsAt - (r.pausedAt ?? now)) / 1000));

/** 进度条百分比(0–100)。暂停中分子冻住、分母不动,所以条子也停住 */
export const restPct = (r: RestTimer, now: number): number =>
  r.total > 0 ? Math.min(100, (restRemain(r, now) / r.total) * 100) : 0;

/**
 * 起一份新计时。**0 秒给 null** —— 不休息(超级组、拉伸)就该是「没有这条」,
 * 起一份 0 秒的表只会闪一下就消失,看起来像卡了一下。
 */
export const restStart = (sec: number, now: number): RestTimer | null =>
  sec > 0 ? { endsAt: now + sec * 1000, total: sec } : null;

/** 暂停 / 继续。继续时按冻结下来的剩余重算结束时刻,`total` 不动(进度条接着刚才那一步走) */
export function toggleRestPause(r: RestTimer, now: number): RestTimer {
  if (r.pausedAt != null) {
    return { endsAt: now + Math.max(0, r.endsAt - r.pausedAt), total: r.total };
  }
  return { ...r, pausedAt: now };
}

/**
 * 加一段时间。
 *
 * 分母(`total`)是**这一段休息曾经最长的那一次**,只在剩余真的顶破它时才抬 ——
 * 不是每次都重设成「加完之后还剩多少」。两者只差一种情况:**在尾巴上加时间**
 * (第 89 秒剩 1 秒时按 +15):重设会把条子刷回满格,等于说「你又从头开始歇了」,
 * 人明明已经歇了 89 秒。抬下限的写法给 41%,那才是这一刻的实话。
 *
 * 加时间时基准要用 `pausedAt`,不是 `Date.now()`。这两者**在大多数情况下算出来一样**
 * (暂停中的 `endsAt` 落在过去,负数被上面的下限兜住了),只在一种情况下分道扬镳:
 * 加的量大到剩余顶破了老分母 —— 那时拿墙钟当基准会得一个负数,分母卡在旧值上。
 * 不换成重设分母(见上)是为了那条「尾巴上加时间别刷回满格」;既然下限留着,
 * 基准就必须自己拿对,不能指望它兜。
 */
export function extendRest(r: RestTimer, sec: number, now: number): RestTimer {
  const endsAt = r.endsAt + sec * 1000;
  const base = r.pausedAt ?? now;
  return { ...r, endsAt, total: Math.max(r.total, Math.ceil((endsAt - base) / 1000)) };
}

/** 到点了没有。暂停中永远不算到点 —— 冻结的 `endsAt` 早就落在过去了 */
export const restOver = (r: RestTimer, now: number): boolean =>
  r.pausedAt == null && now >= r.endsAt;
