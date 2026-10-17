import { View, Text } from '@tarojs/components';
import type { MuscleGroup } from '../engine/muscles';
import './BodyMap.scss';

/**
 * 身体肌群图 — 用方块拼出的简化人形,每个部位可点。
 *
 * 为什么不用 Canvas:小程序里 Canvas 要自己处理 DPR、真机首帧偶发空白、还不好做点击热区;
 * 这七个部位用绝对定位的圆角方块拼出来,同样是「一眼看出哪里该歇了」,
 * 但天然可点、可换色、跟着主题走。轮廓是示意,不是解剖图 —— 用户要的是位置感。
 */
export type Tone = 'fresh' | 'ok' | 'tired' | 'none' | 'high' | 'low';

export interface BodyMapProps {
  /** 每个部位当前的颜色档 */
  tone: Record<MuscleGroup, Tone>;
  /** 正面 / 背面 */
  side: 'front' | 'back';
  /** 选中的部位(没有则 null) */
  active?: MuscleGroup | null;
  /** 点某个部位 */
  onPick?: (g: MuscleGroup) => void;
}

/** 各部位的位置与形状(百分比,跟着容器缩放) */
interface Part {
  g: MuscleGroup;
  style: Record<string, string>;
  label?: boolean;
}

/** 图上写短名 —— 「核心腰腹」「臀腿」写不进巴掌大的方块里 */
const SHORT: Record<MuscleGroup, string> = {
  chest: '胸', back: '背', shoulder: '肩', arm: '臂', core: '核心', leg: '臀腿', calf: '小腿'
};

const FRONT: Part[] = [
  { g: 'shoulder', style: { left: '23%', top: '13%', width: '13%', height: '9%' } },
  { g: 'shoulder', style: { left: '64%', top: '13%', width: '13%', height: '9%' } },
  { g: 'chest', style: { left: '31%', top: '17%', width: '38%', height: '15%' }, label: true },
  { g: 'arm', style: { left: '19%', top: '22%', width: '11%', height: '30%' } },
  { g: 'arm', style: { left: '70%', top: '22%', width: '11%', height: '30%' } },
  { g: 'core', style: { left: '33%', top: '33%', width: '34%', height: '14%' } },
  { g: 'leg', style: { left: '33%', top: '48%', width: '15%', height: '26%' } },
  { g: 'leg', style: { left: '52%', top: '48%', width: '15%', height: '26%' } },
  { g: 'calf', style: { left: '34%', top: '75%', width: '13%', height: '19%' } },
  { g: 'calf', style: { left: '53%', top: '75%', width: '13%', height: '19%' } }
];

const BACK: Part[] = [
  { g: 'shoulder', style: { left: '23%', top: '13%', width: '13%', height: '9%' } },
  { g: 'shoulder', style: { left: '64%', top: '13%', width: '13%', height: '9%' } },
  { g: 'back', style: { left: '31%', top: '17%', width: '38%', height: '18%' }, label: true },
  { g: 'arm', style: { left: '19%', top: '22%', width: '11%', height: '30%' } },
  { g: 'arm', style: { left: '70%', top: '22%', width: '11%', height: '30%' } },
  { g: 'core', style: { left: '33%', top: '36%', width: '34%', height: '10%' } },
  { g: 'leg', style: { left: '32%', top: '45%', width: '36%', height: '10%' }, label: true },
  { g: 'leg', style: { left: '33%', top: '52%', width: '15%', height: '23%' } },
  { g: 'leg', style: { left: '52%', top: '52%', width: '15%', height: '23%' } },
  { g: 'calf', style: { left: '34%', top: '77%', width: '13%', height: '17%' } },
  { g: 'calf', style: { left: '53%', top: '77%', width: '13%', height: '17%' } }
];

export default function BodyMap({ tone, side, active, onPick }: BodyMapProps) {
  const parts = side === 'front' ? FRONT : BACK;
  const cls = (g: MuscleGroup) =>
    `bm-part bm-part--${tone[g]}${active === g ? ' bm-part--active' : ''}`;
  const pick = (g: MuscleGroup) => () => onPick?.(g);

  return (
    <View className="bm">
      <View className="bm-figure">
        {/* 头与颈是固定装饰,不参与统计 */}
        <View className="bm-head" />
        <View className="bm-neck" />
        {parts.map((p, i) => (
          <View
            className={cls(p.g)}
            key={`${p.g}-${i}`}
            style={p.style}
            onClick={pick(p.g)}
          >
            {p.label && <Text className="bm-part-t">{SHORT[p.g]}</Text>}
          </View>
        ))}
      </View>
      <Text className="bm-side">{side === 'front' ? '正面' : '背面'}</Text>
    </View>
  );
}
