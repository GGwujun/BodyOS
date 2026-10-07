import { useEffect, useState } from 'react';
import { View, Text, Input, Button, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { userApi } from '@/services';
import './index.scss';

/**
 * 健康小工具:BMI 与体脂率计算(本地公式估算,结果仅供参考)
 * 身高/体重/性别/出生日期自动预填个人资料
 * 支持 ?tab=bmi|bfr 直达(工具箱深链)
 */
export default function Tools() {
  const [tab, setTab] = useState<'bmi' | 'bfr'>(Taro.getCurrentInstance().router?.params?.tab === 'bfr' ? 'bfr' : 'bmi');
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
            <Text className="advice-dim">饮食建议</Text>
            {bmiLevel.diet.map((s, i) => <Text key={i} className="advice-item">· {s}</Text>)}
            <Text className="advice-dim mt-2">运动建议</Text>
            {bmiLevel.exercise.map((s, i) => <Text key={i} className="advice-item">· {s}</Text>)}
          </View>
        </View>
      )}
      <View className="tip-card">
        <Text className="fs-h2">计算规则与举例</Text>
        <Text className="tip-copy">公式:BMI = 体重(kg) ÷ 身高(m)²,标准范围 18.5 ~ 23.9。</Text>
        <Text className="tip-copy">举例:体重 70kg、身高 1.75m 的人,BMI = 70 ÷ (1.75 × 1.75) ≈ 22.9,属于正常范围。</Text>
      </View>
      <View className="tip-card">
        <Text className="fs-h2">不同 BMI 的饮食与运动建议</Text>
        <Text className="guide-note"><Text className="guide-lead">偏瘦(BMI &lt; 18.5)</Text>多吃优质蛋白(鸡胸、鱼虾、蛋奶),主食适当加量,蔬果补足维生素,两餐之间加一餐坚果或酸奶;每周 2~3 次力量练习,帮身体长肌肉而不是只长脂肪。</Text>
        <Text className="guide-note"><Text className="guide-lead">正常(18.5 ~ 23.9)</Text>三餐规律、粗细搭配,每餐蔬菜占一半;每周 150 分钟中等强度运动维持代谢,保持体重长期稳定在正常区间。</Text>
        <Text className="guide-note"><Text className="guide-lead">超重(24 ~ 27.9)</Text>先减含糖饮料和夜宵,主食减三分之一换成杂粮,每餐先吃蔬菜和蛋白质再吃主食;每周 150 分钟以上有氧运动,配合 2 次力量练习,每天少摄入 300~500 千卡。</Text>
        <Text className="guide-note"><Text className="guide-lead">肥胖(BMI ≥ 28)</Text>建议咨询医生或营养科制定减重方案;从快走、游泳等护关节运动开始,逐步达到每天 6000~8000 步;每周减重 0.5~1kg 是安全节奏,坚持记录饮食与体重变化。</Text>
      </View>
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
          <Text className="fs-mini text-secondary">{bfr.method} · {gender === 'male' ? '男性' : '女性'}健康体脂率约 {bfrRange.low}% ~ {bfrRange.high}%(通用参考区间)</Text>
          <View className="advice">
            {bfrLevel.advice.map((s, i) => <Text key={i} className="advice-item">· {s}</Text>)}
          </View>
        </View>
      )}
      <View className="tip-card">
        <Text className="fs-h2">关于体脂率</Text>
        <Text className="tip-copy">体脂率是脂肪重量占体重的百分比,比单看体重更能反映身材变化。家用体脂秤误差较大,本工具按通用公式估算,趋势比绝对值更有参考意义。</Text>
      </View>
      <View className="tip-card">
        <Text className="fs-h2">科学管理体脂指南</Text>
        <Text className="guide-lead">饮食管理</Text>
        <Text className="guide-note">1. 控制总热量:减少精制碳水(白米面、甜食)和饱和脂肪(油炸食品),每天保持 300~500 千卡的热量缺口,减脂速度每周 0.5~1kg 为宜;</Text>
        <Text className="guide-note">2. 均衡营养:"211 饮食法"——每餐 2 份蔬菜、1 份优质蛋白(手掌大小的鱼禽肉蛋豆)、1 份低升糖主食(杂粮饭、燕麦、薯类);</Text>
        <Text className="guide-note">3. 减少隐形糖分:含糖饮料、风味酸奶、酱料里糖不少,看配料表选"0 糖"或低糖版本;</Text>
        <Text className="guide-note">4. 足量蛋白:减脂期每公斤体重摄入 1.2~1.6g 蛋白质,保住肌肉才不容易反弹。</Text>
        <Text className="guide-lead mt-2">运动管理</Text>
        <Text className="guide-note">1. 有氧打底:每周 3~5 次、每次 30~45 分钟快走、慢跑、骑行或游泳;</Text>
        <Text className="guide-note">2. 力量加持:每周 2~3 次抗阻训练(深蹲、俯卧撑、器械),肌肉多一公斤,每天多消耗几十千卡;</Text>
        <Text className="guide-note">3. 日常活动:多走楼梯、少坐电梯,通勤提前一站下车,这些"零碎消耗"一个月累积可观。</Text>
      </View>
    </View>}

    <Text className="tools-foot">以上结果均为公式估算,仅供参考,不能替代医学诊断。</Text>
  </Screen>;
}

const BMI_LEVELS = [
  { label: '偏瘦', tone: 'blue', diet: ['主食粗细搭配、适当加量,保证三餐规律', '每餐都有优质蛋白:鱼禽肉蛋奶豆', '两餐之间加餐:坚果、酸奶、水果'], exercise: ['每周 2~3 次力量练习,增加肌肉量', '有氧适量即可,避免消耗过大'] },
  { label: '正常', tone: 'green', diet: ['保持当前结构:蔬果占一半、蛋白一掌、主食一拳', '少喝含糖饮料,烹调少油少盐'], exercise: ['每周 150 分钟中等强度运动', '每周 2 次力量练习维持肌肉量', '规律作息,保持体重长期稳定'] },
  { label: '超重', tone: 'amber', diet: ['先戒含糖饮料与夜宵,效果最直接', '主食减三分之一,换成杂粮或薯类', '每餐先吃蔬菜和蛋白质,最后吃主食'], exercise: ['每周 150 分钟以上有氧:快走、慢跑、骑行', '每周 2 次力量练习,保肌肉减脂肪', '每天少摄入 300~500 千卡,循序渐进'] },
  { label: '肥胖', tone: 'red', diet: ['建议咨询医生或营养科制定个性化方案', '记录每一餐,看清热量从哪里来'], exercise: ['从快走、游泳等低冲击运动开始,保护关节', '逐步达到每天 6000~8000 步', '每周减重 0.5~1kg 是安全节奏'] },
];
const BFR_ADVICE = {
  low: ['适当增加健康脂肪与蛋白质摄入,如坚果、鱼类', '加入抗阻训练,提升肌肉量而不是只增脂肪'],
  normal: ['体脂率在健康区间,继续保持当前的饮食与运动习惯', '定期复测,关注长期趋势而非单次数值'],
  high: ['优先减少精制碳水和油炸食品,控制总热量', '有氧运动与力量练习结合,保住肌肉减脂肪', '腰围明显增大时建议同时关注血糖血脂'],
};

