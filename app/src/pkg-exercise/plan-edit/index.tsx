import { useRef, useState } from 'react';
import { View, Text, Input, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { EQUIPMENT_ZH, MUSCLE_ZH, type ExerciseEntry } from '../data/exercises';
import { findExercise, patternPool } from '../engine/generator';
import { loadText } from '../engine/load';
import { PATTERNS } from '../engine/patterns';
import { loadPlan, savePlan } from '../engine/store';
import * as E from '../engine/editor';
import { SETTYPE_ZH } from '../engine/settype';
import { rescaleReps } from '../engine/sided';
import { schemeText } from '../engine/timed';
import type { PlannedExercise, TrainingPlan } from '../engine/types';
import { round2 } from '../engine/onerm';
import { CYCLE_ZH, CYCLE_DESC, cycleWeeks, setCycle, type CycleStyle } from '../engine/cycle';
import { clearMax, loadMaxes, maxList, setMax, type MaxEntry, type MaxMap } from '../engine/max';
import { loadHint, loadKit, type Kit } from '../engine/kit';
import { loadFavs, saveFavs, sortedByFav, toggleFav, usageOf, type UsageMap } from '../engine/fav';
import { isFaded, restText, strengthRows, type StrengthRow } from '../engine/strength';
import { loadLogs } from '../engine/store';
import { fmtDuration } from '@/utils/duration';
import ExerciseSetup, { patternName } from '../setup';
import './index.scss';
import { THEME } from '@/constants/theme';
import { navigate } from '@/utils/nav';
import { param } from '@/utils/url-param';

/** 底部弹层状态:训练日操作 / 动作参数 / 选动作(ii=null 表示新增) / 力量基准 */
type Sheet =
  | { t: 'day'; di: number }
  | { t: 'item'; di: number; ii: number }
  | { t: 'pick'; di: number; ii: number | null; pid: string }
  | { t: 'max'; ex: MaxEntry }
  | null;

const CYCLE_ORDER: (CycleStyle | null)[] = [null, 'line', '531'];

const fmtItem = (it: PlannedExercise) => {
  const t = it.setType ?? 'normal';
  return `${schemeText(it)} · 休息 ${fmtDuration(it.restSec, '不休息')}`
    + `${it.weightKg != null ? ` · ${loadText(it.exerciseId, it.weightKg)} 起` : ' · 自重'}`
    + (t !== 'normal' ? ` · ${SETTYPE_ZH[t]}` : '');
};

/** 步进器 — 统一「− 值 ＋」样式。`text` 传了就显示它(休息时间要念成「1:30」而不是「90 秒」) */
function Step(props: {
  value: number; unit: string; step?: number; min?: number; max?: number; text?: string;
  onChange: (v: number) => void;
}) {
  const { value, unit, step = 1, min = 1, max = 99, text, onChange } = props;
  return (
    <View className="pe-step">
      <Text className="pe-step-btn" onClick={() => onChange(Math.max(min, value - step))}>−</Text>
      <Text className="pe-step-val">
        {text ?? <>{value}<Text className="pe-step-unit">{unit}</Text></>}
      </Text>
      <Text className="pe-step-btn" onClick={() => onChange(Math.min(max, value + step))}>＋</Text>
    </View>
  );
}

/** 计划编辑器 — 增删动作 / 调顺序 / 改组次次数 / 换动作 / 增删训练日 */
export default function PlanEdit() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  /** 改名的草稿(确认前不落库) */
  const [titleDraft, setTitleDraft] = useState('');
  /** 力量基准(训练最大重量)— 由日志自动估算,页面上只读+手动覆盖 */
  const [maxes, setMaxes] = useState<MaxMap>({});
  /** 基准编辑草稿 */
  const [tmDraft, setTmDraft] = useState(0);
  /** 我的器材 — 行尾显示「每边挂什么」 */
  const [kit, setKit] = useState<Kit>({});
  /** 收藏的动作 + 各动作练过几次 — 换动作时排在前面 */
  const [favs, setFavs] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageMap>({});
  /** 力量保持:停久了的主项要提醒一句 —— 基准是拿历史最好成绩估的,停过就不是今天的能力了 */
  const [faded, setFaded] = useState<Record<string, StrengthRow>>({});
  /**
   * 从计划页「编排这套」带过来的 `?day=` —— 只认一次。
   * 不只认一次的话,用户关掉弹层去动作库挑完动作回来(`useDidShow` 会再跑一趟),
   * 那个页面又会自己弹出来,像关不掉。
   */
  const dayAsked = useRef(false);

  useDidShow(() => {
    const p = loadPlan();
    if (!p) {
      navigate('/pkg-exercise/plan-create/index', { replace: true });
      return;
    }
    setPlan(p);
    setMaxes(loadMaxes());
    setKit(loadKit());
    setFavs(loadFavs());
    const logs = loadLogs();
    setUsage(usageOf(logs));
    setFaded(Object.fromEntries(strengthRows(logs).filter(isFaded).map((r) => [r.exerciseId, r])));
    track('training_plan_edit', 'other');
    // 「编排这套」进来的:直接翻到那一天,别让人在自己那一摞卡里再找一遍
    if (!dayAsked.current) {
      dayAsked.current = true;
      const key = param(Taro.getCurrentInstance().router?.params.day);
      const di = key ? p.days.findIndex((d) => d.key === key) : -1;
      if (di >= 0) {
        setTitleDraft(p.days[di].title);
        setSheet({ t: 'day', di });
      }
    }
  });

  const star = (id: string) => {
    const next = toggleFav(favs, id);
    saveFavs(next);
    setFavs(next);
  };

  /** 所有改动都走这里:改内存 + 立即落库(编辑器没有「取消」语义,所见即所得) */
  const mutate = (fn: (p: TrainingPlan) => TrainingPlan) => {
    if (!plan) return;
    const next = fn(plan);
    if (next === plan) return; // 边界操作返回同引用 — 不必重渲染与写盘
    setPlan(next);
    savePlan(next);
  };

  /**
   * 没有计划就没什么可编排的。正常路径走不到这里(useDidShow 会把人换成计划页),
   * 但**渲染发生在那个跳转之前** —— 原来这一帧是一块纯白,看着像没加载出来。
   * 与其白一下,不如把要说的话先摆上;万一以后多一条进入路径,这里也不必再补。
   */
  if (!plan) {
    return <Screen className="pe-page">
      <View className="card pe-blank">
        <Text className="fs-h1">还没有训练计划</Text>
        <Text className="fs-mini text-secondary">先有一份计划,才谈得上编排动作、改组次。</Text>
        <Button
          className="btn btn--primary pe-blank-cta"
          onClick={() => navigate('/pkg-exercise/plan-create/index')}
        >
          去生成计划
        </Button>
      </View>
    </Screen>;
  }

  const cands = patternPool(plan.access, plan.level);
  const pidList = Object.keys(PATTERNS).filter((pid) => (cands[pid]?.length ?? 0) > 0);

  const step = (di: number, ii: number, patch: Partial<PlannedExercise>) => mutate((p) => E.patchItem(p, di, ii, patch));

  /**
   * 左右交替(单侧)开关。次数口径是**两侧合计**,所以切换的这一刻要把区间折过来,
   * 让用户看到的「每侧几次」保持不变:打开 → 区间 ×2(16-20 就变成 32-40,还是每侧 8-10),
   * 关掉 → 折半。来回各按一次,数字原样回到起点,不会因为点错一下就得重填。
   */
  const toggleSided = (di: number, ii: number, on: boolean) => {
    const it = plan.days[di]?.items[ii];
    if (!it || !!it.sided === on) return;
    step(di, ii, {
      sided: on || undefined,
      repsMin: rescaleReps(it.repsMin, on),
      repsMax: rescaleReps(it.repsMax, on)
    });
  };

  const closeSheet = () => setSheet(null);

  const openDay = (di: number) => {
    setTitleDraft(plan.days[di]?.title ?? '');
    setSheet({ t: 'day', di });
  };

  /** 选动作确认:ii 为 null 时是新增 */
  const chooseExercise = (di: number, ii: number | null, pid: string, ex: ExerciseEntry) => {
    mutate((p) => (ii == null ? E.addItem(p, di, pid, ex) : E.replaceItem(p, di, ii, pid, ex)));
    setSheet(null);
  };

  /**
   * 从训练日里拿掉一个动作。以前是点了就落盘、没有撤销,而那个 ✕ 就挨在「换」旁边 ——
   * 这一天的编排还没试过,先被改掉一格。整页只有它和「删除这一训练日」是破坏性的,
   * 两个都该问一句。
   */
  const delItem = async (di: number, ii: number) => {
    const it = plan.days[di]?.items[ii];
    const { confirm } = await Taro.showModal({
      title: it ? `移除${it.nameZh}?` : '移除这个动作?',
      content: '它会从这一天的编排里删掉,配好的组数和顺序也一起没了。',
      confirmText: '移除',
      cancelText: '留着'
    });
    if (!confirm) return;
    mutate((p) => E.removeItem(p, di, ii));
    setSheet(null);
  };

  /**
   * 上移/下移。一次一步,但超级组是「相邻两个动作」配出来的 —— 这一步把它挪出了相邻位置,
   * 这个组就跟着解散(见 engine/order.ts 开头)。小程序里没有 hover 提示,
   * 所以解散时明说一句,别让用户的超级组无声消失。
   */
  const moveItem = (di: number, ii: number, delta: -1 | 1) => {
    let dissolved = 0;
    mutate((p) => {
      const res = E.moveItemDetailed(p, di, ii, delta);
      if (!res) return p;
      dissolved = res.dissolved;
      return res.plan;
    });
    if (dissolved) Taro.showToast({ title: '超级组已解除', icon: 'none' });
  };

  const openMax = (ex: MaxEntry) => {
    setTmDraft(round2(ex.tmKg));
    setSheet({ t: 'max', ex });
  };

  return (
    <Screen className="pe-page">
      <View className="card pe-intro">
        <Text className="fs-h1">编排你的训练</Text>
        <Text className="fs-mini text-secondary">
          改完即保存。动作顺序、组数次数、休息时间都能调;换动作会保留你已经调好的组次。
        </Text>
      </View>

      {plan.days.map((d, di) => (
        <View className="card pe-day" key={d.key}>
          <View className="pe-day-head" onClick={() => openDay(di)}>
            <View className="pe-day-title">
              <Text className="fs-h1">{d.title}</Text>
              <Text className="pe-day-edit">编排 ▾</Text>
            </View>
            <Text className="fs-mini text-secondary">
              {d.items.length ? `${d.items.length} 个动作 · 约 ${d.estMin} 分钟` : '还没有动作'}
            </Text>
          </View>

          {d.items.map((it, ii) => (
            <View className="pe-item" key={`${it.exerciseId}-${ii}`}>
              <View className="pe-item-main" onClick={() => setSheet({ t: 'item', di, ii })}>
                <View className="pe-item-title">
                  <Text className="pe-item-name">{it.nameZh}</Text>
                  {it.superset && <Text className="pe-ss">超级组</Text>}
                </View>
                <Text className="fs-mini text-secondary">{fmtItem(it)}</Text>
                {/* 配片:改重量时顺手知道这重量挂不挂得出来 */}
                {loadHint(kit, it.weightKg, findExercise(it.exerciseId)) && (
                  <Text className="fs-mini pe-plate">{loadHint(kit, it.weightKg, findExercise(it.exerciseId))}</Text>
                )}
              </View>
              <View className="pe-item-ops">
                <Text className={`pe-op${ii === 0 ? ' off' : ''}`} onClick={() => ii > 0 && moveItem(di, ii, -1)}>↑</Text>
                <Text className={`pe-op${ii === d.items.length - 1 ? ' off' : ''}`} onClick={() => ii < d.items.length - 1 && moveItem(di, ii, 1)}>↓</Text>
                <Text className="pe-op" onClick={() => setSheet({ t: 'pick', di, ii, pid: it.patternId })}>换</Text>
                <Text className="pe-op danger" onClick={() => delItem(di, ii)}>✕</Text>
              </View>
            </View>
          ))}

          <Button
            className="btn btn--secondary btn--block pe-add"
            onClick={() => setSheet({ t: 'pick', di, ii: null, pid: d.items[d.items.length - 1]?.patternId ?? 'hpush' })}
          >
            ＋ 添加动作
          </Button>
        </View>
      ))}

      <Button className="btn btn--secondary btn--block" onClick={() => mutate(E.addDay)}>
        ＋ 添加训练日
      </Button>
      <Text className="fs-mini text-secondary pe-foot">
        单次训练日建议 4-7 个动作;太少刺激不够,太多练完累垮。改完记得回计划页看看时长是否合适。
      </Text>

      {/* ===== 周期安排 ===== */}
      <View className="card pe-cycle">
        <Text className="fs-h1">周期安排</Text>
        <Text className="fs-mini text-secondary">
          默认是「每次都往上加」。设成周期后,重量会按周次走 —— 想更稳、不想一直顶重量时开。
        </Text>
        <View className="pe-chips">
          {CYCLE_ORDER.map((k) => (
            <Text
              key={k ?? 'off'}
              className={`pe-chip${(plan.cycle?.style ?? null) === k ? ' on' : ''}`}
              onClick={() => mutate((p) => setCycle(p, k))}
            >
              {k === null ? '不做周期' : CYCLE_ZH[k]}
            </Text>
          ))}
        </View>
        {plan.cycle ? (
          <>
            <Text className="fs-mini text-secondary pe-tip">{CYCLE_DESC[plan.cycle.style]}</Text>
            <View className="pe-wklist">
              {cycleWeeks(plan.cycle.style).map((w, i) => (
                <View className={`pe-wk${plan.cycle?.week === i + 1 ? ' on' : ''}`} key={w.label}>
                  <Text className="pe-wk-label">{w.label}</Text>
                  <Text className="fs-mini text-secondary">{w.tip}</Text>
                </View>
              ))}
            </View>
            {plan.cycle.style === '531' && (
              <Text className="fs-mini text-secondary">
                波次只作用于有力量基准的主项(见下方);其它动作照常渐进。
              </Text>
            )}
          </>
        ) : (
          <Text className="fs-mini text-secondary pe-tip">
            {CYCLE_DESC.line}
            {'\n'}练到第三四个星期觉得浑身发沉、动作发飘,就该开一个周期了。
          </Text>
        )}
      </View>

      {/* ===== 力量基准(训练最大重量) ===== */}
      <View className="card pe-max">
        <Text className="fs-h1">力量基准</Text>
        <Text className="fs-mini text-secondary">
          练过带重量的动作后,这里会自动估出你的「训练最大重量」(估算极限的九成)。
          拿来判断今天的重量算重还是算轻,也是走 5/3/1 波次的依据。点一行可以自己改。
        </Text>
        {maxList(maxes).map((e) => {
          const f = faded[e.exerciseId];
          return (
            <View className="pe-maxrow" key={e.exerciseId} onClick={() => openMax(e)}>
              <View className="pe-max-copy">
                <Text className="pe-max-name">{e.nameZh}</Text>
                <Text className="fs-mini text-secondary">
                  {e.source === 'manual' ? '自己填的' : '根据记录估算'}
                </Text>
                {/* 停久了:基准是拿历史最好成绩估的,波次按 %TM 开重量,不提醒的话回来第一天就得吃一次失败。
                    说百分比而不是给一个公斤数 —— 这一格是训练最大重量,换成公斤得先折一次 0.9,
                    而且这个模型本来就不精确,写个精确数字反而是骗人。 */}
                {f && (
                  <Text className="pe-max-fade">
                    {restText(f.restDays)} · 力量约剩 {Math.round(f.retained * 100)}%,回来第一周别照这个开
                  </Text>
                )}
              </View>
              <Text className="pe-max-val">{round2(e.tmKg)}<Text className="pe-max-unit">kg</Text></Text>
            </View>
          );
        })}
        {maxList(maxes).length === 0 && (
          <Text className="fs-mini text-secondary pe-empty">
            还没有基准。完成一次带重量的训练,系统会用你实际完成的重量和次数估一个出来。
          </Text>
        )}
      </View>

      {/* ===== 训练日操作 ===== */}
      {sheet?.t === 'day' && (
        <>
          <View className="pe-mask" onClick={closeSheet} catchMove />
          <View className="pe-sheet" catchMove>
            <View className="pe-sheet-head">
              <View className="pe-sheet-title">
                <Text className="fs-h1">训练日设置</Text>
                {/* 写清楚在改哪一天。上移/下移是**相邻互换**,这块面板要是只说「训练日设置」,
                    移完再点「保存名称」/「删除这一训练日」到底落在哪天全靠记性 —— 而下面两个按钮
                    是拿 sheet.di 去操作的,记错了就是改错天、删错天。 */}
                <Text className="fs-mini text-secondary">第 {sheet.di + 1} 天 · 「{plan.days[sheet.di]?.title}」</Text>
              </View>
              <Text className="pe-sheet-close" onClick={closeSheet}>✕</Text>
            </View>
            <View className="pe-field">
              <Text className="pe-field-k">名称</Text>
              <Input
                className="pe-input"
                value={titleDraft}
                maxlength={8}
                placeholder="如:推日 / 全身 A"
                onInput={(e) => setTitleDraft(e.detail.value)}
              />
            </View>
            <View className="pe-sheet-ops">
              <Text className="pe-sheet-op" onClick={() => { mutate((p) => E.renameDay(p, sheet.di, titleDraft)); closeSheet(); }}>保存名称</Text>
              {/* 移完要把 sheet.di 一起挪到新位置:**跟着这一天走**,不是跟着那个位置走。
                  不移的话面板会继续指着换过来的那一天,再点「保存名称」改的就是别人的名字。 */}
              <Text className={`pe-sheet-op${sheet.di === 0 ? ' off' : ''}`} onClick={() => {
                if (sheet.di <= 0) return;
                mutate((p) => E.moveDay(p, sheet.di, -1));
                setSheet({ t: 'day', di: sheet.di - 1 });
              }}>上移</Text>
              <Text className={`pe-sheet-op${sheet.di === plan.days.length - 1 ? ' off' : ''}`} onClick={() => {
                if (sheet.di >= plan.days.length - 1) return;
                mutate((p) => E.moveDay(p, sheet.di, 1));
                setSheet({ t: 'day', di: sheet.di + 1 });
              }}>下移</Text>
              {/* 复制出来的那天插在**这一天后面**,而弹层盖着下半屏 —— 眼前什么都不会变,
                  所以必须报一声「复制到哪了」,不然用户只能关掉弹层去列表里找。
                  弹层留在原件上(不跟着跳到复制品):连点两下就是想再要一份,跟着跳反而要退回来。 */}
              <Text className="pe-sheet-op" onClick={() => {
                // 复制不出来时**别报一句假的**「已复制」:这一刻的 plan 可能已经不是打开弹层时那份了
                // (云同步会把整份计划落到本机),下标指不到任何一天 —— 届时 duplicateDay 原样返回,
                // 而那句「已复制到第 N 天」就成了谎话
                if (!plan.days[sheet.di]) {
                  closeSheet();
                  Taro.showToast({ title: '计划变了,回去看一眼再试', icon: 'none' });
                  return;
                }
                mutate((p) => E.duplicateDay(p, sheet.di));
                track('training_day_dup', 'other');
                Taro.showToast({ title: `已复制到第 ${sheet.di + 2} 天`, icon: 'none' });
              }}>复制这天</Text>
            </View>
            <Button
              className="btn btn--secondary btn--block pe-danger"
              onClick={async () => {
                if (plan.days.length <= 1) { Taro.showToast({ title: '至少保留一个训练日', icon: 'none' }); return; }
                const { confirm } = await Taro.showModal({ title: '删除这一天?', content: `「${plan.days[sheet.di].title}」里的动作编排会一起删除。`, confirmText: '删除', confirmColor: THEME.danger });
                if (confirm) { mutate((p) => E.removeDay(p, sheet.di)); closeSheet(); }
              }}
            >
              删除这一训练日
            </Button>
          </View>
        </>
      )}

      {/* ===== 动作参数 ===== */}
      {sheet?.t === 'item' && (() => {
        const it = plan.days[sheet.di]?.items[sheet.ii];
        if (!it) return null;
        const nextIt = plan.days[sheet.di]?.items[sheet.ii + 1];
        return (
          <>
            <View className="pe-mask" onClick={closeSheet} catchMove />
            <View className="pe-sheet" catchMove>
              <View className="pe-sheet-head">
                <Text className="fs-h1">{it.nameZh}</Text>
                <Text className="pe-sheet-close" onClick={closeSheet}>✕</Text>
              </View>
              <Text className="fs-mini text-secondary">{patternName(it)}</Text>

              {/* 参数面板和「动作库 → 加入计划」共用同一份(见 setup/index.tsx) */}
              <ExerciseSetup
                item={it}
                ex={findExercise(it.exerciseId)}
                kit={kit}
                maxes={maxes}
                canSuperset={!!nextIt}
                supersetOn={Boolean(it.superset && it.superset === nextIt?.superset)}
                onPatch={(patch) => step(sheet.di, sheet.ii, patch)}
                onWeight={(w) => {
                  const next = E.withWeight(it, w);
                  step(sheet.di, sheet.ii, {
                    weightKg: next.weightKg, progression: next.progression, setType: next.setType
                  });
                }}
                onSided={(on) => toggleSided(sheet.di, sheet.ii, on)}
                onSetType={(t) => step(sheet.di, sheet.ii, { setType: E.withSetType(it, t).setType })}
                onProgression={(k) => step(sheet.di, sheet.ii, { progression: E.withProgression(it, k).progression })}
                onToggleSuperset={() => mutate((p) => E.toggleSuperset(p, sheet.di, sheet.ii))}
              />

              <View className="pe-sheet-ops">
                <Text className="pe-sheet-op" onClick={() => setSheet({ t: 'pick', di: sheet.di, ii: sheet.ii, pid: it.patternId })}>换个动作</Text>
                <Text className="pe-sheet-op danger" onClick={() => delItem(sheet.di, sheet.ii)}>删除</Text>
              </View>
            </View>
          </>
        );
      })()}

      {/* ===== 力量基准编辑 ===== */}
      {sheet?.t === 'max' && (
        <>
          <View className="pe-mask" onClick={closeSheet} catchMove />
          <View className="pe-sheet" catchMove>
            <View className="pe-sheet-head">
              <View className="pe-sheet-title">
                <Text className="fs-h1">{sheet.ex.nameZh}</Text>
                <Text className="fs-mini text-secondary">训练最大重量(不是极限重量,留了一成余量)</Text>
              </View>
              <Text className="pe-sheet-close" onClick={closeSheet}>✕</Text>
            </View>

            <View className="pe-field">
              <Text className="pe-field-k">训练最大重量</Text>
              <Step value={tmDraft} unit="kg" step={2.5} min={0} max={500} onChange={setTmDraft} />
            </View>
            <Text className="fs-mini text-secondary pe-tip">
              现在的估算极限是 {round2(sheet.ex.e1rmKg)}kg,对应的训练基准是 {round2(sheet.ex.tmKg)}kg。
              如果你实际测过更准的数字,直接改这里;改过之后系统不再用记录覆盖它。
            </Text>

            <View className="pe-sheet-ops">
              <Text
                className="pe-sheet-op"
                onClick={() => {
                  setMax(sheet.ex.exerciseId, sheet.ex.nameZh, tmDraft);
                  setMaxes(loadMaxes());
                  closeSheet();
                }}
              >
                保存
              </Text>
              <Text
                className="pe-sheet-op danger"
                onClick={() => {
                  clearMax(sheet.ex.exerciseId);
                  setMaxes(loadMaxes());
                  closeSheet();
                }}
              >
                清除基准
              </Text>
            </View>
          </View>
        </>
      )}

      {/* ===== 选动作(模式 → 动作) ===== */}
      {sheet?.t === 'pick' && (() => {
        // 收藏的和常练的排前面:换动作时就那么几个候选,排一下就很不一样
        const list = sortedByFav(cands[sheet.pid] ?? [], favs, usage);
        const curId = sheet.ii == null ? null : plan.days[sheet.di]?.items[sheet.ii]?.exerciseId;
        return (
          <>
            <View className="pe-mask" onClick={closeSheet} catchMove />
            <View className="pe-sheet pe-sheet--pick" catchMove>
              <View className="pe-sheet-head">
                <View className="pe-sheet-title">
                  <Text className="fs-h1">{sheet.ii == null ? '添加动作' : '换个动作'}</Text>
                  <Text className="fs-mini text-secondary">{PATTERNS[sheet.pid]?.zhName}</Text>
                </View>
                <Text className="pe-sheet-close" onClick={closeSheet}>✕</Text>
              </View>

              <View className="pe-chips">
                {pidList.map((pid) => (
                  <Text
                    key={pid}
                    className={`pe-chip${pid === sheet.pid ? ' on' : ''}`}
                    onClick={() => setSheet({ ...sheet, pid })}
                  >
                    {PATTERNS[pid].zhName}
                  </Text>
                ))}
              </View>

              <View className="pe-exlist">
                {list.map((ex) => {
                  const on = ex.id === curId;
                  const dup = sheet.ii == null && E.dayHasExercise(plan, sheet.di, ex.id);
                  return (
                    <View
                      className={`pe-ex${on ? ' on' : ''}`}
                      key={ex.id}
                      onClick={() => !on && chooseExercise(sheet.di, sheet.ii, sheet.pid, ex)}
                    >
                      <View className="pe-ex-copy">
                        <Text className="pe-ex-name">{ex.nameZh}</Text>
                        <Text className="fs-mini text-secondary">
                          {EQUIPMENT_ZH[ex.equipment as keyof typeof EQUIPMENT_ZH] ?? ex.equipment}
                          {' · '}
                          {MUSCLE_ZH[ex.target as keyof typeof MUSCLE_ZH] ?? ex.target}
                          {dup ? ' · 这一天已有' : ''}
                        </Text>
                      </View>
                      {on && <Text className="pe-ex-tick">当前</Text>}
                      {/* 挑备选的时候正是「这个我喜欢」的时刻 —— 在这里就能星上,
                          不用回头去动作库再找一遍(星标要吃下这次点击) */}
                      <Text
                        className={`pe-ex-star${favs.includes(ex.id) ? ' is-on' : ''}`}
                        onClick={(ev) => { ev.stopPropagation(); star(ex.id); }}
                      >
                        {favs.includes(ex.id) ? '★' : '☆'}
                      </Text>
                    </View>
                  );
                })}
                {list.length === 0 && (
                  <Text className="fs-mini text-secondary pe-ex-empty">
                    这个模式在你的器械条件下暂无可用动作,换个模式试试。
                  </Text>
                )}
              </View>
            </View>
          </>
        );
      })()}
    </Screen>
  );
}
