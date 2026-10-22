import { Canvas, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { axisText, chartDomain, pickIndex, valueText, worthTarget } from '@/utils/chart';
import { CHART_INK, currentTheme, onThemeSwitch, themedColor } from '@/utils/theme';
import './index.scss';

interface Point {
  label: string;
  value: number;
}

/**
 * 小程序 canvas 的触摸事件:坐标是**相对 canvas**的(`touches[0].x`)。
 * 不声明成 Taro 的通用事件类型,是因为这里只读两个字段 —— 宽进窄出。
 */
interface ChartTouch {
  touches?: { x?: number }[];
  detail?: { x?: number };
}

interface LineChartProps {
  points: Point[];
  /** 调用方强指纵轴范围(不给就按数据算,见 `utils/chart.chartDomain`) */
  domain?: [number, number];
  color?: string;
  height?: number;
  canvasId: string;
  /** 目标线(虚线 + 右侧小字)。画不进来的线等于没画,所以它会参与算域 */
  target?: { value: number; label: string } | null;
  /** 读数后面的单位(「65.2 公斤」)。不传就只有数字 */
  unit?: string;
  /**
   * 末点读数气泡:`true` = 用最后一个点的「值 + 单位」,字符串 = 自定义文案。
   * 首页那张体重卡只摆一条曲线,最新值是图的落点而不是另一行数字,
   * 所以让图自己把它标出来(设计稿就是那个「77.8kg」的小标签)。
   */
  endBadge?: boolean | string;
  /**
   * 没点选时是否显示「点曲线看具体数值」。
   * 设计稿里图下面直接是别的内容时传 false;点过之后读数照样出现。
   */
  hint?: boolean;
  /** 点选回调 —— 想和别处联动的调用方才需要(比如把读数写进标题) */
  onPick?: (p: Point, i: number) => void;
}

/**
 * Canvas 折线图(微信小程序 2d,无第三方依赖)—— 全站曲线的**唯一**画法。
 *
 * 三个能读的地方,都是 2026-10-16 补的(此前它只是一条线加几个点,
 * 用户看得出「在涨」但读不出「涨到多少」,鼠标年代的习惯在手机上不成立 —— 没有 hover):
 *  · **纵轴刻度**:上下各一个数(念得出来的整数,见 `chartDomain`),横轴首末两个日期。
 *    画在 canvas 里而不是摆 View:90 天的曲线要是每个点一个节点,小程序直接卡死。
 *  · **目标线**:体重曲线摆在目标体重上、热量曲线摆在每日热量目标上 ——
 *    「还差多少」以前只能靠用户自己拿眼睛比。
 *  · **点选读数**:手指点(或按住拖)哪一段,就报那个点的日期和值,读数写在图下面那一行。
 *    不在图里画气泡:canvas 里的小字缩放到手机上看不清,而且那一行本来就在摆提示语。
 *
 * 性能上的两条:量一次 canvas 就存进 ref,触摸时只重画不重新查询节点;
 * 选中的下标存在 ref 里(重画读它),state 只用来更新那一行读数文字。
 */
export default function LineChart({
  points,
  domain,
  color = '#176b55',
  height = 120,
  canvasId,
  target,
  unit = '',
  endBadge,
  hint = true,
  onPick
}: LineChartProps) {
  /* 量出来的绘图区(重画要用),以及「现在选中的是第几个」——画的时候读 ref,不读 state */
  const sizeRef = useRef({ left: 0, width: 0 });
  const drawRef = useRef<() => void>(() => {});
  const pickRef = useRef<number | null>(null);
  /**
   * 选中**自己带着序列的签名**:换时间档(7 天 → 30 天)之后「第 5 个点」指的是另一天,
   * 签名对不上就当没选过(那一行退出读数、回到提示语)——
   * 和列表分页那套「状态自带作用域」同一个道理,别改成单独一个下标再处处记着清。
   */
  const key = `${points.length}:${points[0]?.label ?? ''}:${points[points.length - 1]?.label ?? ''}`;
  const [pick, setPick] = useState<{ key: string; i: number } | null>(null);
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    pickRef.current = null;
  }

  useEffect(() => {
    if (!points.length) return;
    const query = Taro.createSelectorQuery();
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res?.[0]?.node;
        if (!canvas) return;
        const dpr = Taro.getSystemInfoSync().pixelRatio;
        const measuredWidth = Number.isFinite(res[0].width) && res[0].width > 0 ? res[0].width : 320;
        const measuredHeight = Number.isFinite(res[0].height) && res[0].height > 0 ? res[0].height : height;
        canvas.width = measuredWidth * dpr;
        canvas.height = measuredHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        sizeRef.current = { left: PAD_L, width: measuredWidth - PAD_L - PAD_R };
        drawRef.current = () => draw(ctx, measuredWidth, measuredHeight);
        drawRef.current();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, domain?.[0], domain?.[1], color, target?.value, target?.label, unit, endBadge, height, canvasId]);

  /* 深色模式切换时 canvas 读不到 CSS 变量,得整张重画一遍才换得上墨色 */
  useEffect(() => onThemeSwitch(() => drawRef.current()), []);

  /**
   * 点选:按最近的点算(见 `utils/chart.pickIndex`)—— 落在留白里、甚至图外面也算头尾那一点,
   * 不用精确戳中那个 2.5px 的圆。按住横向拖也走这条(同一个点不重复上报)。
   */
  const onTouch = (e: ChartTouch) => {
    if (!points.length || !sizeRef.current.width) return;
    const x = e?.touches?.[0]?.x ?? e?.detail?.x;
    if (typeof x !== 'number') return;
    const i = pickIndex(x, sizeRef.current.left, sizeRef.current.width, points.length);
    if (pickRef.current === i) return;
    pickRef.current = i;
    setPick({ key, i });
    drawRef.current();
    onPick?.(points[i], i);
  };

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.clearRect(0, 0, w, h);
    if (points.length === 0) return;

    /* canvas 读不到 CSS 变量,墨色按当前模式整组取(见 utils/theme.ts) */
    const ink = CHART_INK[currentTheme()];
    const line = themedColor(color);

    const values = points.map((p) => p.value);
    /* 目标太远就不画(否则曲线被压平),见 utils/chart.worthTarget —— 算域和画线用同一个判断 */
    const t = target && worthTarget(values, target.value) ? target : null;
    const d = chartDomain(values, t?.value ?? null);
    const min = domain?.[0] ?? d.min;
    const max = domain?.[1] ?? d.max;
    const step = domain ? (max - min) / 3 : d.step;
    const span = max - min || 1;

    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    const plotBottom = h - PAD_B;
    const xOf = (i: number) => PAD_L + (points.length > 1 ? (plotW / (points.length - 1)) * i : plotW / 2);
    const yOf = (v: number) => PAD_T + plotH - ((v - min) / span) * plotH;
    const coords = points.map((p, i) => ({ x: xOf(i), y: yOf(p.value) }));

    /* 横向参考线先画(在面积下面),曲线才不会被切成几段:
       上/中/下三条淡虚线,读值时眼睛有把尺子 */
    const midY = yOf(min + span / 2);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = ink.grid;
    ctx.lineWidth = 1;
    [PAD_T, midY, plotBottom].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(w - PAD_R, y);
      ctx.stroke();
    });
    ctx.restore();

    /* 刻度:上下中三个数;横轴点数不多时每个点都标日期(对齐设计稿),
       多了就只标首末两个 —— 90 个日期挤在一行,一个都读不出来 */
    ctx.font = '10px sans-serif';
    ctx.fillStyle = ink.axis;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(axisText(max, step), PAD_L - 6, PAD_T - 4);
    ctx.textBaseline = 'middle';
    ctx.fillText(axisText(min + span / 2, step), PAD_L - 6, midY);
    ctx.textBaseline = 'bottom';
    ctx.fillText(axisText(min, step), PAD_L - 6, plotBottom + 4);
    ctx.textBaseline = 'top';
    if (points.length <= 7) {
      ctx.textAlign = 'center';
      points.forEach((p, i) => {
        const half = ctx.measureText(p.label).width / 2;
        const tx = Math.min(Math.max(xOf(i), half + 2), w - half - 2);
        ctx.fillText(p.label, tx, plotBottom + 4);
      });
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(points[0].label, PAD_L, plotBottom + 4);
      ctx.textAlign = 'right';
      ctx.fillText(points[points.length - 1].label, w - PAD_R, plotBottom + 4);
    }

    /* 渐变填充区域 */
    ctx.beginPath();
    coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.lineTo(coords[coords.length - 1].x, plotBottom);
    ctx.lineTo(coords[0].x, plotBottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_T, 0, plotBottom);
    grad.addColorStop(0, hexA(line, 0.13));
    grad.addColorStop(1, hexA(line, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    /* 折线 */
    ctx.beginPath();
    coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    /* 目标线:虚线 + 右端一行小字(字压在线上面,免得和横轴刻度挤在一起) */
    if (t) {
      const ty = yOf(t.value);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ink.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_L, ty);
      ctx.lineTo(w - PAD_R, ty);
      ctx.stroke();
      ctx.restore();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = ink.label;
      ctx.fillText(`${t.label} ${valueText(t.value)}${unit}`, w - PAD_R, ty - 2);
    }

    /* 数据点 */
    coords.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = line;
      ctx.fill();
    });

    /* 末点:白圈垫底 + 实心点 —— 曲线最后落在哪儿,是这张图最该被看见的一处。
       只有一个点时也画(它就是「现在」),所以不依赖 coords.length > 1 */
    const last = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = ink.cardFill;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = line;
    ctx.fill();

    /* 末点读数气泡:首页那张卡的最新体重就长在曲线头上,不再另起一行大数字。
       贴点上方;顶到画布上沿就翻到点下面,免得被裁掉 */
    const badge =
      endBadge === true
        ? `${valueText(points[points.length - 1].value)}${unit}`
        : typeof endBadge === 'string'
          ? endBadge
          : '';
    if (badge) {
      ctx.font = '600 11px sans-serif';
      const bw = ctx.measureText(badge).width + 15;
      const bh = 19;
      const bx = Math.min(Math.max(last.x - bw / 2, PAD_L), w - PAD_R - bw);
      const by = last.y - bh - 8 < 0 ? last.y + 8 : last.y - bh - 8;
      roundRect(ctx, bx, by, bw, bh, 9.5);
      ctx.fillStyle = line;
      ctx.fill();
      ctx.fillStyle = ink.badgeText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, bx + bw / 2, by + bh / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    /* 选中的那一点:一条竖向参考线 + 一个圈 —— 读数在图下面那一行,这里只标「是哪一个」 */
    const sel = pickRef.current;
    if (sel != null && sel < coords.length) {
      const c = coords[sel];
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = ink.guide;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x, PAD_T);
      ctx.lineTo(c.x, plotBottom);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = ink.cardFill;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = line;
      ctx.fill();
    }
  }

  const sel = pick && pick.key === key && pick.i < points.length ? points[pick.i] : null;
  return (
    <View className="line-chart">
      <Canvas
        type="2d"
        id={canvasId}
        className="chart-canvas"
        style={{ width: '100%', height: `${height}px` }}
        onTouchStart={onTouch}
        onTouchMove={onTouch}
      />
      {/* 这一行既是提示也是读数:没点过说什么能点,点过就换成那个点的日期和值。
          `hint=false` 时没点过就不占这一行,点下去读数照常出现 */}
      {(hint || sel) && (
        <Text className={`line-chart__read${sel ? ' is-on' : ''}`}>
          {sel ? `${sel.label} · ${valueText(sel.value)}${unit}` : '点曲线看具体数值'}
        </Text>
      )}
    </View>
  );
}

/** 绘图区边距:左边留给纵轴那两个数,下边留给横轴那两个日期,右边只留一点喘气 */
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 18;

/** 圆角矩形路径。不用 ctx.roundRect —— 老基础库没有,画不出来就是一块直角 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** #RRGGBB → rgba */
function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
