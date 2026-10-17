import { MUSCLE_FIGURES } from '../data/muscle-figures';

/**
 * 「练哪儿」示意图 —— 动作**没有演示图**时兜底的那张身体图。
 *
 * ## 和演示图(ex-media)是两件事,别合在一起
 * 演示图回答「**怎么做**」:一张会循环的 GIF,是 Gym visual 的图(**有版权、要署名**)。
 * 这张回答「**练哪儿**」:按主要肌群点亮的一块身体,是我们自己画的(不用署名)。
 * 一个是借来的、一个是自家的,署名口径完全不一样 —— 合并就会把署名也一起合没了。
 *
 * ## 它现在是个**兜底**,而且基本轮不到它
 * 演示图 1324/1324 全覆盖之后,库里的动作不会走到这里。真会走到的只有两种情况:
 * 自定义动作,以及「哪天上游那批 GIF 撤了」。留着它的理由就是后者 ——
 * 库里每个动作都标了主要肌群,所以那一块**永远接得住**,不会变成空白。
 *
 * ## 边界情况:自定义动作
 * 用户自建的动作用户自己填肌群,可以不填 —— 不填就没有示意图,那一块照旧空着。
 * 这是对的:「你自己建的动作、你自己也没说练哪儿」,我们无从替他标一块肌肉点亮。
 */
const PREFIX = '/media/figure/';

/** 这个动作练哪儿的示意图。查不到(自定义动作没填肌群 / 肌群没画过)给 null */
export function figureUrl(target: string | undefined | null): string | null {
  if (!target) return null;
  const f = MUSCLE_FIGURES[target];
  return f ? PREFIX + f.file : null;
}

/** 「正面」/「背面」—— 背阔肌点在正面上就是错的,所以图分两面,标出来免得用户以为画错了 */
export function figureView(target: string | undefined | null): string | null {
  if (!target) return null;
  const f = MUSCLE_FIGURES[target];
  return f ? (f.view === 'back' ? '背面' : '正面') : null;
}
