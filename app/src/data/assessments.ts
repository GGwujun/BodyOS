/**
 * 测评中心 — 10 套健康测评,通用数据模型
 * 计分:每题选项 0~3 分(多选题为所选选项求和),总分折算 0~100,分数越高状态越好
 * 结果按固定分档给出,仅供参考,不构成医学建议
 * 血糖/血压为生活方式风险评估,不能替代测量与诊疗
 */

export interface AssessOption {
  label: string;
  score: number;
  /** 互斥项(如"以上都不符合"):选中后清除其他选择 */
  exclusive?: boolean;
}

export interface AssessQuestion {
  title: string;
  /** 维度 key(不分维度的测评可省略) */
  dim?: string;
  /** 多选题 */
  multi?: boolean;
  options: AssessOption[];
}

export interface AssessBand {
  min: number;
  label: string;
  tone: 'green' | 'amber' | 'red';
  copy: string;
  tips: string[];
}

export interface AssessmentDef {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  color: string;
  /** 维度标签(供结果页展示) */
  dimLabels?: Record<string, string>;
  /** 弱维度(<60)改进建议 */
  dimAdvice?: Record<string, string[]>;
  questions: AssessQuestion[];
  /** 总分分档,从高到低 */
  bands: AssessBand[];
}

export interface AssessResult {
  score: number;
  band: AssessBand;
  dims: { dim: string; label: string; pct: number }[];
  weakDims: string[];
}

/** 答案:单选题为选项下标,多选题为选项下标数组 */
export type Answer = number | number[];

function questionMax(q: AssessQuestion): number {
  if (!q.multi) return Math.max(...q.options.map((o) => o.score));
  return q.options.reduce((s, o) => s + Math.max(0, o.score), 0);
}

/** 由答案计算结果 */
export function scoreAssessment(def: AssessmentDef, answers: Answer[]): AssessResult {
  let total = 0, maxTotal = 0;
  const dimScore: Record<string, { got: number; max: number }> = {};
  def.questions.forEach((q, i) => {
    const max = questionMax(q);
    maxTotal += max;
    const a = answers[i];
    let got = 0;
    if (q.multi && Array.isArray(a)) {
      got = q.options.reduce((s, o, idx) => (a.includes(idx) ? s + Math.max(0, o.score) : s), 0);
    } else if (typeof a === 'number') {
      got = q.options[a]?.score ?? 0;
    }
    total += Math.min(got, max);
    if (q.dim) {
      dimScore[q.dim] ??= { got: 0, max: 0 };
      dimScore[q.dim].got += Math.min(got, max);
      dimScore[q.dim].max += max;
    }
  });
  const score = Math.round((total / Math.max(maxTotal, 1)) * 100);
  const band = def.bands.find((b) => score >= b.min) ?? def.bands[def.bands.length - 1];
  const dims = Object.keys(dimScore).map((dim) => ({
    dim,
    label: def.dimLabels?.[dim] ?? dim,
    pct: Math.round((dimScore[dim].got / Math.max(dimScore[dim].max, 1)) * 100),
  }));
  const weakDims = def.dimAdvice ? dims.filter((d) => d.pct < 60).map((d) => d.dim) : [];
  return { score, band, dims, weakDims };
}

/* ============ 1. 生活方式测评(综合四维度) ============ */
const LIFESTYLE: AssessmentDef = {
  id: 'lifestyle', name: '生活方式测评', tagline: '睡眠、饮食、运动、习惯一次看全', emoji: '📋', color: '#d9f6e9',
  dimLabels: { sleep: '睡眠', diet: '饮食', exercise: '运动', habit: '习惯' },
  dimAdvice: {
    sleep: ['尽量在 23:30 前入睡,固定起床时间,周末也不例外', '睡前一小时放下手机,试试拉伸、泡脚或听轻音乐'],
    diet: ['每天规律吃早餐,晚餐吃到八分饱就停', '每餐先吃蔬菜再吃主食,少喝含糖饮料、少点油炸'],
    exercise: ['每周安排 3 次以上 30 分钟运动,快走、骑行都算数', '每坐 1 小时就起身活动 3~5 分钟,接水、伸展都可以'],
    habit: ['把水杯放在手边,全天少量多次饮水,别等渴了才喝', '压力大时用散步、深呼吸替代宵夜与熬夜刷手机'],
  },
  questions: [
    { dim: 'sleep', title: '平均每晚睡多久?', options: [
      { label: '6 小时以内', score: 0 }, { label: '6 ~ 7 小时', score: 2 },
      { label: '7 ~ 9 小时', score: 3 }, { label: '9 小时以上', score: 2 }] },
    { dim: 'sleep', title: '你的作息规律吗?', options: [
      { label: '经常凌晨 1 点后睡', score: 0 }, { label: '一周有两三天晚睡', score: 1 },
      { label: '多数时候规律入睡', score: 3 }] },
    { dim: 'sleep', title: '睡前一小时在做什么?', options: [
      { label: '几乎一直在刷手机', score: 0 }, { label: '经常刷手机', score: 1 },
      { label: '偶尔看看', score: 2 }, { label: '基本不碰,放松收尾', score: 3 }] },
    { dim: 'diet', title: '早餐吃吗?', options: [
      { label: '几乎不吃', score: 0 }, { label: '偶尔吃', score: 1 },
      { label: '经常吃', score: 2 }, { label: '每天吃', score: 3 }] },
    { dim: 'diet', title: '蔬菜水果吃得勤吗?', options: [
      { label: '很少吃', score: 0 }, { label: '一周两三次', score: 1 },
      { label: '每天有一两餐搭配', score: 2 }, { label: '每天多餐都有', score: 3 }] },
    { dim: 'diet', title: '含糖饮料、油炸食品、外卖的频率?', options: [
      { label: '几乎每天', score: 0 }, { label: '每周 3 ~ 5 次', score: 1 },
      { label: '每周 1 ~ 2 次', score: 2 }, { label: '基本不碰', score: 3 }] },
    { dim: 'diet', title: '晚餐一般吃到几分饱?', options: [
      { label: '吃到很撑', score: 0 }, { label: '偶尔吃多', score: 1 },
      { label: '八九分饱', score: 3 }] },
    { dim: 'exercise', title: '每周运动几次?(每次 20 分钟以上)', options: [
      { label: '几乎不运动', score: 0 }, { label: '1 ~ 2 次', score: 1 },
      { label: '3 ~ 4 次', score: 2 }, { label: '5 次以上', score: 3 }] },
    { dim: 'exercise', title: '每次运动大概多久?', options: [
      { label: '不足 30 分钟', score: 1 }, { label: '30 ~ 60 分钟', score: 3 },
      { label: '60 分钟以上', score: 3 }] },
    { dim: 'exercise', title: '白天久坐时间有多长?', options: [
      { label: '8 小时以上', score: 0 }, { label: '5 ~ 8 小时', score: 1 },
      { label: '3 ~ 5 小时', score: 2 }, { label: '3 小时以内', score: 3 }] },
    { dim: 'habit', title: '每天大概喝多少水?', options: [
      { label: '不到 800ml', score: 0 }, { label: '800 ~ 1200ml', score: 1 },
      { label: '1200 ~ 1800ml', score: 3 }, { label: '1800ml 以上', score: 2 }] },
    { dim: 'habit', title: '最近的压力状态?', options: [
      { label: '压力很大', score: 0 }, { label: '偶尔很大', score: 1 },
      { label: '一般', score: 2 }, { label: '比较轻松', score: 3 }] },
  ],
  bands: [
    { min: 80, label: '状态很好', tone: 'green', copy: '你的生活习惯整体健康,保持下去,并继续记录身体数据观察趋势。',
      tips: ['保持当前的作息与饮食节奏', '定期复测,关注长期变化而不是单次分数'] },
    { min: 60, label: '整体不错', tone: 'green', copy: '大方向没问题,把下面几个薄弱项补一补,状态会明显提升。',
      tips: ['优先改进得分最低的维度', '一次只改一个习惯,坚持两周再叠加下一个'] },
    { min: 40, label: '一般', tone: 'amber', copy: '有几项习惯在拖后腿,先挑一两个最容易改的入手,别贪多。',
      tips: ['从睡眠时间或早餐开始,这两个最容易见效', '用记录工具让变化看得见,更容易坚持'] },
    { min: 0, label: '待改善', tone: 'red', copy: '身体正在为当前习惯买单,建议从睡眠和饮食两件小事开始调整。',
      tips: ['先固定入睡和起床时间,哪怕先提前 30 分钟', '每天吃早餐、多喝一杯水,是成本最低的开始'] },
  ],
};

/* ============ 2. 睡眠质量测评 ============ */
const SLEEP: AssessmentDef = {
  id: 'sleep', name: '睡眠质量测评', tagline: '看看你的睡眠在哪个段位', emoji: '😴', color: '#e0f2fe',
  questions: [
    { title: '躺下后一般多久能睡着?', options: [
      { label: '10 分钟左右', score: 3 }, { label: '半小时内', score: 2 },
      { label: '一小时左右', score: 1 }, { label: '经常翻来覆去睡不着', score: 0 }] },
    { title: '半夜会醒吗?', options: [
      { label: '基本一觉到天亮', score: 3 }, { label: '偶尔醒一次能很快睡着', score: 2 },
      { label: '经常醒,要过一阵才睡回去', score: 1 }, { label: '醒了就很难再睡着', score: 0 }] },
    { title: '早上醒来时的状态?', options: [
      { label: '精神饱满', score: 3 }, { label: '还行,缓一会儿就好', score: 2 },
      { label: '有点昏沉', score: 1 }, { label: '经常疲惫,像没睡一样', score: 0 }] },
    { title: '白天会犯困吗?', options: [
      { label: '基本不困', score: 3 }, { label: '午后偶尔犯困', score: 2 },
      { label: '上下午都容易困', score: 1 }, { label: '全天都提不起精神', score: 0 }] },
    { title: '入睡时间规律吗?', options: [
      { label: '每天都差不多', score: 3 }, { label: '工作日规律,周末晚', score: 2 },
      { label: '经常变,看当天状态', score: 1 }, { label: '完全没规律', score: 0 }] },
    { title: '睡前一般做什么?(多选)', multi: true, options: [
      { label: '刷短视频或追剧到困', score: 0 }, { label: '喝咖啡、浓茶或酒', score: 0 },
      { label: '吃夜宵', score: 0 }, { label: '工作或学习到很晚', score: 0 },
      { label: '洗漱后看看书、听听轻音乐', score: 2 }, { label: '拉伸或泡脚放松', score: 2 },
      { label: '以上都不符合', score: 2, exclusive: true }] },
    { title: '卧室环境怎么样?', options: [
      { label: '安静、全黑、温度合适', score: 3 }, { label: '基本安静,略有光线', score: 2 },
      { label: '有噪音或光线干扰', score: 1 }, { label: '很吵 / 很亮 / 很闷', score: 0 }] },
    { title: '平均每晚实际睡眠时长?', options: [
      { label: '7 ~ 9 小时', score: 3 }, { label: '6 ~ 7 小时', score: 2 },
      { label: '5 ~ 6 小时', score: 1 }, { label: '不到 5 小时', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '睡眠优质', tone: 'green', copy: '你的睡眠质量在线,作息稳定、入睡顺畅,白天精力有保障。',
      tips: ['保持当前节奏,出差或假期也尽量别打乱', '成年人 7~9 小时是主流建议区间'] },
    { min: 60, label: '睡眠尚可', tone: 'green', copy: '整体睡得还行,但有几个细节在偷走你的睡眠质量。',
      tips: ['固定入睡和起床时间,误差控制在半小时内', '睡前一小时收起手机,试试翻几页书'] },
    { min: 40, label: '睡眠不佳', tone: 'amber', copy: '睡眠已经在亮黄灯,白天的困倦和疲惫大概率源于此。',
      tips: ['先戒掉睡前刷手机与夜宵,这两项影响最直接', '下午两点后别再碰咖啡和浓茶', '躺下 20 分钟睡不着就起来,困了再回床'] },
    { min: 0, label: '睡眠堪忧', tone: 'red', copy: '长期这样会明显影响精力、情绪和代谢,值得认真调整。',
      tips: ['从"固定起床时间"开始倒推入睡时间', '白天增加 20 分钟以上光照和活动,帮助夜间入睡', '若持续失眠超过一个月,建议就医评估'] },
  ],
};

/* ============ 3. 饮食习惯测评 ============ */
const DIET: AssessmentDef = {
  id: 'diet', name: '饮食习惯测评', tagline: '你的吃法,身体都记得', emoji: '🥗', color: '#fef3e2',
  questions: [
    { title: '一周吃几次早餐?', options: [
      { label: '6 ~ 7 次', score: 3 }, { label: '4 ~ 5 次', score: 2 },
      { label: '1 ~ 3 次', score: 1 }, { label: '基本不吃', score: 0 }] },
    { title: '主食结构更接近哪种?', options: [
      { label: '粗细搭配,常吃杂粮薯类', score: 3 }, { label: '以米饭面条为主,偶尔粗粮', score: 2 },
      { label: '精米白面为主', score: 1 }, { label: '经常不吃主食或以粉面快餐为主', score: 0 }] },
    { title: '每餐蔬菜的量?', options: [
      { label: '每餐都有,能占一半', score: 3 }, { label: '一天两餐有', score: 2 },
      { label: '一天一餐有', score: 1 }, { label: '很少主动吃蔬菜', score: 0 }] },
    { title: '蛋白质来源更接近?(多选)', multi: true, options: [
      { label: '鱼虾', score: 2 }, { label: '鸡胸、瘦肉', score: 2 },
      { label: '鸡蛋、豆制品', score: 2 }, { label: '牛奶酸奶', score: 2 },
      { label: '主要靠香肠、培根、丸子等加工肉', score: 0 },
      { label: '以上都不符合', score: 1, exclusive: true }] },
    { title: '喝水还是喝饮料?', options: [
      { label: '基本喝白水或茶', score: 3 }, { label: '每周一两次饮料', score: 2 },
      { label: '每周 3 ~ 5 次饮料', score: 1 }, { label: '几乎每天含糖饮料', score: 0 }] },
    { title: '外卖和油炸食品频率?', options: [
      { label: '一周不超过 1 次', score: 3 }, { label: '一周 2 ~ 3 次', score: 2 },
      { label: '一周 4 ~ 6 次', score: 1 }, { label: '基本天天点', score: 0 }] },
    { title: '吃饭速度?', options: [
      { label: '细嚼慢咽,一顿 20 分钟以上', score: 3 }, { label: '速度适中', score: 2 },
      { label: '偏快,10 分钟解决', score: 1 }, { label: '风卷残云,几分钟吃完', score: 0 }] },
    { title: '以下符合你的有?(多选)', multi: true, options: [
      { label: '经常吃夜宵', score: 0 }, { label: '零食当饭吃', score: 0 },
      { label: '渴了才喝水', score: 0 }, { label: '常常吃到很撑', score: 0 },
      { label: '以上都不符合', score: 3, exclusive: true }] },
  ],
  bands: [
    { min: 80, label: '吃得健康', tone: 'green', copy: '结构均衡、节奏规律,你的吃法可以打满分。',
      tips: ['保持粗细搭配和足量蔬菜的习惯', '外出就餐时也按"先菜后饭"的顺序点餐'] },
    { min: 60, label: '大体均衡', tone: 'green', copy: '整体不差,但有几处可以再拧紧一点。',
      tips: ['把饮料换成无糖茶或气泡水', '每周再多安排 1~2 顿自己做饭'] },
    { min: 40, label: '需要调整', tone: 'amber', copy: '饮食结构在向"高油高糖方便化"倾斜,注意别越滑越远。',
      tips: ['先从每天一顿"有菜有蛋白"的正餐开始', '主食减掉三分之一,换成杂粮或薯类', '家里办公室备点水果坚果,替代零食'] },
    { min: 0, label: '饮食失衡', tone: 'red', copy: '目前的吃法热量密度高、营养密度低,身体容易囤脂肪、缺微量元素。',
      tips: ['每天先吃一顿"合格早餐":主食+蛋白+水果', '含糖饮料直接换成白水,两周就能看到变化', '若需要控重,建议咨询营养科医生定制方案'] },
  ],
};

/* ============ 4. 压力状态测评 ============ */
const STRESS: AssessmentDef = {
  id: 'stress', name: '压力状态测评', tagline: '给紧绷的神经做个体检', emoji: '🧘', color: '#f1eeff',
  questions: [
    { title: '最近两周,感到紧张或焦虑的频率?', options: [
      { label: '几乎没有', score: 3 }, { label: '偶尔', score: 2 },
      { label: '经常', score: 1 }, { label: '几乎每天', score: 0 }] },
    { title: '压力影响到睡眠了吗?', options: [
      { label: '完全没影响', score: 3 }, { label: '偶尔想事情睡不着', score: 2 },
      { label: '经常因心事睡不好', score: 1 }, { label: '一躺下就胡思乱想', score: 0 }] },
    { title: '情绪波动大吗?', options: [
      { label: '很平稳', score: 3 }, { label: '偶尔烦躁', score: 2 },
      { label: '容易发脾气或低落', score: 1 }, { label: '情绪像过山车', score: 0 }] },
    { title: '能专注做事吗?', options: [
      { label: '专注没问题', score: 3 }, { label: '偶尔分心', score: 2 },
      { label: '经常坐不住、刷手机逃避', score: 1 }, { label: '很难集中注意力', score: 0 }] },
    { title: '身体有这些信号吗?(多选)', multi: true, options: [
      { label: '肩颈紧绷酸痛', score: 0 }, { label: '头胀头痛', score: 0 },
      { label: '胃口变差或暴食', score: 0 }, { label: '心跳快、胸闷', score: 0 },
      { label: '以上都没有', score: 3, exclusive: true }] },
    { title: '每天有属于自己的放松时间吗?', options: [
      { label: '有,雷打不动', score: 3 }, { label: '多数天有', score: 2 },
      { label: '很少,被各种事占满', score: 1 }, { label: '完全没有', score: 0 }] },
    { title: '会跟人倾诉烦恼吗?', options: [
      { label: '有固定的倾诉对象', score: 3 }, { label: '偶尔说说', score: 2 },
      { label: '一般自己消化', score: 1 }, { label: '习惯全憋在心里', score: 0 }] },
    { title: '对未来两周的期待感?', options: [
      { label: '有明确期待的事', score: 3 }, { label: '还行,按部就班', score: 2 },
      { label: '提不起劲', score: 1 }, { label: '觉得会很难熬', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '压力可控', tone: 'green', copy: '你有自己的减压节奏,张弛有度,继续保持。',
      tips: ['把当前有效的放松方式保持下去', '压力大的人是你,能帮别人的人也是你,别硬扛'] },
    { min: 60, label: '偶有压力', tone: 'green', copy: '压力在正常范围内,只是偶尔堆多了点。',
      tips: ['每天留 15 分钟"什么都不做"的缓冲时间', '睡前把明天三件要事写下来,清空大脑'] },
    { min: 40, label: '压力偏大', tone: 'amber', copy: '身体和情绪已经在报警,别等耗尽才休息。',
      tips: ['把"必须做"和"可以放"分开,砍掉两件可放的事', '快走、跑步等有氧是性价比最高的减压阀', '跟信任的人聊一次,比独自消化十天有用'] },
    { min: 0, label: '压力过大', tone: 'red', copy: '当前压力水平偏高,已影响到睡眠、情绪或身体,需要主动干预。',
      tips: ['优先保障睡眠,其他事都可以让位', '把压力源写下来,区分"能改变"与"不能改变"', '若持续两周以上情绪低落、失眠,建议寻求专业心理支持'] },
  ],
};

/* ============ 5. 运动习惯测评 ============ */
const EXERCISE: AssessmentDef = {
  id: 'exercise', name: '运动习惯测评', tagline: '你是久坐族还是活力派', emoji: '🏃', color: '#ffe4e9',
  questions: [
    { title: '每周运动几次?(20 分钟以上算一次)', options: [
      { label: '5 次以上', score: 3 }, { label: '3 ~ 4 次', score: 3 },
      { label: '1 ~ 2 次', score: 1 }, { label: '几乎不运动', score: 0 }] },
    { title: '每次运动的类型?', options: [
      { label: '有氧 + 力量都有', score: 3 }, { label: '以有氧为主(快走/跑步/骑行)', score: 2 },
      { label: '以拉伸散步为主', score: 2 }, { label: '基本不运动', score: 0 }] },
    { title: '白天久坐情况?', options: [
      { label: '每坐 1 小时就起来动动', score: 3 }, { label: '一坐半天,偶尔起身', score: 1 },
      { label: '除了上厕所基本不动', score: 0 }] },
    { title: '通勤或日常活动量?', options: [
      { label: '每天步行 8000 步以上', score: 3 }, { label: '4000 ~ 8000 步', score: 2 },
      { label: '2000 ~ 4000 步', score: 1 }, { label: '不到 2000 步', score: 0 }] },
    { title: '爬三层楼梯会气喘吗?', options: [
      { label: '轻松,面不改色', score: 3 }, { label: '微喘但能聊', score: 3 },
      { label: '明显喘,要缓一下', score: 1 }, { label: '很吃力', score: 0 }] },
    { title: '会做力量训练吗?(俯卧撑/深蹲/器械)', options: [
      { label: '每周 2 次以上', score: 3 }, { label: '每周 1 次', score: 2 },
      { label: '偶尔练练', score: 1 }, { label: '从不', score: 0 }] },
    { title: '运动前后的习惯?(多选)', multi: true, options: [
      { label: '运动前热身 5 分钟以上', score: 2 }, { label: '运动后拉伸放松', score: 2 },
      { label: '注意补水', score: 2 }, { label: '直接开练、练完就停', score: 0 },
      { label: '以上都不符合', score: 1, exclusive: true }] },
    { title: '阻碍你运动的最大原因?', options: [
      { label: '其实没有障碍,已经在规律运动', score: 3 }, { label: '没时间', score: 1 },
      { label: '没兴趣、懒得动', score: 0 }, { label: '身体不舒服或怕受伤', score: 1 }] },
  ],
  bands: [
    { min: 80, label: '活力满满', tone: 'green', copy: '运动已经是你的生活方式,心肺和肌肉都在受益。',
      tips: ['注意安排休息日,恢复也是训练的一部分', '每 6~8 周换一种训练方式,持续给身体新刺激'] },
    { min: 60, label: '动起来了', tone: 'green', copy: '已经有基础活动量,再往上加一点就能上一个台阶。',
      tips: ['每周补 1 次力量训练,抵消肌肉流失', '把一次通勤改成步行或骑行'] },
    { min: 40, label: '运动不足', tone: 'amber', copy: '活动量在及格线下,久坐正在悄悄拉低代谢。',
      tips: ['从每天快走 20 分钟开始,别一上来就上强度', '手机设每小时起身提醒,接水、爬楼梯都算', '约朋友一起运动,坚持率翻倍'] },
    { min: 0, label: '久坐预警', tone: 'red', copy: '长期久坐少动,代谢、腰颈和情绪都会慢慢买单。',
      tips: ['第一周目标只有一个:每天步行 4000 步', '看电视时做深蹲或靠墙静蹲,把碎片时间用起来', '有基础疾病或明显不适,先从医生建议的低强度开始'] },
  ],
};

/* ============ 6. 脱发测评 ============ */
const HAIR: AssessmentDef = {
  id: 'hair', name: '脱发测评', tagline: '发现问题,提前防脱', emoji: '💇', color: '#eee9fe',
  dimLabels: { rest: '作息压力', nutrition: '饮食营养', care: '洗护习惯', signal: '脱发信号' },
  dimAdvice: {
    rest: ['尽量 23 点前入睡,熬夜与压力是掉发的放大器', '睡前半小时远离工作消息,给神经降降速'],
    nutrition: ['每天保证一个鸡蛋加一份肉或豆制品,头发的主要原料是蛋白质', '主食别一刀切不吃,粗细搭配比完全断碳更护发'],
    care: ['温水洗头、指腹按摩,少用指甲抓挠头皮', '烫染间隔拉长到半年以上,吹风机离头皮 15 厘米以上'],
    signal: ['连续记录掉发与头皮状态,变化明显时带着记录去就诊', '家族史叠加作息差,更建议每年让皮肤科看一次头皮'],
  },
  questions: [
    { dim: 'signal', title: '最近三个月,你感觉掉发量有什么变化?', options: [
      { label: '没有明显变化', score: 3 }, { label: '略有增多,但没有成撮', score: 2 },
      { label: '明显增多,发缝变宽', score: 1 }, { label: '出现成撮脱落或局部斑块', score: 0 }] },
    { dim: 'rest', title: '最近一个月的精神状态?', options: [
      { label: '比较轻松', score: 3 }, { label: '偶尔紧张', score: 2 },
      { label: '长期紧绷', score: 1 }, { label: '压力大到影响睡眠', score: 0 }] },
    { dim: 'rest', title: '平均几点入睡?', options: [
      { label: '23 点前', score: 3 }, { label: '23 点 ~ 1 点', score: 2 },
      { label: '1 ~ 2 点', score: 1 }, { label: '2 点以后', score: 0 }] },
    { dim: 'rest', title: '每周熬夜(超过凌晨 1 点)几次?', options: [
      { label: '基本没有', score: 3 }, { label: '1 ~ 2 次', score: 2 },
      { label: '3 ~ 4 次', score: 1 }, { label: '几乎天天', score: 0 }] },
    { dim: 'nutrition', title: '以下符合你日常饮食的有?(可多选)', multi: true, options: [
      { label: '每天都有蛋、肉、鱼或豆制品', score: 2 },
      { label: '常吃深色蔬菜和水果', score: 2 },
      { label: '常吃坚果、粗粮', score: 1 },
      { label: '正在节食或长期吃很少', score: 0 },
      { label: '常吃高油高糖零食', score: 0 }] },
    { dim: 'nutrition', title: '主食吃得怎么样?', options: [
      { label: '粗细搭配,顿顿适量', score: 3 }, { label: '以米饭面条为主', score: 2 },
      { label: '偶尔不吃主食', score: 1 }, { label: '长期不吃主食', score: 0 }] },
    { dim: 'care', title: '过去一年烫发、染发几次?', options: [
      { label: '0 次', score: 3 }, { label: '1 次', score: 2 },
      { label: '2 ~ 3 次', score: 1 }, { label: '3 次以上', score: 0 }] },
    { dim: 'care', title: '平时怎么打理头发?', options: [
      { label: '披散或松扎,少加热', score: 3 }, { label: '偶尔紧扎或高温吹整', score: 2 },
      { label: '经常紧扎马尾或脏辫', score: 1 }, { label: '经常高温卷烫、强力定型', score: 0 }] },
    { dim: 'signal', title: '头皮状态怎么样?', options: [
      { label: '清爽无不适', score: 3 }, { label: '偶尔头痒或有头屑', score: 2 },
      { label: '长期油腻、头痒或屑多', score: 1 }, { label: '有红疹、疼痛或痘', score: 0 }] },
    { dim: 'signal', title: '直系亲属(父母、兄妹)有明显脱发吗?', options: [
      { label: '没有', score: 3 }, { label: '不清楚', score: 2 },
      { label: '父辈一方有', score: 1 }, { label: '父母双方都有', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '头发状态在线', tone: 'green', copy: '目前没有明显的脱发风险,作息与洗护都在线,继续保持。',
      tips: ['保持规律作息与均衡的蛋白质摄入', '烫染一年不超过 2 次,给头发留出恢复期'] },
    { min: 60, label: '大体稳定', tone: 'green', copy: '整体稳定,但有几个细节正在悄悄透支发量,趁早补上。',
      tips: ['优先改进得分最低的维度,先睡眠后饮食', '洗头用温水、指腹按摩,减少拉扯和高温'] },
    { min: 40, label: '需要关注', tone: 'amber', copy: '多个风险因素叠加,掉发量可能已经在悄悄增加。',
      tips: ['先稳睡眠:固定入睡时间,连续熬夜是掉发的放大器', '每天保证蛋白质与适量主食,别用节食换体重'] },
    { min: 0, label: '建议尽快就诊', tone: 'red', copy: '掉发信号比较明显,生活习惯之外可能还有其他原因,别硬扛。',
      tips: ['建议到正规医院皮肤科面诊,先明确原因', '斑块状脱发或成撮脱落,越早处理越好', '不要轻信生发偏方与三无产品'] },
  ],
};

/* ============ 7. 抗衰护肤测评 ============ */
const SKIN: AssessmentDef = {
  id: 'skin', name: '抗衰护肤测评', tagline: '科学护肤,延缓衰老', emoji: '✨', color: '#ffedd5',
  dimLabels: { sun: '防晒', rest: '作息压力', care: '清洁保湿', habit: '生活习惯' },
  dimAdvice: {
    sun: ['把防晒霜放在玄关,出门前 15 分钟涂好', '阴天与冬天也要防,紫外线全年在线'],
    rest: ['固定入睡时间,把睡前手机换成纸质书', '高压时段用运动泄压,比硬扛对皮肤友好'],
    care: ['精简三步:温和清洁、保湿、防晒,先坚持四周', '带妆回家第一件事是卸妆,别等到睡前'],
    habit: ['每周设一个无糖日,奶茶先换无糖茶', '戒烟或远离二手烟,是抗衰回报率最高的一步'],
  },
  questions: [
    { dim: 'sun', title: '白天出门的防晒习惯?', options: [
      { label: '全年做防晒(防晒霜或帽子伞)', score: 3 }, { label: '只在夏天或大太阳时防', score: 2 },
      { label: '偶尔想起来才防', score: 1 }, { label: '几乎从不防晒', score: 0 }] },
    { dim: 'sun', title: '长时间户外活动后会?', options: [
      { label: '及时补涂并做晒后舒缓', score: 3 }, { label: '正常清洁休息', score: 2 },
      { label: '偶尔补涂', score: 1 }, { label: '持续暴晒也不做防护', score: 0 }] },
    { dim: 'rest', title: '平均每晚睡多久?', options: [
      { label: '7 ~ 8 小时', score: 3 }, { label: '6 ~ 7 小时', score: 2 },
      { label: '不足 6 小时', score: 1 }, { label: '昼夜颠倒', score: 0 }] },
    { dim: 'rest', title: '最近一个月的压力与情绪?', options: [
      { label: '轻松平稳', score: 3 }, { label: '偶尔烦躁', score: 2 },
      { label: '长期紧绷', score: 1 }, { label: '焦虑到影响睡眠', score: 0 }] },
    { dim: 'habit', title: '奶茶、甜饮料、甜点的频率?', options: [
      { label: '几乎不碰', score: 3 }, { label: '每周 1 ~ 2 次', score: 2 },
      { label: '每周 3 次以上', score: 1 }, { label: '几乎每天', score: 0 }] },
    { dim: 'habit', title: '吸烟或长期处在二手烟环境?', options: [
      { label: '都没有', score: 3 }, { label: '偶尔接触', score: 2 },
      { label: '经常接触二手烟', score: 1 }, { label: '本人吸烟', score: 0 }] },
    { dim: 'habit', title: '每周运动几次(每次 30 分钟以上)?', options: [
      { label: '3 次以上', score: 3 }, { label: '1 ~ 2 次', score: 2 },
      { label: '偶尔动一动', score: 1 }, { label: '几乎不运动', score: 0 }] },
    { dim: 'care', title: '卸妆与洁面做得如何?', options: [
      { label: '认真但不过度清洁', score: 3 }, { label: '简单洗一下', score: 2 },
      { label: '频繁去角质或强力清洁', score: 1 }, { label: '经常带妆入睡', score: 0 }] },
    { dim: 'care', title: '日常护肤怎么安排?', options: [
      { label: '基础清洁加保湿坚持在做', score: 3 }, { label: '多种功效产品叠着用', score: 2 },
      { label: '想起来才涂', score: 1 }, { label: '基本不护肤', score: 0 }] },
    { dim: 'care', title: '所处环境与饮水情况?', options: [
      { label: '注意保湿,每天喝水 1500ml 以上', score: 3 }, { label: '喝水看心情', score: 2 },
      { label: '皮肤干了才补救', score: 1 }, { label: '长期干燥环境又很少喝水', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '抗衰基础扎实', tone: 'green', copy: '防晒、作息、护理都在线,衰老速度大概率被你放慢了。',
      tips: ['防晒是一年四季的事,阴天紫外线也不弱', '保持精简护肤,功效型产品宁少勿多'] },
    { min: 60, label: '方向对,细节拉分', tone: 'green', copy: '基础尚可,还有几个几乎白捡的加分项。',
      tips: ['把防晒从夏天扩展到全年,是性价比最高的抗衰', '睡前少刷半小时手机,皮肤和睡眠都会回馈你'] },
    { min: 40, label: '有习惯在拖后腿', tone: 'amber', copy: '有几个习惯正在加速皮肤老化,现在改还来得及。',
      tips: ['先做减法:戒烟、减糖、别带妆入睡', '再做加法:每天保湿加防晒,坚持四周再评估'] },
    { min: 0, label: '需要认真干预', tone: 'red', copy: '多个加速老化的因素叠加,皮肤问题可能已经显现。',
      tips: ['从防晒和睡眠两件事开始,两周就能感到变化', '若出现持续红肿、色斑快速变化,及时到皮肤科就诊'] },
  ],
};

/* ============ 8. 护眼测评(成人) ============ */
const EYE: AssessmentDef = {
  id: 'eye', name: '护眼测评(成人)', tagline: '眼睛很重要,却常被忽视', emoji: '👁', color: '#fef9c3',
  dimLabels: { time: '用眼强度', rest: '休息护眼', env: '环境症状', life: '生活支持' },
  dimAdvice: {
    time: ['给屏幕时间设硬上限,工作 40 分钟必休息', '睡前刷手机改成听内容,黑暗中亮屏最伤眼'],
    rest: ['把 20-20-20 设成循环提醒:每 20 分钟看 6 米外 20 秒', '休息时真的看远处,而不是换一块屏幕'],
    env: ['屏幕亮度跟随环境光,别在黑暗里看屏', '干涩时主动多眨眼,明显时可用不含防腐剂的人工泪液'],
    life: ['白天多出门走走,自然光对眼睛和节律都有好处', '深色蔬菜与蛋黄常吃,每年验光一次并建档'],
  },
  questions: [
    { dim: 'time', title: '每天看屏幕(手机加电脑)的总时长?', options: [
      { label: '4 小时以内', score: 3 }, { label: '4 ~ 6 小时', score: 2 },
      { label: '6 ~ 8 小时', score: 1 }, { label: '8 小时以上', score: 0 }] },
    { dim: 'time', title: '通常连续用眼多久休息一次?', options: [
      { label: '每 30 ~ 40 分钟', score: 3 }, { label: '1 小时左右', score: 2 },
      { label: '半天想起来才歇', score: 1 }, { label: '从不主动休息', score: 0 }] },
    { dim: 'time', title: '睡前关灯后还玩手机吗?', options: [
      { label: '从不', score: 3 }, { label: '偶尔', score: 2 },
      { label: '经常', score: 1 }, { label: '每晚如此', score: 0 }] },
    { dim: 'rest', title: '知道「20-20-20」法则吗(每 20 分钟看 6 米外 20 秒)?', options: [
      { label: '知道,经常这样做', score: 3 }, { label: '知道,但做不到', score: 1 },
      { label: '今天第一次听说', score: 0 }] },
    { dim: 'rest', title: '工作学习间隙会?', options: [
      { label: '远眺、闭目或做眼保健操', score: 3 }, { label: '起身走动,眼睛继续盯屏', score: 2 },
      { label: '偶尔换个姿势', score: 1 }, { label: '一直盯着不动', score: 0 }] },
    { dim: 'env', title: '用眼时的环境光线?', options: [
      { label: '充足均匀,屏幕不反光', score: 3 }, { label: '时好时坏', score: 2 },
      { label: '偏暗或屏幕反光刺眼', score: 1 }, { label: '经常关灯看屏幕', score: 0 }] },
    { dim: 'env', title: '眼睛干涩、酸胀、视物模糊的频率?', options: [
      { label: '几乎没有', score: 3 }, { label: '偶尔', score: 2 },
      { label: '经常', score: 1 }, { label: '每天如此', score: 0 }] },
    { dim: 'life', title: '每周白天在户外的累计时长?', options: [
      { label: '7 小时以上', score: 3 }, { label: '3 ~ 7 小时', score: 2 },
      { label: '1 ~ 3 小时', score: 1 }, { label: '几乎不出门', score: 0 }] },
    { dim: 'life', title: '深色蔬菜(菠菜、胡萝卜、玉米)和蛋黄吃得多吗?', options: [
      { label: '经常吃', score: 3 }, { label: '每周两三次', score: 2 },
      { label: '偶尔吃', score: 1 }, { label: '几乎不吃', score: 0 }] },
    { dim: 'life', title: '验光或眼科检查的频率?', options: [
      { label: '每年定期检查', score: 3 }, { label: '感觉不对才去', score: 2 },
      { label: '两三年没查过', score: 1 }, { label: '从没查过', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '用眼习惯优秀', tone: 'green', copy: '用眼节奏和休息习惯都在线,继续守护这扇窗。',
      tips: ['保持 20-20-20 的节奏与白天户外时间', '每年一次验光,把视力变化记进档案'] },
    { min: 60, label: '尚可,别透支', tone: 'green', copy: '大体可以,但屏幕时间和休息自觉性还差一点。',
      tips: ['给手机设屏幕使用提醒,到点就远眺', '睡前刷手机换成听内容,眼睛和睡眠都受益'] },
    { min: 40, label: '眼疲劳风险高', tone: 'amber', copy: '眼睛长期超负荷,干涩酸胀可能已经是信号。',
      tips: ['把连续用眼切成 40 分钟一段,配一杯水的提醒', '干涩明显时用不含防腐剂的人工泪液,并多眨眼'] },
    { min: 0, label: '建议做次检查', tone: 'red', copy: '用眼负担明显偏重,视力与视疲劳风险都在上升。',
      tips: ['建议做一次全面眼科检查,排查屈光与干眼问题', '出现视力骤降、视野缺损、眼前闪光感,立即就医'] },
  ],
};

/* ============ 9. 血糖管理测评 ============ */
const SUGAR: AssessmentDef = {
  id: 'blood-sugar', name: '血糖管理测评', tagline: '管理血糖,没那么难', emoji: '🩸', color: '#fae8ff',
  dimLabels: { diet: '饮食结构', sport: '运动习惯', rest: '作息压力', risk: '风险因素' },
  dimAdvice: {
    diet: ['主食的三分之一换成杂豆、燕麦或糙米', '含糖饮料先减半,再过渡到无糖替代', '三餐规律,把夜宵挪到第二天早餐'],
    sport: ['每周至少 150 分钟中等强度运动,快走就算数', '久坐设 45 分钟起身提醒,接水、爬楼梯都行'],
    rest: ['睡够 7 小时,睡眠不足会直接影响血糖波动', '压力大时优先补睡眠,别用吃东西解压'],
    risk: ['有家族史更要保持健康体重,每年查空腹血糖', '腰围超标先减 5%,身体的血糖负担会明显减轻', '空腹血糖曾偏高,建议复查并加做糖化血红蛋白'],
  },
  questions: [
    { dim: 'diet', title: '主食怎么吃?', options: [
      { label: '粗细搭配,顿顿适量', score: 3 }, { label: '以米饭面条为主,偶尔粗粮', score: 2 },
      { label: '常常不吃主食', score: 1 }, { label: '顿顿精米白面还吃得多', score: 0 }] },
    { dim: 'diet', title: '含糖饮料(奶茶、可乐、果汁)的频率?', options: [
      { label: '几乎不喝', score: 3 }, { label: '每周 1 ~ 2 次', score: 2 },
      { label: '每周 3 次以上', score: 1 }, { label: '几乎每天', score: 0 }] },
    { dim: 'diet', title: '三餐规律吗?', options: [
      { label: '规律三餐,七八分饱', score: 3 }, { label: '基本规律,偶尔吃多', score: 2 },
      { label: '常跳过正餐吃零食', score: 1 }, { label: '常吃夜宵或深夜进食', score: 0 }] },
    { dim: 'sport', title: '每周中等强度运动(快走、慢跑等)累计?', options: [
      { label: '150 分钟以上', score: 3 }, { label: '75 ~ 150 分钟', score: 2 },
      { label: '不足 75 分钟', score: 1 }, { label: '几乎不运动', score: 0 }] },
    { dim: 'sport', title: '工作日连续久坐的时间?', options: [
      { label: '3 小时以内', score: 3 }, { label: '3 ~ 6 小时', score: 2 },
      { label: '6 ~ 8 小时', score: 1 }, { label: '8 小时以上', score: 0 }] },
    { dim: 'rest', title: '每晚睡眠情况?', options: [
      { label: '7 小时以上且规律', score: 3 }, { label: '6 ~ 7 小时', score: 2 },
      { label: '不足 6 小时', score: 1 }, { label: '昼夜颠倒或质量很差', score: 0 }] },
    { dim: 'rest', title: '长期压力和情绪状态?', options: [
      { label: '平稳', score: 3 }, { label: '偶尔紧张', score: 2 },
      { label: '长期紧绷', score: 1 }, { label: '已影响睡眠和饮食', score: 0 }] },
    { dim: 'risk', title: '以下情况你有吗?(可多选)', multi: true, options: [
      { label: '直系亲属有糖尿病', score: 0 },
      { label: 'BMI 超过 24 或腰围超标(男 ≥90cm、女 ≥85cm)', score: 0 },
      { label: '年龄超过 45 岁', score: 0 },
      { label: '生过 4 公斤以上的巨大儿(女性)', score: 0 },
      { label: '以上都没有', score: 3, exclusive: true }] },
    { dim: 'risk', title: '最近一次体检的空腹血糖?', options: [
      { label: '正常', score: 3 }, { label: '没测过或不记得', score: 2 },
      { label: '在 6.1 ~ 7.0 之间', score: 0 }, { label: '达到或超过 7.0,或被告知血糖异常', score: 0 }] },
    { dim: 'risk', title: '出现过这些情况吗(多饮多尿、不明原因消瘦、餐前心慌手抖)?', options: [
      { label: '从来没有', score: 3 }, { label: '偶尔单项,很快缓解', score: 2 },
      { label: '常有一两项反复出现', score: 1 }, { label: '多项同时且持续存在', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '防线稳固', tone: 'green', copy: '饮食、运动、作息都在正轨,血糖管理的主动权在你手里。',
      tips: ['保持粗细搭配与餐后散步的习惯', '每年体检关注空腹血糖与糖化血红蛋白'] },
    { min: 60, label: '大方向可以', tone: 'green', copy: '整体不错,把短板补上会更稳。',
      tips: ['含糖饮料换成无糖茶或气泡水,是最容易的一步', '每周定一个运动闹钟,先动起来再加量'] },
    { min: 40, label: '风险在累积', tone: 'amber', copy: '再不干预,这些习惯会慢慢抬高血糖风险。',
      tips: ['主食减掉三分之一精米白面,换成杂豆燕麦', '久坐每 45 分钟起身活动 3 分钟', '建议近期做一次空腹血糖检测'] },
    { min: 0, label: '建议尽快检查', tone: 'red', copy: '风险因素与信号偏多,需要认真对待。本测评只评估生活方式,不能替代血糖检测。',
      tips: ['建议尽快到内分泌科或社区医院查空腹血糖与糖化血红蛋白', '若已确诊,请遵医嘱管理,本测评不能替代任何治疗', '出现明显多饮多尿、体重快速下降,立即就医'] },
  ],
};

/* ============ 10. 血压管理测评 ============ */
const PRESSURE: AssessmentDef = {
  id: 'blood-pressure', name: '血压管理测评', tagline: '找对问题,管理更轻松', emoji: '🩺', color: '#dbeafe',
  dimLabels: { salt: '饮食控盐', sport: '运动习惯', rest: '作息情绪', risk: '风险因素' },
  dimAdvice: {
    salt: ['买个限盐勺,全家每天盐控制在 5 克以内', '外卖与腌制品减半,汤底酱料别吃完', '补钾有助控压:每天蔬菜约一斤、水果半斤'],
    sport: ['每天快走 30 分钟、每周 5 天,控压从脚开始', '体重减 5%,对血压是实打实的减负'],
    rest: ['睡够且规律,打鼾严重建议排查睡眠呼吸暂停', '情绪上头时先深呼吸 10 次再说话,给血压一点缓冲'],
    risk: ['家里备一台电子血压计,早晚各测一次并记录', '吸烟饮酒减到最少,需要时寻求戒烟门诊帮助', '测出偏高别拖,尽早让医生评估'],
  },
  questions: [
    { dim: 'salt', title: '你的口味?', options: [
      { label: '清淡,少盐少酱', score: 3 }, { label: '一般', score: 2 },
      { label: '偏咸', score: 1 }, { label: '重口,无咸不欢', score: 0 }] },
    { dim: 'salt', title: '外卖、加工食品(香肠火腿、咸菜酱料)的频率?', options: [
      { label: '每周 2 次以内', score: 3 }, { label: '每周 3 ~ 5 次', score: 2 },
      { label: '每周 6 次以上', score: 1 }, { label: '几乎每天', score: 0 }] },
    { dim: 'salt', title: '新鲜蔬菜水果每天吃够吗?(蔬菜约一斤、水果半斤)', options: [
      { label: '基本达标', score: 3 }, { label: '只吃其中一样', score: 2 },
      { label: '常常没有', score: 1 }, { label: '几乎不吃', score: 0 }] },
    { dim: 'sport', title: '每周运动情况?', options: [
      { label: '5 次以上,每次 30 分钟', score: 3 }, { label: '每周 3 ~ 4 次', score: 2 },
      { label: '每周 1 ~ 2 次', score: 1 }, { label: '几乎不动', score: 0 }] },
    { dim: 'sport', title: '体重与腰围?', options: [
      { label: '都在正常范围', score: 3 }, { label: '不清楚', score: 2 },
      { label: '有一项超标', score: 1 }, { label: '都超标', score: 0 }] },
    { dim: 'rest', title: '每晚睡眠情况?', options: [
      { label: '7 小时以上且规律', score: 3 }, { label: '6 ~ 7 小时', score: 2 },
      { label: '不足 6 小时', score: 1 }, { label: '昼夜颠倒或常失眠', score: 0 }] },
    { dim: 'rest', title: '情绪状态?', options: [
      { label: '平稳', score: 3 }, { label: '偶尔急躁', score: 2 },
      { label: '常焦虑易怒', score: 1 }, { label: '长期高压', score: 0 }] },
    { dim: 'risk', title: '以下情况你有吗?(可多选)', multi: true, options: [
      { label: '吸烟', score: 0 },
      { label: '每周饮酒 3 次以上', score: 0 },
      { label: '直系亲属有高血压', score: 0 },
      { label: '打鼾严重或白天嗜睡', score: 0 },
      { label: '以上都没有', score: 3, exclusive: true }] },
    { dim: 'risk', title: '最近半年测过血压吗?', options: [
      { label: '定期自测且正常', score: 3 }, { label: '体检时测过,正常', score: 2 },
      { label: '半年内没测过', score: 2 }, { label: '测过偏高,没重视', score: 0 }] },
    { dim: 'risk', title: '出现过头晕、头痛、心悸这类情况吗?', options: [
      { label: '很少', score: 3 }, { label: '偶尔,休息就好', score: 2 },
      { label: '时常出现', score: 1 }, { label: '频繁且影响生活', score: 0 }] },
  ],
  bands: [
    { min: 80, label: '基础扎实', tone: 'green', copy: '控盐、运动、作息都在线,血压大概率被你稳稳管住。',
      tips: ['保持限盐节奏,外卖汤底别喝完', '家里备一台电子血压计,定期自测'] },
    { min: 60, label: '基础尚可', tone: 'green', copy: '大方向没问题,把短板补上更稳。',
      tips: ['下厨用限盐勺,酱油蚝油减半试试', '每天快走 30 分钟,是性价比最高的控压运动之一'] },
    { min: 40, label: '该认真干预了', tone: 'amber', copy: '多个危险因素叠加,血压风险正在抬头。本测评只评估生活方式,不能替代血压测量。',
      tips: ['先把盐降下来:少外卖、少酱料、少吃腌制品', '戒烟限酒对血压的影响立竿见影', '建议近期测一次血压并记录'] },
    { min: 0, label: '建议尽快测量', tone: 'red', copy: '危险因素与不适信号偏多,别再拖了。',
      tips: ['尽快到社区医院或内科测血压,必要时做动态血压监测', '若收缩压 ≥140 或舒张压 ≥90,应就医评估并遵医嘱', '已确诊高血压者请规律服药,本测评不能替代治疗'] },
  ],
};

export const ASSESSMENTS: AssessmentDef[] = [LIFESTYLE, SLEEP, DIET, STRESS, EXERCISE, HAIR, SKIN, EYE, SUGAR, PRESSURE];

/** 预计用时文案 */
export function estimateMinutes(q: AssessQuestion[]): string {
  return `${Math.max(1, Math.round(q.length / 3))} ~ ${Math.max(2, Math.round(q.length / 2))} 分钟`;
}
