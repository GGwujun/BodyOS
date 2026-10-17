/**
 * 训练计划本地持久化 — Taro storage 同步 API(数据量小,免异步样板)。
 * key 前缀 bodyos.training.*;日志上限 300 条防膨胀。
 */
import Taro from '@tarojs/taro';
// 相对路径(而不是 '@/')):这些 engine 模块要被 scripts/smoke-*.mjs 单独编译跑单测,
// 那些脚本走的是纯 tsc,不认 tsconfig 里的路径别名。
import { markTouched } from '../../utils/sync-marks';
import { cleanPlanUnits } from './order';
import type { ProgressState, TrainingPlan, WorkoutLog } from './types';

const K_PLAN = 'bodyos.training.plan';
const K_PROG = 'bodyos.training.progress';
const K_LOGS = 'bodyos.training.logs';
const K_NOTES = 'bodyos.training.notes';
/**
 * 本机日志条数上限。**只影响本机**,云端的日志不跟着裁
 * (同步是只增不删的 upsert,裁掉的旧日志在云端还在,换设备能拉回来)。
 * 300 条约 200KB,离 storage 上限还很远。
 */
export const LOG_CAP = 300;

export function loadPlan(): TrainingPlan | null {
  const plan: TrainingPlan | null = Taro.getStorageSync(K_PLAN) || null;
  // 读的时候顺手修一次「落单的超级组」:本机存着的老计划可能是旧版调序(纯换位、不看超级组)
  // 或者删同伴留下的。修在读入口,页面上就不会出现「没有同伴的动作挂着超级组徽标」。
  return plan ? cleanPlanUnits(plan) : null;
}
export function savePlan(plan: TrainingPlan): void {
  Taro.setStorageSync(K_PLAN, plan);
  markTouched('plan', 'main');
}
/**
 * 只删计划本身,不动渐进状态 —— 云同步按文档粒度改写本机时用
 * (clearPlan 是用户主动「清空计划」,渐进一起删;同步把云端那份计划删掉时,
 * 渐进状态由它自己的文档决定,不能顺手抹了)。
 */
export function dropPlan(): void {
  Taro.removeStorageSync(K_PLAN);
}

export function clearPlan(): void {
  Taro.removeStorageSync(K_PLAN);
  Taro.removeStorageSync(K_PROG);
  // 记一笔「我删过」:同步靠它把删除动作也推到云端,否则下次同步计划会被拉回来
  markTouched('plan', 'main');
  markTouched('progress', 'main');
}

export function loadProgress(): ProgressState {
  return Taro.getStorageSync(K_PROG) || {};
}
export function saveProgress(state: ProgressState): void {
  Taro.setStorageSync(K_PROG, state);
  markTouched('progress', 'main');
}

export function loadLogs(): WorkoutLog[] {
  return Taro.getStorageSync(K_LOGS) || [];
}
/** 整份覆盖(云同步合并后写回用,不走这里的裁剪) */
export function saveLogs(logs: WorkoutLog[]): void {
  Taro.setStorageSync(K_LOGS, logs);
}
export function appendLog(log: WorkoutLog): WorkoutLog[] {
  const logs = [log, ...loadLogs()].slice(0, LOG_CAP);
  Taro.setStorageSync(K_LOGS, logs);
  markTouched('logs', log.id);
  return logs;
}
/** 修改已存的日志(补记感受、修正次数用) */
export function updateLog(id: string, patch: Partial<WorkoutLog>): WorkoutLog[] {
  const logs = loadLogs().map((l) => (l.id === id ? { ...l, ...patch } : l));
  Taro.setStorageSync(K_LOGS, logs);
  markTouched('logs', id);
  return logs;
}

/** 动作常驻备注:exerciseId → 备注。跨计划长期有效(如「左肩不适,重量减一档」) */
export type ExerciseNotes = Record<string, string>;
export function loadNotes(): ExerciseNotes {
  return Taro.getStorageSync(K_NOTES) || {};
}
/**
 * 整份覆盖。写的人有两条路:用户改备注(要记时间)、同步把云端那份写回来
 * (调用方随后会用**云端的时间戳**盖掉)。记一笔 now 不会伤到后者 ——
 * 但漏记的后果很实在:删掉一个带备注的自定义动作后,云端旧备注会在下次同步时
 * 原样复活(本机没有「更晚」的证据),备份导入也会因为时间戳是 EPOCH 而永远输给云端。
 */
export function saveNotes(notes: ExerciseNotes): void {
  Taro.setStorageSync(K_NOTES, notes);
  markTouched('notes', 'main');
}
export function setNote(exerciseId: string, text: string): ExerciseNotes {
  const notes = { ...loadNotes() };
  const t = text.trim();
  if (t) notes[exerciseId] = t.slice(0, 60);
  else delete notes[exerciseId];
  Taro.setStorageSync(K_NOTES, notes);
  markTouched('notes', 'main');
  return notes;
}
