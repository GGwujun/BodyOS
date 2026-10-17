/* 由 scripts/build-muscle-figures.mjs 生成 —— 不要手改,改脚本重跑。
 *
 * 动作**没有演示图**时兜底的那张「练哪儿」示意图:按主要肌群(target)点亮的身体图,
 * 画在 server/media/figure/,一个肌群一张。
 *
 * 为什么按肌群而不是按动作:库里 1324 条动作的 target 只有 19 种,
 * 而同一个肌群的动作「练哪儿」本来就是一回事。19 张图覆盖全部动作。
 *
 * 自己画的图,没有第三方署名义务 —— 这一点和演示图(exercise-media.ts,© Gym visual)
 * 不一样,两边的署名/说明文案也因此不同,别混。
 *
 * 演示图现在 1324/1324 全覆盖,所以这张图基本轮不到(它是兜底)。
 */
export type MuscleFigure = { file: string; view: 'front' | 'back'; zh: string };

export const MUSCLE_FIGURES: Record<string, MuscleFigure> = {
  "abductors": { file: "abductors.svg", view: "front", zh: "大腿外展肌" },
  "abs": { file: "abs.svg", view: "front", zh: "腹直肌" },
  "adductors": { file: "adductors.svg", view: "front", zh: "大腿内收肌" },
  "biceps": { file: "biceps.svg", view: "front", zh: "肱二头肌" },
  "calves": { file: "calves.svg", view: "back", zh: "小腿三头肌" },
  "cardiovascular system": { file: "cardiovascular-system.svg", view: "front", zh: "心肺" },
  "delts": { file: "delts.svg", view: "front", zh: "三角肌" },
  "forearms": { file: "forearms.svg", view: "front", zh: "前臂" },
  "glutes": { file: "glutes.svg", view: "back", zh: "臀大肌" },
  "hamstrings": { file: "hamstrings.svg", view: "back", zh: "腘绳肌" },
  "lats": { file: "lats.svg", view: "back", zh: "背阔肌" },
  "levator scapulae": { file: "levator-scapulae.svg", view: "back", zh: "肩胛提肌" },
  "pectorals": { file: "pectorals.svg", view: "front", zh: "胸大肌" },
  "quads": { file: "quads.svg", view: "front", zh: "股四头肌" },
  "serratus anterior": { file: "serratus-anterior.svg", view: "front", zh: "前锯肌" },
  "spine": { file: "spine.svg", view: "back", zh: "竖脊肌" },
  "traps": { file: "traps.svg", view: "back", zh: "斜方肌" },
  "triceps": { file: "triceps.svg", view: "back", zh: "肱三头肌" },
  "upper back": { file: "upper-back.svg", view: "back", zh: "上背(菱形肌/中斜方)" },
};
