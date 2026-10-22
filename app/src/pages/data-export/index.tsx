import { useEffect, useState } from 'react';
import { Button, Text, Textarea, View } from '@tarojs/components';
import Screen from '@/components/Screen';
import { trendsApi } from '@/services';
import { track } from '@/services/analytics';
import { copyText, toast } from '@/utils/ui';
import './index.scss';

/**
 * 数据导出 —— 体重和饮食是你自己记的,该有一扇门把它们整个带走:
 * 复制成表格文本,粘到备忘录、发给自己、贴进 Excel 都行。
 * 训练数据有自己的门(计划页的「导出与备份」),这页只管主包这半边。
 *
 * 逗号分隔、首行是表头 —— 不是为了好看:Excel 和 WPS 直接粘进去就是一张表。
 */
export default function DataExport() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [weights, setWeights] = useState<{ date: string; weightKg: number }[]>([]);
  const [foodDays, setFoodDays] = useState<{ date: string; kcal: number; proteinG: number; carbG: number; fatG: number }[]>([]);

  const load = () => {
    setLoading(true); setFailed(false);
    trendsApi.getTrends(90)
      .then((r) => {
        setWeights(r.weights);
        // 只导有记录的天:没吃的那些天是 0,导出去是一串 0 行,看着像「绝食九十天」
        setFoodDays(r.summaries
          .filter((s) => s.intakeCalories > 0)
          .map((s) => ({ date: s.date, kcal: s.intakeCalories, proteinG: s.nutrition.proteinG, carbG: s.nutrition.carbG, fatG: s.nutrition.fatG })));
        setLoading(false);
      })
      .catch(() => { setFailed(true); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const weightText = ['日期,体重kg', ...weights.map((w) => `${w.date},${w.weightKg}`)].join('\n');
  const foodText = [
    '日期,热量kcal,蛋白g,碳水g,脂肪g',
    ...foodDays.map((d) => `${d.date},${d.kcal},${d.proteinG},${d.carbG},${d.fatG}`)
  ].join('\n');

  const doCopy = async (kind: 'weight' | 'food', text: string, count: number) => {
    if (!count) { toast('这个范围里还没有记录', 'none'); return; }
    const ok = await copyText(text);
    toast(ok ? `已复制 ${count} 行,粘贴到备忘录或表格里就是备份数据` : '复制没成功,请在下面长按全选复制', ok ? 'success' : 'none');
    track('health_data_export', 'other', { kind, rows: count });
  };

  return <Screen className="data-export-page">
    <View className="card">
      <Text className="fs-h1">体重记录</Text>
      <Text className="fs-mini text-secondary">近 90 天的每次称重,共 {weights.length} 条。复制后可粘进 Excel / WPS。</Text>
      <Button className="btn btn--primary" loading={loading} onClick={() => doCopy('weight', weightText, weights.length)}>复制体重数据</Button>
      {weights.length > 0 && <Textarea className="export-preview" value={weightText} maxlength={-1} disabled />}
      {weights.length === 0 && !loading && !failed && <Text className="fs-mini text-secondary">近 90 天还没有称重记录。</Text>}
    </View>

    <View className="card">
      <Text className="fs-h1">饮食汇总</Text>
      <Text className="fs-mini text-secondary">近 90 天有记录的 {foodDays.length} 天,每天一行热量与三大营养素。</Text>
      <Button className="btn btn--primary" loading={loading} onClick={() => doCopy('food', foodText, foodDays.length)}>复制饮食数据</Button>
      {foodDays.length > 0 && <Textarea className="export-preview" value={foodText} maxlength={-1} disabled />}
      {foodDays.length === 0 && !loading && !failed && <Text className="fs-mini text-secondary">近 90 天还没有饮食记录。</Text>}
    </View>

    {failed && <View className="card" onClick={load}><Text className="fs-caption text-danger">加载失败,点击重试</Text></View>}
  </Screen>;
}
