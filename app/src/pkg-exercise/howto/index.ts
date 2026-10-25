export { default } from './HowTo';
/* 演示图单独出去一格:训练页要把它摆在「正在做的那个动作」上面,
   而那一处不需要整套图 + chip + 步骤(见 workout/index.tsx 里那段) */
export { DemoImage } from './HowTo';
/* 自建动作的用户配图也单独出去:训练页和这里要的是同一条优先级链
   (演示图 > 用户配图 > 肌群示意图),两边各挑一支就该共用同一个组件 */
export { MineImage } from './HowTo';
/* 「练哪儿」示意图也单独出去:同样是训练页要用的那一小块 ——
   没有演示图的动作(自定义动作、以及万一演示图那批撤了),那一格摆的就是它 */
export { FigureImage } from './HowTo';
