# 第三方数据来源与授权声明

`app/src/data/exercises.ts`(内置动作库)为自动生成文件,数据来源与授权如下。

## 1. 动作文本(名称/器械/部位/肌群/分类/步骤) — MIT

源自 **ExerciseDB v1**(by AscendAPI),经
[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) 与
[openGym](https://github.com/DuarteSantos8/openGym) catalogue(`textSource: "exercisedb"` 的 1,324 条)传入。

```
MIT License
Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. 训练属性(level/force/mechanic)与补充条目文本 — Unlicense(公有领域)

源自 [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)(数据上游为
[wrkout/exercises.json](https://github.com/wrkout/exercises.json)),仅使用其文本字段;
**该仓库的图片未使用**(图片来源不明,不可考)。

## 3. 动作演示图(GIF)— ⚠️ © Gym visual,**我们还没拿到授权**

`server/media/ex/` 下的 1324 张动画 GIF 取自
[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)
的 `videos/` 目录,**版权归 [Gym visual](https://gymvisual.com/) 所有**
(公开署名常用 `© Aliaksandr Makatserchyk`)。

**这批图不是自由素材,这一节是待办而不是声明。** 上游仓库自己的 `NOTICE.md` 写得很清楚:
它拿到的是**它自己的**书面许可,并且

> Cloning this repository does not grant you any license to the media;
> obtain your own from Gym visual.

也就是说:**clone 上游不会把任何媒体授权转给我们**。要上线,得自行向 gymvisual.com
取得许可;在那之前,这批图只能用于本机开发调试。

- **署名要求**:每处用法都要带 `© Gym visual — https://gymvisual.com/`。客户端那一行是
  `src/pkg-exercise/howto/HowTo.tsx` 里 `DemoImage` 的 `howto-demo__credit`,**别删**;
- 图**原样搬运,未作任何修改**(没有裁切、重新着色、转格式或重新编码);
- **只取图,不取上游的任何文字**(动作步骤仍是第 1 节的 ExerciseDB 文本);
- 覆盖 1324/1324:上游动作 id 与我们库的 id 一一对应,所以库里**每条动作都有演示图**,
  不再有「没有图」的动作(上一版的覆盖率只有 142/1324,那正是换掉它的原因);
- 索引 `src/pkg-exercise/data/exercise-media.ts` 是**生成文件**,别手改。

重新生成:`node scripts/build-exercise-gifs.mjs`(详见脚本头注释)。

### 3.0 上一版:Everkinetic 静态图(已弃用,不要再启用)

2026-10-16 之前用的是 [everkinetic/data](https://github.com/everkinetic/data)
(CC BY-SA 4.0,作者 Greg Priday)的 SVG:放松位/发力位两张静止图由客户端交替播放。
问题有两个,都不是能修的:一是**两张不动的画不叫演示**(用户原话「这就不是动作啊,静态的」),
二是 289 个上游动作对 1324 条库只能靠别名表硬凑出 142 条。这版连同
`scripts/build-exercise-media.mjs`、`scripts/everkinetic-index.json` 和盘上那 284 个 SVG
一并删除(要考古:`git log -- server/media/ex`)。

## 3.1 肌群示意图 — 自己画的,没有第三方来源

`server/media/figure/` 下的 19 张身体图是**本项目自己画的**(`scripts/build-muscle-figures.mjs`
里的几何数据),不来自任何图库,**没有署名义务、也没有许可传染**。

它和上一节是两件事,别混:上一节回答「这个动作怎么做」(借来的图),这一节回答
「这个动作练哪儿」(自己的图)。所以显示这一张的地方**不写 Gym visual 署名** ——
写上去等于把一份我们并不承担的义务揽到自己头上。

**它现在退成了兜底**:演示图 1324/1324 全覆盖之后,库里的动作不会再走到这张图,
唯一会走到的是自定义动作(而自定义动作本来就没有肌群,也就不会问图)。留着它的理由是
上一节那批 GIF 的授权还没落定 —— 真要撤下来,这张图是唯一接得住的东西。
(2026-10-16 之前它接的是另外 1182 条没有演示图的动作,那段历史见上一节 3.0。)

按肌群而不是按动作出图:库里 1324 条动作的 `target` 只有 19 种取值,一个肌群一张。
库里出现新肌群而这里没画,生成脚本会**直接报错退出**(而不是悄悄少一张图)。

重新生成:`node scripts/build-muscle-figures.mjs`(详见脚本头注释)。

## 4. 明确未使用

- openGym 的**代码**(AGPL-3.0)未复制;
- openGym 自己那批动作图片(同样来自 Gym visual)未使用 —— 我们取的是上游数据集里的原始
  GIF,**没有**经 openGym 中转。注意这不改变版权归属:媒体仍是 Gym visual 的,
  和第 3 节是同一批东西、同一个待办;
- free-exercise-db 的**图片**未使用(同上,第 2 节);
- everkinetic/data 的**文字**(步骤/提示/引言)未使用,图片也已弃用(同上,第 3.0 节)。

生成方式:`node scripts/build-exercise-lib.mjs`(动作文本)、
`node scripts/build-exercise-gifs.mjs`(演示图)与
`node scripts/build-muscle-figures.mjs`(肌群示意图,自绘),详见各自脚本头注释。
