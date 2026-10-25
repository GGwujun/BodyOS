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
  /**
   * 到点后**停住等处置**的那一刻(ms);有值就是「歇够了」(Ready)态。
   * 到点不收表:数字停在 0,直到他自己收掉(跳过)或再起一段(+15 / 点数字改时)——
   * 人可能正在换衣服、找耳机,回过头来第一眼要的答案是「歇够了没有」,不是一条消失的休息条。
   * 和暂停一样**只在内存里**,不进草稿:重新进来的人需要的是一张新表,不是昨天的「歇够了」。
   */
  readyAt?: number;
}

/** 「+15 秒」每次加多少 */
export const EXTEND_SEC = 15;

/**
 * 还剩几秒(向上取整,最低 0)。**暂停中停在冻结那一刻** —— 界面上的数字不动,
 * 因为它答的是「歇够了没有」,而暂停的全部意义就是「这段时间不算」。
 * Ready 态(歇够了)恒为 0。
 */
export const restRemain = (r: RestTimer, now: number): number =>
  r.readyAt != null ? 0 : Math.max(0, Math.ceil((r.endsAt - (r.pausedAt ?? now)) / 1000));

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
  // Ready 态没有暂停这回事:表已经走完了,没有可停的表(页面也不该把这个按钮摆出来)
  if (r.readyAt != null) return r;
  if (r.pausedAt != null) {
    return { endsAt: now + Math.max(0, r.endsAt - r.pausedAt), total: r.total };
  }
  return { ...r, pausedAt: now };
}

/** 到点 → 停进「歇够了」(不收表)。调用方负责那一声提示 */
export const restToReady = (r: RestTimer, now: number): RestTimer => ({ ...r, readyAt: now });

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
  // Ready 态里加时间 = **另起一段新的**:旧的那段已经歇完了,「上一段曾经想歇多久」
  // 不该给新一段当分母(接着旧分母,条子会从半截开始,像还没歇够的样子 —— 其实早够了)
  if (r.readyAt != null) return { endsAt: now + sec * 1000, total: sec };
  const endsAt = r.endsAt + sec * 1000;
  const base = r.pausedAt ?? now;
  return { ...r, endsAt, total: Math.max(r.total, Math.ceil((endsAt - base) / 1000)) };
}

/**
 * 减一段时间(「−15s」)。减穿底返回 **null** —— 剩余都不剩了,这条休息就该结束,
 * 和「跳过」走同一条路;页面拿 null 清掉计时,不用再造一个「剩 0 秒」的中间态。
 *
 * 分母不动:已经歇掉的那段是事实,「曾经计划歇多久」不因为按了减号缩回去。
 * (分子随剩余一起变小,进度条会显得还没走完 —— 那正是这一刻的实话:
 * 本来打算歇 90 秒、第 30 秒上按了 −15,条子该停在还剩一大截的位置。)
 */
export function shortenRest(r: RestTimer, sec: number, now: number): RestTimer | null {
  // Ready 态里「减」:剩余已经是 0,减掉任何一段都是收表 —— 和「跳过」同一条路
  if (r.readyAt != null) return null;
  const base = r.pausedAt ?? now;
  const endsAt = r.endsAt - sec * 1000;
  if (endsAt <= base) return null;
  return { ...r, endsAt };
}

/** 点倒计时数字改时用的预设(秒)—— 从「再歇一会儿」到「歇透了」一列 */
export const REST_ADJUST: number[] = [15, 30, 45, 60, 90, 120, 180, 240, 300];

/**
 * 直接把剩余改成 N 秒(点倒计时数字选一个)。
 * 和加时间同一条规矩:分母只在 N 比它大时抬高,改短了不动 —— 已经歇掉的不缩回。
 */
export function setRestRemain(r: RestTimer, sec: number, now: number): RestTimer | null {
  if (sec <= 0) return null;
  // Ready 态里改时 = 另起一段新的(理由同 extendRest:旧段已经结束,分母从头算)
  if (r.readyAt != null) return { endsAt: now + sec * 1000, total: sec };
  const base = r.pausedAt ?? now;
  const endsAt = base + sec * 1000;
  return { ...r, endsAt, total: Math.max(r.total, sec) };
}

/**
 * 到点了没有。暂停中永远不算到点 —— 冻结的 `endsAt` 早就落在过去了;
 * Ready 态也不算 —— 它不是「等着被收掉」,是「停在那里等他自己处置」。
 */
export const restOver = (r: RestTimer, now: number): boolean =>
  r.pausedAt == null && r.readyAt == null && now >= r.endsAt;
