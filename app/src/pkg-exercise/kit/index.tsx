import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import {
  BAR_DEFAULT_KG, DUMBBELL_PRESETS, KIT_EQUIPMENT, PLATE_SIZES, PROFILE_MAX, PROFILE_NAME_MAX,
  accessFor, addProfile, currentProfileId, kitLabel, listProfiles, loadKit, plateInv, plateText,
  plateStack, removeProfile, renameProfile, saveKit, switchProfile,
  type Kit, type KitProfile
} from '../engine/kit';
import './index.scss';

/** 杆重的快选(计算器用):常见的那几根 + 「不要杆」 */
const BAR_CHOICES: number[] = [20, 15, 10, 9, 0];

/**
 * 带输入框的 showModal(微信基础库 2.17.1+ 的 `editable` / `placeholderText`)。
 * Taro 3.6 那份类型里还没有这两个字段,而它们会被原样透传给 `wx.showModal` —— 所以在这里
 * 补一次形状,免得两个调用点各写一遍 `as any`(那样下次谁都不知道为什么要有这个 cast)。
 * 返回 `content` = 用户输的内容;没输就是空串(取值由 `cleanName` 兜底)。
 */
const promptModal = (opt: { title: string; content?: string; placeholderText?: string }): Promise<{ confirm: boolean; content?: string }> =>
  Taro.showModal({ ...opt, editable: true } as unknown as Parameters<typeof Taro.showModal>[0]) as unknown as Promise<{ confirm: boolean; content?: string }>;

const kg = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * 我的器材 — 把计划里的「60kg」翻译成「每边 25 + 5」,并让重量落在你真正有的片和铃上。
 * 三项都可留空:没登记就按标准健身房配置算,不会因为没填就把计划搞坏。
 */
export default function KitPage() {
  const [kit, setKit] = useState<Kit>({});
  const [draft, setDraft] = useState('60');     // 计算器输入(字符串,允许输一半)
  const [bar, setBar] = useState(20);           // 计算器的杆重
  /** 我存了几套、现在在用哪套(见 engine/kit.ts 的「几套器材」) */
  const [profs, setProfs] = useState<KitProfile[]>([]);
  const [cur, setCur] = useState('');

  /** 换了一套(或者刚进来)—— 页面内容与计算器的杆重都得跟着那一套走 */
  const takeCurrent = () => {
    const k = loadKit();
    setKit(k);
    setProfs(listProfiles());
    setCur(currentProfileId());
    // 计算器默认跟着他自己的杠铃杆重走(改过 15kg 就按 15 算)
    const own = k.bars?.barbell;
    setBar(own ?? BAR_DEFAULT_KG.barbell);
  };

  useEffect(() => {
    track('kit_view', 'other');
    takeCurrent();
  }, []);

  const inv = useMemo(() => plateInv(kit), [kit]);
  const ownsOwnPlates = useMemo(() => Object.keys(kit.plates ?? {}).length > 0, [kit]);

  /** 每次改动立刻落盘 —— 器材是「设一次管很久」的东西,不留未保存状态 */
  const patch = (next: Partial<Kit>) => {
    const merged = { ...kit, ...next };
    setKit(merged);
    saveKit(merged);
  };

  // ---- 几套器材 ----
  const profName = (id: string) => profs.find((p) => p.id === id)?.name ?? '这一套';

  const switchTo = (id: string) => {
    if (id === cur) return;
    switchProfile(id);
    takeCurrent();
    Taro.showToast({ title: `已切到「${profName(id)}」`, icon: 'none' });
  };

  /** 新建:照现在这套复制(常见的第二套是「差不多但少几样」;要空白的,切过去清几下就空了) */
  const addOne = async () => {
    if (profs.length >= PROFILE_MAX) {
      Taro.showToast({ title: `最多存 ${PROFILE_MAX} 套`, icon: 'none' });
      return;
    }
    const { confirm, content } = await promptModal({
      title: '新建一套器材', content: '', placeholderText: '例:家里 / 公司楼下 / 出差'
    });
    if (!confirm) return;
    addProfile(content ?? '');
    takeCurrent();
    Taro.showToast({ title: '已建好,照原来那套复制的一份', icon: 'none' });
  };

  const renameCur = async () => {
    const { confirm, content } = await promptModal({
      title: '给这一套改个名字', content: profName(cur), placeholderText: `最多 ${PROFILE_NAME_MAX} 个字`
    });
    if (!confirm) return;
    renameProfile(cur, content ?? '');
    takeCurrent();
  };

  const removeCur = async () => {
    if (profs.length <= 1) return;
    const { confirm } = await Taro.showModal({
      title: `删掉「${profName(cur)}」?`,
      content: '只删这套设置。已经练过的记录不受影响 —— 记录里的重量本来就是杠上的总重。'
    });
    if (!confirm) return;
    removeProfile(cur);
    takeCurrent();
  };

  const setPairs = (w: number, n: number) => {
    const base = ownsOwnPlates
      ? { ...(kit.plates ?? {}) }
      : Object.fromEntries(inv.map((p) => [String(p.w), p.n]));
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(base)) if (Number(k) > 0) next[k] = v;
    if (n > 0) next[String(w)] = n; else delete next[String(w)];
    patch({ plates: next });
  };

  const resetPlates = async () => {
    const { confirm } = await Taro.showModal({
      title: '恢复标准配置', content: '按健身房常见的片架算:每种 6 对,1.25 的小片 2 对。'
    });
    if (confirm) patch({ plates: null });
  };

  const setBarKg = (eq: string, v: number | null) => {
    const bars = { ...(kit.bars ?? {}) };
    if (v == null) delete bars[eq];
    else bars[eq] = v;
    patch({ bars });
  };

  const toggleBell = (w: number) => {
    const has = (kit.dumbbells ?? []).includes(w);
    const next = has ? (kit.dumbbells ?? []).filter((x) => x !== w) : [...(kit.dumbbells ?? []), w].sort((a, b) => a - b);
    patch({ dumbbells: next });
  };

  const toggleEquip = (eq: string) => {
    const has = (kit.equipment ?? []).includes(eq);
    const next = has ? (kit.equipment ?? []).filter((x) => x !== eq) : [...(kit.equipment ?? []), eq];
    patch({ equipment: next });
  };

  // ---- 计算器 ----
  const target = Number(draft) || 0;
  const perSide = target > bar ? Math.round(((target - bar) / 2) * 100) / 100 : 0;
  const load = perSide > 0 ? plateStack(perSide, inv) : null;
  const barTotal = inv.reduce((s, p) => s + p.w * p.n * 2, 0);   // 两侧全挂满

  return (
    <Screen className="kit-page">
      <View className="card kt-intro">
        <Text className="fs-h1">我的器材</Text>
        <Text className="fs-caption">
          训练计划只说「卧推 60kg」,可站到杠铃前你还得算每边挂几片。这一页只做两件事:
          ①把计划里的重量翻译成「每边 25 + 5」,加重建议也只落在你有的片上;
          ②勾一下你有的器械,生成计划时按它挑动作。
          三项都可以不填 —— 不填就按健身房标准配置算,计划照常能用。
        </Text>
      </View>

      {/* ===== 几套器材 ===== */}
      <View className="card kt-block">
        <View className="kt-head">
          <Text className="fs-h1">我的几套器材</Text>
          <Text className="kt-legend">健身房 / 家里 / 出差</Text>
        </View>
        <Text className="fs-mini text-secondary kt-note">
          下面几张卡记的是「{profName(cur)}」这一套。换个地方练就切一套,回来再切回去 ——
          不用每次重登记。新建的那套是照现在这套复制的一份,改掉不一样的地方更快。
        </Text>
        <View className="kt-profs">
          {profs.map((p) => {
            const on = p.id === cur;
            return (
              <Text
                className={`kt-prof${on ? ' kt-prof--on' : ''}`}
                key={p.id}
                onClick={() => switchTo(p.id)}
              >
                {p.name}{on ? ' ✓' : ''}
              </Text>
            );
          })}
        </View>
        <View className="kt-quick">
          <Text className="kt-quick-btn" onClick={addOne}>+ 新建一套</Text>
          <Text className="kt-quick-btn" onClick={renameCur}>改名</Text>
          {profs.length > 1 && <Text className="kt-quick-btn" onClick={removeCur}>删掉这套</Text>}
        </View>
        <Text className="fs-mini text-secondary kt-note">
          几套都在这一份设置里,跟着同步与备份走 —— 换设备拉一次就都回来了。
        </Text>
      </View>

      {/* ===== 配片计算器 ===== */}
      <View className="card kt-block">
        <View className="kt-head">
          <Text className="fs-h1">配片计算器</Text>
          <Text className="kt-legend">杠上总重 → 每边挂什么</Text>
        </View>
        <View className="kt-calc-in">
          <Text className="kt-calc-label">目标重量</Text>
          <View className="kt-calc-field">
            <Input
              className="kt-input"
              type="digit"
              placeholder="60"
              value={draft}
              onInput={(e) => setDraft(e.detail.value)}
            />
            <Text className="kt-calc-unit">kg</Text>
          </View>
        </View>
        <View className="kt-chips">
          {BAR_CHOICES.map((b) => (
            <Text className={`kt-chip${bar === b ? ' kt-chip--on' : ''}`} key={b} onClick={() => setBar(b)}>
              {b === 0 ? '不要杆' : `${b}kg 杆`}
            </Text>
          ))}
        </View>

        {perSide > 0 && load ? (
          <View className="kt-result">
            <Text className="kt-result-k">每边</Text>
            <Text className="kt-result-v">{kg(perSide)}<Text className="kt-result-u">kg</Text></Text>
            <Text className="kt-result-plates">
              {load.plates.length ? plateText(load.plates) : '空着'}
            </Text>
            {load.missing > 0.001 ? (
              <Text className="kt-result-warn">
                还差 {kg(load.missing)}kg{ownsOwnPlates ? ' —— 你登记的那些片凑不出这个重量' : ' —— 标准配置也凑不出来'}
              </Text>
            ) : (
              <Text className="fs-mini text-secondary kt-result-sub">
                也就是 {bar > 0 ? `${bar}kg 杆 + ` : ''}两侧各这一串
              </Text>
            )}
          </View>
        ) : (
          <Text className="fs-mini text-secondary kt-calc-foot">
            {target > 0 && target <= bar
              ? `${kg(target)}kg 还没超过空杆,不用挂片。`
              : '填个目标重量,下面告诉你每边挂什么。'}
          </Text>
        )}
      </View>

      {/* ===== 杠铃片库存 ===== */}
      <View className="card kt-block">
        <View className="kt-head">
          <Text className="fs-h1">杠铃片</Text>
          <Text className="kt-legend">每种有几对</Text>
        </View>
        <Text className="fs-mini text-secondary kt-note">
          {ownsOwnPlates
            ? `按你登记的算,全挂满约 ${kg(barTotal)}kg(两边的总片重)。`
            : '还没登记,现在按健身房标准配置算:每种 6 对。改一下下面的数就按你的来。'}
        </Text>
        {PLATE_SIZES.map((w) => {
          const n = inv.find((p) => p.w === w)?.n ?? 0;
          return (
            <View className="kt-row" key={w}>
              <Text className="kt-row-k">{w}<Text className="kt-row-u">kg 片</Text></Text>
              <View className="kt-stepper">
                <Text className="kt-step" onClick={() => setPairs(w, Math.max(0, n - 1))}>−</Text>
                <Text className={`kt-step-v${n === 0 ? ' kt-step-v--off' : ''}`}>{n} 对</Text>
                <Text className="kt-step" onClick={() => setPairs(w, Math.min(20, n + 1))}>＋</Text>
              </View>
            </View>
          );
        })}
        {ownsOwnPlates && (
          <Text className="kt-reset" onClick={resetPlates}>恢复标准配置</Text>
        )}
      </View>

      {/* ===== 杠铃杆重 ===== */}
      <View className="card kt-block">
        <View className="kt-head">
          <Text className="fs-h1">杠铃杆</Text>
          <Text className="kt-legend">你那根杆多重</Text>
        </View>
        <Text className="fs-mini text-secondary kt-note">
          杆重是配片的起点:60kg 挂在 20kg 杆上是每边 20,挂在 10kg 曲杆上是每边 25。
          史密斯机的车厢有配重抵消时填 0,那它就不算起始重量。
        </Text>
        {Object.keys(BAR_DEFAULT_KG).map((eq) => {
          const own = kit.bars?.[eq];
          const val = own != null ? own : BAR_DEFAULT_KG[eq];
          return (
            <View className="kt-row" key={eq}>
              <Text className="kt-row-k">{kitLabel(eq)}</Text>
              <View className="kt-stepper">
                <Text className="kt-step" onClick={() => setBarKg(eq, Math.max(0, Math.round((val - 1) * 2) / 2))}>−</Text>
                <Text className="kt-step-v">{kg(val)}<Text className="kt-row-u">kg</Text></Text>
                <Text className="kt-step" onClick={() => setBarKg(eq, Math.min(50, Math.round((val + 1) * 2) / 2))}>＋</Text>
              </View>
              {own != null && (
                <Text className="kt-row-clear" onClick={() => setBarKg(eq, null)}>默认</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* ===== 哑铃档位 ===== */}
      <View className="card kt-block">
        <View className="kt-head">
          <Text className="fs-h1">哑铃 / 壶铃</Text>
          <Text className="kt-legend">
            {kit.dumbbells?.length ? `已选 ${kit.dumbbells.length} 档` : '一个都没选'}
          </Text>
        </View>
        <Text className="fs-mini text-secondary kt-note">
          点一下选中你有的档位(单个哑铃的重量)。选过之后,训练时按「＋ / −」会跳到你真有的下一个重量,
          而不是数学上等距的那个 —— 手里只有 10 和 14,就不该让你对着 12 发呆。
        </Text>
        <View className="kt-bells">
          {DUMBBELL_PRESETS.map((w) => {
            const on = (kit.dumbbells ?? []).includes(w);
            return (
              <Text className={`kt-bell${on ? ' kt-bell--on' : ''}`} key={w} onClick={() => toggleBell(w)}>
                {w}
              </Text>
            );
          })}
        </View>
        {!!kit.dumbbells?.length && (
          <Text className="kt-reset" onClick={() => patch({ dumbbells: [] })}>清空</Text>
        )}
      </View>

      {/* ===== 器械清单 ===== */}
      <View className="card kt-block">
        <View className="kt-head">
          <Text className="fs-h1">我有的器械</Text>
          <Text className="kt-legend">
            {kit.equipment?.length ? `已勾 ${kit.equipment.length} 项` : '没勾'}
          </Text>
        </View>
        <Text className="fs-mini text-secondary kt-note">
          勾了之后,生成计划时会按这份清单折算器械条件(没有器械也能生成,自重动作永远在里面)。
          {!!kit.equipment?.length && ` 按这份清单,你的条件是「${accessFor(kit) === 'gym' ? '健身房' : accessFor(kit) === 'home' ? '居家全套' : accessFor(kit) === 'dumbbell' ? '有哑铃' : '徒手'}」。`}
          自重动作永远可用 —— 没有哪种装备条件能把引体向上从你身上拿走。
        </Text>
        <View className="kt-equips">
          {KIT_EQUIPMENT.map((eq) => {
            const on = (kit.equipment ?? []).includes(eq);
            return (
              <Text className={`kt-equip${on ? ' kt-equip--on' : ''}`} key={eq} onClick={() => toggleEquip(eq)}>
                {kitLabel(eq)}
              </Text>
            );
          })}
        </View>
        <View className="kt-quick">
          <Text className="kt-quick-btn" onClick={() => patch({ equipment: ['bench', 'dumbbell', 'pull-up bar', 'body weight'] })}>
            家里一副哑铃
          </Text>
          <Text className="kt-quick-btn" onClick={() => patch({ equipment: KIT_EQUIPMENT.filter((e) => e !== 'other' && e !== 'roller') })}>
            全都有
          </Text>
          {!!kit.equipment?.length && (
            <Text className="kt-quick-btn" onClick={() => patch({ equipment: [] })}>清空</Text>
          )}
        </View>
        {!kit.equipment?.length && (
          <Text className="fs-mini text-secondary kt-note">
            没勾任何一项 = 不做筛选,动作库照常显示全部。(不是「什么都没有」的意思。)
          </Text>
        )}
      </View>

      <Text className="fs-mini text-secondary kt-foot">
        器材设置跟着同步与备份走,换设备拉一次就回来了。动作库中文名与技术术语来自公开动作数据集,器械的中文叫法各地不同,勾选时以形状为准。
      </Text>
    </Screen>
  );
}
