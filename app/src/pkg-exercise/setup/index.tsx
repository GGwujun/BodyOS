import { Input, Text, View } from '@tarojs/components';
import HoldText from '@/components/HoldText';
import { canSetProgression, canSetSetType } from '../engine/editor';
import { loadHint, type Kit } from '../engine/kit';
import { isAssisted, weightNoun } from '../engine/load';
import { pctOfWeight, tmOf, type MaxMap } from '../engine/max';
import { PATTERNS } from '../engine/patterns';
import { repStepOf, sideRepsText } from '../engine/sided';
import { SETTYPE_DESC, SETTYPE_ZH, type SetType } from '../engine/settype';
import {
  HOLD_MAX_SEC, HOLD_STEP_SEC, clampHoldSec, holdText
} from '../engine/timed';
import {
  PROGRESSION_DESC, PROGRESSION_ZH,
  type PlannedExercise, type ProgressionKind
} from '../engine/types';
import { REST_MAX, REST_PRESETS, REST_STEP, clampRest, fmtDuration } from '@/utils/duration';
import type { ExerciseEntry } from '../data/exercises';
import './index.scss';

/**
 * 一个动作的完整参数面板 —— 组数、次数或时长、重量、热身、休息、组型、渐进、备注。
 *
 * **为什么是一个共享组件**:这套设置要在两个地方出现 ——
 *   ① 计划编辑器点开某一项(改已经排好的动作);
 *   ② 从动作库「加入计划」,选完训练日之后(加之前就设好,而不是先按默认值塞进去再回来改)。
 * openGym 在这两处用的是同一个配置面板(ExConfig),这里也是一样的取舍:
 * 两边各写一套的话,「编辑器里能调热身组数、加计划那边不能」这种缺口不会报错,
 * 只会让人以为那个功能不存在。
 *
 * 组件只管**渲染和回调**,不读 storage、不写计划 —— 父级决定改动落到哪里
 * (编辑器是立即落盘,动作库是先改草稿、确认才写)。
 * 改重量/组型/渐进/单侧的合法性判定也不在这里重复:父级调 engine/editor 的纯变换
 * (`withWeight` 等),规则只有一份。
 */

function Step(props: {
  value: number; unit: string; step?: number; min?: number; max?: number;
  text?: string; onChange: (v: number) => void;
}) {
  const { value, unit, step = 1, min = 1, max = 99, text, onChange } = props;
  return (
    <View className="set-step">
      <HoldText className="set-step-btn" onStep={() => onChange(Math.max(min, value - step))}>−</HoldText>
      <Text className="set-step-v">{text ?? <>{value}<Text className="set-step-u">{unit}</Text></>}</Text>
      <HoldText className="set-step-btn" onStep={() => onChange(Math.min(max, value + step))}>＋</HoldText>
    </View>
  );
}

const SET_TYPE_ORDER: SetType[] = ['normal', 'drop', 'failure', 'pyramid', 'backoff'];
const PROG_ORDER: ProgressionKind[] = ['linear', 'double', 'triple', 'ladder'];

export default function ExerciseSetup(props: {
  item: PlannedExercise;
  ex?: ExerciseEntry;
  kit: Kit;
  maxes: MaxMap;
  /** 有没有「下一个动作」可组超级组 —— 新加的动作排在最后,没有 */
  canSuperset?: boolean;
  /** 超级组是否已经和下一个动作连上 */
  supersetOn?: boolean;
  onPatch: (patch: Partial<PlannedExercise>) => void;
  onWeight: (w: number | null) => void;
  onSided: (on: boolean) => void;
  onSetType: (t: SetType) => void;
  onProgression: (k: ProgressionKind) => void;
  onToggleSuperset?: () => void;
}) {
  const { item, ex, kit, maxes } = props;
  const assisted = isAssisted(item.exerciseId);
  const progOn = assisted ? 'ladder' : item.progression;
  const hold = item.holdSec;
  const weighted = item.weightKg != null;
  const stepKg = item.weightStepKg > 0 ? item.weightStepKg : 2.5;
  const hint = loadHint(kit, item.weightKg, ex);
  const tm = tmOf(maxes, item.exerciseId);
  const pct = pctOfWeight(item.weightKg, tm);

  return (
    <View className="set-fields">
      {/* 组数 */}
      <View className="set-field">
        <Text className="set-k">组数</Text>
        <Step value={item.sets} unit="组" min={1} max={10} onChange={(v) => props.onPatch({ sets: v })} />
      </View>

      {/* 计时型改秒数,次数型改次数 —— 两个量纲不能混(见 engine/timed.ts) */}
      {hold ? (
        <>
          <View className="set-field">
            <Text className="set-k">时长下限</Text>
            <Step
              value={hold.min} unit="秒" step={HOLD_STEP_SEC} min={HOLD_STEP_SEC} max={hold.max}
              text={holdText(hold.min)}
              onChange={(v) => props.onPatch({ holdSec: { min: clampHoldSec(v), max: hold.max } })}
            />
          </View>
          <View className="set-field">
            <Text className="set-k">时长上限</Text>
            <Step
              value={hold.max} unit="秒" step={HOLD_STEP_SEC} min={hold.min} max={HOLD_MAX_SEC}
              text={holdText(hold.max)}
              onChange={(v) => props.onPatch({ holdSec: { min: hold.min, max: clampHoldSec(v) } })}
            />
          </View>
          <Text className="set-note">
            撑到上限就加 5 秒;下限是「这组没白撑」的底线,低于它才算没做到。这套动作的组型不按次数算,
            所以不提供递减/金字塔。
          </Text>
        </>
      ) : (
        <>
          <View className="set-field">
            <Text className="set-k">次数下限</Text>
            <Step
              value={item.repsMin} unit="次" step={repStepOf(item.sided)} min={item.sided ? 2 : 1} max={50}
              onChange={(v) => props.onPatch({ repsMin: v, repsMax: Math.max(v, item.repsMax) })}
            />
          </View>
          <View className="set-field">
            <Text className="set-k">次数上限</Text>
            <Step
              value={item.repsMax} unit="次" step={repStepOf(item.sided)} min={item.repsMin} max={50}
              onChange={(v) => props.onPatch({ repsMax: v })}
            />
          </View>
          <View className="set-field set-field--copy">
            <View className="set-copy">
              <Text className="set-k">左右交替做(单侧)</Text>
              <Text className="set-note">
                {item.sided
                  ? `记的是两侧合计:${item.repsMin}-${item.repsMax} 次 = 每侧 ${sideRepsText(item.repsMin)}-${sideRepsText(item.repsMax)} 次`
                  : '单臂划船、弓步、分腿蹲这类一次只练一边的动作打开它,次数按每侧来数、1RM 也按每侧估'}
              </Text>
            </View>
            <Text
              className={`set-toggle${item.sided ? ' on' : ''}`}
              onClick={() => props.onSided(!item.sided)}
            >
              {item.sided ? '已开启' : '开启'}
            </Text>
          </View>
        </>
      )}

      {/* 重量 */}
      <View className="set-field">
        <Text className="set-k">{weightNoun(item.exerciseId)}</Text>
        {weighted ? (
          <Step
            value={item.weightKg ?? 0} unit="kg" step={stepKg} min={assisted ? 0 : 0} max={500}
            onChange={(v) => props.onWeight(v > 0 ? v : null)}
          />
        ) : assisted ? (
          <Text
            className="set-add-weight"
            onClick={() => props.onWeight(stepKg)}
          >
            + 填助力重量
          </Text>
        ) : (
          <Text
            className="set-add-weight"
            onClick={() => props.onWeight(stepKg || 2.5)}
          >
            + 加负重
          </Text>
        )}
      </View>
      {assisted && (
        <Text className="set-note">
          助力器械的数字是「器械帮你分担多少」—— 越小越难。渐进按次数走,次数练满之前不用动它。
        </Text>
      )}
      {!weighted && !assisted && (
        <Text className="set-note">
          现在是自重。加负重适合引体向上、双杠臂屈伸这类能挂片的动作;纯徒手动作保持自重就好。
        </Text>
      )}
      {weighted && (
        <Text className="set-note">
          {assisted ? '助力' : '当前'}{item.weightKg}kg · 每次{assisted ? '减少' : '增加'}{stepKg}kg
          {pct == null ? '' : ` · 约训练最大重量的 ${pct}%${pct >= 90 ? '(接近上限)' : pct <= 60 ? '(偏轻)' : ''}`}
        </Text>
      )}
      {hint && <Text className="set-plate">{hint}</Text>}

      {/* 热身 */}
      <View className="set-field">
        <Text className="set-k">热身组</Text>
        <Step
          value={item.warmupSets ?? 3} unit="组" step={1} min={0} max={3}
          text={item.warmupSets === 0 ? '不热身' : `${item.warmupSets ?? 3} 组`}
          onChange={(v) => props.onPatch({ warmupSets: v })}
        />
      </View>
      <Text className="set-note">
        热身按正式重量自动折算(最多 3 组),只算打勾引导,不进日志也不进容量。
      </Text>

      {/* 休息 */}
      <View className="set-field">
        <Text className="set-k">组间休息</Text>
        <Step
          value={item.restSec} unit="" step={REST_STEP} min={0} max={REST_MAX}
          text={fmtDuration(item.restSec, '不休息')}
          onChange={(v) => props.onPatch({ restSec: clampRest(v) })}
        />
      </View>
      <View className="set-chips">
        {REST_PRESETS.map((sec) => (
          <Text
            key={sec}
            className={`set-chip${clampRest(item.restSec) === sec ? ' on' : ''}`}
            onClick={() => props.onPatch({ restSec: sec })}
          >
            {fmtDuration(sec, '不休息')}
          </Text>
        ))}
      </View>

      {/* 组型 */}
      {!hold && (
        <>
          <Text className="set-title">进阶组型</Text>
          <View className="set-chips">
            {SET_TYPE_ORDER.map((t) => {
              const ok = canSetSetType(item, t);
              const on = (item.setType ?? 'normal') === t;
              return (
                <Text
                  key={t}
                  className={`set-chip${on ? ' on' : ''}${ok ? '' : ' off'}`}
                  onClick={() => ok && props.onSetType(t)}
                >
                  {SETTYPE_ZH[t]}
                </Text>
              );
            })}
          </View>
          <Text className="set-note">{SETTYPE_DESC[item.setType ?? 'normal']}</Text>
        </>
      )}

      {/* 超级组 */}
      {props.canSuperset && props.onToggleSuperset && (
        <View className="set-field set-field--copy">
          <View className="set-copy">
            <Text className="set-k">和下一个动作组成超级组</Text>
            <Text className="set-note">两个动作交替做、组间不休息,省时间但更累</Text>
          </View>
          <Text
            className={`set-toggle${props.supersetOn ? ' on' : ''}`}
            onClick={props.onToggleSuperset}
          >
            {props.supersetOn ? '已开启' : '开启'}
          </Text>
        </View>
      )}

      {/* 渐进 */}
      <Text className="set-title">渐进方式</Text>
      <View className="set-chips">
        {PROG_ORDER.map((k) => {
          const ok = canSetProgression(item, k);
          const on = progOn === k;
          return (
            <Text
              key={k}
              className={`set-chip${on ? ' on' : ''}${ok ? '' : ' off'}`}
              onClick={() => ok && props.onProgression(k)}
            >
              {PROGRESSION_ZH[k]}
            </Text>
          );
        })}
      </View>
      <Text className="set-note">
        {PROGRESSION_DESC[progOn]}
        {item.weightStepKg > 0 && !assisted ? ` · 每次加 ${item.weightStepKg}kg` : ''}
      </Text>

      {/* 备注 — 跟着这一天的安排走,不改动作库 */}
      <Text className="set-title">备注</Text>
      <Input
        className="set-input"
        value={item.note ?? ''}
        maxlength={40}
        placeholder="只给这一次安排,例如「窄握」「膝不舒服就减一组」"
        onInput={(ev) => props.onPatch({ note: ev.detail.value })}
      />
    </View>
  );
}

/** 面板标题那句话:动作属于哪个模式 —— 编辑器和加入计划两处都念同一句 */
export const patternName = (item: PlannedExercise): string =>
  PATTERNS[item.patternId]?.zhName ?? '';
