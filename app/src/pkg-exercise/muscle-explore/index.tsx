import { useEffect, useMemo, useState } from 'react';
import { View, Text, Input, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import { track } from '@/services/analytics';
import { mediaUrl } from '@/services/training';
import { param } from '@/utils/url-param';
import { navigate } from '@/utils/nav';
import { matchesQuery, nearMatches } from '../engine/search';
import { demoUrl } from '../engine/ex-media';
import {
  GROUP_ORDER, GROUP_ZH, groupsOf, type MuscleGroup
} from '../engine/muscles';
import {
  EXERCISES, BODYPART_ZH, EQUIPMENT_ZH, CATEGORY_ZH, LEVEL_ZH, type ExerciseEntry
} from '../data/exercises';
import BodyMap, { type Tone } from '../muscles/BodyMap';
import './index.scss';

const PAGE_STEP = 60;

/** 词表是 `as const` 的窄类型,键来自 `Object.keys`(string),这里统一收一次口 */
const zh = (map: Record<string, string>, key: string): string => map[key] ?? key;

interface GroupExercise {
  ex: ExerciseEntry;
  /** 1 = 主动肌,0.5 = 协同肌 */
  w: number;
}

/**
 * 按肌肉看 —— 和动作库的搜索/部位筛选并列的第二种找法:
 * 不是「我记得它叫什么」,而是「我今天想练哪儿」。
 *
 * **这一页不读日志、也不读计划**:它回答的是「有哪些动作练得到背」,
 * 和「我这周练了多少」「我有没有训练计划」是两件事。参考项目(openGym 的 Explore muscles)
 * 也是这么分的 —— 原来动作库的「按肌肉看」错误地指向了统计用的「肌群与恢复」页,
 * 没有训练记录的人一进来就只剩一句「去我的训练计划」,而他要的其实只是动作。
 */
export default function MuscleExplore() {
  const initial = param(Taro.getCurrentInstance().router?.params?.mg);
  const [selected, setSelected] = useState<MuscleGroup | ''>(
    (GROUP_ORDER as string[]).includes(initial) ? (initial as MuscleGroup) : ''
  );
  const [kw, setKw] = useState('');
  const [bp, setBp] = useState('');
  const [eq, setEq] = useState('');
  const [shown, setShown] = useState(PAGE_STEP);

  useEffect(() => { track('training_muscle_explore', 'other'); }, []);

  /**
   * 一次把 1324 个动作分到七个大组里 —— 每个动作只算一次,不在渲染里反复问。
   * 判据和统计页共用 `groupsOf`:协同肌也算,所以「统计里算半组」的动作在这里一定出现。
   */
  const byGroup = useMemo(() => {
    const map = Object.fromEntries(GROUP_ORDER.map((g) => [g, [] as GroupExercise[]])) as
      Record<MuscleGroup, GroupExercise[]>;
    for (const ex of EXERCISES) {
      for (const hit of groupsOf(ex.id)) map[hit.group].push({ ex, w: hit.w });
    }
    for (const g of GROUP_ORDER) map[g].sort((a, b) => b.w - a.w || a.ex.nameZh.localeCompare(b.ex.nameZh, 'zh'));
    return map;
  }, []);

  const pick = (g: MuscleGroup) => {
    const next = g === selected ? '' : g;
    setSelected(next);
    setKw('');
    setBp('');
    setEq('');
    setShown(PAGE_STEP);
    track('training_muscle_explore_pick', 'other', { group: next || 'none' });
  };

  /** 先按搜索词缩，再从缩完的结果里给部位/器械选项 —— 搜不到的选项不该还挂在筛子里 */
  const searched = useMemo(() => {
    if (!selected) return [] as GroupExercise[];
    const q = kw.trim();
    return q ? byGroup[selected].filter((x) => matchesQuery(x.ex, q)) : byGroup[selected];
  }, [selected, kw, byGroup]);

  const bpOptions = useMemo(() => {
    const present = new Set(searched.map((x) => x.ex.bodyPart));
    return Object.keys(BODYPART_ZH).filter((k) => present.has(k));
  }, [searched]);

  // 选了部位之后，器械选项只从这一部位里出；原来选的器械不在新结果里就不拿它过滤，
  // 但用户的选择不抹掉 —— 把部位切回来，器械筛跟着回来。
  const bpOn = bpOptions.includes(bp) ? bp : '';
  const byPart = bpOn ? searched.filter((x) => x.ex.bodyPart === bpOn) : searched;

  const eqOptions = useMemo(() => {
    const present = new Set(byPart.map((x) => x.ex.equipment));
    return Object.keys(EQUIPMENT_ZH).filter((k) => present.has(k));
  }, [byPart]);

  const eqOn = eqOptions.includes(eq) ? eq : '';
  const rows = eqOn ? byPart.filter((x) => x.ex.equipment === eqOn) : byPart;
  const visible = rows.slice(0, shown);

  const fuzzy = !rows.length && kw.trim() && selected
    ? nearMatches(byGroup[selected].map((x) => x.ex), kw, 4)
    : [];

  const tone = GROUP_ORDER.reduce((m, g) => {
    m[g] = selected === g ? 'fresh' : 'none';
    return m;
  }, {} as Record<MuscleGroup, Tone>);

  const setQuery = (v: string) => {
    setKw(v);
    setShown(PAGE_STEP);
  };
  const chooseBp = (v: string) => {
    setBp(v);
    setShown(PAGE_STEP);
  };
  const chooseEq = (v: string) => {
    setEq(v);
    setShown(PAGE_STEP);
  };
  const clear = () => {
    setSelected('');
    setKw('');
    setBp('');
    setEq('');
    setShown(PAGE_STEP);
  };
  const open = (ex: ExerciseEntry) => {
    track('training_muscle_explore_to_ex', 'other', { exerciseId: ex.id });
    navigate(`/pkg-exercise/library/index?focus=${encodeURIComponent(ex.id)}`);
  };
  const addToPlan = (ex: ExerciseEntry) => {
    track('training_muscle_explore_to_plan', 'other', { exerciseId: ex.id });
    navigate(`/pkg-exercise/library/index?focus=${encodeURIComponent(ex.id)}&plan=1`);
  };

  return (
    <Screen className="me-page">
      <View className="card me-intro">
        <Text className="fs-h1">探索肌肉</Text>
        <Text className="fs-mini text-secondary">
          选择一块肌肉，查看针对该肌肉的训练动作。主动肌和协同肌都算 ——
          主要练这块的排在前面，不需要先有训练记录或计划。
        </Text>
      </View>

      <View className="card me-map">
        <View className="me-map-head">
          <Text className="fs-h1">选一个部位</Text>
          {selected && <Text className="me-clear" onClick={clear}>清除选择</Text>}
        </View>
        <View className="me-map-row">
          <BodyMap tone={tone} side="front" active={selected || null} onPick={pick} />
          <BodyMap tone={tone} side="back" active={selected || null} onPick={pick} />
        </View>
        <ScrollView scrollX className="me-scroll">
          <View className="me-chip-row">
            {GROUP_ORDER.map((g) => (
              <View
                key={g}
                className={`me-chip${selected === g ? ' is-on' : ''}`}
                onClick={() => pick(g)}
              >
                <Text className="me-chip-name">{GROUP_ZH[g]}</Text>
                <Text className="me-chip-count">{byGroup[g].length}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <Text className="fs-mini text-secondary me-tip">
          数字是练得到这个部位的动作为数（含协同肌）。点身体或上面的名字都能选。
        </Text>
      </View>

      {!selected ? (
        <View className="card me-empty">
          <Image className="me-empty-icon" src={dumbbellIcon} mode="aspectFit" />
          <Text className="fs-h1">先选一个部位</Text>
          <Text className="fs-mini text-secondary">
            比如今天想练背，点「背」，下面就会列出练得到背的动作。
          </Text>
        </View>
      ) : (
        <>
          <View className="me-head">
            <View>
              <Text className="fs-h1">练「{GROUP_ZH[selected]}」的动作</Text>
              <Text className="fs-mini text-secondary me-count">
                共 {rows.length} 个{eqOn ? `（${zh(EQUIPMENT_ZH, eqOn)}）` : ''}
              </Text>
            </View>
            <Text className="me-clear" onClick={clear}>换一个部位</Text>
          </View>

          <View className="me-search">
            <Input
              className="me-search-input"
              value={kw}
              placeholder="在结果里搜动作、器械"
              placeholderClass="me-search-ph"
              confirmType="search"
              onInput={(e) => setQuery(e.detail.value)}
            />
            {kw && <Text className="me-search-clear" onClick={() => setQuery('')}>✕</Text>}
          </View>

          {bpOptions.length > 1 && (
            <ScrollView scrollX className="me-scroll me-scroll--filters">
              <View className="me-filter-row">
                <Text className={`me-filter-chip${!bpOn ? ' is-on' : ''}`} onClick={() => chooseBp('')}>
                  全部
                </Text>
                {bpOptions.map((k) => (
                  <Text
                    key={k}
                    className={`me-filter-chip${bpOn === k ? ' is-on' : ''}`}
                    onClick={() => chooseBp(k)}
                  >
                    {zh(BODYPART_ZH, k)}
                  </Text>
                ))}
              </View>
            </ScrollView>
          )}

          {eqOptions.length > 1 && (
            <ScrollView scrollX className="me-scroll me-scroll--filters">
              <View className="me-filter-row">
                <Text
                  className={`me-filter-chip${!eqOn ? ' is-on' : ''}`}
                  onClick={() => chooseEq('')}
                >
                  全部器械
                </Text>
                {eqOptions.map((k) => (
                  <Text
                    key={k}
                    className={`me-filter-chip${eqOn === k ? ' is-on' : ''}`}
                    onClick={() => chooseEq(k)}
                  >
                    {zh(EQUIPMENT_ZH, k)}
                  </Text>
                ))}
              </View>
            </ScrollView>
          )}

          <View className="card me-list">
            {visible.map(({ ex, w }) => {
              const url = demoUrl(ex.id);
              return (
                <View className="me-row" key={ex.id} onClick={() => open(ex)}>
                  {url ? (
                    <Image
                      className="me-row-thumb"
                      src={mediaUrl(url)}
                      mode="aspectFit"
                      lazyLoad
                    />
                  ) : (
                    <View className="me-row-thumb me-row-thumb--none">
                      <Text className="me-row-thumb-t">＋</Text>
                    </View>
                  )}
                  <View className="me-row-body">
                    <View className="me-row-main">
                      <Text className="me-row-name">{ex.nameZh}</Text>
                      <Text className={`me-tag${w === 1 ? ' is-primary' : ''}`}>
                        {w === 1 ? '主要练到' : '协同练到'}
                      </Text>
                      {ex.level && <Text className="me-tag">{LEVEL_ZH[ex.level]}</Text>}
                    </View>
                    <Text className="me-row-sub">
                      {zh(EQUIPMENT_ZH, ex.equipment)}
                      {ex.category ? ` · ${zh(CATEGORY_ZH, ex.category)}` : ''}
                    </Text>
                  </View>
                  <Text
                    className="me-plan"
                    onClick={(ev) => { ev.stopPropagation(); addToPlan(ex); }}
                  >
                    ＋ 计划
                  </Text>
                </View>
              );
            })}

            {!rows.length && (
              <View className="me-none">
                <Text className="me-none-title">没搜到</Text>
                <Text className="fs-mini text-secondary">换个词，或点「全部器械」把筛子放宽</Text>
                {fuzzy.length > 0 && (
                  <View className="me-fuzzy">
                    <Text className="fs-mini text-secondary">这几个最像：</Text>
                    {fuzzy.map((ex) => (
                      <Text key={ex.id} className="me-fuzzy-chip" onClick={() => open(ex)}>
                        {ex.nameZh}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {rows.length > shown && (
              <Text className="me-more" onClick={() => setShown((n) => n + PAGE_STEP)}>
                再看 {Math.min(PAGE_STEP, rows.length - shown)} 个 ›
              </Text>
            )}
          </View>

          <Text className="fs-mini text-secondary me-foot">
            没找到合适的？动作库里还能按器械、部位和分类筛，自己建的动作也会出现在那边。
          </Text>
          <Text className="me-credit">动作演示图 © Gym visual · gymvisual.com</Text>
        </>
      )}
    </Screen>
  );
}
