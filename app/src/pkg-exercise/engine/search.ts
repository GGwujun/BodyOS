/**
 * 动作库那个搜索框认什么 —— 「一个动作能被搜到的全部字」的唯一定义。
 *
 * 为什么从页面里搬到 engine:它是**判据**,不是渲染。搬出来才咬得住 ——
 * 「搜『胸』搜不出卧推」这类毛病靠手点是发现不了的:试的人往往去搜他记得名字的那个
 * 动作,一搜就有,于是这毛病能活很久,而真正不知道动作叫什么的用户一上手就是 0 结果。
 *
 * 为什么不只搜名字:用户手里那个词常常不是动作名,而是**他想练的地方**或者**他有的
 * 器械**。「胸」「哑铃」「腿」这三个词在新手手里出现得比任何动作名都早,只比名字的话
 * 它们全是 0 结果。
 *
 * 协同肌群也算(次要练到胸的动作,搜「胸」也该冒出来):宁可多给几条让人自己挑,
 * 也别让人以为库里没有。
 *
 * 三层,按代价从低到高,**前一层 0 结果才轮到后一层**:
 *   ①**逐词命中**(`matchesQuery`)—— 词与词之间是「都」(搜「哑铃 卧推」要的是哑铃卧推,
 *     不是所有哑铃或所有卧推);一个词命中**任意一个词**就算这条命中(不必整串相邻,
 *     中文字和英文词首的差别见 `inWord`);
 *   ②**口语/简写表**(`SYNONYMS`)—— 人嘴里说的和译表里的解剖学名字不是一套(「胸肌」vs「胸大肌」);
 *   ③**差一个字的兜底**(`nearMatches`)—— 打错一个字不该得到一片空白,但也不该**悄悄**
 *     把结果换成另一批(那会让用户以为自己搜对了),所以它只在 0 结果时作为「这几个最像」出现。
 *
 * ②③是**猜**,偶尔会猜歪(搜「拉力器」会指向库里的「助力器械」)。留着的理由是:
 * 它只摆三条、明说着「最像」,歪了也只是被忽略;而少这一层,打错一个字的人看到的是
 * 「库里没有这个动作」—— 那是句假话。
 */
import { BODYPART_ZH, CATEGORY_ZH, EQUIPMENT_ZH, MUSCLE_ZH, type ExerciseEntry } from '../data/exercises';

/** 查不到译名就回退成 key 本身 —— 我建的动作里出现过的器械可能还没进中文表 */
const zh = (map: Record<string, string>, key: string): string => map[key] ?? key;

/**
 * 归一化:小写 + 去掉词内那些不属于词本身的符号(连字符、括号、逗号)。
 *
 * 起因很小、结果很大:数据里写的是 `pull-up`,而人打的是 `pullup` —— 一个都搜不到。
 * 归一化在**词**这一层做(不是把整条文本的空格都抹掉),因为空格是词与词的分界:
 * 抹掉它,'band'+'bench' 会拼出 'ban**db**ench' 这种假命中(搜「db」搜出弹力带卧推)。
 */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '');

/**
 * 一段原文 → 它贡献的那些词:每个最小段(归一化后)+ **相邻两段粘一起**。
 *
 * 为什么要粘:'weighted one hand pull up' 拆出来是 'pull' 和 'up',于是打 `pullup`
 * 的人搜不到它,打 `pull up` 的人搜得到 —— 同一个动作,隔一个空格就有了两种命运。
 * 粘起来('pull'+'up' → 'pullup')把这条缝补上,'dip-pull-up' 里的 'pull-up' 也一样,
 * 顺带 'bench'+'press' → 'benchpress' 也认得了。
 *
 * 粘出来的词只会被**从它开头**匹配到(英文按词首),而它的开头就是前一段本身 ——
 * 所以它只可能带来「跨过段边界、比前一段更长」的命中,不会凭空多出别的。
 */
function fieldWords(s: string): string[] {
  /* 空格、斜杠、括号、连字符都只是**间隔**,先一律拆成最小段('dip-pull-up' → dip/pull/up) */
  const atoms: string[] = [];
  for (const chunk of String(s ?? '').split(/[\s/,()]+/)) {
    for (const piece of chunk.split('-')) {
      const q = norm(piece);
      if (q) atoms.push(q);
    }
  }
  const out = atoms.slice();
  for (let i = 1; i < atoms.length; i++) out.push(atoms[i - 1] + atoms[i]);
  return out;
}

/**
 * 这个词条能被搜到的所有**词**(都归一化过)。
 *
 * **中文名和原始英文 key 都收**:数据里的 key 是英文(chest / barbell / dumbbell),
 * 中文表把它们译成了「胸大肌 / 杠铃 / 哑铃」。只收译文的话,一个习惯打英文的人
 * 搜 'chest' 会是 0 结果 —— 而这两种人都在用同一个框。多拼一份的成本是零。
 *
 * 切词的口径在 `fieldWords`:空格/斜杠/括号/连字符都算间隔,并且**相邻两段还要粘一份**
 * —— 库里同一个动作有写 'pull up' 的也有写 'pull-up' 的,两种写法的人都得搜得到。
 *
 * 每次按键重算一遍 1300 条:拼字符串比维护一份会过期的缓存表省心得多。
 */
export function searchWords(e: ExerciseEntry): string[] {
  return [
    e.nameZh, e.name,
    e.target, zh(MUSCLE_ZH, e.target),
    e.bodyPart, zh(BODYPART_ZH, e.bodyPart),
    e.equipment, zh(EQUIPMENT_ZH, e.equipment),
    e.category, zh(CATEGORY_ZH, e.category),
    ...(e.secondary ?? []).flatMap((k) => [k, zh(MUSCLE_ZH, k)])
  ].flatMap(fieldWords);
}

/** 查询串 → 若干词(空格/连字符都算分隔)。全是标点的查询给不出词,见 `matchesQuery`。 */
const tokensOf = (query: string): string[] =>
  query.split(/[\s\-_/]+/).map(norm).filter(Boolean);

/**
 * 口语/简写 → 库里真有的那个词(都是**归一化**形式,因为两边都过 `norm`)。
 *
 * 这张表是**拿真数据一条条验过**的:左边的词今天搜是 0 条(或全是歪的),
 * 右边是库里确实有的译名或原文。没验过的词不许往里加 —— 加错的代价是搜「胸肌」
 * 冒出一堆不相关的动作,比搜不到更让人不敢相信这个框。
 *
 * 一个词展开成两个的只有 `ohp`:过顶推和军事推在这份数据里是两批名字,两个都对。
 * 别的都收成一个 —— 展开得越多,结果越糊。
 *
 * **右边取的是库里那套口径里的一个词**(`searchWords` 切出来的,不是随手写的说法),
 * 而且要**指向同一批条目** —— 冒烟测试就是拿 `sameSet` 钉这条的,指错了就红。
 * `bw` 指译名「自重」而不是 'bodyweight':自重动作的器械字段写的是 'body weight',
 * `bw`/「无器械」/「自重」/`bodyweight` 今天都是同一批 325 条,但译名才和别处(筛选、
 * 详情页)说的是同一句话。`sldl` 指 'stiff'(名字是 'stiff leg deadlift')同理。
 *
 * 表里没有的几个,是**库里根本没有那个概念**:杠铃片/哑铃片(没有"片"这个器械)、
 * 瑜伽垫/垫子(没有"垫")、拉力器(绳索机还是弹力带说不准)。这种词该老老实实 0 结果,
 * 硬指一个方向等于骗人。
 */
const SYNONYMS: Record<string, string[]> = {
  // 中文口语 —— 译表收的是解剖学名字,人嘴里说的是另一套
  胸肌: ['胸大肌'], 背肌: ['背阔肌'], 肩膀: ['肩部'], 大臂: ['上臂'], 小臂: ['前臂'],
  屁股: ['臀肌'], 后腰: ['下背部'], 腿前侧: ['股四头肌'], 腿后侧: ['腘绳肌'],
  // 器械/场地
  无器械: ['自重'], 绳子: ['绳索'], 龙门架: ['绳索机'],
  // 英文简写。挑的原文/译名见上面那段注释
  db: ['dumbbell'], bb: ['barbell'], kb: ['kettlebell'], bw: ['自重'],
  rdl: ['romanian'], sldl: ['stiff'], bp: ['卧推'],
  // 过顶推和军事推是两批名字,都指过去 —— 指一个会漏掉另一批。
  // 「overhead press」是两个词(都要命中):只认「overhead」会把过顶深蹲、过顶臂屈伸
  // 这些**不是推**的动作一起捞进来,'ohp' 这个词要的显然是推
  ohp: ['overhead press', 'military']
};

/**
 * 一个词里有没有这个查询词 —— **中文按任意位置,英文只按词首**。
 *
 * 中文必须按任意位置:中文没有词边界,「背」出现在「下背部」里正是要的(用户搜的就是
 * 那个部位,不是那个词)。英文反过来,按任意位置会一路把「像」当「是」捞:
 * 搜 `chin`(引体的一种握法)会命中 'ma**chin**e',198 条器械题;搜 `row`(划船)
 * 会命中 'na**rrow**'(窄距),9 条窄握引体;搜 `arm` 会命中 'w**arm**up'(热身)。
 * 按词首就都干净了,而该命中的一个不少:`press` → 'bench press' 里本来就是独立的词,
 * `pull` → 'pull-up' 拆出来的 'pull'。
 *
 * 两个字母的英文串再紧一档,必须**整词相等**(复数算同一个词,'up' 得认 'ups')。
 * 短到两个字母,词首也对不上什么:`bb` 要找的杠铃名字叫 'barbell' —— 它本来就是个简写,
 * 该走 `SYNONYMS` 那张表,不走子串。'push up' 里的 'up' 是独立的一个词,照样搜得到。
 */
const SHORT_LATIN = 2;
const isLatin = (t: string): boolean => /^[a-z0-9]+$/.test(t);

const inWord = (w: string, t: string): boolean => {
  if (!isLatin(t)) return w.includes(t);
  return t.length <= SHORT_LATIN ? (w === t || w === `${t}s`) : w.startsWith(t);
};

/** 一个词命中没有:哪个词里有它(`inWord`),或者它是个口语词(展开成库里真有的那几个词) */
const hitToken = (words: string[], token: string): boolean => {
  if (words.some((w) => inWord(w, token))) return true;
  const alts = SYNONYMS[token];
  // 表里那一句再走一遍同样的判法 —— 它不是「另一种匹配」,只是「他要找的其实是这些词」。
  // 一句里几个词算「都」(和查询本身一个道理):'overhead press' 要求两样都在
  return !!alts && alts.some((alt) => tokensOf(alt).every((t) => words.some((w) => inWord(w, t))));
};

/**
 * 这个动作该不该出现在这次搜索里。空词一律算命中 —— 「没在搜」由调用方决定怎么处理,
 * 这里不做那个判断(否则每个调用方都要再写一遍 `!kw ||`,迟早有人漏掉一个)。
 *
 * 全是标点的查询(「###」)给不出词,按「什么都没搜到」算:那时候把整个动作库铺出来,
 * 用户看到的是「搜了个莫名其妙的东西,结果全库都相关」。
 */
export function matchesQuery(e: ExerciseEntry, query: string): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const tokens = tokensOf(raw);
  if (!tokens.length) return false;
  const words = searchWords(e);
  return tokens.every((t) => hitToken(words, t));
}

/* ================= 差一个字的兜底 ================= */

/**
 * 两个词是不是**只差一个字**(换一个字 / 多一个 / 少一个 / **挨着的两个字颠倒**)。
 * 只判「是不是差一个」比算完整距离便宜得多:错的字数一到第二个就直接出局。
 *
 * 颠倒要算进来:`sqaut` / `squat` 这种前后手滑在键盘上最常发生,而按标准的编辑距离
 * 它是**两次**操作 —— 不认它的话,最常见的错法反而一个都接不住。
 */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0; let j = 0; let used = false;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    // 已经是第二个不同的字 —— 不「只差一个」了
    if (used) return false;
    used = true;
    if (s.length !== l.length) { j++; continue; }   // 长的那个跳过这一位(它就是多出来的字)
    if (s[i] === l[j + 1] && s[i + 1] === l[j]) { i += 2; j += 2; }  // 颠倒的一对
    else { i++; j++; }                                               // 换掉了这一位
  }
  return true;
}

/**
 * 一个词和它像不像,**多像**。`0` = 整个词就差一个字(最像),`1` = 词里有一截差一个字
 * (次之),`null` = 不像。
 *
 * 为什么要分这两档:只判「像不像」的话,「sqaut」的候选里「杠铃深蹲」(整词 squat)
 * 和「半蹲跳」(词里一截 squat)一样远,排序就只能按名字长短瞎排 —— 用户看到的
 * 第一个建议不是最像的那个。分档之后整词对上的自然浮上来。
 *
 * 片段也要认:打错的常常是长名字里的一截(「平板支掌」错在「平板支撑」的后两字上)。
 * 三种长度都要试:换字(等长)、多一个字、少一个字。
 */
function nearQuality(word: string, token: string): number | null {
  if (oneEditApart(token, word)) return 0;
  const L = token.length;
  for (let i = 0; i < word.length; i++) {
    for (const len of [L - 1, L, L + 1]) {
      if (len > 0 && oneEditApart(token, word.slice(i, i + len))) return 1;
    }
  }
  return null;
}

/**
 * 够这个长度的词才允许「差一个字」,短的必须原样命中。
 * 两个字的中文词不许差:一个字之差在两字词里就是换掉一半 —— 「背肌」和「腹肌」只差一个字,
 * 可它们是两个地方。中文的二字词靠上面的口语表,不靠这条。
 */
const MIN_FUZZY = 3;

/**
 * 这几条是**最像**那个查询的,一个都没有就是空数组。
 *
 * 判据和 `matchesQuery` 同形:每个词都要命中,只不过长词(≥ `MIN_FUZZY`)可以差一个字。
 * 短词照样**精确**判 —— 搜「哑铃 sqaut」时「哑铃」不是打错的,它得原样命中,
 * 整句才谈得上「最像哑铃深蹲的那个」。
 *
 * 排序:`nearQuality` 的分越低越像(整词对上的排在「词里一截对上」的前面),
 * 同分按名字短的在前 —— 短名字通常就是那个本体(「深蹲」而不是「杠铃深蹲(窄站距)」);
 * 再同就按 id,保证同一份数据两次打开给出同一批、同一个顺序。
 */
export function nearMatches(entries: ExerciseEntry[], query: string, limit = 3): ExerciseEntry[] {
  const tokens = tokensOf(query);
  if (!tokens.length) return [];
  const out: Array<{ e: ExerciseEntry; score: number }> = [];
  for (const e of entries) {
    const words = searchWords(e);
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (t.length < MIN_FUZZY) {
        // 短词照旧精确判:搜「哑铃 sqaut」时「哑铃」不是打错的,它得原样命中
        if (!hitToken(words, t)) { ok = false; break; }
        continue;
      }
      let best: number | null = null;
      for (const w of words) {
        const q = nearQuality(w, t);
        if (q !== null && (best === null || q < best)) best = q;
        if (best === 0) break;
      }
      if (best === null) { ok = false; break; }
      score += best;
    }
    if (ok) out.push({ e, score });
  }
  return out
    .sort((a, b) => (a.score - b.score)
      || (a.e.nameZh.length - b.e.nameZh.length)
      || (a.e.id < b.e.id ? -1 : 1))
    .slice(0, limit)
    .map((r) => r.e);
}
