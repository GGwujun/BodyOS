/**
 * 恢复模型 — 哪块肌肉还没缓过来。
 *
 * 做法很朴素但够用:每次训练给练到的肌群记一笔「疲劳值」,之后按半衰期衰减,
 * 时间一到自然归零。疲劳值受两组因素影响:
 *   1. 练了多少(计权组数,主动肌 1 / 次要肌 0.5,见 muscles.ts);
 *   2. 练得多狠(那一组离力竭有多远,用 RIR 锚定 —— RIR 0 最伤,RIR 5 几乎不占恢复)。
 *
 * 半衰期按肌群大小分档:大肌群恢复慢(48h)、小肌群快(24h)。这是粗略模型,
 * 目的不是精确预测,而是拦住「昨天练胸今天又练胸、还每次都做到力竭」这种最常见的问题。
 */
import { round2 } from './onerm';
import { GROUP_ZH, groupsOf, type MuscleGroup } from './muscles';
import type { WorkoutLog } from './types';

/** 半衰期(小时):越大恢复越慢 */
export const HALF_LIFE_H: Record<MuscleGroup, number> = {
  chest: 48, back: 48, leg: 48,
  shoulder: 36, arm: 36,
  core: 24, calf: 24
};

/** 各肌群的「一次练满」疲劳容量 — 用来把疲劳值折算成恢复百分比 */
export const CAPACITY: Record<MuscleGroup, number> = {
  chest: 18, back: 20, leg: 20, shoulder: 14, arm: 12, core: 10, calf: 10
};

/** 恢复到这个百分比以上就算缓过来了 */
export const READY_AT = 0.85;

/** 一组练到离力竭多远 → 占多少恢复。RIR 空(没评分)= 1.0 的中性值 */
export function setIntensity(rir: number | null | undefined): number {
  if (rir == null) return 1;
  const r = Math.min(Math.max(rir, 0), 6);
  return round2(Math.max(0.6, 1.45 - 0.15 * r));
}

export interface MuscleRecovery {
  group: MuscleGroup;
  /** 当前疲劳值(未衰减完的部分) */
  fatigue: number;
  /** 恢复度 0-100 */
  recovered: number;
  /** 还要几小时才算缓过来;已恢复为 0 */
  etaHours: number;
  /** 上次练到这个肌群是哪天;没练过为 null */
  lastDate: string | null;
  /** 距离上次练它过了多少小时 */
  hoursAgo: number | null;
}

/**
 * 算各肌群此刻的恢复情况(按恢复度升序 —— 最该歇的排最前)。
 * @param now 便于测试注入
 */
export function recoveryOf(logs: WorkoutLog[], now = new Date()): MuscleRecovery[] {
  const acc = new Map<MuscleGroup, { fatigue: number; lastAt: number | null; lastDate: string | null }>();

  for (const log of logs) {
    // 日志日期只有天,统一按当天 00:00 起算(与实际训练时刻最多差 24h,对半衰期模型无所谓)
    const at = new Date(`${log.date}T00:00:00`).getTime();
    if (!Number.isFinite(at)) continue;
    const hoursAgo = (now.getTime() - at) / 3600000;
    for (const e of log.entries) {
      const gs = groupsOf(e.exerciseId);
      if (!gs.length) continue;
      for (const { group, w } of gs) {
        const cur = acc.get(group) ?? { fatigue: 0, lastAt: null, lastDate: null };
        cur.lastAt = cur.lastAt == null || at > cur.lastAt ? at : cur.lastAt;
        if (cur.lastAt === at) cur.lastDate = log.date;
        // 逐组累加(强度逐组算 —— 后几组更接近力竭)
        for (const s of e.sets) {
          const decay = Math.pow(0.5, hoursAgo / HALF_LIFE_H[group]);
          cur.fatigue += w * setIntensity(s.rir) * decay;
        }
        acc.set(group, cur);
      }
    }
  }

  const out: MuscleRecovery[] = [];
  for (const [group, v] of acc) {
    const fatigue = round2(v.fatigue);
    const cap = CAPACITY[group];
    const recovered = Math.max(0, Math.min(100, Math.round((1 - Math.min(1, fatigue / cap)) * 100)));
    const threshold = cap * (1 - READY_AT);
    const etaHours = fatigue <= threshold
      ? 0
      : Math.max(1, Math.round(HALF_LIFE_H[group] * Math.log2(fatigue / threshold)));
    out.push({
      group,
      fatigue,
      recovered,
      etaHours,
      lastDate: v.lastDate,
      hoursAgo: v.lastAt == null ? null : Math.round((now.getTime() - v.lastAt) / 3600000)
    });
  }
  return out.sort((a, b) => a.recovered - b.recovered);
}

/** 只保留有记录或有残余疲劳的(没练过的肌群不必占屏) */
export function relevant(list: MuscleRecovery[]): MuscleRecovery[] {
  return list.filter((r) => r.lastDate != null);
}

/** 一句话结论:现在最该歇的是谁 */
export function recoveryVerdict(list: MuscleRecovery[]): string {
  const r = relevant(list);
  if (!r.length) return '还没有训练记录。练完一次之后,这里会显示每个部位缓过来的进度。';
  const worst = r[0];
  const ready = r.filter((x) => x.recovered >= READY_AT * 100).length;
  if (worst.recovered >= READY_AT * 100) return '各部位都缓过来了,想练哪天都可以。';
  return `${GROUP_ZH[worst.group]}还没缓过来(约 ${worst.etaHours} 小时),今天优先练别的地方;`
    + `另有 ${ready}/${r.length} 个部位已恢复。`;
}

/** 恢复度的颜色档(页面着色用) */
export function recoveryTone(recovered: number): 'fresh' | 'ok' | 'tired' {
  if (recovered >= READY_AT * 100) return 'fresh';
  if (recovered >= 60) return 'ok';
  return 'tired';
}
