/**
 * 进阶组型 — 把「N 组 × 同重量同次数」展开成具体的每组目标。
 * 组型只改变组内安排,不改变渐进规则(渐进仍以正式重量那一组为准)。
 */

import { evenReps } from './types';

export type SetType = 'normal' | 'drop' | 'failure' | 'pyramid' | 'backoff';

export const SETTYPE_ZH: Record<SetType, string> = {
  normal: '常规组',
  drop: '递减组',
  failure: '力竭组',
  pyramid: '金字塔组',
  backoff: '降重组'
};

export const SETTYPE_DESC: Record<SetType, string> = {
  normal: '每组同样的重量、同样的次数,最省心',
  drop: '最后一组做完立刻减重接着做,中间不休息,把刺激榨干',
  failure: '最后一组做到实在做不动(留 0 次余力),适合小重量孤立动作',
  pyramid: '重量逐组递增、次数逐组递减,最后一组最重',
  backoff: '先用正式重量做完,最后一组减重做更多次收尾'
};

/** 组型是否适用于该动作(自重动作没有递减/金字塔的配重语义) */
export function setTypeAvailable(type: SetType, weightKg: number | null): boolean {
  if (type === 'drop' || type === 'pyramid') return weightKg != null;
  if (type === 'backoff') return weightKg != null;
  if (type === 'failure') return true; // 徒手也能练到力竭
  return true;
}

/** 展开后的一组:本次要做多少次、用多重、要不要额外提示 */
export interface SetSeed {
  reps: number;
  weightKg: number | null;
  /** 行尾小标签(空串=普通组) */
  tag: string;
  /** 该组的额外说明(力竭/递减的做法提示) */
  note?: string;
}

export interface SetBase {
  sets: number;
  repsMin: number;
  repsMax: number;
  weightKg: number | null;
  /** 末组尽力(AMRAP):最后一组做完目标次数还有余力就继续做 */
  amrapLast?: boolean;
  /** 单侧动作(次数是两侧合计)— 展开出的次数一律取偶数,见 engine/sided.ts */
  sided?: boolean;
}

/**
 * 按组型展开每组目标。
 * @param step 加重步长 — 展开出的重量会对齐到它,避免出现配不出的重量
 */
export function expandSets(base: SetBase, type: SetType, step = 2.5, workSetOk = true): SetSeed[] {
  const n = Math.max(1, Math.round(base.sets) || 1);
  const w = base.weightKg;
  const unit = step > 0 ? step : 2.5;
  const snap = (x: number) => Math.max(unit, Math.round(x / unit) * unit);
  // 单侧动作:每组目标次数都取偶数(金字塔按区间插值最容易插出奇数 —— 每侧 9.5 次没法做)
  const repsOf = (x: number) => (base.sided ? evenReps(x) : x);

  const plain: SetSeed[] = Array.from({ length: n }, () => ({ reps: repsOf(base.repsMin), weightKg: w, tag: '' }));
  // 末组尽力:和目标次数不冲突,任何组型都能挂(退化成常规组时也保留)
  const amrap = (list: SetSeed[]): SetSeed[] => {
    if (!base.amrapLast || !list.length) return list;
    const last = list[list.length - 1];
    return [...list.slice(0, -1), {
      ...last,
      tag: last.tag ? `${last.tag}·尽力` : '尽力',
      note: last.note
        ? `${last.note};做完还有余力就继续做,把实际次数记下来`
        : '做完目标次数还有余力就继续做,把实际次数记下来(用来校准你的力量基准)'
    }];
  };
  // 组型依赖配重或需要至少两组 — 不满足就退回常规(生成的计划不该出现无效组型)
  if (!workSetOk || n < 2) return amrap(plain);
  if ((type === 'drop' || type === 'pyramid' || type === 'backoff') && w == null) return amrap(plain);

  switch (type) {
    case 'pyramid': {
      const top = w as number;
      return amrap(Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 1 : i / (n - 1);          // 0 → 1
        const reps = Math.round(base.repsMax - (base.repsMax - base.repsMin) * t);
        return {
          reps: repsOf(Math.max(1, reps)),
          weightKg: snap(top * (0.8 + 0.2 * t)),
          tag: i === 0 ? '轻' : i === n - 1 ? '最重' : ''
        };
      }));
    }
    case 'backoff':
      return amrap(Array.from({ length: n }, (_, i) => (i < n - 1
        ? { reps: repsOf(base.repsMin), weightKg: w, tag: '' }
        : {
          reps: repsOf(Math.min(30, base.repsMax + 4)),
          weightKg: snap((w as number) * 0.85),
          tag: '降重',
          note: '减重后一组,做满为止,不用再往上加'
        })));
    case 'drop':
      return amrap(Array.from({ length: n }, (_, i) => (i < n - 1
        ? { reps: repsOf(base.repsMin), weightKg: w, tag: '' }
        : {
          reps: repsOf(base.repsMin),
          weightKg: w,
          tag: '递减',
          note: '做完这组立刻减约 20% 重量接着做,中间不休息'
        })));
    case 'failure':
      return amrap(Array.from({ length: n }, (_, i) => (i < n - 1
        ? { reps: repsOf(base.repsMin), weightKg: w, tag: '' }
        : {
          reps: repsOf(Math.min(30, base.repsMax)),
          weightKg: w,
          tag: '力竭',
          note: '做到再也做不动为止,形式变形就停'
        })));
    default:
      return amrap(plain);
  }
}

/** 组型一句话说明(编辑器选择时展示) */
export function setTypeSummary(type: SetType, sets: number): string {
  switch (type) {
    case 'drop': return `前 ${sets - 1} 组常规,最后一组递减`;
    case 'failure': return `前 ${sets - 1} 组常规,最后一组力竭`;
    case 'backoff': return `前 ${sets - 1} 组正式重量,最后一组降重收尾`;
    case 'pyramid': return `${sets} 组重量递增 / 次数递减`;
    default: return `${sets} 组常规`;
  }
}
