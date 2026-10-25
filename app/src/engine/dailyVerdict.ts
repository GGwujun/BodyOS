/**
 * 每日成绩单的判定引擎(纯函数,冒烟可测)。
 *
 * 阈值是和用户逐条确认过的口径,别随手调:
 *   热量(摄入/预算)  达标 85%~110% | 略偏 70%~85% 或 110%~125% | 缺口大 <70%(吃太少) 或 >125%(超了)
 *   蛋白质           达标 ≥100%   | 略缺 70%~99%              | 缺口大 <70%
 *   训练/步数        只如实展示,不参与及格判定 —— 休息日是合法的一天
 * 及格 = 热量达标 且 蛋白质 ≥70%。大字标题一天只讲**最大的那个故事**(缺口优先),
 * 「今天全是好消息」才轮到「及格了」。
 */

export interface VerdictTraining {
  title: string;
  minutes: number;
  sets: number;
}

export interface VerdictInput {
  intakeCalories: number;
  kcalTarget: number;
  proteinG: number;
  proteinTargetG: number;
  steps: number;
  stepGoal: number;
  training: VerdictTraining | null;
}

export type RowStatus = 'ok' | 'warn' | 'bad' | 'none';

export interface VerdictRow {
  key: 'kcal' | 'protein' | 'training' | 'steps';
  label: string;
  main: string;
  /** 进度条画到百分之几;null = 这一行不画条 */
  pct: number | null;
  status: RowStatus;
}

export interface DailyVerdict {
  headline: string;
  pass: boolean;
  empty: boolean;
  rows: VerdictRow[];
  comment: string;
}

const INK_OK = 'ok';
const fmt = (n: number) => `${Math.round(n)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

type Ratio = 'ok' | 'warn' | 'bad' | 'none';

/** 热量:区间判定(低于 70% 也是缺口 —— 减脂不靠饿,这是口径不是bug) */
function kcalRatio(intake: number, target: number): Ratio {
  if (target <= 0 || intake <= 0) return 'none';
  const r = intake / target;
  if (r >= 0.85 && r <= 1.1) return INK_OK;
  if (r > 1.25 || r < 0.7) return 'bad';
  return 'warn';
}

function proteinRatio(g: number, target: number): Ratio {
  if (target <= 0 || g <= 0) return 'none';
  const r = g / target;
  if (r >= 1) return INK_OK;
  if (r < 0.7) return 'bad';
  return 'warn';
}

export function dailyVerdict(v: VerdictInput): DailyVerdict {
  const empty = v.intakeCalories <= 0 && v.proteinG <= 0 && !v.training;

  const kc = kcalRatio(v.intakeCalories, v.kcalTarget);
  const pr = proteinRatio(v.proteinG, v.proteinTargetG);
  const kcalOver = v.kcalTarget > 0 && v.intakeCalories / v.kcalTarget > 1.1;

  const rows: VerdictRow[] = [
    {
      key: 'kcal',
      label: '热量',
      main: kc === 'none'
        ? (v.intakeCalories > 0 ? `${fmt(v.intakeCalories)} 大卡` : '还没有记录')
        : `${fmt(v.intakeCalories)} / ${fmt(v.kcalTarget)} 大卡`,
      pct: kc === 'none' ? null : Math.min(100, (v.intakeCalories / v.kcalTarget) * 100),
      status: kc
    },
    {
      key: 'protein',
      label: '蛋白质',
      main: pr === 'none'
        ? (v.proteinG > 0 ? `${Math.round(v.proteinG)} 克` : '还没有记录')
        : `${Math.round(v.proteinG)} / ${Math.round(v.proteinTargetG)} 克`,
      pct: pr === 'none' ? null : Math.min(100, (v.proteinG / v.proteinTargetG) * 100),
      status: pr
    },
    {
      key: 'training',
      label: '训练',
      main: v.training ? `${v.training.title} · ${v.training.minutes}分钟` : '今天没练',
      pct: null,
      status: v.training ? INK_OK : 'none'
    },
    {
      key: 'steps',
      label: '运动',
      main: v.steps > 0 ? `${fmt(v.steps)} 步` : '未接入步数',
      pct: v.steps > 0 && v.stepGoal > 0 ? Math.min(100, (v.steps / v.stepGoal) * 100) : null,
      status: v.steps > 0 && v.stepGoal > 0 ? (v.steps >= v.stepGoal ? INK_OK : v.steps >= v.stepGoal * 0.6 ? 'warn' : 'none') : 'none'
    }
  ];

  const hasTargets = v.kcalTarget > 0 || v.proteinTargetG > 0;
  let headline: string;
  let comment: string;
  let pass: boolean;

  if (empty) {
    headline = '今天,身体在等答案';
    comment = '记录只要一分钟,身体已经等了一整天';
    pass = false;
  } else if (kc === 'bad') {
    headline = kcalOver ? '今天,热量超了' : '今天,吃得太少了';
    comment = kcalOver ? '一天吃回来三天的量,明天轻一点就好' : '吃太少代谢先降下来,明天把饭吃够';
    pass = false;
  } else if (pr === 'bad') {
    headline = '今天,蛋白质拖了后腿';
    comment = '热量没白记,肌肉还没吃饱;明早加两个蛋';
    pass = false;
  } else if (kc === 'warn') {
    headline = kcalOver ? '今天,热量多了一点' : '今天,吃得少了点';
    comment = kcalOver ? '只多了一口,明天主食少半拳就回来了' : '差一口达标,睡前一杯奶刚好补上';
    pass = false;
  } else if (pr === 'warn') {
    headline = '今天,蛋白质差一口';
    comment = '蛋白质差一口,下一顿加个蛋或一杯奶';
    // 蛋白质 70%~99% 仍算及格(及格线就是 70%):热量达标时这一天是「过了,差口气」,
    // 不是「没过」—— 标题照旧讲蛋白质的事,判定别跟着降级
    pass = kc === INK_OK;
  } else if (!hasTargets || kc === 'none') {
    // 没填资料算不出目标,或热量这一侧没得比(没目标/没记):记了就该被肯定,但话里带路
    headline = '今天,记下来了 ✓';
    comment = '补全身高体重,明天就有目标可比了';
    pass = true;
  } else {
    headline = '今天,身体及格了 ✓';
    const proteinFull = v.proteinTargetG > 0 && v.proteinG >= v.proteinTargetG;
    comment = !proteinFull
      ? '吃动都在线,蛋白质明天再补一口'
      : v.training
        ? '吃动都在线,身体今天没白过'
        : '吃得明白,动的事明天安排上';
    pass = true;
  }

  return { headline, pass, empty, rows, comment };
}
