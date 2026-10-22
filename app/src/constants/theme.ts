/**
 * 颜色在 TS 这一侧的唯一入口。
 *
 * 原生组件读不到 scss:`<Switch color>`、`<Slider activeColor>`、折线图的
 * `color=`,还有 `Taro.showModal` 的 `confirmColor`,都只能收一个字符串。
 * 于是同一个品牌绿在 tsx 里被手打了十几遍 —— 以后换一次色,改的是一处还是十几处,
 * 差别就在这个文件上。
 *
 * 它是 variables.scss 的一份**手工对照表**,不是同一个东西:scss 那边改了这边也要改。
 * 两份表各有各的用处(一个给样式表,一个给原生属性),但每边都只应该出现一次。
 */
export const THEME = {
  /** 品牌主色,对齐 $color-primary */
  primary: '#176b55',
  /** 数据/信息,$color-info */
  info: '#4f7382',
  /** 数值/强调,$color-warning */
  warning: '#b07a2a',
  /** 另一条数据线(步数等),$color-sky */
  sky: '#5a8ca0',
  /** 力量训练/肌群强调,$color-muscle-high */
  plum: '#8b7aa8',
  /** 碳水/暖色数据,$color-amber-dark */
  amber: '#8f6322',
  /** 脂肪/玫瑰色数据,$color-rose */
  rose: '#a94f5c',
  /** 中性次要(图表空档、未激活图标),$color-text-tertiary */
  muted: '#8a958f',
  /** 警示/破坏性动作,$color-danger */
  danger: '#b04a3f'
} as const;
