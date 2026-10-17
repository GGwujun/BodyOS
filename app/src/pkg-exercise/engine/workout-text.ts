/**
 * 一次训练的文字版 —— 练完复制一段字,粘到微信、备忘录,或者发给教练。
 *
 * 为什么图上完了还要文字:分享卡是「发出去好看」的图,但很多场景要的是**能改的文本** ——
 * 发给教练之后他要添两句、填进自己的表格、或者跟以前的记录存在一起;图做不到这些
 * (图里的字选不中,教练只能照着敲一遍)。
 *
 * 三条规矩都是照 openGym 的 `lib/workout-text.js` 定的:
 * ①**只写练了的组**:判据是 `didSet()`(次数 > 0 **或**秒数 > 0),不是 `reps > 0` ——
 *   后者会把每一个计时组都当成「跳过没做」,于是整个平板支撑在这段文字里凭空消失。
 *   跳过的组在这段文字里没有任何记号能和真练的区分开,写进去就是谎报做了;
 * ②**每一组怎么念和别处一样** —— 重量走 `loadText`(自重 / 助力 30kg / +20kg),
 *   次数走 `sideRepsLabel`(每侧 N),不在这个文件里另拼一套,否则迟早出现
 *   「分享卡上写每侧 10、复制出来的文字写 10」;
 * ③**空行分块**:标题 + 一行事实是一块,每个动作一块,超级组的成员合在一块,感受在最后。
 *   每个动作在块里占**两行** —— 名字一行、组一行(照 openGym 的形状):一组组写下去的时候,
 *   名字不会跟一长串组号挤在同一行末尾,手机上也不会折得乱七八糟。
 */

import { fmtSpan } from '../../utils/duration';
import { loadText } from './load';
import { orderUnits } from './order';
import { dateText, volumeText } from './share-card';
import { isSided, sideRepsLabel } from './sided';
import { holdSecOfSets, holdText } from './timed';
import { didSet, type WorkoutLog } from './types';

/** 一组练完的数据(日志里的那一份)。计时组 `reps` 为 0、时长在 `sec`。 */
type LoggedSet = { reps: number; weightKg: number | null; sec?: number };

export interface TextOpts {
  /**
   * 单侧动作的判定。默认按动作库的名字规则,页面应当传入「**以计划为准**」的那个
   * (见 log-edit 的 `sidedIn`)—— 用户手动关掉过单侧开关的动作不能被名字规则翻回来。
   */
  sidedOf?: (exerciseId: string) => boolean;
}

/**
 * 一组的念法:`60kg × 8` / `自重 × 10` / `12kg × 每侧 10` / `助力 30kg × 12`。
 * 和纪录、掉力分析、分享卡同一套原子(loadText + sideRepsLabel)。
 *
 * 计时组不写 `×`:`20kg · 45 秒`。`×` 在这个文件里一直是「乘」的意思(重量 × 次数),
 * 而一次支撑不是乘出来的东西 —— 换个记号,读的人一眼就知道这一组不是按次数记的。
 * 动作本身是「撑」还是「走」由动作决定(平板支撑 vs 农夫行走),所以这里不写动词,
 * 只把重量和时长的两个事实并排放着。
 */
export function setText(exerciseId: string, s: LoggedSet, sided?: boolean): string {
  const load = loadText(exerciseId, s.weightKg);
  if (s.reps <= 0 && (s.sec ?? 0) > 0) return `${load} · ${holdText(s.sec as number)}`;
  const reps = sideRepsLabel(exerciseId, s.reps, sided ?? isSided(exerciseId));
  return `${load} × ${reps}`;
}

/**
 * 标题下面那一行事实:`58 分钟 · 14 组 · 132 次 · 12,840 kg · 强度 RIR 2`。
 * 顺序和计划页历史里的那一行一致(组 · 次 · 容量),时长放最前面、RIR 放最后。
 * 时长为 0 时整段不写 —— 时长口径给的是「—」,粘到聊天里一个破折号没有意义。
 * 强度取**整场的平均**:逐组写 RIR 会让每行都多三四个字,而没打分的组还只能空着,
 * 一行里一半有一半没有,读起来比平均值还粗。
 */
export function factsText(log: WorkoutLog): string {
  const parts: string[] = [];
  if (log.durationSec > 0) parts.push(fmtSpan(log.durationSec));
  parts.push(`${log.totalSets} 组`, `${log.totalReps} 次`, volumeText(log.totalVolumeKg));
  // 计时总时长:一次核心课可能「0 次」,但「撑了 3 分 20 秒」。不写的话那天的成绩
  // 只剩一个「0 次」,发给教练就是一条看着像没练的记录。
  const hold = holdSecOfSets((log.entries ?? []).flatMap((e) => e.sets));
  if (hold > 0) parts.push(`保持 ${holdText(hold)}`);
  if (log.avgRir != null) parts.push(`强度 RIR ${log.avgRir}`);
  return parts.join(' · ');
}

/**
 * 把一次训练写成可以粘出去的纯文本。
 *
 * 只认**已经落库的日志** —— 训练还没结束、数据还在内存里的时候没有「记录」可言。
 * 补录(manual)会在标题后面标一句:那段数字是事后回忆填的,不是当场记的,
 * 发给教练时这个区别有意义。「这次不算进步」(noProg)不标 —— 那是 App 内部
 * 怎么读这条记录的规矩,跟这次到底练了什么无关,写出去只是让对面莫名其妙。
 */
export function workoutText(log: WorkoutLog, opts: TextOpts = {}): string {
  const sidedOf = opts.sidedOf ?? isSided;
  const head = `${dateText(log.date)}${log.dayTitle ? ` · ${log.dayTitle}` : ''}${log.manual ? ' · 补录' : ''}`;
  const blocks: string[] = [[head, factsText(log)].join('\n')];

  // 超级组:两个动作交替做,文字里合成一块并标一行「超级组」(只有同组号且相邻的才算一块)。
  // 只有一半进了日志(另一个动作被删掉/跳过)时它就是一块单行,不标 —— 标了反而像少写了一个。
  const entries = log.entries ?? [];
  for (const unit of orderUnits(entries)) {
    const lines = unit
      .map((i) => entries[i])
      .map((e) => {
        const sets = e.sets.filter(didSet);
        if (!sets.length) return null;
        return [e.nameZh, sets.map((s) => setText(e.exerciseId, s, sidedOf(e.exerciseId))).join(', ')].join('\n');
      })
      .filter((x): x is string => x !== null);
    if (!lines.length) continue;
    blocks.push([...(unit.length > 1 ? ['超级组'] : []), ...lines].join('\n'));
  }

  if (log.note) blocks.push(`感受:${log.note}`);
  return blocks.join('\n\n');
}
