/**
 * 把「练了这么久我有没有变」算成一张快照,交给主包(见 @/utils/training-progress)。
 *
 * 算在分包、存的主包 —— 理由写在 @/utils/training-progress.ts 的文件头。
 * 这里只管一件事:从日志里挑出**攒下来的那几个数**。
 *
 * 挑数只挑用户自己会拿来对比的:练过的日子、一共练了多少次多少天、
 * 最近破的三个纪录是哪几个。热力图、容量曲线那些是统计页的事,不进这张快照 ——
 * 趋势页那一格要能一眼看完,搬多了就成了第二个统计页。
 *
 * 「练过的日子」存成一串日期而不是「近 30 天几次」:趋势页有自己的 7/30/90 天档,
 * 存死的数不会跟着那一档动(理由同 @/utils/training-progress.ts 文件头)。
 */
import { summaryOf, type Summary } from './history';
import { strengthRows } from './strength';
import type { WorkoutLog } from './types';
/* 相对路径:冒烟测试用纯 tsc 编译,不认 '@/' 别名(同 engine/kit.ts) */
import { MARKS_MAX, type TrainingProgress } from '../../utils/training-progress';

export function progressOf(logs: WorkoutLog[]): TrainingProgress {
  const clean = (logs ?? []).filter((l) => l && l.date);
  const all: Summary = summaryOf(clean, null);

  // 练过的日子,新的在前,最多 MARKS_MAX 天 —— 趋势页选 7/30/90 天都从这串里现算
  const marks = [...new Set(clean.map((l) => l.date))].sort().reverse().slice(0, MARKS_MAX);

  // 最近一次(marks[0] 就是它):补录的那次也算真练过(它是事实),所以不过滤 manual。
  // 标题得回日志里找那一场的 dayTitle —— marks 只存了日期
  const lastAt = marks[0] ?? '';
  const lastTitle = clean.find((l) => l.date === lastAt)?.dayTitle ?? '';

  return {
    total: all.sessions,
    days: all.days,
    marks,
    lastTitle,
    // 最近破的三个纪录:按「哪天破的」倒序,而不是按重量 —— 卧推 60 和硬拉 100 谁大谁小
    // 不比也知道,「上周刚破」比「数字大」更像变化
    lifts: strengthRows(clean)
      .filter((r) => r.bestE1rm > 0 && r.bestDate)
      .sort((a, b) => (a.bestDate < b.bestDate ? 1 : a.bestDate > b.bestDate ? -1 : b.bestE1rm - a.bestE1rm))
      .slice(0, 3)
      .map((r) => ({ name: r.nameZh, kg: Math.round(r.bestE1rm * 10) / 10, date: r.bestDate }))
  };
}
