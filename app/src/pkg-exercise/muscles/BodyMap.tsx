import { useEffect, useRef, useState } from 'react';
import { Canvas, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import type { MuscleGroup } from '../engine/muscles';
import { GROUP_ORDER } from '../engine/muscles';
import { onThemeSwitch, themedColor } from '@/utils/theme';
import { BODY_GEOMETRY, type BodySide } from './body-geometry';
import './BodyMap.scss';

/**
 * 身体肌群图 —— 解剖轮廓 + 可点的七个大组。
 *
 * 形状来自 MuscleMap(MIT)的矢量路径,构建期摊平成多边形存在 body-geometry.ts 里
 * (见 scripts/build-body-map.mjs)。这里用 Canvas 2D 画:
 *   - 同一张图在恢复/容量两种口径下要换五档颜色,还要有选中描边;
 *     预渲染成图片就是 7 组 × 5 档 × 2 面的一堆文件,进分包太贵。
 *   - 小程序没有内联 SVG,`<Image src="data:image/svg+xml…">` 在部分基础库上不可靠。
 *   Canvas 是唯一能按任意配色实时重画、又保持真实轮廓的路子。
 *
 * 点击不靠「叠一层透明热区」:解剖形状互相咬合,方块热区必然串味。
 * 改成把触点换算回 viewBox 坐标,再做多边形命中测试。
 */
export type Tone = 'fresh' | 'ok' | 'tired' | 'none' | 'high' | 'low';

export interface BodyMapProps {
  /** 每个大组当前的颜色档 */
  tone: Record<MuscleGroup, Tone>;
  /** 正面 / 背面 */
  side: BodySide;
  /** 选中的大组 */
  active?: MuscleGroup | null;
  /** 点某个大组 */
  onPick?: (g: MuscleGroup) => void;
}

/** 和 tokens 对齐:主色 / 琥珀 / 砖红 / 肌群紫 / 肌群蓝 */
const TONE_COLOR: Record<Tone, string> = {
  fresh: '#176b55',
  ok: '#b07a2a',
  tired: '#b04a3f',
  high: '#8b7aa8',
  low: '#5c7fa3',
  none: '#dcd6c7'
};

const SIL = '#e6e1d3';      // 头/手/脚等不参与统计的部位
const MUSCLE = '#dcd6c7';   // 没有颜色的肌肉
const EDGE = '#fffefa';     // 肌肉之间的缝 = 卡片底色
const ACTIVE = '#11503f';

let seq = 0;

interface DrawSurface {
  node: { width: number; height: number; getContext: (k: string) => CanvasRenderingContext2D };
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  scale: number;
  ox: number;
  oy: number;
}

/** 点在多边形内(射线法)。坐标已换算到 viewBox。 */
function inPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1];
    const xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function bboxArea(poly: number[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    if (poly[i] < minX) minX = poly[i];
    if (poly[i] > maxX) maxX = poly[i];
    if (poly[i + 1] < minY) minY = poly[i + 1];
    if (poly[i + 1] > maxY) maxY = poly[i + 1];
  }
  return (maxX - minX) * (maxY - minY);
}

export default function BodyMap({ tone, side, active, onPick }: BodyMapProps) {
  const [uid] = useState(() => `bm-canvas-${++seq}`);
  const hitId = `${uid}-hit`;
  const surface = useRef<DrawSurface | null>(null);
  const alive = useRef(true);
  const tries = useRef(0);
  const drawRef = useRef<() => void>(() => {});

  // 每次渲染刷新绘制闭包,init 完成时和 props 变化时都调最新的那次
  drawRef.current = () => {
    const s = surface.current;
    if (!s) return;
    const geo = BODY_GEOMETRY[side];
    const { view, inert, groups } = geo;
    const { ctx, node, w, h, dpr } = s;
    const scale = Math.min(w / view.w, h / view.h);
    const ox = (w - view.w * scale) / 2 - view.x * scale;
    const oy = (h - view.h * scale) / 2 - view.y * scale;
    s.scale = scale;
    s.ox = ox;
    s.oy = oy;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, node.width, node.height);
    // 直接以 viewBox 坐标作图,线宽也按 viewBox 单位给
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const trace = (poly: number[]) => {
      ctx.beginPath();
      ctx.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
      ctx.closePath();
    };

    // 深色模式下整个人形的底子色和档位色都要换(canvas 读不到 CSS 变量,
    // 走 utils/theme 的映射表 —— 那边的注释说明了三处同步的规矩)
    const SIL_T = themedColor(SIL);
    const EDGE_T = themedColor(EDGE);
    const MUSCLE_T = themedColor(MUSCLE);
    const ACTIVE_T = themedColor(ACTIVE);

    // 1. 剪影
    ctx.fillStyle = SIL_T;
    ctx.strokeStyle = EDGE_T;
    ctx.lineWidth = 2.4;
    for (const poly of inert) {
      trace(poly);
      ctx.fill();
      ctx.stroke();
    }

    // 2. 全部肌肉打底 —— 没上色的组也要看得见形状
    ctx.fillStyle = MUSCLE_T;
    for (const g of GROUP_ORDER) {
      for (const poly of groups[g] ?? []) {
        trace(poly);
        ctx.fill();
        ctx.stroke();
      }
    }

    // 3. 有大组颜色的,覆盖上色
    for (const g of GROUP_ORDER) {
      const t = tone[g];
      if (!t || t === 'none') continue;
      ctx.fillStyle = themedColor(TONE_COLOR[t]);
      for (const poly of groups[g] ?? []) {
        trace(poly);
        ctx.fill();
        ctx.stroke();
      }
    }

    // 4. 选中:描一圈主色深边
    if (active && groups[active]) {
      ctx.strokeStyle = ACTIVE_T;
      ctx.lineWidth = 12;
      for (const poly of groups[active] ?? []) {
        trace(poly);
        ctx.stroke();
      }
    }
  };

  const init = () => {
    if (surface.current) return;
    Taro.createSelectorQuery()
      .select(`#${uid}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!alive.current || surface.current) return;
        const item = (res?.[0] ?? null) as
          | { node?: DrawSurface['node']; width?: number; height?: number }
          | null;
        if (!item?.node || !item.width || !item.height) {
          // 布局还没完成 —— 下一页帧再取一次。最多试 20 次(约 1.2 秒),
          // 取不到就保持空白:无限重试只会让一个画不出来的组件一直占着定时器。
          if (tries.current < 20) {
            tries.current += 1;
            setTimeout(() => {
              if (alive.current && !surface.current) init();
            }, 60);
          }
          return;
        }
        let dpr = 2;
        try { dpr = Taro.getSystemInfoSync().pixelRatio || 2; } catch { /* 老基础库就按 2 画 */ }
        const node = item.node;
        node.width = Math.round(item.width * dpr);
        node.height = Math.round(item.height * dpr);
        const ctx = node.getContext('2d');
        if (!ctx) return;
        surface.current = {
          node,
          ctx,
          w: item.width,
          h: item.height,
          dpr,
          scale: 1,
          ox: 0,
          oy: 0
        };
        drawRef.current();
      });
  };

  useEffect(() => {
    alive.current = true;
    init();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 深浅切换时整张重画(和 LineChart 同一条规矩) */
  useEffect(() => onThemeSwitch(() => drawRef.current()), []);

  const toneKey = GROUP_ORDER.map((g) => tone[g]).join('');
  useEffect(() => {
    drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toneKey, active, side]);

  // 从别的页面切回来时,极少数机型会把原生画布清掉
  useDidShow(() => { drawRef.current(); });

  const onTap = (event: unknown) => {
    if (!onPick) return;
    const s = surface.current;
    if (!s) return;
    const e = event as {
      changedTouches?: Array<{ clientX: number; clientY: number }>;
      touches?: Array<{ clientX: number; clientY: number }>;
      detail?: { x: number; y: number };
    };
    const touch = e.changedTouches?.[0] ?? e.touches?.[0];
    // changedTouches 是视口坐标;有些环境只给 detail.x/y,那是页面坐标,得补滚动量
    const pageX = touch?.clientX ?? e.detail?.x ?? 0;
    const pageY = touch?.clientY ?? e.detail?.y ?? 0;
    const fromDetail = !touch;
    const q = Taro.createSelectorQuery();
    q.select(`#${hitId}`).boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      const rect = (res?.[0] ?? null) as { left: number; top: number } | null;
      const scroll = (res?.[1] ?? null) as { scrollLeft?: number; scrollTop?: number } | null;
      if (!rect) return;
      if (fromDetail) {
        const sx = scroll?.scrollLeft ?? 0;
        const sy = scroll?.scrollTop ?? 0;
        const vx = (pageX - sx - rect.left - s.ox) / s.scale;
        const vy = (pageY - sy - rect.top - s.oy) / s.scale;
        hitAt(vx, vy);
      } else {
        const vx = (pageX - rect.left - s.ox) / s.scale;
        const vy = (pageY - rect.top - s.oy) / s.scale;
        hitAt(vx, vy);
      }
    });

    const hitAt = (vx: number, vy: number) => {
      if (!onPick) return;
      const groups = BODY_GEOMETRY[side].groups;
      // 交叠处(比如三角肌压着胸)选面积更小的那块,免得大地块把小块吃掉
      let hit: MuscleGroup | null = null;
      let hitArea = Infinity;
      for (const g of GROUP_ORDER) {
        for (const poly of groups[g] ?? []) {
          if (!inPolygon(vx, vy, poly)) continue;
          const area = bboxArea(poly);
          if (area < hitArea) {
            hitArea = area;
            hit = g;
          }
        }
      }
      if (hit) onPick(hit);
    };
  };

  return (
    <View className="bm">
      <View className="bm-figure">
        <Canvas
          id={uid}
          canvasId={uid}
          type="2d"
          className="bm-canvas"
        />
        <View id={hitId} className="bm-hit" onClick={onTap} />
      </View>
      <Text className="bm-side">{side === 'front' ? '正面' : '背面'}</Text>
    </View>
  );
}
