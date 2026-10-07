/**
 * 生活方式测评 — 12 道习惯题,规则计分(每题 0~3 分,总分折算 100)
 * 结果仅反映生活习惯倾向,不构成健康诊断
 */

export type AssessDim = 'sleep' | 'diet' | 'exercise' | 'habit';

export interface AssessmentQuestion {
  id: string;
  dim: AssessDim;
  title: string;
  options: { label: string; score: number }[];
}

export const DIM_LABELS: Record<AssessDim, string> = {
  sleep: '睡眠',
  diet: '饮食',
  exercise: '运动',
  habit: '习惯',
};

export const QUESTIONS: AssessmentQuestion[] = [
  { id: 'q1', dim: 'sleep', title: '平均每晚睡多久?', options: [
    { label: '6 小时以内', score: 0 },
    { label: '6 ~ 7 小时', score: 2 },
    { label: '7 ~ 9 小时', score: 3 },
    { label: '9 小时以上', score: 2 },
  ]},
  { id: 'q2', dim: 'sleep', title: '你的作息规律吗?', options: [
    { label: '经常凌晨 1 点后睡', score: 0 },
    { label: '一周有两三天晚睡', score: 1 },
    { label: '多数时候规律入睡', score: 3 },
  ]},
  { id: 'q3', dim: 'sleep', title: '睡前一小时在做什么?', options: [
    { label: '几乎一直在刷手机', score: 0 },
    { label: '经常刷手机', score: 1 },
    { label: '偶尔看看', score: 2 },
    { label: '基本不碰,放松收尾', score: 3 },
  ]},
  { id: 'q4', dim: 'diet', title: '早餐吃吗?', options: [
    { label: '几乎不吃', score: 0 },
    { label: '偶尔吃', score: 1 },
    { label: '经常吃', score: 2 },
    { label: '每天吃', score: 3 },
  ]},
  { id: 'q5', dim: 'diet', title: '蔬菜水果吃得勤吗?', options: [
    { label: '很少吃', score: 0 },
    { label: '一周两三次', score: 1 },
    { label: '每天有一两餐搭配', score: 2 },
    { label: '每天多餐都有', score: 3 },
  ]},
  { id: 'q6', dim: 'diet', title: '含糖饮料、油炸食品、外卖的频率?', options: [
    { label: '几乎每天', score: 0 },
    { label: '每周 3 ~ 5 次', score: 1 },
    { label: '每周 1 ~ 2 次', score: 2 },
    { label: '基本不碰', score: 3 },
  ]},
  { id: 'q7', dim: 'diet', title: '晚餐一般吃到几分饱?', options: [
    { label: '吃到很撑', score: 0 },
    { label: '偶尔吃多', score: 1 },
    { label: '八九分饱', score: 3 },
  ]},
  { id: 'q8', dim: 'exercise', title: '每周运动几次?(每次 20 分钟以上)', options: [
    { label: '几乎不运动', score: 0 },
    { label: '1 ~ 2 次', score: 1 },
    { label: '3 ~ 4 次', score: 2 },
    { label: '5 次以上', score: 3 },
  ]},
  { id: 'q9', dim: 'exercise', title: '每次运动大概多久?', options: [
    { label: '不足 30 分钟', score: 1 },
    { label: '30 ~ 60 分钟', score: 3 },
    { label: '60 分钟以上', score: 3 },
  ]},
  { id: 'q10', dim: 'exercise', title: '白天久坐时间有多长?', options: [
    { label: '8 小时以上', score: 0 },
    { label: '5 ~ 8 小时', score: 1 },
    { label: '3 ~ 5 小时', score: 2 },
    { label: '3 小时以内', score: 3 },
  ]},
  { id: 'q11', dim: 'habit', title: '每天大概喝多少水?', options: [
    { label: '不到 800ml', score: 0 },
    { label: '800 ~ 1200ml', score: 1 },
    { label: '1200 ~ 1800ml', score: 3 },
    { label: '1800ml 以上', score: 2 },
  ]},
  { id: 'q12', dim: 'habit', title: '最近的压力状态?', options: [
    { label: '压力很大', score: 0 },
    { label: '偶尔很大', score: 1 },
    { label: '一般', score: 2 },
    { label: '比较轻松', score: 3 },
  ]},
];

export const DIM_ADVICE: Record<AssessDim, string[]> = {
  sleep: ['尽量在 23:30 前入睡,固定起床时间,周末也不例外', '睡前一小时放下手机,试试拉伸、泡脚或听轻音乐'],
  diet: ['每天规律吃早餐,晚餐吃到八分饱就停', '每餐先吃蔬菜再吃主食,少喝含糖饮料、少点油炸'],
  exercise: ['每周安排 3 次以上 30 分钟运动,快走、骑行都算数', '每坐 1 小时就起身活动 3~5 分钟,接水、伸展都可以'],
  habit: ['把水杯放在手边,全天少量多次饮水,别等渴了才喝', '压力大时用散步、深呼吸替代宵夜与熬夜刷手机'],
};

export interface AssessResult {
  score: number;
  level: { label: string; tone: 'green' | 'amber' | 'red'; copy: string };
  dims: { dim: AssessDim; pct: number }[];
  weakDims: AssessDim[];
}

/** 由答案(每题选项下标)计算结果 */
export function scoreAssessment(answers: number[]): AssessResult {
  const dimScore: Record<AssessDim, { got: number; max: number }> = {
    sleep: { got: 0, max: 0 }, diet: { got: 0, max: 0 }, exercise: { got: 0, max: 0 }, habit: { got: 0, max: 0 },
  };
  let total = 0, maxTotal = 0;
  QUESTIONS.forEach((q, i) => {
    const opt = q.options[answers[i] ?? 0];
    total += opt.score; maxTotal += 3;
    const d = dimScore[q.dim];
    d.got += opt.score; d.max += 3;
  });
  const score = Math.round((total / maxTotal) * 100);
  const dims = (Object.keys(dimScore) as AssessDim[]).map((dim) => ({ dim, pct: Math.round((dimScore[dim].got / dimScore[dim].max) * 100) }));
  const weakDims = dims.filter((d) => d.pct < 60).map((d) => d.dim);
  const level = score >= 80
    ? { label: '状态很好', tone: 'green' as const, copy: '你的生活习惯整体健康,保持下去,并继续记录身体数据观察趋势。' }
    : score >= 60
      ? { label: '整体不错', tone: 'green' as const, copy: '大方向没问题,把下面几个薄弱项补一补,状态会明显提升。' }
      : score >= 40
        ? { label: '一般', tone: 'amber' as const, copy: '有几项习惯在拖后腿,先挑一两个最容易改的入手,别贪多。' }
        : { label: '待改善', tone: 'red' as const, copy: '身体正在为当前习惯买单,建议从睡眠和饮食两件小事开始调整。' };
  return { score, level, dims, weakDims };
}
