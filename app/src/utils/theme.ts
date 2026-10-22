/**
 * 运行时主题(浅/深)—— 给 canvas、showModal 这类**读不到 CSS 变量**的地方用。
 *
 * 样式表那边深色靠 tokens.scss 的 @media 整段切换,不经过这个文件;
 * 这里只回答两件事:「现在系统是什么模式」和「canvas 里该用哪组色」。
 * 老基础库拿不到 theme 就一律按浅色 —— 图表照常出,只是颜色不变。
 */
import Taro from '@tarojs/taro';

export type ThemeMode = 'light' | 'dark';

let mode: ThemeMode = 'light';
let inited = false;
const listeners = new Set<(m: ThemeMode) => void>();

function init(): void {
  if (inited) return;
  inited = true;
  try {
    const info = Taro.getSystemInfoSync() as Taro.getSystemInfoSync.Result & { theme?: string };
    mode = info.theme === 'dark' ? 'dark' : 'light';
  } catch {
    /* 拿不到系统信息就按浅色 */
  }
  try {
    const api = Taro as unknown as {
      onThemeChange?: (cb: (res: { theme: string }) => void) => void;
    };
    api.onThemeChange?.((res) => {
      mode = res.theme === 'dark' ? 'dark' : 'light';
      listeners.forEach((fn) => fn(mode));
    });
  } catch {
    /* 老基础库没有 onThemeChange:用户在控制中心切换主题时已打开的 canvas 不会跟着换,
       下次进页面才换新色。可接受 —— 那是切主题瞬间的边角,不是常态 */
  }
}

/** 当前模式(首次调用时顺带初始化监听) */
export function currentTheme(): ThemeMode {
  init();
  return mode;
}

/** 订阅主题变化(返回退订函数)。主题在后台被切换、回到前台时触发 */
export function onThemeSwitch(fn: (m: ThemeMode) => void): () => void {
  init();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 折线图在深色下的整组墨色 —— 和 tokens.scss 深色段同一套值,
 * 改那边记得同步这边(canvas 吃不了 var(),只能再抄一份)。
 */
export const CHART_INK: Record<ThemeMode, {
  axis: string;      /* 纵轴刻度/目标虚线 */
  label: string;     /* 目标线旁的小字 */
  grid: string;      /* 三条横向参考虚线 */
  guide: string;     /* 选中点的竖向参考虚线(浅色那档边线太淡,单列一档) */
  cardFill: string;  /* 末点/选中点垫底的那个圆 —— 得和卡片底色一致才像「镂空」 */
  badgeText: string; /* 末点读数气泡的字色(气泡底是折线色,浅色线配深字) */
}> = {
  light: {
    axis: '#8a958f',
    label: '#4c5b54',
    grid: 'rgba(23, 107, 85, .13)',
    guide: '#d9d4c7',
    cardFill: '#fffefa',
    badgeText: '#fffefa'
  },
  dark: {
    axis: '#838d85',
    label: '#b6c0b8',
    grid: 'rgba(63, 165, 132, .18)',
    guide: '#3d453e',
    cardFill: '#1c211d',
    badgeText: '#0d211a'
  }
};

/**
 * canvas/原生控件用的颜色:调用方传的是浅色模式那套十六进制(THEME.xxx 或字面量),
 * 深色底下这些色会沉进卡片里 —— 按表提亮。没登记的颜色原样返回。
 * 键值对齐 constants/theme.ts ↔ tokens.scss 深色段,三处一起改。
 */
const LINE_DARK: Record<string, string> = {
  '#176b55': '#3fa584', // primary
  '#11503f': '#8fd2b6', // primary-dark
  '#4f7382': '#8fb3c2', // info
  '#b07a2a': '#d2a05a', // warning
  '#5a8ca0': '#7fb0c2', // sky
  '#8b7aa8': '#ab9cc6', // muscle-high(紫)
  '#5c7fa3': '#84a8c8', // muscle-low
  '#8f6322': '#d8ab63', // amber
  '#a94f5c': '#d0868f', // rose
  '#8dae91': '#8dae91', // sage(中间调,两套通用)
  '#8a958f': '#838d85', // muted/tertiary
  /* BodyMap(肌群图)的底子色:浅色是人形剪影的暖米色,深色翻成暗一档的底 */
  '#e6e1d3': '#3d453e', // 剪影(头/手/脚)
  '#dcd6c7': '#39413a', // 没着色的肌肉
  '#fffefa': '#1c211d'  // 肌肉之间的缝 = 卡片底色
};

/** 颜色按当前模式取值(深色下提亮,浅色原样)。折线、canvas、Switch/Slider 都走它 */
export function themedColor(hex: string): string {
  return currentTheme() === 'dark' ? LINE_DARK[hex.toLowerCase()] ?? hex : hex;
}
