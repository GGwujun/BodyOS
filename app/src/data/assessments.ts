/**
 * 测评中心 — 5 套生活方式测评,通用数据模型
 * 计分:每题选项 0~3 分(多选题为所选选项求和),总分折算 0~100
 * 结果按固定分档给出,仅供参考,不构成医学建议
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

export const ASSESSMENTS: AssessmentDef[] = [LIFESTYLE, SLEEP, DIET, STRESS, EXERCISE];

/** 预计用时文案 */
export function estimateMinutes(q: AssessQuestion[]): string {
  return `${Math.max(1, Math.round(q.length / 5))} ~ ${Math.max(2, Math.round(q.length / 4))} 分钟`;
}
