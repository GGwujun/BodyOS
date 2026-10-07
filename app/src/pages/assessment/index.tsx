import { useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { QUESTIONS, DIM_LABELS, DIM_ADVICE, scoreAssessment } from '@/data/assessment';
import type { AssessResult } from '@/data/assessment';
import { todayStr } from '@/utils/date';
import './index.scss';

const STORAGE_KEY = 'assessment_last';

interface LastResult { date: string; score: number; }

/**
 * 生活方式测评 — 12 道习惯题,规则计分;结果存本地可回看
 */
export default function Assessment() {
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'result'>('intro');
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [last, setLast] = useState<LastResult | null>(() => {
    try { return Taro.getStorageSync(STORAGE_KEY) || null; } catch { return null; }
  });

  const q = QUESTIONS[idx];
  const chosen = answers[idx];
  const progress = Math.round(((idx + (chosen != null ? 1 : 0)) / QUESTIONS.length) * 100);

  const choose = (optIdx: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = optIdx;
      return next;
    });
  };

  const next = () => {
    if (chosen == null) return;
    if (idx < QUESTIONS.length - 1) { setIdx(idx + 1); return; }
    const r = scoreAssessment(answers);
    setResult(r);
    const summary = { date: todayStr(), score: r.score };
    setLast(summary);
    try { Taro.setStorageSync(STORAGE_KEY, summary); } catch { /* 本地存储失败不影响结果展示 */ }
    setPhase('result');
  };

  const restart = () => { setAnswers([]); setIdx(0); setResult(null); setPhase('quiz'); };

  return <Screen className="assess-page">
    {phase === 'intro' && (
      <View className="card intro-card">
        <Text className="intro-emoji">📋</Text>
        <Text className="intro-title">生活方式测评</Text>
        <Text className="intro-copy">12 道习惯题,涵盖睡眠、饮食、运动与日常习惯。不需要任何身体数据,凭最近两周的真实状态作答即可。</Text>
        <View className="intro-meta">
          <Text>12 道题</Text><Text>约 2 分钟</Text><Text>即时出结果</Text>
        </View>
        {last && <Text className="intro-last">上次测评:{last.date} · 得分 {last.score}</Text>}
        <Button className="btn btn--primary btn--block mt-4" onClick={() => setPhase('quiz')}>{last ? '重新测评' : '开始测评'}</Button>
      </View>
    )}

    {phase === 'quiz' && (
      <View className="card quiz-card">
        <View className="quiz-progress">
          <Text className="quiz-step">{idx + 1} / {QUESTIONS.length}</Text>
          <Text className="quiz-pct">{progress}%</Text>
        </View>
        <View className="quiz-bar"><View className="quiz-bar__fill" style={{ width: `${progress}%` }} /></View>
        <Text className="quiz-dim">{DIM_LABELS[q.dim]}</Text>
        <Text className="quiz-title">{q.title}</Text>
        <View className="quiz-options">
          {q.options.map((opt, i) => (
            <View key={i} className={`quiz-option${chosen === i ? ' active' : ''}`} onClick={() => choose(i)}>
              <Text>{opt.label}</Text>
              <View className={`quiz-check${chosen === i ? ' checked' : ''}`}>{chosen === i && <Text className="quiz-tick">✓</Text>}</View>
            </View>
          ))}
        </View>
        <View className="quiz-nav">
          <Button className="nav-back" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>上一题</Button>
          <Button className="btn btn--primary nav-next" disabled={chosen == null} onClick={next}>
            {idx === QUESTIONS.length - 1 ? '查看结果' : '下一题'}
          </Button>
        </View>
      </View>
    )}

    {phase === 'result' && result && (
      <View className="card result-page">
        <View className="score-ring" style={{ '--score': `${Math.max(4, result.score) * 3.6}deg` } as React.CSSProperties}>
          <View className="score-ring__inner">
            <Text className="score-num">{result.score}</Text>
            <Text className="score-dim-label">总 分</Text>
          </View>
        </View>
        <Text className={`level-pill level--${result.level.tone}`}>{result.level.label}</Text>
        <Text className="level-copy">{result.level.copy}</Text>

        <View className="dim-list">
          {result.dims.map((d) => (
            <View className="dim-row" key={d.dim}>
              <Text className="dim-name">{DIM_LABELS[d.dim]}</Text>
              <View className="dim-track"><View className="dim-fill" style={{ width: `${Math.max(4, d.pct)}%` }} /></View>
              <Text className="dim-value">{d.pct}</Text>
            </View>
          ))}
        </View>

        <View className="advice-block">
          <Text className="advice-title">{result.weakDims.length > 0 ? '可以优先改进的地方' : '保持建议'}</Text>
          {(result.weakDims.length > 0 ? result.weakDims : (Object.keys(DIM_ADVICE) as (keyof typeof DIM_ADVICE)[])).map((dim) => (
            <View className="advice-group" key={dim}>
              <Text className="advice-dim">{DIM_LABELS[dim]}</Text>
              {DIM_ADVICE[dim].map((s, i) => <Text key={i} className="advice-line">· {s}</Text>)}
            </View>
          ))}
        </View>

        <Button className="btn btn--primary btn--block mt-3" onClick={restart}>再测一次</Button>
        <Text className="result-foot">结果由习惯答案按固定规则计算,仅供参考,不构成医学建议。</Text>
      </View>
    )}
  </Screen>;
}
