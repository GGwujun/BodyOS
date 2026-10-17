import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import { navigate } from '@/utils/nav';
import type { ExerciseEntry } from '../data/exercises';
import { personalRecords, refLine } from '../engine/history';
import { isAssisted, liftE1rm, weightNoun } from '../engine/load';
import { barWeightFor, loadKit, plateInv, plateStack, plateText, usesBar } from '../engine/kit';
import { E1RM_MAX_REPS, round2 } from '../engine/onerm';
import { isSided } from '../engine/sided';
import { holdText, isTimed } from '../engine/timed';
import type { WorkoutLog } from '../engine/types';
import './index.scss';

/**
 * 动作详情里「和重量有关」的那几块 —— 上次/最好、配片、1RM 估算。
 *
 * 这三件事放在同一个组件里,因为它们回答的是同一个问题:**这个动作我该上多重**。
 * 动作库以前只教「怎么做」,不回答「做多重」:用户看完步骤,还得退出去翻历史、
 * 自己心算每边挂几片,或者干脆凭感觉。openGym 的详情页把这三件事摆在一起,
 * 这个组件就是把那一层补齐,而不是把动作库做成另一个统计页。
 *
 * 口径全部走引擎里已有的那几处(history.refLine / kit.* / onerm.liftE1rm):
 * 详情页算出来的数和训练页、历史页、计划页看见的必须是同一个。
 */

const kg = (v: number): string => String(Math.round(v * 100) / 100);

/** 「− 值 ＋」步进器 —— 和计划编辑器同一个手感,但样式独立(exlib-*) */
function Step(props: {
  value: number; unit: string; step?: number; min?: number; max?: number;
  text?: string; onChange: (v: number) => void;
}) {
  const { value, unit, step = 1, min = 0, max = 999, text, onChange } = props;
  return (
    <View className="exlib-step">
      <Text className="exlib-step-btn" onClick={() => onChange(Math.max(min, value - step))}>−</Text>
      <Text className="exlib-step-v">{text ?? <>{kg(value)}<Text className="exlib-step-u">{unit}</Text></>}</Text>
      <Text className="exlib-step-btn" onClick={() => onChange(Math.min(max, value + step))}>＋</Text>
    </View>
  );
}

type LoadMode = 'pairs' | 'single' | 'none';

const MODE_ZH: Record<LoadMode, string> = { pairs: '每边', single: '单栈', none: '不用' };
const MODE_DESC: Record<LoadMode, string> = {
  pairs: '杠铃:总重扣掉杆重后,左右各挂一半',
  single: '单栈:片全挂在一处(地雷管、挂片器械、雪橇)',
  none: '不显示配片行 —— 重量照常记,只是不算每边挂什么'
};

export default function DetailTools({
  ex, logs
}: { ex: ExerciseEntry; logs: WorkoutLog[] }) {
  const kit = useMemo(() => loadKit(), []);
  const inv = useMemo(() => plateInv(kit), [kit]);
  const barEx = usesBar(ex);
  const bodyweight = ex.equipment === 'body weight';
  const assisted = isAssisted(ex.id);
  const timed = isTimed(ex.id);
  const sided = isSided(ex.id);

  const ref = useMemo(() => refLine(logs, ex.id), [logs, ex.id]);
  const pr = useMemo(
    () => personalRecords(logs).find((p) => p.exerciseId === ex.id),
    [logs, ex.id]
  );

  /** 初始口径:杠铃动作按「每边」,自重按「不用」,其余按「单栈」 */
  const [mode, setMode] = useState<LoadMode>(barEx ? 'pairs' : bodyweight ? 'none' : 'single');
  const [barKg, setBarKg] = useState(() => barWeightFor(kit, ex));
  /** 单栈的起始重量(器械/雪橇本身多重;全挂片就是 0) */
  const [baseKg, setBaseKg] = useState(0);
  /** 计算器里的目标总重 —— 默认拿历史最重的一组起步,没练过就给一个能算的整数 */
  const [target, setTarget] = useState(() => {
    const start = pr?.topKg && pr.topKg > 0 ? pr.topKg : barWeightFor(kit, ex) + 20;
    return Math.max(0, Math.round(start * 2) / 2);
  });

  /** 1RM 计算器:默认用最近最好的一组(重量 × 次数),没练过就用 20kg × 5 */
  const [w, setW] = useState(() => (pr?.topKg && pr.topKg > 0 ? pr.topKg : 20));
  const [r, setR] = useState(() => (pr?.topReps && pr.topReps > 0 ? Math.min(pr.topReps, E1RM_MAX_REPS) : 5));

  const load = (() => {
    if (mode === 'none') return null;
    const start = mode === 'pairs' ? barKg : baseKg;
    if (!(target > 0)) return null;
    if (target <= start) return { perSide: 0, plates: [] as number[], missing: 0 };
    const per = Math.round(((target - start) / (mode === 'pairs' ? 2 : 1)) * 100) / 100;
    // 单栈的片全挂在一处:器材按「对数」登记,单栈要按片数用,所以每种翻倍
    const stock = mode === 'single' ? inv.map((p) => ({ ...p, n: p.n * 2 })) : inv;
    return { perSide: per, ...plateStack(per, stock) };
  })();

  const est = liftE1rm(ex.id, r, w, sided);
  const bestLine = ref.bestText;
  const lastLine = ref.lastTexts.length
    ? `${ref.date?.slice(5) ?? ''} · ${ref.lastTexts.slice(0, 3).join(' / ')}${ref.lastTexts.length > 3 ? ' …' : ''}`
    : null;

  return (
    <View className="exlib-tools">
      {/* ===== 上次 / 最好 ===== */}
      <View className="exlib-ref">
        <View className="exlib-ref-row">
          <Text className="exlib-ref-k">最好</Text>
          <Text className="exlib-ref-v">{bestLine ?? '还没练过这个动作'}</Text>
        </View>
        <View className="exlib-ref-row">
          <Text className="exlib-ref-k">上次</Text>
          <Text className="exlib-ref-sub">{lastLine ?? '还没有记录 —— 第一次练会从计划里的起始重量开始'}</Text>
        </View>
        <Text
          className="exlib-ref-more"
          onClick={() => navigate(`/pkg-exercise/exercise-history/index?exerciseId=${ex.id}`)}
        >
          看每次的变化 ›
        </Text>
      </View>

      {/* ===== 配片 ===== */}
      <View className="exlib-tool">
        <View className="exlib-tool-h">
          <Text className="exlib-tool-t">配片</Text>
          <Text className="exlib-tool-hint">按「我的器材」里的片和杆算</Text>
        </View>
        <View className="exlib-modes">
          {(Object.keys(MODE_ZH) as LoadMode[]).map((k) => (
            <Text
              key={k}
              className={`exlib-mode${mode === k ? ' on' : ''}`}
              onClick={() => setMode(k)}
            >
              {MODE_ZH[k]}
            </Text>
          ))}
        </View>
        <Text className="exlib-tool-note">{MODE_DESC[mode]}</Text>

        {mode !== 'none' && (
          <>
            <View className="exlib-calc-row">
              <Text className="exlib-calc-k">{mode === 'pairs' ? '杆重' : '起始重量'}</Text>
              {mode === 'pairs' ? (
                <View className="exlib-steps">
                  <Step
                    value={barKg} unit="kg" step={0.5} min={0} max={50}
                    onChange={(v) => setBarKg(v)}
                  />
                  {barEx && (
                    <Text
                      className={`exlib-nobar${barKg === 0 ? ' on' : ''}`}
                      onClick={() => setBarKg(barKg === 0 ? barWeightFor(kit, ex) : 0)}
                    >
                      {barKg === 0 ? '已设不用杆' : '不用杆'}
                    </Text>
                  )}
                </View>
              ) : (
                <Step value={baseKg} unit="kg" step={1} min={0} max={200} onChange={setBaseKg} />
              )}
            </View>

            {mode === 'pairs' && (
              <View className="exlib-barchips">
                {[20, 15, 10, 9, 0].map((b) => (
                  <Text
                    key={b}
                    className={`exlib-barchip${barKg === b ? ' on' : ''}`}
                    onClick={() => setBarKg(b)}
                  >
                    {b === 0 ? '无杆' : `${b}kg`}
                  </Text>
                ))}
                <Text className="exlib-barchip-note">空着按器械默认杆重</Text>
              </View>
            )}

            <View className="exlib-calc-row">
              <Text className="exlib-calc-k">目标总重</Text>
              <Step value={target} unit="kg" step={2.5} min={0} max={500} onChange={setTarget} />
            </View>

            {load && (
              <View className="exlib-plate">
                {load.perSide <= 0 ? (
                  <Text className="exlib-plate-main">
                    {mode === 'pairs' ? '还没超过空杆' : '还没超过起始重量'},不用挂片
                  </Text>
                ) : (
                  <>
                    <View className="exlib-plate-row">
                      <Text className="exlib-plate-k">{mode === 'pairs' ? '每边' : '这一栈'}</Text>
                      <Text className="exlib-plate-v">
                        {kg(load.perSide)}<Text className="exlib-plate-u">kg</Text>
                      </Text>
                    </View>
                    <Text className="exlib-plate-stack">
                      {load.plates.length ? plateText(load.plates) : '空着'}
                    </Text>
                    {load.missing > 0.001 && (
                      <Text className="exlib-plate-warn">
                        还差 {kg(load.missing)}kg —— 登记的片凑不出这个重量
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}
        <Text className="exlib-ref-more" onClick={() => navigate('/pkg-exercise/kit/index')}>
          去校准我的片和杆重 ›
        </Text>
      </View>

      {/* ===== 1RM 估算 ===== */}
      <View className="exlib-tool">
        <View className="exlib-tool-h">
          <Text className="exlib-tool-t">估算极限(1RM)</Text>
          <Text className="exlib-tool-hint">一组的数据推出来的,不是测出来的</Text>
        </View>
        {timed ? (
          <Text className="exlib-tool-note">
            这是按时间练的动作 —— 它的成绩看「最长保持 {pr?.bestHoldSec ? holdText(pr.bestHoldSec) : '还没记录'}」,
            不估极限重量。
          </Text>
        ) : assisted ? (
          <Text className="exlib-tool-note">
            助力器械的数字是器械帮你分担的力,越大越轻松 —— 拿它估极限是反的,所以不算。
          </Text>
        ) : (
          <>
            <View className="exlib-calc-row">
              <Text className="exlib-calc-k">{weightNoun(ex.id)}</Text>
              <Step value={w} unit="kg" step={2.5} min={0} max={500} onChange={setW} />
            </View>
            <View className="exlib-calc-row">
              <Text className="exlib-calc-k">次数</Text>
              <Step value={r} unit="次" step={1} min={1} max={E1RM_MAX_REPS} onChange={setR} />
            </View>
            <View className="exlib-orm">
              <Text className="exlib-orm-k">大概能做 1 次</Text>
              <Text className="exlib-orm-v">
                {est > 0 ? `${round2(est)}` : '—'}<Text className="exlib-orm-u">kg</Text>
              </Text>
            </View>
            <Text className="exlib-tool-note">
              {est > 0
                ? `按 ${w}kg × ${r} 次推的(七个经典公式取中位数)。次数超过 ${E1RM_MAX_REPS} 次外推太远,这里不给数。`
                : `填一个重量和 1-${E1RM_MAX_REPS} 次才估得出来。`}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
