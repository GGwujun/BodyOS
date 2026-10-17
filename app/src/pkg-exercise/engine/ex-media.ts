import { EX_MEDIA } from '../data/exercise-media';

/**
 * 动作演示图 —— 库里每个动作那张**动图**从哪来。
 *
 * ## 一条不落
 * 1324 条动作**每条都有一张动画 GIF**(上游 `hasaneyldrm/exercises-dataset` 的 id
 * 和我们库的 id 一一对应,1324/1324)。所以「有没有图」在库里几乎恒为真 ——
 * `hasDemo` 留着是为了自定义动作(`c-` 开头,不在表里)和将来可能的缺图。
 *
 * ## 上一版是两张静止图,被用户骂下架的
 * 早先用 Everkinetic 的 SVG:放松位/发力位两张交替放,想假装「在动」。实际效果是
 * 两张不动的画在闪,而且 289 个上游动作对 1324 条库只能硬凑出 142 条(靠一张别名表)。
 * GIF 自带循环,一个动作一张,不用客户端做任何事 —— 这就是换掉的原因。
 *
 * ## ⚠️ 图是 © Gym visual 的,不是自由素材
 * 上游那份 NOTICE 写明了:**clone 那个仓库不给你任何媒体授权**,要自己去
 * gymvisual.com 取得。署名(每处用法都要带)写在 howto/HowTo.tsx 的 DemoImage 里
 * —— 那行 `howto-demo__credit` **别删**,删了就是无署名使用。详见 THIRD-PARTY-NOTICES.md 第 3 节。
 *
 * ## 这里只给**站点相对地址**
 * `/media/ex/xxx.gif` 还不是能直接喂给 Image 的地址,要过一道 `mediaUrl()`
 * (它在 services/training 里,会补上后端域名)——放这儿是为了让这个模块不依赖任何服务层,
 * 纯查表 + 拼串,冒烟测试能直接跑。
 */
const PREFIX = '/media/ex/';

/** 这个动作的演示图地址(站点相对)。库里没有、或者这个 id 不在表里,给 null。 */
export function demoUrl(id: string): string | null {
  const file = EX_MEDIA[id];
  return file ? PREFIX + file : null;
}

/** 这个动作有没有演示图 —— 列表和详情里要据此决定摆不摆那一块 */
export function hasDemo(id: string): boolean {
  return demoUrl(id) !== null;
}
