import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Screen from '@/components/Screen';
import { QA_BANK, QA_CATEGORIES, qaOfDate } from '@/data/qa';
import { todayStr } from '@/utils/date';
import './index.scss';

export default function Qa() {
  const today = todayStr();
  const daily = useMemo(() => qaOfDate(today), [today]);
  const [cat, setCat] = useState('全部');
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const filtered = useMemo(
    () => QA_BANK.filter((e) => cat === '全部' || e.cat === cat),
    [cat]
  );

  const dateLabel = `${Number(today.slice(5, 7))} 月 ${Number(today.slice(8, 10))} 日`;

  return (
    <Screen className="qa-page">
      {/* 每日一答:按日期轮换,当天固定 */}
      <View className="card daily-card">
        <View className="between">
          <Text className="daily-badge">每日一答</Text>
          <Text className="fs-mini text-secondary">{dateLabel}</Text>
        </View>
        <Text className="daily-q">{daily.q}</Text>
        <Text className="daily-a">{daily.a}</Text>
        <Text className="fs-mini text-secondary">每天更新一题,全部 {QA_BANK.length} 问可往下浏览。</Text>
      </View>

      {/* 分类筛选 */}
      <View className="qa-chips">
        {['全部', ...QA_CATEGORIES].map((c) => (
          <Text
            key={c}
            className={`qa-chip${cat === c ? ' active' : ''}`}
            onClick={() => { setCat(c); setOpenIdx(null); }}
          >
            {c}
          </Text>
        ))}
      </View>

      {/* 问答列表:点击展开 */}
      <View className="card">
        <View className="between">
          <Text className="fs-h1">{cat === '全部' ? '全部问答' : cat}</Text>
          <Text className="fs-mini text-secondary">{filtered.length} 问</Text>
        </View>
        {filtered.map((e, i) => (
          <View key={`${e.cat}-${e.q}`} className={`qa-item${openIdx === i ? ' open' : ''}`} onClick={() => setOpenIdx(openIdx === i ? null : i)}>
            <View className="row between">
              <Text className="qa-q">{e.q}</Text>
              <Text className="qa-arrow">{openIdx === i ? '−' : '+'}</Text>
            </View>
            {openIdx === i && (
              <View className="qa-body" onClick={(ev) => ev.stopPropagation()}>
                <Text className="qa-cat-tag">{e.cat}</Text>
                <Text className="qa-a">{e.a}</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      <Text className="fs-mini text-secondary qa-foot">内容为通用健康科普,不构成医疗建议;如有疾病或特殊身体状况,请咨询医生或注册营养师。</Text>
    </Screen>
  );
}
