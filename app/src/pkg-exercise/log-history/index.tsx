import { useMemo, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { todayStr } from '@/utils/date';
import LogCard from '../log-card';
import { historyRows } from '../engine/history';
import { loadDayNotes, noteText, type DayNotes } from '../engine/daynote';
import { editDayNoteText } from '../engine/daynote-sheet';
import { volumeText } from '../engine/share-card';
import { loadLogs, loadPlan } from '../engine/store';
import { backfillWorkoutEnergy } from '../engine/workout-energy';
import type { TrainingPlan, WorkoutLog } from '../engine/types';
import './index.scss';
import { navigate } from '@/utils/nav';

/**
 * 训练记录 —— 练过的每一次都在这里,一天一行,从近到远。
 *
 * 计划页那边只摊得开最近 5 次(它是给「今天/下次练什么」用的),而历史上限是 300 条
 * (见 store 的 LOG_CAP):练了一年的人翻不到上个月那次是怎么练的,「照这次再来一遍」
 * 也就用不上了 —— 这个页面就是那 5 行的全部。
 *
 * 两件它自己拿的主意:
 * - 没练但请过假的日子**也占一行**(见 engine/history 的 historyRows):一路翻下去
 *   只看见一个个空档,人是会怀疑自己偷懒的 —— 那几天本来就是有原因的。
 * - 一次只渲染 40 行,「显示更早的」再放 40。300 行一次性进渲染层是能跑,但滚动会肉眼可见地沉。
 */
const PAGE = 40;

export default function LogHistory() {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [notes, setNotes] = useState<DayNotes>({});
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  /** 训练日筛选:'all' 或那一天的 key */
  const [day, setDay] = useState('all');
  /** 已经放出来多少行 */
  const [count, setCount] = useState(PAGE);

  useDidShow(() => {
    const list = loadLogs();
    setLogs(list);
    setNotes(loadDayNotes());
    setPlan(loadPlan());
    // 这一页就是「我以前练的那些」,顺手把还没有消耗记录的那几次补进热量引擎
    // (补过一次本会话就不再补,见 engine/workout-energy)
    void backfillWorkoutEnergy(list);
    track('training_log_history', 'other');
  });

  /**
   * 筛选用的训练日 —— 顺序照计划里那几天的排法(推/拉/腿是用户认得的顺序),
   * 计划外的训练日(换过计划、导进来的)排在后面。
   */
  const days = useMemo(() => {
    const titles = new Map<string, string>();
    logs.forEach((l) => titles.set(l.dayKey, l.dayTitle));
    const order = (plan?.days ?? []).map((d) => d.key);
    return [...titles.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    });
  }, [logs, plan]);

  const rows = useMemo(() => historyRows(logs, notes), [logs, notes]);
  const shown = useMemo(
    // 请假条不挂在任何一个训练日上 —— 筛了某一天,就只剩那一天的训练
    () => (day === 'all' ? rows : rows.filter((r) => r.log?.dayKey === day)),
    [rows, day]
  );

  const totalVol = useMemo(() => logs.reduce((a, l) => a + l.totalVolumeKg, 0), [logs]);

  /** 换一个筛选就把「放出来多少行」收回第一页 —— 否则换到记录少的那天会剩一屏空白 */
  const pick = (k: string) => {
    setDay(k);
    setCount(PAGE);
  };

  const saveNoteText = (date: string) => {
    const note = notes[date];
    if (!note) return;
    void editDayNoteText(notes, date, note, todayStr()).then(setNotes);
  };

  return (
    <Screen className="lh-page">
      <View className="card lh-top">
        <Text className="fs-h1">训练记录</Text>
        <Text className="fs-mini text-secondary">
          {logs.length
            ? `共 ${logs.length} 次训练 · 累计 ${volumeText(totalVol)}`
            : '每一次练完都会记在这里,包括补录的'}
        </Text>
        <Button
          className="btn btn--primary btn--block lh-backfill"
          onClick={() => navigate('/pkg-exercise/log-edit/index')}
        >
          记录一次以前的训练
        </Button>
      </View>

      {days.length > 1 && (
        <View className="lh-chips">
          <Text className={`lh-chip${day === 'all' ? ' on' : ''}`} onClick={() => pick('all')}>全部</Text>
          {days.map(([k, t]) => (
            <Text key={k} className={`lh-chip${day === k ? ' on' : ''}`} onClick={() => pick(k)}>{t}</Text>
          ))}
        </View>
      )}

      <View className="card lh-list">
        {shown.length === 0 && (
          <Text className="fs-mini text-secondary lh-empty">
            {logs.length ? '这一天还没有记录。' : '还没有训练记录 —— 练完第一次,这里就有一行。'}
          </Text>
        )}
        {shown.slice(0, count).map((r, i) => {
          const prev = i > 0 ? shown[i - 1] : null;
          const month = monthLabel(r.date, prev?.date);
          return (
            <View key={r.log?.id ?? `off-${r.date}`}>
              {month && <Text className="lh-month">{month}</Text>}
              {r.log ? (
                <LogCard log={r.log} />
              ) : (
                <View className="lh-off">
                  <View className="lh-off-head">
                    <Text className="lh-off-name">请假</Text>
                    <Text className="fs-mini text-secondary">{r.date}</Text>
                  </View>
                  <Text className="lh-off-text">{r.note ? noteText(r.note) : ''}</Text>
                  <Text className="lh-off-op" onClick={() => saveNoteText(r.date)}>
                    {r.note?.text ? '改说明' : '补一句'}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
        {shown.length > count && (
          <Text className="lh-more" onClick={() => setCount((n) => n + PAGE)}>
            显示更早的 {Math.min(PAGE, shown.length - count)} 次 ›
          </Text>
        )}
      </View>

      {logs.length > 0 && (
        <Text className="fs-mini text-secondary lh-foot">
          补录和修改都不会回头动下次的训练目标 —— 改的是这一条记录本身。
          补录的、以及标了「不算进步」的,照常进统计和容量,但不算纪录。
        </Text>
      )}
    </Screen>
  );
}

/** 月份分隔:换月了才说一句(这一年以内只念月,跨年了才带上年份) */
function monthLabel(date: string, prev?: string): string {
  if (prev && prev.slice(0, 7) === date.slice(0, 7)) return '';
  const [y, m] = date.split('-');
  const thisYear = new Date().getFullYear();
  return Number(y) === thisYear ? `${Number(m)} 月` : `${y} 年 ${Number(m)} 月`;
}
