/**
 * 每日分享卡的金句库 —— 服务端唯一真源,客户端 src/constants/dailyQuotes.ts 是兜底副本。
 *
 * 轮换口径:**按日期确定性轮换**,同一天全站同一条 —— 朋友圈里两张不同人的卡是同一句话,
 * 读起来像「大家都在用」,这是特性不是巧合。换库不影响:索引按「天数对条数取模」,
 * 条数变了顺序会重排,但当天所有人看到的仍然一致。
 */

export interface QuoteItem {
  /** 主句(扎心句),卡面大字 */
  text: string;
  /** 出路句,指向「记录/看清」 */
  sub: string;
  category: string;
}

export const DEFAULT_QUOTES: QuoteItem[] = [
  { text: '白天沙拉,深夜烧烤——身体都替你记着账呢', sub: '看得见的摄入,才管得住', category: 'emotion' },
  { text: '你吃下去的不是夜宵,是白天的委屈', sub: '先记下来,再决定吃不吃', category: 'emotion' },
  { text: '不开心就吃,吃完更不开心,这笔账怎么算都不划算', sub: '下一顿好好吃,就是改变', category: 'emotion' },
  { text: '「明天开始」这句话,你已经说了三百个明天', sub: '今天记一笔,就算开始', category: 'delay' },
  { text: '减肥最难的不是管住嘴,是今天就开始', sub: '从记录今天这一顿开始', category: 'delay' },
  { text: '等忙完这阵再减肥,这阵已经忙了三年', sub: '越忙,越要吃得明白', category: 'delay' },
  { text: '靠饿瘦下来的,身体会连本带利要回去', sub: '吃够再吃对,才是正路', category: 'yoyo' },
  { text: '不吃晚饭省下的热量,宵夜都替你补回来了', sub: '三餐记清楚,比少吃一顿有用', category: 'yoyo' },
  { text: '体重是弹簧,压得越狠,弹得越高', sub: '慢慢来,比较快', category: 'yoyo' },
  { text: '你不是喝水都胖,是零食都失忆', sub: '记下来,真相会说话', category: 'excuse' },
  { text: '「我吃得不多」和「我记得吃了什么」是两回事', sub: '记三天,你就明白了', category: 'excuse' },
  { text: '基础代谢不背这个锅,奶茶也不背,选择才背', sub: '看见选择,才能改变选择', category: 'excuse' },
  { text: '体重没变围度变了,你却只信那个数字', sub: '量量围度,别跟秤较劲', category: 'scale' },
  { text: '秤上的数字管得了今天,管不了你三个月的样子', sub: '记趋势,不记某一天', category: 'scale' },
  { text: '少喝两口水轻一斤,这波动你也当真?', sub: '看周均线,别看单日', category: 'scale' },
  { text: '原来不是我不自律,是我根本不知道自己吃了多少', sub: '记录,是改变的第一步', category: 'logging' },
  { text: '瘦下来的人不是意志力强,是看得清自己', sub: '先看见,再改变', category: 'logging' },
  { text: '一天记三笔,一个月后你会吓一跳', sub: '现在就记今天这一笔', category: 'logging' },
  { text: '身体的账,大脑记不住,笔记记得住', sub: '交给轻身记,你只管生活', category: 'logging' },
  { text: '改变从来不靠狠劲,靠看清', sub: '每天看一眼,就够了', category: 'logging' },
  { text: '熬最晚的夜,吃最油的宵夜', sub: '今晚早睡半小时试试', category: 'life' },
  { text: '久坐八小时,一杯奶茶补偿自己,身体表示不解', sub: '起来接杯水,顺手记一笔', category: 'life' },
  { text: '外卖越点越快,身体越来越慢', sub: '点这顿之前,先记上一顿', category: 'life' },
  { text: '喝水都嫌麻烦的人,身体也在将就你', sub: '今天喝够水了吗', category: 'life' },
  { text: '每一次记录,都是在给未来的自己攒证据', sub: '今天这一笔,别落下', category: 'encourage' },
  { text: '你不需要完美的一天,只需要如实的一天', sub: '记录,不需要完美', category: 'encourage' },
  { text: '身体不会辜负每一个认真记录的日子', sub: '坚持的人都知道', category: 'encourage' },
  { text: '三个月后的你,会感谢今天记的这一笔', sub: '现在,就去记', category: 'encourage' },
  { text: '慢一点没关系,别停下来就行', sub: '记录,让每一步都算数', category: 'encourage' },
  { text: '减脂不是苦行,是学会跟身体好好商量', sub: '好好吃饭,好好记录', category: 'encourage' }
];

/** 自增 id 的步长基数:插入时按数组顺序赋 sort,轮换按 sort 稳定 */
export const QUOTE_LIST_MAX = 200;

/** 「今天是第几天」:相对固定锚点日的天数差。纯函数,客户端用同一套公式保持一致。 */
export function dayIndexOf(dateStr: string, anchorStr = '2026-01-01'): number {
  const t = Date.parse(dateStr);
  const a = Date.parse(anchorStr);
  if (!Number.isFinite(t) || !Number.isFinite(a)) return 0;
  return Math.floor((t - a) / 86_400_000);
}

/** 当天该轮到第几条:负数日期(理论上不会出现)也要落回正区间 */
export function pickQuoteIndex(dateStr: string, count: number): number {
  if (count <= 0) return 0;
  const d = dayIndexOf(dateStr);
  return ((d % count) + count) % count;
}

/** 后台整体替换时的校验/清洗:主句 4~40 字,出路 2~30 字,最多 200 条,重复主句去重(保留首个) */
export function validateQuoteList(input: unknown): { quotes: QuoteItem[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) return { quotes: [], error: '金句列表不能为空' };
  if (input.length > QUOTE_LIST_MAX) return { quotes: [], error: `一次最多 ${QUOTE_LIST_MAX} 条` };
  const seen = new Set<string>();
  const quotes: QuoteItem[] = [];
  for (const raw of input) {
    const q = raw as Record<string, unknown>;
    const text = String(q?.text ?? '').trim();
    const sub = String(q?.sub ?? '').trim();
    const category = String(q?.category ?? 'general').trim() || 'general';
    if (text.length < 4 || text.length > 40) return { quotes: [], error: `主句长度应在 4~40 字:「${text.slice(0, 10)}…」` };
    if (sub.length < 2 || sub.length > 30) return { quotes: [], error: `出路句长度应在 2~30 字:「${sub.slice(0, 10)}…」` };
    if (seen.has(text)) continue;
    seen.add(text);
    quotes.push({ text, sub, category: category.slice(0, 20) });
  }
  if (quotes.length === 0) return { quotes: [], error: '没有可用的金句' };
  return { quotes };
}
