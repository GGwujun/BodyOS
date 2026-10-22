import { themedColor } from '@/utils/theme';
import { useState } from 'react';
import { View, Text, Button, Image, Input, Switch, Textarea } from '@tarojs/components';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { THEME } from '@/constants/theme';
import { navigate } from '@/utils/nav';
import { track } from '@/services/analytics';
import { toast } from '@/utils/ui';
import { fmtDuration } from '@/utils/duration';
import { loadPlan, savePlan } from '../engine/store';
import { loadText } from '../engine/load';
import { schemeText } from '../engine/timed';
import {
  ACCESS_DESC, ACCESS_ZH, GOAL_ZH, LEVEL_ZH, type EquipAccess, type Goal, type Level,
  type PlannedExercise, type TrainingPlan
} from '../engine/types';
import { WEEKDAY_ONE, WEEKDAY_ZH } from '../engine/schedule';
import { PATTERNS } from '../engine/patterns';
import {
  REFINE_HINT, buildWeek, intakeLines, loadCoach, makeProposal, message,
  refineProfile, saveCoach, scheduleForImport,
  type CoachMessage, type CoachProposal, type CoachProfile, type CoachState
} from '../engine/coach';
import './index.scss';

const DEFAULT_PROFILE: CoachProfile = {
  goal: 'fatloss',
  level: 'beginner',
  access: 'body',
  daysPerWeek: 3,
  sessionMin: 30,
  preferredDays: [],
  limitations: ''
};

const STEPS = ['goal', 'level', 'days', 'length', 'access', 'limits'] as const;
type Step = typeof STEPS[number];

const GOAL_DESC: Record<Goal, string> = {
  fatloss: '消耗优先,次数偏高、休息更短',
  muscle: '肌肥大区间,组数与休息充足',
  endurance: '高次数耐力,节奏紧凑'
};
const LEVEL_DESC: Record<Level, string> = {
  beginner: '刚练或停练很久,动作求稳',
  intermediate: '熟悉常见动作,想系统进阶'
};
const ACCESSES: EquipAccess[] = ['body', 'dumbbell', 'home', 'gym'];
const LENGTHS = [30, 45, 60, 90];

/** 从计划页进来的教练 —— 先问清情况,再给一份能导入的计划 */
export default function CoachPage() {
  const [state, setState] = useState<CoachState>(() => loadCoach());
  /** null = 在对话里;否则是在问第几题 */
  const [step, setStep] = useState<Step | null>(() => (loadCoach().profile ? null : STEPS[0]));
  const [draft, setDraft] = useState<CoachProfile>(() => loadCoach().profile ?? DEFAULT_PROFILE);
  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** 刚导入完 / 刚丢弃:在对话底部给一个「去看计划」的落点 */
  const [justImported, setJustImported] = useState(false);

  useDidShow(() => {
    const next = loadCoach();
    setState(next);
    // 从动作库/计划页回来时不要把人又拽回问卷:有档案就直接看对话
    if (next.profile) setStep(null);
    track('training_coach_view', 'other');
  });

  /** 所有状态改动走这一处:内存和本机同时落地,刷新不会丢 */
  const commit = (next: CoachState) => {
    setState(next);
    saveCoach(next);
  };

  const scrollEnd = () => {
    setTimeout(() => {
      void Taro.pageScrollTo({ scrollTop: 999999, duration: 200 }).catch(() => undefined);
    }, 60);
  };

  const lastIteration = (s: CoachState) => s.pending?.iteration ?? s.history[0]?.iteration ?? 0;

  /**
   * 「我的情况」那张卡永远只有一张。
   * 改过回答以后重排,如果又追加一张,对话里会躺着两份互相矛盾的目标/天数;
   * 直接在原处换成最新的,后改的那次自然覆盖先前的。
   */
  const withIntake = (msgs: CoachMessage[], profile: CoachProfile): CoachMessage[] => {
    const text = intakeLines(profile).join('\n');
    if (!msgs.some((m) => m.kind === 'intake')) return [...msgs, message('user', 'intake', text)];
    return msgs.map((m) => (m.kind === 'intake' ? { ...m, text } : m));
  };

  /* ============================ 问卷 ============================ */

  const openIntake = (reset = false) => {
    setDraft(reset || !state.profile ? DEFAULT_PROFILE : state.profile);
    setStep(STEPS[0]);
    setMenuOpen(false);
    void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }).catch(() => undefined);
  };

  const backFromIntake = () => {
    const i = step ? STEPS.indexOf(step) : 0;
    if (i > 0) {
      setStep(STEPS[i - 1]);
      return;
    }
    if (state.profile) setStep(null);
    else void Taro.navigateBack().catch(() => navigate('/pkg-exercise/plan-view/index'));
  };

  const finishIntake = () => {
    const profile: CoachProfile = {
      ...draft,
      limitations: draft.limitations.trim().slice(0, 120)
    };
    const iteration = lastIteration(state) + 1;
    const proposal = makeProposal(profile, iteration);
    const intro = iteration > 1
      ? `按你改过的回答重排了第 ${iteration} 版。还是那句话:你点「导入此计划」之前,现在的计划一点都不会动。`
      : '先按这些排了一版。下面就是,慢慢看 —— 你点「导入此计划」之前,现在的计划一点都不会动。';
    commit({
      ...state,
      profile,
      pending: proposal,
      history: state.pending
        ? [{ ...state.pending, status: 'dismissed' as const }, ...state.history].slice(0, 20)
        : state.history,
      messages: [
        ...withIntake(state.messages, profile),
        message('coach', 'text', intro)
      ]
    });
    setStep(null);
    setJustImported(false);
    scrollEnd();
    track('training_coach_proposal', 'other');
  };

  /* ============================ 决定一份方案 ============================ */

  const importProposal = (useWeek: boolean) => {
    const p = state.pending;
    if (!p) return;
    const old = loadPlan();
    const schedule = useWeek ? p.plan.schedule : scheduleForImport(old, p.plan);
    const nextPlan: TrainingPlan = {
      ...p.plan,
      daysPerWeek: p.plan.days.length,
      ...(schedule ? { schedule } : {})
    };
    savePlan(nextPlan);
    // 留一份旧的:导入不是不可逆的,用户发现排得不对时点一下就能回去
    const decided: CoachProposal = { ...p, status: 'imported', prevPlan: old ?? undefined };
    commit({
      ...state,
      pending: null,
      history: [decided, ...state.history].slice(0, 20),
      messages: [
        ...state.messages,
        message('coach', 'applied', useWeek
          ? `导入好了。${nextPlan.days.length} 套训练日和这周的安排都换成了这份;这份没排的日子就是休息日。以后每练完一次,重量和次数会按你的表现自己往前调。`
          : old
            ? `导入好了。日常动作换成了这份 ${nextPlan.days.length} 套;周计划保持原样。想让它也接管日程,去计划页的「日程」里选一下。`
            : `导入好了。${nextPlan.days.length} 套训练日按顺序轮转;想改成固定哪几天,去计划页的「日程」里排。`)
      ]
    });
    setJustImported(true);
    toast('计划已导入');
    scrollEnd();
    track('training_coach_import', 'other');
  };

  const discardProposal = async () => {
    const p = state.pending;
    if (!p) return;
    const { confirm } = await Taro.showModal({
      title: '丢弃这份计划?',
      content: '不会保存,也不会动现在的计划。想再要一版,随时说一声。',
      confirmText: '丢弃',
      confirmColor: THEME.danger
    });
    if (!confirm) return;
    const decided: CoachProposal = { ...p, status: 'dismissed' };
    commit({
      ...state,
      pending: null,
      history: [decided, ...state.history].slice(0, 20),
      messages: [
        ...state.messages,
        message('coach', 'dismissed', '这份先放下了,现有的计划没动。想重排的话点下面的「重新排一份」,或者直接说改哪里。')
      ]
    });
    setMenuOpen(false);
    toast('已丢弃');
    scrollEnd();
    track('training_coach_discard', 'other');
  };

  /**
   * 撤回一次导入。只有存了导入前的计划才能撤 —— 老版本留下的提案没有那一格,
   * 此时老老实实说撤不回来,而不是把计划清空。
   */
  const undoImport = async (p: CoachProposal) => {
    if (!p.prevPlan) {
      toast('这一版没有可恢复的旧计划', 'none');
      return;
    }
    const { confirm } = await Taro.showModal({
      title: '撤回这次导入?',
      content: '会把计划恢复成导入前的那一份;导入之后你手动改过的地方也会一起恢复。',
      confirmText: '撤回',
      confirmColor: THEME.danger
    });
    if (!confirm) return;
    savePlan(p.prevPlan);
    commit({
      ...state,
      history: state.history.map((x) => (x.id === p.id ? { ...x, status: 'dismissed' as const } : x)),
      messages: [
        ...state.messages,
        message('coach', 'dismissed', '已经把计划恢复成导入前的那一份。这一版留在提案记录里,想再要随时拿回来。')
      ]
    });
    setJustImported(false);
    toast('已撤回');
    track('training_coach_undo', 'other');
  };

  /* ============================ 说一句改一改 ============================ */

  const send = () => {
    const msg = text.trim();
    if (!msg) return;
    const base = state.profile ?? draft;
    const { profile, changes } = refineProfile(base, msg);
    const wantsRebuild = /重新|重排|再来一?版|换一版|换一份/.test(msg);
    const userMsg = message('user', 'text', msg);
    if (!changes.length && !wantsRebuild) {
      commit({
        ...state,
        messages: [...state.messages, userMsg, message('coach', 'text', REFINE_HINT)]
      });
      setText('');
      scrollEnd();
      return;
    }
    const iteration = lastIteration(state) + 1;
    const proposal = makeProposal(profile, iteration);
    commit({
      ...state,
      profile,
      pending: proposal,
      history: state.pending
        ? [{ ...state.pending, status: 'dismissed' as const }, ...state.history].slice(0, 20)
        : state.history,
      messages: [
        ...withIntake(state.messages, profile),
        userMsg,
        message('coach', 'text', changes.length
          ? `按你说的改了:${changes.join('、')}。这是第 ${iteration} 版。`
          : `重新排了一版(第 ${iteration} 版),回答没改,所以动作安排和上一版一样。想换目标、天数、时长或器械,直接说就行。`)
      ]
    });
    setText('');
    setJustImported(false);
    scrollEnd();
    track('training_coach_refine', 'other');
  };

  const rebuild = () => {
    setMenuOpen(false);
    if (!state.profile) {
      openIntake();
      return;
    }
    const iteration = lastIteration(state) + 1;
    const proposal = makeProposal(state.profile, iteration);
    commit({
      ...state,
      pending: proposal,
      history: state.pending
        ? [{ ...state.pending, status: 'dismissed' as const }, ...state.history].slice(0, 20)
        : state.history,
      messages: [
        ...state.messages,
        message('user', 'text', '重新排一份。'),
        message('coach', 'text', `重新看了一遍你的回答,排出第 ${iteration} 版。`)
      ]
    });
    setJustImported(false);
    scrollEnd();
    track('training_coach_proposal', 'other');
  };

  const reopen = (p: CoachProposal) => {
    const proposal: CoachProposal = { ...p, status: 'pending' };
    commit({
      ...state,
      pending: proposal,
      history: [
        ...(state.pending && state.pending.id !== p.id
          ? [{ ...state.pending, status: 'dismissed' as const }]
          : []),
        ...state.history.filter((x) => x.id !== p.id)
      ].slice(0, 20),
      messages: [
        ...state.messages,
        message('coach', 'text', `把第 ${p.iteration} 版又拿出来了。想导入就点下面,不想要就再丢掉。`)
      ]
    });
    setHistoryOpen(false);
    scrollEnd();
  };

  const backToPlan = () => {
    void Taro.navigateBack().catch(() => navigate('/pkg-exercise/plan-view/index'));
  };

  /* ============================ 问卷界面 ============================ */

  if (step) {
    const i = STEPS.indexOf(step);
    const last = i === STEPS.length - 1;
    const toggleDay = (d: number) => setDraft((v) => ({
      ...v,
      preferredDays: v.preferredDays.includes(d)
        ? v.preferredDays.filter((x) => x !== d)
        : [...v.preferredDays, d].sort((a, b) => a - b)
    }));
    const toggleAccess = (a: EquipAccess) => setDraft((v) => ({ ...v, access: a }));

    return (
      <Screen className="coach-page">
        <View className="ch-intake-top">
          <Text className="ch-back" onClick={backFromIntake}>‹</Text>
          <View className="ch-dots">
            {STEPS.map((s, k) => (
              <View key={s} className={`ch-dot${k === i ? ' on' : k < i ? ' done' : ''}`} />
            ))}
          </View>
          <Text className="ch-stepno">{i + 1}/{STEPS.length}</Text>
        </View>

        <View className="ch-intake">
          {step === 'goal' && <>
            <Text className="ch-eyebrow">你的目标</Text>
            <Text className="ch-q">你练它是为了什么?</Text>
            <Text className="ch-q-sub">整套安排会围着它排。</Text>
            <View className="ch-choices">
              {(['fatloss', 'muscle', 'endurance'] as Goal[]).map((g) => (
                <View
                  key={g}
                  className={`ch-choice${draft.goal === g ? ' on' : ''}`}
                  onClick={() => setDraft((v) => ({ ...v, goal: g }))}
                >
                  <View className="ch-choice-copy">
                    <Text className="ch-choice-t">{GOAL_ZH[g]}</Text>
                    <Text className="ch-choice-s">{GOAL_DESC[g]}</Text>
                  </View>
                  <View className={`ch-tick${draft.goal === g ? ' on' : ''}`}>{draft.goal === g && <Text>✓</Text>}</View>
                </View>
              ))}
            </View>
          </>}

          {step === 'level' && <>
            <Text className="ch-eyebrow">训练经验</Text>
            <Text className="ch-q">你现在从哪儿开始?</Text>
            <Text className="ch-q-sub">它决定进度快慢,也决定默认你熟不熟这些动作。</Text>
            <View className="ch-choices">
              {(['beginner', 'intermediate'] as Level[]).map((l) => (
                <View
                  key={l}
                  className={`ch-choice${draft.level === l ? ' on' : ''}`}
                  onClick={() => setDraft((v) => ({ ...v, level: l }))}
                >
                  <View className="ch-choice-copy">
                    <Text className="ch-choice-t">{LEVEL_ZH[l]}</Text>
                    <Text className="ch-choice-s">{LEVEL_DESC[l]}</Text>
                  </View>
                  <View className={`ch-tick${draft.level === l ? ' on' : ''}`}>{draft.level === l && <Text>✓</Text>}</View>
                </View>
              ))}
            </View>
          </>}

          {step === 'days' && <>
            <Text className="ch-eyebrow">日程</Text>
            <Text className="ch-q">每周练几天?</Text>
            <Text className="ch-q-sub">挑你真正能坚持的,不是想象里最理想的。</Text>
            <View className="ch-dayrow">
              {[2, 3, 4, 5, 6].map((n) => (
                <Text
                  key={n}
                  className={`ch-daynum${draft.daysPerWeek === n ? ' on' : ''}`}
                  onClick={() => setDraft((v) => ({ ...v, daysPerWeek: n }))}
                >
                  {n}
                </Text>
              ))}
            </View>
            <Text className="ch-sub">想排哪几天?(可不选)</Text>
            <View className="ch-weekrow">
              {WEEKDAY_ZH.map((w, d) => (
                <Text
                  key={w}
                  className={`ch-wd${draft.preferredDays.includes(d) ? ' on' : ''}`}
                  onClick={() => toggleDay(d)}
                >
                  {WEEKDAY_ONE[d]}
                </Text>
              ))}
            </View>
          </>}

          {step === 'length' && <>
            <Text className="ch-eyebrow">单次时长</Text>
            <Text className="ch-q">一次能练多久?</Text>
            <Text className="ch-q-sub">组间休息也算在里面 —— 给一个你真的有的时间。</Text>
            <View className="ch-dayrow">
              {LENGTHS.map((n) => (
                <Text
                  key={n}
                  className={`ch-daynum ch-daynum--min${draft.sessionMin === n ? ' on' : ''}`}
                  onClick={() => setDraft((v) => ({ ...v, sessionMin: n }))}
                >
                  {n} 分钟
                </Text>
              ))}
            </View>
          </>}

          {step === 'access' && <>
            <Text className="ch-eyebrow">器械</Text>
            <Text className="ch-q">你能用哪些器械?</Text>
            <Text className="ch-q-sub">按最常去的那个地方选;我的器材里登记过的话,也可以在计划页再细化。</Text>
            <View className="ch-choices">
              {ACCESSES.map((a) => (
                <View
                  key={a}
                  className={`ch-choice${draft.access === a ? ' on' : ''}`}
                  onClick={() => toggleAccess(a)}
                >
                  <View className="ch-choice-copy">
                    <Text className="ch-choice-t">{ACCESS_ZH[a]}</Text>
                    <Text className="ch-choice-s">{ACCESS_DESC[a]}</Text>
                  </View>
                  <View className={`ch-tick${draft.access === a ? ' on' : ''}`}>{draft.access === a && <Text>✓</Text>}</View>
                </View>
              ))}
            </View>
          </>}

          {step === 'limits' && <>
            <Text className="ch-eyebrow">最后一点</Text>
            <Text className="ch-q">有什么要避开的?</Text>
            <Text className="ch-q-sub">写动作名就行,比如「引体向上、硬拉」。有备选动作就换一个,没有就从那天拿掉。</Text>
            <View className="ch-field">
              <Textarea
                className="ch-area"
                value={draft.limitations}
                maxlength={120}
                placeholder="例:引体向上、杠铃硬拉"
                onInput={(e) => setDraft((v) => ({ ...v, limitations: e.detail.value }))}
              />
            </View>
            <Text className="ch-warn">如果身体真的疼,先找医生或康复师。教练只会按你说的动作名避开,不做诊断。</Text>
          </>}
        </View>

        <View className="ch-intake-foot">
          <Button className="btn btn--primary btn--block" onClick={last ? finishIntake : () => setStep(STEPS[i + 1])}>
            {last ? '让教练排一版' : '继续'}
          </Button>
        </View>
      </Screen>
    );
  }

  /* ============================ 对话界面 ============================ */

  return (
    <Screen className="coach-page">
      <View className="ch-header">
        <Text className="ch-back" onClick={backToPlan}>‹</Text>
        <View className="ch-av"><Image className="ch-av-img" src={dumbbellIcon} mode="aspectFit" /></View>
        <View className="ch-hdr-copy">
          <Text className="ch-name">教练</Text>
          <Text className="ch-state">{state.pending ? '有一版等你决定' : '在这儿看你的计划'}</Text>
        </View>
        <Text className="ch-more" onClick={() => setMenuOpen(true)}>⋯</Text>
      </View>

      <View className="ch-msgs">
        {state.messages.map((m) => (
          <View key={m.id} className={`ch-msg ch-msg--${m.role}`}>
            <View className={`ch-bub${m.kind === 'applied' ? ' is-ok' : ''}${m.kind === 'dismissed' ? ' is-dim' : ''}`}>
              {m.kind === 'intake' ? (
                <>
                  <Text className="ch-bub-title">我的情况</Text>
                  {m.text.split('\n').filter(Boolean).map((line) => (
                    <Text className="ch-bub-line" key={line}>{line}</Text>
                  ))}
                </>
              ) : (
                <Text>{m.text}</Text>
              )}
            </View>
          </View>
        ))}

        {state.pending && (
          <ProposalCard
            p={state.pending}
            onImport={importProposal}
            onDiscard={() => void discardProposal()}
          />
        )}

        {justImported && !state.pending && (
          <View className="ch-after">
            <Text className="ch-after-t">计划已经在你手上了。</Text>
            <Text className="ch-after-link" onClick={() => navigate('/pkg-exercise/plan-view/index')}>
              去看训练计划 ›
            </Text>
          </View>
        )}
      </View>

      <View className="ch-dock">
        <View className="ch-quick">
          {!state.pending && (
            <Text className="ch-chip" onClick={() => navigate('/pkg-exercise/plan-view/index')}>去看计划</Text>
          )}
          <Text className="ch-chip" onClick={rebuild}>重新排一份</Text>
          <Text className="ch-chip" onClick={() => openIntake()}>调整回答</Text>
          <Text className="ch-chip" onClick={() => setHistoryOpen(true)}>提案记录</Text>
        </View>

        <View className="ch-composer">
          <Input
            className="ch-input"
            value={text}
            maxlength={200}
            placeholder={state.pending ? '觉得哪儿不对?说改哪里…' : '告诉教练改什么…'}
            placeholderClass="ch-ph"
            confirmType="send"
            onInput={(e) => setText(e.detail.value)}
            onConfirm={send}
          />
          <Text className={`ch-send${text.trim() ? ' on' : ''}`} onClick={send}>发送</Text>
        </View>
      </View>

      {/* 对话页的更多 */}
      {menuOpen && <>
        <View className="ch-mask" onClick={() => setMenuOpen(false)} catchMove />
        <View className="ch-sheet" catchMove>
          <View className="ch-sheet-head">
            <Text className="ch-sheet-title">教练</Text>
            <Text className="ch-sheet-close" onClick={() => setMenuOpen(false)}>✕</Text>
          </View>
          <View className="ch-menu-row" onClick={() => openIntake()}>
            <View className="ch-menu-copy">
              <Text className="ch-menu-t">调整我的回答</Text>
              <Text className="ch-menu-s">目标、经验、天数、时长、器械、想避开的动作</Text>
            </View>
            <Text className="ch-menu-arrow">›</Text>
          </View>
          <View className="ch-menu-row" onClick={rebuild}>
            <View className="ch-menu-copy">
              <Text className="ch-menu-t">重新排一份</Text>
              <Text className="ch-menu-s">按现在的回答再排一版,现在的计划不动</Text>
            </View>
            <Text className="ch-menu-arrow">›</Text>
          </View>
          <View className="ch-menu-row" onClick={() => { setMenuOpen(false); setHistoryOpen(true); }}>
            <View className="ch-menu-copy">
              <Text className="ch-menu-t">提案记录</Text>
              <Text className="ch-menu-s">给过的方案都留着,不管是导入还是丢弃</Text>
            </View>
            <Text className="ch-menu-arrow">›</Text>
          </View>
          {state.pending && (
            <View className="ch-menu-row" onClick={() => void discardProposal()}>
              <Text className="ch-menu-t ch-menu-t--danger">丢弃当前这一版</Text>
            </View>
          )}
        </View>
      </>}

      {/* 提案记录 */}
      {historyOpen && <>
        <View className="ch-mask" onClick={() => setHistoryOpen(false)} catchMove />
        <View className="ch-sheet" catchMove>
          <View className="ch-sheet-head">
            <View>
              <Text className="ch-sheet-title">提案记录</Text>
              <Text className="ch-sheet-sub">导入的和丢弃的都在这儿</Text>
            </View>
            <Text className="ch-sheet-close" onClick={() => setHistoryOpen(false)}>✕</Text>
          </View>
          {state.history.length ? state.history.map((p) => (
            <View
              className="ch-hist"
              key={p.id}
              onClick={() => {
                if (p.status === 'imported') {
                  toast('这一版已经导入了', 'none');
                  return;
                }
                reopen(p);
              }}
            >
              <View className="ch-hist-main">
                <Text className="ch-hist-t">第 {p.iteration} 版 · {p.summary}</Text>
                <Text className="ch-hist-s">{p.at.slice(0, 10)} · {p.status === 'imported' ? '已导入' : '已丢弃'}</Text>
              </View>
              <Text
                className={`ch-hist-state${p.status === 'imported' && p.prevPlan ? ' ch-hist-undo' : ''}`}
                onClick={(e) => {
                  // 行本身也能点 —— 里面的动作必须自己截住,不然 reopen/undo 会各响两次
                  e.stopPropagation();
                  if (p.status === 'imported') {
                    if (p.prevPlan) void undoImport(p);
                    else toast('这一版已经导入了', 'none');
                    return;
                  }
                  reopen(p);
                }}
              >{p.status === 'imported' ? (p.prevPlan ? '撤回' : '在用') : '再拿回来'}</Text>
            </View>
          )) : (
            <Text className="ch-empty">还没有定下来的方案。上面排一版,导入或丢弃之后都会记在这儿。</Text>
          )}
        </View>
      </>}
    </Screen>
  );
}

/* ============================ 方案卡 ============================ */

function ProposalCard(props: {
  p: CoachProposal;
  onImport: (useWeek: boolean) => void;
  onDiscard: () => void;
}) {
  const { p } = props;
  const [tab, setTab] = useState(0);
  const [useWeek, setUseWeek] = useState(true);
  const days = p.plan.days;
  const d = days[Math.min(tab, days.length - 1)];
  const week = p.plan.schedule?.week ?? buildWeek(days.map((x) => x.key), []);

  return (
    <View className="ch-card">
      <View className="ch-card-head">
        <Text className="ch-eyebrow">{p.iteration > 1 ? `第 ${p.iteration} 版` : '给你的计划'}</Text>
        <Text className="ch-card-title">{GOAL_ZH[p.plan.goal]} · 每周 {days.length} 练</Text>
        <Text className="ch-card-sum">{p.summary}</Text>
        <Text className="ch-card-sub">{p.basedOn}</Text>
      </View>

      <View className="ch-card-week">
        {WEEKDAY_ONE.map((w, i) => (
          <View className={`ch-card-wd${week[i]?.length ? ' on' : ''}`} key={w}>
            <Text>{w}</Text>
          </View>
        ))}
      </View>

      <View className="ch-tabs">
        {days.map((x, i) => (
          <Text
            key={x.key}
            className={`ch-tab${i === tab ? ' on' : ''}`}
            onClick={() => setTab(i)}
          >
            {x.title}
          </Text>
        ))}
      </View>

      {d && (
        <View className="ch-routine">
          <View className="ch-routine-head">
            <Text className="ch-routine-title">{d.title}</Text>
            <Text className="fs-mini text-secondary">{d.items.length} 个动作 · 约 {d.estMin} 分钟</Text>
          </View>
          {d.focus && <Text className="ch-routine-focus">{d.focus}</Text>}
          {d.items.map((it, i) => (
            <View className="ch-ex" key={`${it.exerciseId}-${i}`}>
              <View className="ch-ex-main">
                <Text className="ch-ex-n">{it.nameZh}</Text>
                <Text className="ch-ex-l">{exLine(it)}</Text>
                <Text className="ch-ex-why">{whyText(it, i, p.plan.goal)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View className="ch-sched">
        <View className="ch-sched-copy">
          <Text className="ch-sched-t">同时用这份周计划</Text>
          <Text className="ch-sched-s">换掉现在的周安排;这份没排的日子就是休息日。</Text>
        </View>
        <Switch checked={useWeek} color={themedColor(THEME.primary)} onChange={(e) => setUseWeek(e.detail.value)} />
      </View>

      <Text className="ch-note">教练不是医生,也不做诊断。有疼痛先找专业人士。</Text>

      <View className="ch-card-ops">
        <Button className="btn btn--primary ch-import" onClick={() => props.onImport(useWeek)}>
          导入此计划
        </Button>
        <Button className="btn ch-discard" onClick={props.onDiscard}>丢弃</Button>
      </View>
      <Text className="ch-card-hint">不满意?在下面直接说改哪里,比如「每周 4 练」「40 分钟」「换哑铃」。</Text>
    </View>
  );
}

/** 多关节主项 —— 说明为什么值得放在前面、为什么占掉那几分钟 */
const COMPOUND = new Set(['squat', 'hinge', 'lunge', 'hpush', 'vpush', 'hpull', 'vpull', 'swing']);

/**
 * 每个动作下面那句「为什么排它」。
 * 这不是给动作库背书,而是把**编排的取舍**说出来:为什么它在最前面、为什么练完主项还要它。
 * 只说排得出来的理由,不编造效果。
 */
function whyText(it: PlannedExercise, i: number, goal: TrainingPlan['goal']): string {
  if (it.patternId === 'finisher') return '有氧收尾,把这一天的消耗补满';
  if (it.patternId === 'core') return '核心收尾,不抢主项的体力';
  if (i === 0) return '主项放最前面,体力最好时练';
  if (COMPOUND.has(it.patternId)) {
    if (goal === 'fatloss') return '多关节动作,同样时间消耗更高';
    if (goal === 'muscle') return '多关节动作,撑起这一天的训练量';
    return '组间休息留得短,顺带练到心肺';
  }
  const zh = PATTERNS[it.patternId]?.zhName;
  return zh ? `${zh},补上主项没覆盖到的部位` : '补上主项没覆盖到的部位';
}

/** 一行动作处方:组次 + 重量 + 休息 */
function exLine(it: PlannedExercise): string {
  const scheme = schemeText({ sets: it.sets, repsMin: it.repsMin, repsMax: it.repsMax, holdSec: it.holdSec, sided: it.sided });
  const load = it.weightKg != null ? loadText(it.exerciseId, it.weightKg) : '自重';
  return `${scheme} · ${load} · 休 ${fmtDuration(it.restSec, '不休息')}`;
}
