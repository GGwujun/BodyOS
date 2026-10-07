import { useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { ASSESSMENTS, estimateMinutes, scoreAssessment } from '@/data/assessments';
import type { AssessmentDef, Answer, AssessResult } from '@/data/assessments';
import { todayStr } from '@/utils/date';
import './index.scss';

interface LastResult { date: string; score: number; }
const storageKey = (id: string) => `assessment_${id}_last`;
const readLast = (id: string): LastResult | null => {
  try { return Taro.getStorageSync(storageKey(id)) || null; } catch { return null; }
};

/**
 * 测评中心 — 5 套生活方式测评:列表 → 答题(支持多选) → 结果
 */
export default function Assessment() {
  const [phase, setPhase] = useState<'list' | 'quiz' | 'result'>('list');
  const [def, setDef] = useState<AssessmentDef | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [lastMap, setLastMap] = useState<Record<string, LastResult>>(() => {
    const map: Record<string, LastResult> = {};
    ASSESSMENTS.forEach((a) => { const l = readLast(a.id); if (l) map[a.id] = l; });
    return map;
  });

  const start = (d: AssessmentDef) => {
    setDef(d); setAnswers([]); setIdx(0); setResult(null);
    setPhase('quiz');
  };

  const q = def?.questions[idx];
  const chosen = answers[idx];

  const toggleMulti = (optIdx: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      const cur = Array.isArray(next[idx]) ? (next[idx] as number[]) : [];
      if (q?.options[optIdx].exclusive) {
        next[idx] = cur.includes(optIdx) ? [] : [optIdx];
        return next;
      }
      const withoutExclusive = cur.filter((i) => !q?.options[i].exclusive);
      next[idx] = withoutExclusive.includes(optIdx)
        ? withoutExclusive.filter((i) => i !== optIdx)
        : [...withoutExclusive, optIdx];
      return next;
    });
  };

  const answered = q?.multi
    ? Array.isArray(chosen) && chosen.length > 0
    : typeof chosen === 'number';

  const progress = def ? Math.round(((idx + (answered ? 1 : 0)) / def.questions.length) * 100) : 0;

  const next = () => {
    if (!def || !answered) return;
    if (idx < def.questions.length - 1) { setIdx(idx + 1); return; }
    const r = scoreAssessment(def, answers);
    setResult(r);
    const summary = { date: todayStr(), score: r.score };
    setLastMap((prev) => ({ ...prev, [def.id]: summary }));
    try { Taro.setStorageSync(storageKey(def.id), summary); } catch { /* 本地存储失败不影响结果展示 */ }
    setPhase('result');
  };

  return <Screen className="assess-page">
    {phase === 'list' && (
      <View className="card intro-card">
        <Text className="intro-emoji">🧭</Text>
        <Text className="intro-title">测评中心</Text>
        <Text className="intro-copy">5 套生活方式测评,凭最近的真实状态作答,即时出结果。结果按固定规则计算,仅供参考。</Text>
      </View>
    )}

    {phase === 'list' && ASSESSMENTS.map((a) => (
      <View className="card as-row" key={a.id} onClick={() => start(a)}>
        <View className="as-icon" style={{ background: a.color }}>{a.emoji}</View>
        <View className="as-copy">
          <Text className="as-name">{a.name}</Text>
          <Text className="as-tag">{a.tagline}</Text>
          <Text className="as-meta">{a.questions.length} 题 · 约 {estimateMinutes(a.questions)}</Text>
        </View>
        <View className="as-side">
          {lastMap[a.id]
            ? <Text className="as-score">上次 {lastMap[a.id].score} 分</Text>
            : <Text className="as-score as-score--empty">未测评</Text>}
          <Text className="as-go">开始评测 ›</Text>
        </View>
      </View>
    ))}

    {phase === 'quiz' && def && q && (
      <View className="card quiz-card">
        <View className="quiz-progress">
          <Text className="quiz-step">{idx + 1} / {def.questions.length}{q.multi ? ' · 可多选' : ''}</Text>
          <Text className="quiz-pct">{progress}%</Text>
        </View>
        <View className="quiz-bar"><View className="quiz-bar__fill" style={{ width: `${progress}%` }} /></View>
        {q.dim && def.dimLabels?.[q.dim] && <Text className="quiz-dim">{def.dimLabels[q.dim]}</Text>}
        <Text className="quiz-title">{q.title}</Text>
        <View className="quiz-options">
          {q.options.map((opt, i) => {
            const active = q.multi
              ? Array.isArray(chosen) && chosen.includes(i)
              : chosen === i;
            return (
              <View key={i} className={`quiz-option${active ? ' active' : ''}`} onClick={() => {
                if (!q.multi) {
                  setAnswers((prev) => { const n = [...prev]; n[idx] = i; return n; });
                } else {
                  toggleMulti(i);
                }
              }}>
                <Text>{opt.label}</Text>
                <View className={`quiz-check${active ? ' checked' : ''}`}>{active && <Text className="quiz-tick">✓</Text>}</View>
              </View>
            );
          })}
        </View>
        <View className="quiz-nav">
          <Button className="nav-back" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>上一题</Button>
          <Button className="btn btn--primary nav-next" disabled={!answered} onClick={next}>
            {idx === def.questions.length - 1 ? '查看结果' : '下一题'}
          </Button>
        </View>
      </View>
    )}

    {phase === 'result' && def && result && (
      <View className="card result-page">
        <Text className="result-name">{def.name}</Text>
        <View className="score-ring" style={{ '--score': `${Math.max(4, result.score) * 3.6}deg` } as React.CSSProperties}>
          <View className="score-ring__inner">
            <Text className="score-num">{result.score}</Text>
            <Text className="score-dim-label">总 分</Text>
          </View>
        </View>
        <Text className={`level-pill level--${result.band.tone}`}>{result.band.label}</Text>
        <Text className="level-copy">{result.band.copy}</Text>

        {result.dims.length > 1 && (
          <View className="dim-list">
            {result.dims.map((d) => (
              <View className="dim-row" key={d.dim}>
                <Text className="dim-name">{d.label}</Text>
                <View className="dim-track"><View className="dim-fill" style={{ width: `${Math.max(4, d.pct)}%` }} /></View>
                <Text className="dim-value">{d.pct}</Text>
              </View>
            ))}
          </View>
        )}

        <View className="advice-block">
          <Text className="advice-title">{result.weakDims.length > 0 ? '可以优先改进的地方' : '保持建议'}</Text>
          {result.weakDims.length > 0
            ? result.weakDims.map((dim) => (
              <View className="advice-group" key={dim}>
                <Text className="advice-dim">{def.dimLabels?.[dim] ?? dim}</Text>
                {(def.dimAdvice?.[dim] ?? []).map((s, i) => <Text key={i} className="advice-line">· {s}</Text>)}
              </View>
            ))
            : <View className="advice-group">
              {result.band.tips.map((s, i) => <Text key={i} className="advice-line">· {s}</Text>)}
            </View>}
          {result.weakDims.length > 0 && (
            <View className="advice-group">
              <Text className="advice-dim">通用建议</Text>
              {result.band.tips.map((s, i) => <Text key={i} className="advice-line">· {s}</Text>)}
            </View>
          )}
        </View>

        <Button className="btn btn--primary btn--block mt-3" onClick={() => start(def)}>再测一次</Button>
        <Button className="btn btn--secondary btn--block mt-2" onClick={() => setPhase('list')}>返回测评列表</Button>
        <Text className="result-foot">结果由答案按固定规则计算,仅供参考,不构成医学建议。</Text>
      </View>
    )}
  </Screen>;
}
