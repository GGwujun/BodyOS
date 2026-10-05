import { Canvas, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef } from 'react';
import './index.scss';

interface Point {
  label: string;
  value: number;
}

interface LineChartProps {
  points: Point[];
  domain?: [number, number];
  color?: string;
  height?: number;
  canvasId: string;
}

/**
 * Canvas 折线图(微信小程序 2d,无第三方依赖)。
 * 用于 Trends 页体重/评分趋势。
 */
export default function LineChart({
  points,
  domain,
  color = '#2ecc71',
  height = 120,
  canvasId
}: LineChartProps) {
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const width = 320;

  useEffect(() => {
    if (points.length === 0) return;
    const query = Taro.createSelectorQuery();
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res?.[0]?.node;
        if (!canvas) return;
        const dpr = Taro.getSystemInfoSync().pixelRatio;
        const measuredWidth = Number.isFinite(res[0].width) && res[0].width > 0 ? res[0].width : width;
        const measuredHeight = Number.isFinite(res[0].height) && res[0].height > 0 ? res[0].height : height;
        canvas.width = measuredWidth * dpr;
        canvas.height = measuredHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctxRef.current = ctx;
        draw(ctx, measuredWidth, measuredHeight);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, domain, color]);

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.clearRect(0, 0, w, h);
    if (points.length === 0) return;

    const padX = 12;
    const padY = 14;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;

    const values = points.map((p) => p.value);
    let min = domain?.[0] ?? Math.min(...values);
    let max = domain?.[1] ?? Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coords = points.map((p, i) => ({
      x: padX + i * stepX,
      y: padY + innerH - ((p.value - min) / (max - min)) * innerH
    }));

    // 渐变填充区域
    ctx.beginPath();
    coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.lineTo(coords[coords.length - 1].x, padY + innerH);
    ctx.lineTo(coords[0].x, padY + innerH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padY, 0, padY + innerH);
    grad.addColorStop(0, hexA(color, 0.22));
    grad.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 数据点
    coords.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  return (
    <View className="line-chart" style={{ height: `${height}px` }}>
      <Canvas type="2d" id={canvasId} className="chart-canvas" style={{ width: '100%', height: `${height}px` }} />
    </View>
  );
}

/** #RRGGBB → rgba */
function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
