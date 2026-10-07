import { useEffect, useState } from 'react';
import { View, Text, Input, Button, Picker } from '@tarojs/components';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { userApi } from '@/services';
import './index.scss';

/**
 * 健康小工具:BMI 与体脂率计算(本地公式估算,结果仅供参考)
 * 身高/体重/性别/出生日期自动预填个人资料
 */
export default function Tools() {
  const [tab, setTab] = useState<'bmi' | 'bfr'>('bmi');
  const { data: profile } = useAsync(() => userApi.getProfile(), []);

  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState('');
  const [waist, setWaist] = useState('');
  const [bmi, setBmi] = useState<number | null>(null);
  const [bfr, setBfr] = useState<{ value: number; method: string } | null>(null);
  const [error, setError] = useState('');

  // 资料加载后预填(不覆盖用户已输入的值)
  useEffect(() => {
    if (!profile) return;
    setHeight((h) => h || (profile.heightCm ? String(profile.heightCm) : ''));
    setWeight((w) => w || (profile.weightKg ? String(profile.weightKg) : ''));
    if (profile.gender === 'male' || profile.gender === 'female') setGender(profile.gender);
    if (profile.birthDate) {
      const birth = new Date(profile.birthDate);
      const years = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (years > 5 && years < 110) setAge((a) => a || String(Math.floor(years)));
    }
  }, [profile]);

  const calcBmi = () => {
    setError('');
    const h = Number(height), w = Number(weight);
    if (!Number.isFinite(h) || !Number.isFinite(w) || h < 80 || h > 250) return setError('请输入 80-250 之间的身高(cm)');
    if (!Number.isFinite(w) || w < 20 || w > 300) return setError('请输入 20-300 之间的体重(kg)');
    setBmi(w / (h / 100) ** 2);
  };

  const calcBfr = () => {
    setError('');
    const h = Number(height), w = Number(weight), a = Number(age), wc = Number(waist);
    if (!Number.isFinite(h) || h < 80 || h > 250) return setError('请输入 80-250 之间的身高(cm)');
    if (!Number.isFinite(w) || w < 20 || w > 300) return setError('请输入 20-300 之间的体重(kg)');
    if (waist.trim() && (!Number.isFinite(wc) || wc < 40 || wc > 200)) return setError('腰围请输入 40-200 之间的数值(cm)');
    const hasWaist = waist.trim() !== '';
    if (!hasWaist && (!Number.isFinite(a) || a < 10 || a > 100)) return setError('不填腰围时需要年龄(10-100)来估算');
    const bmiVal = w / (h / 100) ** 2;
    if (hasWaist) {
      // YMCA 公式(腰围+体重),对腰围明显大于身高一半等异常输入兜底
      const waistIn = wc / 2.54, lb = w * 2.20462;
      const base = gender === 'male' ? -98.42 : -76.76;
      let value = ((base + 4.15 * waistIn - 0.082 * lb) / lb) * 100;
      value = Math.max(3, Math.min(60, value));
      setBfr({ value, method: '结合腰围与体重估算' });
    } else {
      // Deurenberg 公式(体质指数+年龄)
      const value = Math.max(3, Math.min(60, 1.2 * bmiVal + 0.23 * a - 5.4 - 10.8 * (gender === 'male' ? 1 : 0)));
      setBfr({ value, method: '按体质指数与年龄估算' });
    }
  };

  const bmiLevel = bmi == null ? null : bmi < 18.5 ? BMI_LEVELS[0] : bmi < 24 ? BMI_LEVELS[1] : bmi < 28 ? BMI_LEVELS[2] : BMI_LEVELS[3];
  const bfrRange = gender === 'male' ? { low: 15, high: 18 } : { low: 25, high: 28 };
  const bfrLevel = bfr == null ? null
    : bfr.value < bfrRange.low ? { label: '偏低', tone: 'blue', advice: BFR_ADVICE.low }
    : bfr.value <= bfrRange.high ? { label: '正常', tone: 'green', advice: BFR_ADVICE.normal }
    : bfr.value <= bfrRange.high + 7 ? { label: '偏高', tone: 'amber', advice: BFR_ADVICE.high }
    : { label: '过高', tone: 'red', advice: BFR_ADVICE.high };

  return <Screen className="tools-page">
    <View className="seg">
      {([{ key: 'bmi', label: 'BMI 指数' }, { key: 'bfr', label: '体脂率' }] as const).map((t) => (
        <Text key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => { setTab(t.key); setError(''); }}>{t.label}</Text>
      ))}
    </View>

    {tab === 'bmi' && <View className="card">
      <Text className="fs-h1">计算 BMI</Text>
      <Text className="fs-mini text-secondary">身高体重已自动填入你的身体资料,可直接计算。</Text>
      <View className="form-row"><Text className="form-label">身高 (cm)</Text><Input className="form-input" type="digit" value={height} onInput={(e) => setHeight(e.detail.value)} placeholder="如 170" /></View>
      <View className="form-row"><Text className="form-label">体重 (kg)</Text><Input className="form-input" type="digit" value={weight} onInput={(e) => setWeight(e.detail.value)} placeholder="如 65" /></View>
      {error && <Text className="fs-caption text-danger">{error}</Text>}
      <Button className="btn btn--primary btn--block mt-2" onClick={calcBmi}>计算 BMI</Button>
      {bmi != null && bmiLevel && (
        <View className="result-card">
          <View className="result-main"><Text className="result-value">{bmi.toFixed(1)}</Text><Text className={`pill pill--${bmiLevel.tone}`}>{bmiLevel.label}</Text></View>
          <Text className="fs-mini text-secondary">中国成人标准:偏瘦 &lt; 18.5,正常 18.5 ~ 23.9,超重 24 ~ 27.9,肥胖 ≥ 28</Text>
          <View className="advice">
            {bmiLevel.advice.map((s, i) => <Text key={i} className="advice-item">· {s}</Text>)}
          </View>
        </View>
      )}
      <View className="tip-card">
        <Text className="fs-h2">什么是 BMI?</Text>
        <Text className="tip-copy">BMI(身体质量指数)= 体重(kg) ÷ 身高(m)²,是快速筛查体重是否健康的通用指标。它不能区分肌肉和脂肪,经常健身或老年人建议结合体脂率、腰围一起看。</Text>
      </View>
    </View>}

    {tab === 'bfr' && <View className="card">
      <Text className="fs-h1">估算体脂率</Text>
      <Text className="fs-mini text-secondary">填腰围按腰围估算更准;不填则按体质指数与年龄估算。</Text>
      <View className="form-row"><Text className="form-label">性别</Text><Picker mode="selector" range={['男', '女']} value={gender === 'male' ? 0 : 1} onChange={(e) => setGender(Number(e.detail.value) === 0 ? 'male' : 'female')}><View className="picker-value">{gender === 'male' ? '男' : '女'}</View></Picker></View>
      <View className="form-row"><Text className="form-label">年龄</Text><Input className="form-input" type="number" value={age} onInput={(e) => setAge(e.detail.value)} placeholder="如 28" /></View>
      <View className="form-row"><Text className="form-label">身高 (cm)</Text><Input className="form-input" type="digit" value={height} onInput={(e) => setHeight(e.detail.value)} placeholder="如 170" /></View>
      <View className="form-row"><Text className="form-label">体重 (kg)</Text><Input className="form-input" type="digit" value={weight} onInput={(e) => setWeight(e.detail.value)} placeholder="如 65" /></View>
      <View className="form-row"><Text className="form-label">腰围 (cm)</Text><Input className="form-input" type="digit" value={waist} onInput={(e) => setWaist(e.detail.value)} placeholder="选填,绕肚脐一周" /></View>
      {error && <Text className="fs-caption text-danger">{error}</Text>}
      <Button className="btn btn--primary btn--block mt-2" onClick={calcBfr}>计算体脂率</Button>
      {bfr != null && bfrLevel && (
        <View className="result-card">
          <View className="result-main"><Text className="result-value">{bfr.value.toFixed(1)}<Text className="result-unit">%</Text></Text><Text className={`pill pill--${bfrLevel.tone}`}>{bfrLevel.label}</Text></View>
          <Text className="fs-mini text-secondary">{bfr.method} · {gender === 'male' ? '男性' : '女性'}健康体脂率约 {bfrRange.low}% ~ {bfrRange.high}%(世界卫生组织建议)</Text>
          <View className="advice">
            {bfrLevel.advice.map((s, i) => <Text key={i} className="advice-item">· {s}</Text>)}
          </View>
        </View>
      )}
      <View className="tip-card">
        <Text className="fs-h2">关于体脂率</Text>
        <Text className="tip-copy">体脂率是脂肪重量占体重的百分比,比单看体重更能反映身材变化。家用体脂秤误差较大,本工具按通用公式估算,趋势比绝对值更有参考意义。</Text>
      </View>
    </View>}

    <Text className="tools-foot">以上结果均为公式估算,仅供参考,不能替代医学诊断。</Text>
  </Screen>;
}

const BMI_LEVELS = [
  { label: '偏瘦', tone: 'blue', advice: ['主食粗细搭配,适当加量,保证三餐规律', '每周 2~3 次力量练习,帮助增加体重与肌肉', '加餐可选牛奶、鸡蛋、坚果等高营养密度食物'] },
  { label: '正常', tone: 'green', advice: ['保持当前饮食结构,蔬果蛋白质均衡摄入', '每周 150 分钟中等强度运动,维持代谢活力', '规律作息,保持体重长期稳定在正常区间'] },
  { label: '超重', tone: 'amber', advice: ['控制精制主食与含糖饮料,增加蔬菜与优质蛋白', '每周 150 分钟以上有氧运动,配合力量练习', '每天减少 300~500 千卡摄入,循序渐进'] },
  { label: '肥胖', tone: 'red', advice: ['建议咨询医生或营养师制定减重计划', '从快走、游泳等低冲击运动开始,保护关节', '记录饮食与体重变化,每周减重 0.5~1kg 为宜'] },
];
const BFR_ADVICE = {
  low: ['适当增加健康脂肪与蛋白质摄入,如坚果、鱼类', '加入抗阻训练,提升肌肉量而不是只增脂肪'],
  normal: ['体脂率在健康区间,继续保持当前的饮食与运动习惯', '定期复测,关注长期趋势而非单次数值'],
  high: ['优先减少精制碳水和油炸食品,控制总热量', '有氧运动与力量练习结合,保住肌肉减脂肪', '腰围明显增大时建议同时关注血糖血脂'],
};

