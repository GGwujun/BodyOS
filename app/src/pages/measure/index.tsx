import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Image, Input, Picker, Text, View } from '@tarojs/components';
import rulerIcon from '@/assets/icons/ruler.png';
import Taro, { useDidShow } from '@tarojs/taro';
import { Delete } from '@taroify/icons';
import Screen from '@/components/Screen';
import LineChart from '@/components/LineChart';
import { bodyApi } from '@/services';
import type { BodyMeasurement } from '@/services/types';
import { track } from '@/services/analytics';
import { confirmDelete, toast } from '@/utils/ui';
import { nowISO, todayStr } from '@/utils/date';
import { createSubmissionGate } from '@/utils/submissionGate';
import {
  BODY_SPANS, CUSTOM_PREFIX, EMPTY_PREFS, SITES, activeSites, ascOf, availableSites, deltaText,
  parseGirth, seriesOf, spanFilter, valueOf, whrOf,
  type BodySpan, type GirthKey, type GirthPrefs
} from '@/utils/girth';
import {
  CUSTOM_NAME_MAX, addCustomSite, loadGirthPrefs, removeCustomSite, toggleSiteKey
} from '@/utils/girth-prefs';
import './index.scss';

/** 记录列表一行里某个部位的值怎么念:内置部位沿用「首字+数」的紧凑念法,
 *  自建部位首字认不出来(「左上臂」只剩「左」),整个名字摆出来 */
const rowTag = (label: string, k: string, unit: string, v: number): string =>
  k.startsWith(CUSTOM_PREFIX)
    ? `${label} ${v.toFixed(1)}`
    : `${label.slice(0, 1)}${v.toFixed(1)}${unit === '%' ? '%' : ''}`;

/** 围度记录 — 腰、胸、臀、上臂、大腿、体脂率,外加自己加的部位(「左上臂」「小腿围」这类) */
export default function MeasurePage() {
  const [records, setRecords] = useState<BodyMeasurement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [site, setSite] = useState<string>('waistCm');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  /** 自建部位 + 显隐(本机存储,跟着账号同步) */
  const [prefs, setPrefs] = useState<GirthPrefs>(EMPTY_PREFS);
  /** 管理弹层里正在加的自建部位名字 */
  const [newName, setNewName] = useState('');
  /** 曲线看多远(只管那张图;最新值/差值/记录列表看的是全程) */
  const [span, setSpan] = useState<BodySpan>('all');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const gate = useRef(createSubmissionGate());

  const load = () => {
    setFailed(false);
    setPrefs(loadGirthPrefs());
    bodyApi.listBodyMeasurements({ pageSize: 100 })
      .then((r) => setRecords(r.items))
      .catch(() => { setRecords(null); setFailed(true); });
  };
  useEffect(() => { track('measure_view', 'other'); }, []);
  useDidShow(() => { load(); });

  /** 录入表单显示的部位(没藏的) */
  const sites = useMemo(() => activeSites(prefs), [prefs]);
  /** 能选着看曲线的部位 = 显示中的 + 藏了但量过数的(藏一个部位不该把它的历史一起藏死) */
  const viewSites = useMemo(() => availableSites(prefs, records ?? []), [prefs, records]);
  const series = useMemo(() => seriesOf(records ?? [], viewSites), [records, viewSites]);
  const done = useMemo(() => series.filter((s) => s.latest != null), [series]);
  const whr = useMemo(() => whrOf(records ?? []), [records]);
  const current = series.find((s) => s.k === site) ?? series[0];
  const withGirth = useMemo(
    () => (records ?? []).filter((r) => viewSites.some((s) => valueOf(r, s.k) != null)),
    [records, viewSites]
  );
  const today = todayStr();
  const spanLabel = BODY_SPANS.find((s) => s.k === span)?.label ?? '全部';
  /** 曲线画区间里的点;头上的「最新多少/较上次」永远按全量算,不跟着窗口缩 */
  const chartPoints = useMemo(() => spanFilter(current.points, span, today), [current, span, today]);

  const save = () => gate.current(async () => {
    const values: Partial<Record<GirthKey, number>> = {};
    const extras: Record<string, number> = {};
    for (const s of sites) {
      const v = parseGirth(draft[s.k] ?? '', s);
      if (v === 'bad') return toast(`${s.label}看着不太对,请在 ${s.min}-${s.max}${s.unit === 'cm' ? ' 厘米' : '%'} 之间`, 'none');
      if (v == null) continue;
      // 内置部位各有各的列;自建部位统一住 extras 这张键值表
      if (s.k.startsWith(CUSTOM_PREFIX)) extras[s.k] = v;
      else values[s.k as GirthKey] = v;
    }
    if (!Object.keys(values).length && !Object.keys(extras).length) return toast('至少填一项', 'none');
    setSaving(true);
    try {
      await bodyApi.createBodyMeasurement({ measuredAt: nowISO(), ...values, ...(Object.keys(extras).length ? { extras } : {}) });
      toast('已记录');
      setSheetOpen(false);
      setDraft({});
      const r = await bodyApi.listBodyMeasurements({ pageSize: 100 });
      setRecords(r.items);
    } catch (e) {
      toast((e as { message?: string })?.message || '保存失败,请重试', 'error');
    } finally { setSaving(false); }
  });

  /* ===== 部位管理:显隐 + 自建 ===== */

  const toggle = (k: string) => {
    setPrefs(toggleSiteKey(k));
    track('measure_site_toggle', 'other');
  };

  const addSite = () => {
    const r = addCustomSite(newName);
    if (!r.ok) { toast(r.why, 'none'); return; }
    setPrefs(r.prefs);
    setNewName('');
    track('measure_site_add', 'other');
  };

  const dropSite = async (id: string, name: string) => {
    const okGo = await confirmDelete(
      `删除「${name}」`,
      '只是不再显示这个部位。量过的数还留在记录里,但同名再建一个也接不回那些数。'
    );
    if (!okGo) return;
    setPrefs(removeCustomSite(id));
    track('measure_site_delete', 'other');
  };

  const remove = async (id: string) => {
    const { confirm } = await Taro.showModal({ title: '删除记录', content: '确定删除这条围度记录吗?' });
    if (!confirm) return;
    setDeletingId(id);
    try {
      await bodyApi.deleteBodyMeasurement(id);
      setRecords((list) => list?.filter((m) => m.id !== id) ?? null);
      toast('已删除');
    } catch (e) {
      toast((e as { message?: string })?.message || '删除失败,请重试', 'error');
    } finally { setDeletingId(''); }
  };

  const fmtDate = (iso: string) => iso.slice(5, 10).replace('-', '/');

  return (
    <Screen className="measure-page">
      <View className="card mc-intro">
        <Text className="fs-h1">围度 · 体脂记录</Text>
        <Text className="fs-caption">
          体重只说明重了多少,围度才说明变在哪。腰围细了、臀围没动,是减脂;
          腰围没动、上臂粗了,是增肌。围度一天能浮动一厘米上下,固定同一时间、同一位置量才有可比性。
          体脂率不同仪器能差出好几个百分点,固定用同一台、只和自己的历史比。
        </Text>
        <Text className="mc-manage" onClick={() => setManageOpen(true)}>不量哪个可以藏 · 想要「左上臂」自己加 ›</Text>
      </View>

      {failed && (
        <Text className="mc-hint" onClick={load}>加载失败,点击重试</Text>
      )}

      {!failed && records != null && withGirth.length === 0 && (
        <View className="card mc-empty">
          <Image className="mc-empty-icon" src={rulerIcon} mode="aspectFit" />
          <Text className="fs-h1">还没有测量记录</Text>
          <Text className="fs-caption">量一次腰围只要十秒,却比体重更能说明这段时间练得对不对</Text>
          <Button className="btn btn--primary mc-cta" onClick={() => setSheetOpen(true)}>记一次围度和体脂</Button>
        </View>
      )}

      {withGirth.length > 0 && (
        <>
          {/* ===== 各部位概览 ===== */}
          <View className="card mc-block">
            <View className="mc-head">
              <Text className="fs-h1">现在多少</Text>
              <Text className="mc-legend">共 {withGirth.length} 次测量</Text>
            </View>
            <View className="mc-grid">
              {done.map((s) => {
                const vsPrev = s.prev != null ? deltaText(s.prev, s.latest as number, s.unit) : null;
                const vsFirst = s.first != null && s.points.length > 1 ? deltaText(s.first, s.latest as number, s.unit) : null;
                return (
                  <View
                    className={`mc-cell${site === s.k ? ' mc-cell--on' : ''}`}
                    key={s.k}
                    onClick={() => setSite(s.k)}
                  >
                    <Text className="mc-cell-k">{s.label}</Text>
                    <View className="mc-cell-v">
                      <Text className="mc-cell-num">{(s.latest as number).toFixed(1)}</Text>
                      <Text className="mc-cell-unit">{s.unit}</Text>
                    </View>
                    <Text className={`mc-delta${vsPrev?.dir ? ` mc-delta--${vsPrev.dir > 0 ? 'up' : 'down'}` : ''}`}>
                      {vsPrev ? `较上次 ${vsPrev.text}` : '第一次记录'}
                    </Text>
                    {vsFirst && <Text className="mc-delta-mini">较首次 {vsFirst.text}</Text>}
                  </View>
                );
              })}
            </View>
          </View>

          {/* ===== 走势 ===== */}
          <View className="card mc-block">
            <View className="mc-head">
              <Text className="fs-h1">{current.label}走势</Text>
              {/* 区间选择在卡片头上,和部位 chip 分开摆 —— 两种开关管的是两件事(看什么/看多远),长得像就会混 */}
              <Picker
                mode="selector"
                range={BODY_SPANS.map((s) => s.label)}
                value={BODY_SPANS.findIndex((s) => s.k === span)}
                onChange={(e) => setSpan(BODY_SPANS[Number(e.detail.value)]?.k ?? 'all')}
              >
                <Text className="mc-legend">{spanLabel} ⌄</Text>
              </Picker>
            </View>
            {current.points.length > 1 ? (
              <>
                <View className="mc-chips">
                  {done.map((s) => (
                    <Text
                      className={`mc-chip${site === s.k ? ' mc-chip--on' : ''}`}
                      key={s.k}
                      onClick={() => setSite(s.k)}
                    >
                      {s.label}
                    </Text>
                  ))}
                </View>
                {/* 日期和单位都画在图里(首末刻度 + 读数行),这一块原先在下面又摆了一遍 */}
                {chartPoints.length > 1 ? (
                  <LineChart canvasId="girth-chart" points={chartPoints} height={150} unit={current.unit === 'cm' ? '厘米' : '%'} />
                ) : (
                  <Text className="fs-caption text-secondary">
                    {spanLabel}只量到 {chartPoints.length} 次,换长一点的区间能看到之前的变化。
                  </Text>
                )}
              </>
            ) : (
              <Text className="fs-caption text-secondary">
                {current.label}目前只有一次记录,再量一次就能看到变化。
              </Text>
            )}
          </View>

          {/* ===== 腰臀比 ===== */}
          {whr && (
            <View className="card mc-block">
              <View className="mc-head">
                <Text className="fs-h1">腰臀比</Text>
                <Text className="mc-legend">{fmtDate(whr.date)}</Text>
              </View>
              <View className="mc-whr">
                <Text className={`mc-whr-num mc-whr-num--${whr.tone}`}>{whr.value.toFixed(2)}</Text>
                <View className="mc-whr-copy">
                  <Text className="fs-mini text-secondary">
                    {whr.tone === 'ok' ? '在通常的健康范围内' : '偏高一点'}
                  </Text>
                  <Text className="fs-mini text-secondary">参考:男性 0.90 以下、女性 0.85 以下</Text>
                </View>
              </View>
              <Text className="fs-mini text-secondary mc-foot">
                腰臀比反映脂肪堆在腰腹还是臀腿。同样体重,腰细臀圆比腰粗臀平更省心 ——
                所以腰围比体重值得盯。想降它,靠的是整体减脂,练腹肌练不掉肚子上那层。
              </Text>
            </View>
          )}

          {/* ===== 记录列表 ===== */}
          <View className="card mc-block">
            <View className="mc-head">
              <Text className="fs-h1">测量记录</Text>
            </View>
            {ascOf(withGirth).reverse().slice(0, 30).map((m) => (
              <View className="mc-row" key={m.id}>
                <View className="mc-row-copy">
                  <Text className="mc-row-date">{fmtDate(m.measuredAt)}</Text>
                  <Text className="mc-row-vals">
                    {viewSites
                      .filter((s) => valueOf(m, s.k) != null)
                      .map((s) => rowTag(s.label, s.k, s.unit, valueOf(m, s.k) as number))
                      .join(' · ')}
                    {m.weightKg != null ? ` · 体重 ${m.weightKg}kg` : ''}
                  </Text>
                </View>
                <Text
                  className={`mc-row-del${deletingId === m.id ? ' is-busy' : ''}`}
                  onClick={() => deletingId !== m.id && remove(m.id)}
                >
                  <Delete size={16} />
                </Text>
              </View>
            ))}
          </View>

          <Button className="btn btn--primary btn--block" onClick={() => setSheetOpen(true)}>
            记一次围度和体脂
          </Button>
        </>
      )}

      {sheetOpen && (
        <View className="mc-mask" onClick={() => !saving && setSheetOpen(false)}>
          <View className="mc-sheet" catchMove onClick={(e) => e.stopPropagation()}>
            <View className="mc-handle" />
            <Text className="mc-sheet-title">记录围度 · 体脂</Text>
            <Text className="fs-mini text-secondary mc-sheet-tip">
              只量了哪几个就填哪几个。软尺贴住皮肤别勒紧,同一侧、同一位置量。
            </Text>
            {sites.length === 0 ? (
              /* 全藏光了:别给一张空表单,先带他去把部位打开(或加一个) */
              <View className="mc-none">
                <Text className="fs-caption text-secondary">现在没有显示中的部位。</Text>
                <Text
                  className="fs-caption mc-none-btn"
                  onClick={() => { setSheetOpen(false); setManageOpen(true); }}
                >
                  去部位管理打开或加一个 ›
                </Text>
              </View>
            ) : sites.map((s) => (
              <View className="mc-field" key={s.k}>
                <View className="mc-field-head">
                  <Text className="mc-field-label">{s.label}</Text>
                  <View className="mc-field-input">
                    <Input
                      className="mc-input"
                      type="digit"
                      placeholder="—"
                      disabled={saving}
                      value={draft[s.k] ?? ''}
                      onInput={(e) => setDraft((d) => ({ ...d, [s.k]: e.detail.value }))}
                    />
                    <Text className="mc-field-unit">{s.unit}</Text>
                  </View>
                </View>
                <Text className="fs-mini text-secondary">{s.hint}</Text>
              </View>
            ))}
            {sites.length > 0 && (
              <Button className="btn btn--primary btn--block mc-save" loading={saving} disabled={saving} onClick={save}>
                {saving ? '正在保存…' : '保存记录'}
              </Button>
            )}
          </View>
        </View>
      )}

      {manageOpen && (
        <View className="mc-mask" onClick={() => setManageOpen(false)}>
          <View className="mc-sheet mc-sheet--manage" catchMove onClick={(e) => e.stopPropagation()}>
            <View className="mc-handle" />
            <Text className="mc-sheet-title">部位管理</Text>
            <Text className="fs-mini text-secondary mc-sheet-tip">
              不量的部位可以藏起来,表单和走势里就不再出现;藏了只是不显示,量过的数都还在。
              表里没有的部位(「左上臂」「小腿围」)自己加一个,和内置部位一样记录、一样看走势。
            </Text>

            <Text className="mc-mg-label">内置部位</Text>
            {SITES.map((s) => (
              <View className="mc-mg-row" key={s.k}>
                {/* 行形状和下面自建部位的行长得一样(主区可点、右侧另有操作)——
                    同位置的事件属性一致,别让某一行的格子点了没反应 */}
                <View className="mc-mg-main" onClick={() => toggle(s.k)}>
                  <Text className="mc-mg-name">{s.label}</Text>
                  <Text className={`mc-sw${prefs.hidden.includes(s.k) ? '' : ' on'}`}>
                    {prefs.hidden.includes(s.k) ? '已藏' : '显示中'}
                  </Text>
                </View>
              </View>
            ))}

            <Text className="mc-mg-label">自己加的部位</Text>
            {prefs.custom.length === 0 && (
              <Text className="fs-mini text-secondary mc-mg-empty">还没有 —— 加一个就能开始记。</Text>
            )}
            {prefs.custom.map((c) => {
              const hidden = prefs.hidden.includes(CUSTOM_PREFIX + c.id);
              return (
                <View className="mc-mg-row" key={c.id}>
                  <View className="mc-mg-main" onClick={() => toggle(CUSTOM_PREFIX + c.id)}>
                    <Text className="mc-mg-name">{c.name}</Text>
                    <Text className={`mc-sw${hidden ? '' : ' on'}`}>{hidden ? '已藏' : '显示中'}</Text>
                  </View>
                  <Text className="mc-mg-del" onClick={() => dropSite(c.id, c.name)}>删除</Text>
                </View>
              );
            })}

            <View className="mc-mg-add">
              <Input
                className="mc-mg-input"
                value={newName}
                maxlength={CUSTOM_NAME_MAX}
                placeholder={`比如:左上臂(最多 ${CUSTOM_NAME_MAX} 个字)`}
                placeholderClass="mc-mg-ph"
                onInput={(e) => setNewName(e.detail.value)}
              />
              <Text className={`mc-mg-addbtn${newName.trim() ? '' : ' is-dim'}`} onClick={addSite}>添加</Text>
            </View>
            <Text className="fs-mini text-secondary mc-mg-foot">
              自建部位跟着账号同步 —— 换台设备登录,名字和显隐都在。
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}
