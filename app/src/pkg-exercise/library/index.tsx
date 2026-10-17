import { useEffect, useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { ArrowDown, Search } from '@taroify/icons';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { param } from '@/utils/url-param';
import { matchesQuery, nearMatches } from '../engine/search';
import { GROUP_ZH, GROUP_ORDER, hitsGroup, type MuscleGroup } from '../engine/muscles';
import { customEntries, isCustomId } from '../engine/custom';
import ExHowTo from '../howto';
import DetailTools from '../detail';
import { loadFavs, saveFavs, sortedByFav, toggleFav, usageOf, usageText, type UsageMap } from '../engine/fav';
import { loadLogs, loadNotes, loadPlan, savePlan, type ExerciseNotes } from '../engine/store';
import {
  addConfiguredItem, addDay, dayHasExercise, renameDay,
  withProgression, withSetType, withSided, withWeight
} from '../engine/editor';
import { bestOf, type BestMap } from '../engine/history';
import { buildItem, bestPatternOf } from '../engine/generator';
import { loadKit, type Kit } from '../engine/kit';
import { loadMaxes, type MaxMap } from '../engine/max';
import ExerciseSetup, { patternName } from '../setup';
import type { PlannedExercise, TrainingPlan, WorkoutLog } from '../engine/types';
import {
  EXERCISES, BODYPART_ZH, EQUIPMENT_ZH, CATEGORY_ZH, MUSCLE_ZH,
  LEVEL_ZH, type ExerciseEntry
} from '../data/exercises';
import './index.scss';
import { navigate } from '@/utils/nav';
import { onIf } from '@/utils/taro-events';

/** 深链友好别名(工具箱入口用短参数) */
const EQ_ALIAS: Record<string, string> = { body: 'body weight', bodyweight: 'body weight', kb: 'kettlebell' };

/** 中文映射查表 — 数据里的 key 是 string,各 ZH 表是窄字面量联合,统一在这里收口,查不到回退原值 */
const zh = (map: Record<string, string>, key: string): string => map[key] ?? key;

const BODYPART_ORDER = Object.keys(BODYPART_ZH);
const EQUIPMENT_ORDER = Object.keys(EQUIPMENT_ZH);
const CATEGORY_ORDER = Object.keys(CATEGORY_ZH);
const GROUP_PREVIEW = 6;   // 浏览模式下每组预览条数
/**
 * 筛选/搜索模式下一屏铺多少条、最多铺到多少条 —— 都是**小程序节点数**的账。
 * 一次全铺:搜「胸」有 262 条、搜「腿」352 条,一屏几千个节点渲染起来会卡(这是原来硬截 80 的原因)。
 * 一次铺 80 条 + 一个「加载更多」:第一步看到的东西和以前一模一样,想看下去的人自己往下点。
 *
 * 但**上限还是要有**:铺到 240 条(三次)就停,剩下的劝他去筛。这不是省节点,是那件事本身:
 * 四百条一屏翻到底的人找不到东西,他要的那个动作在他翻到之前的一百条里就出现过了 ——
 * 与其让他翻,不如让他加一个器械或部位。
 */
const PAGE_STEP = 80;
const PAGE_MAX = 240;

/**
 * 动作库 — 部位/器械/分类三维筛选 + 中英搜索 + 动作步骤详情。
 * 数据在分包内(../data/exercises),主包只经 exercise-meta 拿计数。
 */
export default function ExerciseLibrary() {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  /* 三个参数都过 `param()` 解一次码 —— 深链是从别处(工具箱、ex-new 返回)拼过来的,
     中文/带空格的部位值一定会被编码,而 Taro 的 router params 不会自动解。
     eq 还多一层短别名(body → 'body weight'),别名要在**解码之后**查。 */
  const initEq = (() => {
    const raw = param(params.eq);
    return raw ? (EQ_ALIAS[raw] ?? raw) : '';
  })();
  const [bp, setBp] = useState(param(params.bp));
  /**
   * 七大肌群(`?mg=back`)—— 入口只有一个:肌群页点开某个部位时那条「练得到它的动作」。
   *
   * 它和筛选栏里的「部位」**不是同一个筛子**,所以没有并进同一格:部位是动作库自己的十档
   * (上臂/前臂、大腿/小腿各算一档,还有颈部和有氧),肌群是统计页那七个大组
   * (小臂的动作也归手臂、大腿和小腿分属臀腿与小腿)—— 也就是「这周背练得偏少」那个「背」。
   * 两个入口并排放,用户会以为其中一个是多余的;并进一格,又等于把两套标准搅成一套。
   * 所以它**没有自己的筛选入口**,只在生效时于结果上方挂一条框,**在「部位」里选任何一个值都把它清掉**
   * (两句话说的是同一件事「练哪儿」,同时生效只会互相矛盾)。
   */
  const [mg, setMg] = useState<MuscleGroup | ''>(() => {
    const raw = param(params.mg);
    return (GROUP_ORDER as string[]).includes(raw) ? (raw as MuscleGroup) : '';
  });
  const [eq, setEq] = useState(initEq);
  const [cat, setCat] = useState(param(params.cat));
  const [kw, setKw] = useState('');
  /** 哪一维筛正在展开(部位/器械/分类)—— 三排 chip 收成一条筛选栏后,选项在下面展开 */
  const [filterOpen, setFilterOpen] = useState<'' | 'bp' | 'eq' | 'cat'>('');
  const [detail, setDetail] = useState<ExerciseEntry | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  /** 常用次数来自日志(算出来,不存) */
  const [usage, setUsage] = useState<UsageMap>({});
  /**
   * 每个动作「至今最好的一组」—— 和训练页那一行「最好 65kg×6」是同一个数(engine/history 的
   * `bestOf`),所以一个人在做的时候看到的和在这儿挑的时候看到的不会打架。
   *
   * 一屏二十来行、每行都要拿自己的那一句,所以**一批日志算一次**再按 id 取,
   * 不是二十次各扫一遍日志。
   */
  const [best, setBest] = useState<BestMap>({});
  /** 详情里的「上次/最好」、配片和 1RM 也要用日志 —— 和上面两个数读同一份 */
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  /** 我建的动作(自定义)—— 建/改完回到这一页要立刻变(useDidShow 里重读) */
  const [mine, setMine] = useState<ExerciseEntry[]>([]);
  const [mineExOnly, setMineExOnly] = useState(false);
  /** 动作常驻备注(按动作 id)—— 详情弹层里显示自定义动作的备注 */
  const [notes, setNotes] = useState<ExerciseNotes>({});
  /** 详情弹层下面的那一块翻到「加到哪一天」了没有 —— false 时是常规的编辑/收藏/记录那几行 */
  const [pickDay, setPickDay] = useState(false);
  /** 计划在这一刻现读的副本(点「加入计划」时才读,见 openAdd) */
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  /**
   * 「加入计划」的第二步:参数草稿。`dayKey === null` 表示**新建一个训练日**,
   * 这时 dayTitle 是用户给新训练日起的名字。确认之前不落盘(见 confirmAdd)。
   */
  const [setup, setSetup] = useState<{
    dayKey: string | null; dayTitle: string; item: PlannedExercise;
  } | null>(null);
  /** 参数面板要用的力量和器材口径(和计划编辑器同一份) */
  const [maxes, setMaxes] = useState<MaxMap>({});
  const [kit, setKit] = useState<Kit>({});

  useEffect(() => { track('exercise_lib_view', 'other'); }, []);
  // 从「我的器材」改完勾选回到这一页要立刻生效;收藏与常用同理(练完一次回来就该变)
  useDidShow(() => {
    setFavs(loadFavs());
    // 日志读一次、两个数都从这一份里算:它俩本来就是同一批日志的两种数法,
    // 分两次读也只是多解一遍 storage
    const logs = loadLogs();
    setLogs(logs);
    setUsage(usageOf(logs));
    setBest(bestOf(logs));
    setMine(customEntries());
    setNotes(loadNotes());
  });

  const kwTrim = kw.trim();
  const favCount = favs.length;
  const mineExCount = mine.length;
  // 收藏被取消光之后,「只看收藏」这个开关必须跟着失效 —— 否则它会悄悄继续筛,
  // 而开关自己已经藏起来了(下面只在有收藏时才显示),用户就找不到关它的地方
  const favFilter = favOnly && favCount > 0;
  const mineExFilter = mineExOnly && mineExCount > 0;
  const filtering = Boolean(
    bp || mg || eq || cat || kwTrim || favFilter || mineExFilter
  );

  /** 点「部位」= 换一套说法,顺手把肌群那个筛子摘掉(否则两个筛子叠着,结果会空得没道理) */
  const pickBp = (k: string) => {
    if (mg) setMg('');
    setBp(k);
  };
  /** 清掉全部筛选(空结果和结果栏那两个「重置」用;收藏/我建的开关也算筛选) */
  const resetAll = () => {
    setBp(''); setMg(''); setEq(''); setCat(''); setKw('');
    setFavOnly(false); setMineExOnly(false); setFilterOpen('');
  };

  /**
   * 三维筛选共用一条栏:点开的这一维在下面铺全部选项,选完就收起。
   * 三排常驻 chip 每排都会被屏幕右边切掉一个,还占掉近三分之一首屏 —— 该收。
   */
  const pickFilter = (dim: 'bp' | 'eq' | 'cat', value: string) => {
    if (dim === 'bp') pickBp(value);
    else if (dim === 'eq') setEq(value);
    else setCat(value);
    setFilterOpen('');
  };
  const FILTERS: Array<{
    key: 'bp' | 'eq' | 'cat'; label: string; value: string;
    map: Record<string, string>; order: string[];
  }> = [
    { key: 'bp', label: '部位', value: bp, map: BODYPART_ZH, order: BODYPART_ORDER },
    { key: 'eq', label: '器械', value: eq, map: EQUIPMENT_ZH, order: EQUIPMENT_ORDER },
    { key: 'cat', label: '分类', value: cat, map: CATEGORY_ZH, order: CATEGORY_ORDER }
  ];
  const openFilter = FILTERS.find((f) => f.key === filterOpen);

  /** 能挑的**全体** —— 我建的动作在最前面(挑得到自己的东西比挑得到第 100 个变式重要) */
  const all = useMemo(() => [...mine, ...EXERCISES], [mine]);

  /** 收藏的那几个,也是「按练过的次数」排 —— 同样是收藏,常练的当然放前面 */
  const favList = useMemo(
    () => sortedByFav(all.filter((e) => favs.includes(e.id)), favs, usage),
    [all, favs, usage]
  );

  const filtered = useMemo(() => {
    const list = all.filter((e) =>
      (!bp || e.bodyPart === bp)
      // 协同肌也算(和统计同一套判据,见 engine/muscles.hitsGroup)
      && (!mg || hitsGroup(e.id, mg))
      && (!eq || e.equipment === eq)
      // 自定义动作没有「分类」(那是动作库那套编排属性),按分类筛时它自然不在
      && (!cat || e.category === cat)
      && matchesQuery(e, kwTrim)
      && (!favFilter || favs.includes(e.id))
      && (!mineExFilter || isCustomId(e.id))
    );
    // 收藏的和常练的排前面 —— 筛选/搜索出来的是一长条平铺列表,这里才排得动
    return sortedByFav(list, favs, usage);
  }, [all, bp, mg, eq, cat, kwTrim, favFilter, favs, usage, mineExFilter]);

  /**
   * 「已经展开到第几屏」和**它属于哪一组筛选条件**放在一起。
   *
   * 不这么放就会出两种错:①把屏幕数单独存一个 `useState`、换筛子时忘了收回来 ——
   * 从「胸」切到「背」还停在第 240 条,用户看到的是「背的动作怎么这么多」;
   * ②换筛子时专门清一下(`useEffect` 或渲染里 `setState`)—— 那一帧要么闪一下整列表,
   * 要么白多一次渲染。写成「状态自带作用域」就没这两种错:对不上就是新的一组,自然从第一屏起。
   *
   * 签名里**不含收藏和常用次数**:点某行的 ☆ 会把它顶到最前面(顺序本来就会变),
   * 但那不该把用户刚展开的两屏收回去。
   */
  const filterKey = [
    bp, mg, eq, cat, kwTrim,
    favFilter ? '1' : '', mineExFilter ? '1' : ''
  ].join('|');
  const [more, setMore] = useState({ key: '', n: PAGE_STEP });
  const shown = more.key === filterKey ? more.n : PAGE_STEP;
  const rest = filtered.length - shown;

  /**
   * 差一个字的兜底 —— **只在一条都没搜到时**才跑(它的代价是每个动作都要比一遍),
   * 而且**只作为「这几个最像」摆出来**,不去替换结果列表。
   *
   * 为什么不直接把它当结果:打错一个字得到一批看起来很对的动作,用户不会知道那是猜的,
   * 他会以为库里真有这么个动作 —— 而「猜」和「有」的差别,正是他相不相信这个框的全部。
   * 兜底那份**不看别的筛子**(部位/器械那些):搜「深蹲」而部位筛在「胸」上时,
   * 最该出现的就是那句「你要找的深蹲在这儿」。
   */
  const nearList = useMemo(
    () => (kwTrim && !filtered.length ? nearMatches(all, kwTrim) : []),
    [kwTrim, filtered.length, all]
  );

  const toggleStar = (e: ExerciseEntry) => {
    track('exercise_star', 'other');
    const next = toggleFav(favs, e.id);
    saveFavs(next);
    setFavs(next);
  };

  const open = (e: ExerciseEntry) => {
    track('exercise_lib_detail', 'other');
    setDetail(e);
    setPickDay(false);
    setSetup(null);
  };

  /**
   * 行尾那个「＋ 计划」—— 直接落到「加到哪一天」那一屏,不先展示整套说明。
   *
   * 和 open() 是两条路:open 是「我想看看这个动作怎么做」,这个是「我已经知道它了,
   * 把它排进去」。两者都从详情弹层收尾(同一个 addToDay),但**起点不同** ——
   * 从列表点 ＋ 的人,不该先被动作步骤挡一屏。
   */
  const openPlan = (e: ExerciseEntry) => {
    track('exercise_add_plan', 'other');
    setDetail(e);
    setSetup(null);
    openPick();
  };

  /** 建/改自定义动作。带上当前筛的部位和搜索词:从「胸」那一组点进去就该预选胸,
     搜了「推胸机」没搜到 —— 那个词就是他要建的名字(空手进表单还得再打一遍) */
  const goNew = (preName = '') => {
    track('custom_ex_new', 'other');
    const q = [`bp=${encodeURIComponent(bp)}`, preName ? `name=${encodeURIComponent(preName)}` : '']
      .filter(Boolean).join('&');
    navigate(`/pkg-exercise/ex-new/index?${q}`);
  };
  const goEdit = (id: string) => navigate(`/pkg-exercise/ex-new/index?id=${id}`);
  const close = () => { setDetail(null); setPickDay(false); setSetup(null); };

  /**
   * 打开「加到哪天」那一屏 —— **现读**一份计划,不挂在 useDidShow 上跟别的状态一起读:
   * 用户完全可能先在计划页删了一天/改了个名,再回到动作库点进来,挂在页面上的旧快照
   * 会把一个已经不存在的训练日列出来。这份只用来**显示**,真正加的那一刻还要再读一次
   * (见 confirmAdd,那里才是决定的地方)。
   */
  const openPick = () => {
    setPlan(loadPlan());
    setMaxes(loadMaxes());
    setKit(loadKit());
    setPickDay(true);
  };

  /**
   * 「加入计划」—— 打开这一屏时**现读**一份计划,不挂在 useDidShow 上跟别的状态一起读。
   * 这份只用来显示;真正加的那一刻还要再读一次(见 confirmAdd)。
   */
  const openAdd = () => {
    track('exercise_add_plan', 'other');
    setSetup(null);
    openPick();
  };

  /**
   * 选好训练日之后的**第二步**:先把动作装进一份可改的草稿,让用户把组数、次数、
   * 重量、热身、休息、组型、渐进、备注都定下来,再写进计划。
   *
   * 以前这里点一下就直接按生成器默认值落盘,用户要改只能再去计划编辑器里翻到它 ——
   * 而「加到计划」这一刻正是他脑子里有具体安排的时候。默认值仍来自 `buildItem`,
   * 所以没动过的格子与计划编辑器里「＋添加动作」加出来的逐格一致。
   *
   * `dayKey === null` = 新建一个训练日(名字先放在 `dayTitle` 里,确认时才落盘)。
   */
  const startSetup = (dayKey: string | null, dayTitle: string) => {
    if (!detail) return;
    const fresh = loadPlan();
    if (!fresh) {
      close();
      Taro.showToast({ title: '还没有计划,先去生成一份', icon: 'none' });
      return;
    }
    if (dayKey != null) {
      const di = fresh.days.findIndex((d) => d.key === dayKey);
      if (di < 0) {
        close();
        Taro.showToast({ title: '计划变了,回去看一眼再试', icon: 'none' });
        return;
      }
      // 列表上那个「已在」是打开这一屏时算的;按它判断可能已经过了一分钟
      if (dayHasExercise(fresh, di, detail.id)) {
        close();
        Taro.showToast({ title: `「${dayTitle}」里已经有它了`, icon: 'none' });
        return;
      }
    }
    const item = buildItem(bestPatternOf(detail.id, fresh.level), detail, fresh.goal, fresh.level);
    setSetup({ dayKey, dayTitle, item });
  };

  /** 参数草稿的四种改动 —— 合法性规则全部走 engine/editor 的纯变换,不在这里重写 */
  const patchSetup = (patch: Partial<PlannedExercise>) =>
    setSetup((s) => (s ? { ...s, item: { ...s.item, ...patch } } : s));
  const setupWeight = (w: number | null) =>
    setSetup((s) => (s ? { ...s, item: withWeight(s.item, w) } : s));
  const setupSided = (on: boolean) =>
    setSetup((s) => (s ? { ...s, item: withSided(s.item, on) } : s));
  const setupSetType = (t: Parameters<typeof withSetType>[1]) =>
    setSetup((s) => (s ? { ...s, item: withSetType(s.item, t) } : s));
  const setupProgression = (k: Parameters<typeof withProgression>[1]) =>
    setSetup((s) => (s ? { ...s, item: withProgression(s.item, k) } : s));

  /**
   * 确认加入。**计划在这里再读一次** —— 打开这一屏时读的那份只用来显示,
   * 用户调参数可能调了几分钟,这期间训练完成/切后台的云同步会把云端那份整份落到本机。
   * 拿旧的那份整份写回去,就是把那几分钟里别处的改动**悄悄抹掉**(见 engine/editor.ts 上那段)。
   * 认 key 不认下标,所以就算计划里换了顺序、删了别的天,加的也还是他点的那一天。
   */
  const confirmAdd = () => {
    if (!detail || !setup) return;
    const fresh = loadPlan();
    if (!fresh) {
      close();
      Taro.showToast({ title: '计划不见了,回去重新生成一份', icon: 'none' });
      return;
    }
    let next = fresh;
    let key = setup.dayKey;
    let title = setup.dayTitle;
    if (key == null) {
      // 新训练日:先建出来(标题留空就用 addDay 的默认「自主训练 N」)
      next = addDay(next);
      const di = next.days.length - 1;
      if (setup.dayTitle.trim()) {
        next = renameDay(next, di, setup.dayTitle.trim());
        title = next.days[di].title;
      } else {
        title = next.days[di].title;
      }
      key = next.days[di].key;
    } else {
      const di = next.days.findIndex((d) => d.key === key);
      if (di < 0) {
        close();
        Taro.showToast({ title: '计划变了,回去看一眼再试', icon: 'none' });
        return;
      }
      if (dayHasExercise(next, di, detail.id)) {
        close();
        Taro.showToast({ title: `「${title}」里已经有它了`, icon: 'none' });
        return;
      }
    }
    const withItem = addConfiguredItem(next, key, detail, setup.item);
    if (withItem === next) {
      close();
      Taro.showToast({ title: '没能加进去,计划可能变了,回去看一眼', icon: 'none' });
      return;
    }
    savePlan(withItem);
    track('exercise_add_plan_done', 'other');
    close();
    // 说清加到哪儿了 —— 动作库和计划页不在一处,一句「已加入」用户回去找不着
    Taro.showToast({ title: `已加到「${title}」`, icon: 'none' });
  };
  const eqName = (e: ExerciseEntry) => zh(EQUIPMENT_ZH, e.equipment);
  const muName = (k: string) => zh(MUSCLE_ZH, k);

  const row = (e: ExerciseEntry) => {
    const fav = favs.includes(e.id);
    const use = usageText(usage[e.id]);
    // 「练过 12 次」说的是你和它打过多少交道,「最好 65kg×6」说的才是你练到什么程度。
    // 只有前者的话,翻动作库和翻商品目录没区别 —— 挑了半天的那个动作,你不知道自己
    // 现在能做到什么份上(那个数原来只在训练页和历史里,偏偏挑的时候看不到)
    const bestText = best[e.id];
    return (
      <View className="ex-row" key={e.id} onClick={() => open(e)}>
        <View className="ex-row-body">
          <View className="ex-row-main">
            <Text className="ex-name">{e.nameZh}</Text>
            {/* 我建的动作要一眼看得出来 —— 它在列表里排在最前面,别的动作都不在那儿 */}
            {isCustomId(e.id) && <Text className="ex-tag ex-tag-mine">我建的</Text>}
            {/* 发力/结构这两枚标签每一行都有,只让名字那一行变碎;它们仍然在详情里,
                列表只留「难度」这一个真正能区分动作的标记 */}
            {e.level && <Text className="ex-tag ex-tag-lv">{zh(LEVEL_ZH, e.level)}</Text>}
          </View>
          <Text className="ex-row-sub">
            {eqName(e)} · {muName(e.target)}{use ? ` · ${use}` : ''}{bestText ? ` · 最好 ${bestText}` : ''}
          </Text>
        </View>
        {/* 直接排进计划:已经知道这个动作的人,不该为了加进计划先读一遍动作步骤。
            放在星标左边 —— 星标是「留着以后看」,＋ 是「现在就排」,后者更常按 */}
        <Text
          className="ex-plan"
          onClick={(ev) => { ev.stopPropagation(); openPlan(e); }}
        >
          ＋ 计划
        </Text>
        {/* 星标在行尾且要吃下这次点击 —— 不然收藏一下顺手就把详情弹层打开了 */}
        <Text
          className={`ex-star${fav ? ' is-on' : ''}`}
          onClick={(ev) => { ev.stopPropagation(); toggleStar(e); }}
        >
          {fav ? '★' : '☆'}
        </Text>
      </View>
    );
  };

  return <Screen className="exlib-page">
    {/* 搜索 + 一条筛选栏。
        占位符只留「能搜什么」:以前把「共 1524 个,中英文」也塞进去,搜索框被「按肌肉看」
        挤窄之后那句话一定被右边切掉 —— 讲不清一件事,还显得框是坏的。
        现在这句连 320 宽的老机器也放得下;中英文都能搜仍然成立,只是不必挤在框里说。 */}
    <View className="ex-search-row">
      <View className="ex-search">
        <View className="ex-search-ico"><Search size={16} color="#94a3b8" /></View>
        <Input
          className="ex-search-input"
          value={kw}
          placeholder="搜动作、部位、器械"
          placeholderClass="ex-search-ph"
          confirmType="search"
          onInput={(ev) => setKw(ev.detail.value)}
        />
        {kwTrim && (
          <View className="ex-search-clear" onClick={() => setKw('')}>
            <Text>✕</Text>
          </View>
        )}
      </View>
      {/* 「按肌肉看」—— 挑动作的第二个起点:不是「我叫什么名字」,是「我想练哪儿」。
          入口摆在这里(搜索框右边),因为它是和搜索并列的一种找法,不是列表里的一个筛子 */}
      <Text className="ex-muscle" onClick={() => navigate('/pkg-exercise/muscles/index')}>
        按肌肉看
      </Text>
    </View>

    {/* 部位 / 器械 / 分类收成同一条栏:点开哪一维,选项就在它下面铺开。
        原来三排常驻 chip 每排都被屏幕右边切掉半个,还吃掉小半屏 —— 用户先看到的是
        「一排排还没显示完的按钮」,不是动作。 */}
    <View className="ex-filterbar">
      {FILTERS.map((f) => {
        const on = !!f.value;
        const open = filterOpen === f.key;
        return (
          <View
            key={f.key}
            className={`ex-filter${on ? ' is-on' : ''}${open ? ' is-open' : ''}`}
            onClick={() => setFilterOpen(open ? '' : f.key)}
          >
            {/* 没选时写「全部部位」,选了就直接写「胸」—— 三个格子位置固定,
                用户知道哪个格子管哪一维;挤进「部位 全部」反而放不下「上肢功率车」这种长值 */}
            <Text className="ex-filter-v">{on ? zh(f.map, f.value) : `全部${f.label}`}</Text>
            <View className={`ex-filter-caret${open ? ' is-open' : ''}`}>
              <ArrowDown size={12} color={on || open ? '#059669' : '#94a3b8'} />
            </View>
          </View>
        );
      })}
    </View>

    {openFilter && (
      <View className="ex-filter-panel">
        <View className="ex-filter-panel-head">
          <Text className="ex-filter-panel-t">按{openFilter.label}筛选</Text>
          {/* 同一个位置两种作用:选了东西时清掉这一维,没选时收起面板 —— 不选也得有路退 */}
          <Text
            className="ex-filter-panel-reset"
            onClick={() => {
              if (openFilter.value) pickFilter(openFilter.key, '');
              else setFilterOpen('');
            }}
          >
            {openFilter.value ? '清除这一项' : '收起'}
          </Text>
        </View>
        <View className="ex-filter-opts">
          <Text
            className={`ex-opt${!openFilter.value ? ' on' : ''}`}
            onClick={() => pickFilter(openFilter.key, '')}
          >全部</Text>
          {openFilter.order.map((k) => (
            <Text
              key={k}
              className={`ex-opt${openFilter.value === k ? ' on' : ''}`}
              onClick={() => pickFilter(openFilter.key, k)}
            >{zh(openFilter.map, k)}</Text>
          ))}
        </View>
      </View>
    )}

    {/* 从肌群页过来的肌群筛子 —— 没有自己的 chip 排(理由见上面 mg 的注释),只摆一条可关掉的框 */}
    {mg && (
      <View className="ex-msggroup">
        <Text className="ex-msggroup-t">只看练得到「{GROUP_ZH[mg]}」的动作</Text>
        <View className="ex-msggroup-x" onClick={() => setMg('')}><Text>✕</Text></View>
      </View>
    )}

    {/* 收藏 / 我建的动作这两个筛子。
        「只看我有的器材」那一格已经拿掉了:这一页是**挑动作**的地方,器材是「怎么配重量」,
        不是一种挑法 —— 筛选栏的「器械」本来就能按器械筛。器材登记还在(我的 → 我的器材),
        它服务的是配片和生成计划,不该在这页冒充一个筛子。 */}
    {(favCount > 0 || mineExCount > 0) && (
      <View className="ex-mine-row">
        {/* 收藏同理:一个还没收藏过的人看到这个开关只会困惑「收藏在哪」 */}
        {favCount > 0 && (
          <Text className={`ex-toggle${favOnly ? ' active' : ''}`} onClick={() => setFavOnly((v) => !v)}>
            ★ 只看收藏({favCount})
          </Text>
        )}
        {/* 我建的动作:一个都没有时不摆开关 —— 「建一个」的入口在列表第一行,不必在这儿再说一遍 */}
        {mineExCount > 0 && (
          <Text className={`ex-toggle${mineExOnly ? ' active' : ''}`} onClick={() => setMineExOnly((v) => !v)}>
            ✎ 只看我建的({mineExCount})
          </Text>
        )}
      </View>
    )}

    {/* 自己设计一个动作 —— 排在列表最前面,不是藏在筛选行下面。
        「库里没有」这件事,人是翻着列表才想起来的;等翻到底再去找入口,那个念头已经凉了。
        带搜索词时把词直接当名字带过去(「推胸机」搜不到 → 点这里就预填好了)。
        但**找人/筛东西的时候不摆**:那一刻用户要看的是结果;没找到时,空态里还有一次入口。 */}
    {!filtering && (
      <View className="ex-create" onClick={() => goNew(kwTrim)}>
        <View className="ex-create-icon"><Text className="ex-create-plus">＋</Text></View>
        <View className="ex-create-copy">
          <Text className="ex-create-t">自己设计一个动作</Text>
          <Text className="ex-create-s">起个名字、选部位和肌群,以后一样能排进计划</Text>
        </View>
        <Text className="ex-create-go">›</Text>
      </View>
    )}

    {/* 我建的动作 —— 排在最上面:自己建的就是为了常用,不该夹在 1324 条里翻 */}
    {!filtering && mineExCount > 0 && (
      <View className="card ex-groups">
        <View className="ex-group">
          <View className="ex-group-head">
            <View className="ex-group-name">
              <View className="ex-group-mark" />
              <Text className="ex-group-title">我建的动作</Text>
            </View>
            <Text className="ex-group-count">{mineExCount} 个</Text>
          </View>
          {mine.map(row)}
        </View>
      </View>
    )}

    {/* 我的收藏 —— 常练的那几个不用每次在部位分组里再翻一遍 */}
    {!filtering && favCount > 0 && (
      <View className="card ex-groups">
        <View className="ex-group">
          <View className="ex-group-head">
            <View className="ex-group-name">
              <View className="ex-group-mark ex-group-mark--fav" />
              <Text className="ex-group-title">我的收藏</Text>
            </View>
            <Text className="ex-group-count">{favCount} 个动作</Text>
          </View>
          {favList.slice(0, GROUP_PREVIEW).map(row)}
          {favCount > GROUP_PREVIEW && (
            <Text className="ex-group-more" onClick={() => setFavOnly(true)}>
              查看全部 {favCount} 个收藏 ›
            </Text>
          )}
        </View>
      </View>
    )}

    {!filtering && favCount === 0 && (
      <Text className="ex-fav-tip">
        点右侧的 ☆ 收藏,常练的动作会排到最上面
      </Text>
    )}

    {!filtering && <View className="card ex-groups">
      {BODYPART_ORDER.map((k) => {
        const list = EXERCISES.filter((e) => e.bodyPart === k);
        if (!list.length) return null;
        return <View className="ex-group" key={k}>
          <View className="ex-group-head">
            <View className="ex-group-name">
              <View className="ex-group-mark" />
              <Text className="ex-group-title">{zh(BODYPART_ZH, k)}</Text>
            </View>
            <Text className="ex-group-count">{list.length} 个动作</Text>
          </View>
          {list.slice(0, GROUP_PREVIEW).map(row)}
          {list.length > GROUP_PREVIEW && (
            <Text className="ex-group-more" onClick={() => setBp(k)}>
              查看全部 {list.length} 个 ›
            </Text>
          )}
        </View>;
      })}
    </View>}

    {filtering && <View className="card">
      <View className="ex-result-head">
        <View className="ex-result-copy">
          <Text className="ex-result-t">{kwTrim ? `「${kwTrim}」的结果` : '筛选结果'}</Text>
          <Text className="ex-result-n">{filtered.length} 个动作</Text>
        </View>
        <Text className="ex-result-reset" onClick={resetAll}>重置</Text>
      </View>
      {filtered.slice(0, shown).map(row)}
      {/* 后面还有 → 给一个「加载更多」而不是一句「仅显示前 80 个」。铺到上限还嫌多的话,
          那就不是翻能解决的事(见 PAGE_MAX 那段),这时候才把话换回「去筛」 */}
      {/* 「还能翻」和「翻到头了」合成**同一个** Text:两个分支同标签、一个有 onClick 一个没有,
          React 会当成同一个节点改 props,翻到上限那一刻 onClick 被摘掉 ——
          那一步会让整棵子树崩掉(见 utils/taro-events)。
          差别只在 className 和那句文案上,能不能点写在函数体里。 */}
      {rest > 0 && (
        <Text
          className={shown < PAGE_MAX ? 'ex-result-more ex-result-more--tap' : 'ex-result-more'}
          onClick={onIf(shown < PAGE_MAX, () => setMore({ key: filterKey, n: Math.min(shown + PAGE_STEP, PAGE_MAX) }))}
        >
          {shown < PAGE_MAX
            ? `还有 ${rest} 个,加载更多 ›`
            : `还有 ${rest} 个没显示,加个器械或部位筛得更快`}
        </Text>
      )}
      {!filtered.length && (
        <View className="ex-empty">
          <Text className="ex-empty-emoji">🏋️</Text>
          <Text className="ex-empty-text">
            {nearList.length
              ? `「${kwTrim}」一个都没对上。这几个最像:`
              : '没有匹配的动作,换个关键词或放宽筛选试试'}
          </Text>
          {/* 差一个字的几个 —— 摆在「重置/自己建」上面:一眼看得出是它的话,点开就完事了,
              用不着去重置或者建一个新的 */}
          {nearList.length > 0 && <View className="ex-near">{nearList.map(row)}</View>}
          <View className="ex-empty-ops">
            <Text className="ex-empty-reset" onClick={resetAll}>重置筛选</Text>
            {/* 搜不到的时候就是「库里没有」最该被接住的地方 —— 搜的那个词直接当名字带过去 */}
            {!!kwTrim && (
              <Text className="ex-empty-create" onClick={() => goNew(kwTrim)}>
                把「{kwTrim}」建成我的动作 ›
              </Text>
            )}
          </View>
        </View>
      )}
    </View>}

    {/* 动作详情弹层(fixed 样式在页面类作用域外,见 recipes 先例) */}
    {detail && <>
      <View className="exlib-mask" onClick={close} catchMove />
      <View className="exlib-sheet" catchMove>
        <View className="exlib-grab" />
        {setup ? <>
          {/* 第二步:先把这一项的参数定下来再加进去。标题里写清加到哪里,
              免得一路翻设置项翻到最后忘了自己在给哪一天加 */}
          <View className="exlib-sheet-head">
            <View className="exlib-sheet-title">
              <Text className="exlib-sheet-name">{detail.nameZh}</Text>
              <Text className="exlib-sheet-en fs-mini text-secondary">
                {setup.dayKey == null ? '新建训练日' : `加到「${setup.dayTitle}」`}
                {patternName(setup.item) ? ` · ${patternName(setup.item)}` : ''}
              </Text>
            </View>
            <Text className="exlib-sheet-close" onClick={() => setSetup(null)}>‹</Text>
          </View>

          {/* 新建训练日才要起名。留空就用计划页那套默认名(自主训练 N) */}
          {setup.dayKey == null && (
            <View className="exlib-setup-name">
              <Text className="set-k">训练日名字</Text>
              <Input
                className="set-input"
                value={setup.dayTitle}
                maxlength={12}
                placeholder="例如「上肢 A」「腿日」,留空也行"
                onInput={(ev) => setSetup((s) => (s ? { ...s, dayTitle: ev.detail.value } : s))}
              />
            </View>
          )}

          <ExerciseSetup
            item={setup.item}
            ex={detail}
            kit={kit}
            maxes={maxes}
            canSuperset={false}
            onPatch={patchSetup}
            onWeight={setupWeight}
            onSided={setupSided}
            onSetType={setupSetType}
            onProgression={setupProgression}
          />

          {/* 确认条吸在弹层底部:这面板比别处长得多,不吸底的话「加入」会被滚出屏幕 */}
          <View className="exlib-setup-ops">
            <Text className="exlib-setup-btn" onClick={() => setSetup(null)}>返回</Text>
            <Text className="exlib-setup-btn exlib-setup-btn--ok" onClick={confirmAdd}>
              加到「{setup.dayTitle.trim() || (setup.dayKey == null ? '新训练日' : setup.dayTitle)}」
            </Text>
          </View>
        </> : <>
          <View className="exlib-sheet-head">
            <View className="exlib-sheet-title">
              <Text className="exlib-sheet-name">{detail.nameZh}</Text>
              {/* 自定义动作没有英文原名那一行(名字就是用户自己起的) */}
              {!!detail.name && <Text className="exlib-sheet-en fs-mini text-secondary">{detail.name}</Text>}
            </View>
            <Text className="exlib-sheet-close" onClick={close}>✕</Text>
          </View>
          {/* 部位/器械/肌群/步骤是**和训练页速查栏同一份东西** —— 那一块在 howto/HowTo.tsx,
              两处各写一遍的下场是「两处教的不一样」。
              备注只给自定义动作显示:库里的动作本来就有步骤,再挂一行备注会喧宾夺主;
              自定义动作没有步骤,那条备注就是它唯一的「怎么做」(见 custom.ts 模块头) */}
          <ExHowTo ex={detail} note={isCustomId(detail.id) ? notes[detail.id] : undefined} />
          <DetailTools ex={detail} logs={logs} />

          {/* 下面这一块有两种样子:常规的几行入口,和「加到哪一天」。
              在这一屏里翻页而不是再叠一个弹层 —— 弹层套弹层的关闭语义(mask 点一下关哪层、
              返回键关哪层)在微信里最容易出错,而这里要的就是「选一天」这一件事 */}
          {pickDay ? <>
            <View className="exlib-pick-head">
              <Text className="exlib-pick-back" onClick={() => setPickDay(false)}>‹ 返回</Text>
              <Text className="fs-h1">加到哪一天?</Text>
            </View>

            {/* 没有计划 —— 唯一的死胡同,给一条出路(不给「加入计划」按钮)。
                有计划但没有训练日不算死胡同:下面就能就地新建一天 */}
            {!plan ? (
              <View className="exlib-pick-empty">
                <Text className="fs-mini text-secondary">
                  你还没有训练计划,先有一份计划,才有地方放这个动作。
                </Text>
                <Text
                  className="exlib-mine"
                  onClick={() => { close(); navigate('/pkg-exercise/plan-create/index'); }}
                >
                  去生成一份计划 ›
                </Text>
              </View>
            ) : (
              <>
                {plan.days.map((d, di) => {
                  // 「那天已经有它了」要拦一下:同一个动作排进同一天两遍,九成是手滑,
                  // 而它进去之后在训练页就是多做两组,用户不会立刻发现
                  const has = dayHasExercise(plan, di, detail.id);
                  return (
                    <View
                      key={d.key}
                      className={`exlib-day${has ? ' is-has' : ''}`}
                      onClick={() => { if (!has) startSetup(d.key, d.title); }}
                    >
                      <View className="exlib-day-main">
                        <Text className="exlib-day-title">第 {di + 1} 天 · {d.title}</Text>
                        <Text className="exlib-day-sub">
                          {d.items.length ? `${d.items.length} 个动作 · 约 ${d.estMin} 分钟` : '还没有动作'}
                        </Text>
                      </View>
                      <Text className="exlib-day-tail">{has ? '已在' : '＋'}</Text>
                    </View>
                  );
                })}
                {/* 每天都已有它也还能新建一天 —— 否则用户看着一列「已在」找不到能点的地方 */}
                <View className="exlib-day exlib-day--new" onClick={() => startSetup(null, '')}>
                  <View className="exlib-day-main">
                    <Text className="exlib-day-title">＋ 新建一个训练日</Text>
                    <Text className="exlib-day-sub">给这个动作单开一天,名字下一步再定</Text>
                  </View>
                  <Text className="exlib-day-tail">＋</Text>
                </View>
              </>
            )}
          </> : <>
            <Text className="exlib-mine exlib-add-plan" onClick={openAdd}>＋ 加入我的训练计划 ›</Text>
            {isCustomId(detail.id) && (
              <Text
                className="exlib-mine exlib-edit"
                onClick={() => { const id = detail.id; setDetail(null); goEdit(id); }}
              >
                ✎ 编辑这个动作(名字、部位、肌群、备注)
              </Text>
            )}
            <Text className="exlib-mine exlib-star" onClick={() => toggleStar(detail)}>
              {favs.includes(detail.id) ? '★ 已收藏,再点取消' : '☆ 收藏这个动作'}
            </Text>
          </>}
        </>}
      </View>
    </>}
  </Screen>;
}
