import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Image, Input, Text, View } from '@tarojs/components';
import rulerIcon from '@/assets/icons/ruler.png';
import Taro, { useDidShow } from '@tarojs/taro';
import { Delete } from '@taroify/icons';
import Screen from '@/components/Screen';
import LineChart from '@/components/LineChart';
import { bodyApi } from '@/services';
import type { BodyMeasurement } from '@/services/types';
import { track } from '@/services/analytics';
import { toast } from '@/utils/ui';
import { nowISO } from '@/utils/date';
import { createSubmissionGate } from '@/utils/submissionGate';
import {
  SITES, ascOf, deltaText, measuredSites, parseGirth, seriesOf, whrOf, type GirthKey
} from '@/utils/girth';
import './index.scss';

/** 围度记录 — 腰、胸、臀、上臂、大腿,一条条量、一条条看变化 */
export default function MeasurePage() {
  const [records, setRecords] = useState<BodyMeasurement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [site, setSite] = useState<GirthKey>('waistCm');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [draft, setDraft] = useState<Record<GirthKey, string>>({
    waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: ''
  });
  const gate = useRef(createSubmissionGate());

  const load = () => {
    setFailed(false);
    bodyApi.listBodyMeasurements({ pageSize: 100 })
      .then((r) => setRecords(r.items))
      .catch(() => { setRecords(null); setFailed(true); });
  };
  useEffect(() => { track('measure_view', 'other'); }, []);
  useDidShow(() => { load(); });

  const series = useMemo(() => seriesOf(records ?? []), [records]);
  const done = useMemo(() => measuredSites(records ?? []), [records]);
  const whr = useMemo(() => whrOf(records ?? []), [records]);
  const current = series.find((s) => s.k === site) ?? series[0];
  const withGirth = (records ?? []).filter((r) => SITES.some((s) => r[s.k] != null));

  const save = () => gate.current(async () => {
    const values: Partial<Record<GirthKey, number>> = {};
    for (const s of SITES) {
      const v = parseGirth(draft[s.k]);
      if (v === 'bad') return toast(`${s.label}看着不太对,请在 ${10}-${300} 厘米之间`, 'none');
      if (v != null) values[s.k] = v;
    }
    if (!Object.keys(values).length) return toast('至少量一个部位', 'none');
    setSaving(true);
    try {
      await bodyApi.createBodyMeasurement({ measuredAt: nowISO(), ...values });
      toast('已记录');
      setSheetOpen(false);
      setDraft({ waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: '' });
      const r = await bodyApi.listBodyMeasurements({ pageSize: 100 });
      setRecords(r.items);
    } catch (e) {
      toast((e as { message?: string })?.message || '保存失败,请重试', 'error');
    } finally { setSaving(false); }
  });

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
        <Text className="fs-h1">围度记录</Text>
        <Text className="fs-caption">
          体重只说明重了多少,围度才说明变在哪。腰围细了、臀围没动,是减脂;
          腰围没动、上臂粗了,是增肌。围度一天能浮动一厘米上下,固定同一时间、同一位置量才有可比性。
        </Text>
      </View>

      {failed && (
        <Text className="mc-hint" onClick={load}>加载失败,点击重试</Text>
      )}

      {!failed && records != null && withGirth.length === 0 && (
        <View className="card mc-empty">
          <Image className="mc-empty-icon" src={rulerIcon} mode="aspectFit" />
          <Text className="fs-h1">还没有围度记录</Text>
          <Text className="fs-caption">量一次腰围只要十秒,却比体重更能说明这段时间练得对不对</Text>
          <Button className="btn btn--primary mc-cta" onClick={() => setSheetOpen(true)}>记一次围度</Button>
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
                const vsPrev = s.prev != null ? deltaText(s.prev, s.latest as number) : null;
                const vsFirst = s.first != null && s.points.length > 1 ? deltaText(s.first, s.latest as number) : null;
                return (
                  <View
                    className={`mc-cell${site === s.k ? ' mc-cell--on' : ''}`}
                    key={s.k}
                    onClick={() => setSite(s.k)}
                  >
                    <Text className="mc-cell-k">{s.label}</Text>
                    <View className="mc-cell-v">
                      <Text className="mc-cell-num">{(s.latest as number).toFixed(1)}</Text>
                      <Text className="mc-cell-unit">cm</Text>
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
              <Text className="mc-legend">{current.points.length > 1 ? `最近 ${current.points.length} 次` : '再看一次就有走势'}</Text>
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
                <LineChart canvasId="girth-chart" points={current.points} height={150} unit="厘米" />
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
                    {SITES.filter((s) => m[s.k] != null)
                      .map((s) => `${s.label.slice(0, 1)}${(m[s.k] as number).toFixed(1)}`)
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
            记一次围度
          </Button>
        </>
      )}

      {sheetOpen && (
        <View className="mc-mask" onClick={() => !saving && setSheetOpen(false)}>
          <View className="mc-sheet" catchMove onClick={(e) => e.stopPropagation()}>
            <View className="mc-handle" />
            <Text className="mc-sheet-title">记录围度</Text>
            <Text className="fs-mini text-secondary mc-sheet-tip">
              只量了哪几个就填哪几个。软尺贴住皮肤别勒紧,同一侧、同一位置量。
            </Text>
            {SITES.map((s) => (
              <View className="mc-field" key={s.k}>
                <View className="mc-field-head">
                  <Text className="mc-field-label">{s.label}</Text>
                  <View className="mc-field-input">
                    <Input
                      className="mc-input"
                      type="digit"
                      placeholder="—"
                      disabled={saving}
                      value={draft[s.k]}
                      onInput={(e) => setDraft((d) => ({ ...d, [s.k]: e.detail.value }))}
                    />
                    <Text className="mc-field-unit">cm</Text>
                  </View>
                </View>
                <Text className="fs-mini text-secondary">{s.hint}</Text>
              </View>
            ))}
            <Button className="btn btn--primary btn--block mc-save" loading={saving} disabled={saving} onClick={save}>
              {saving ? '正在保存…' : '保存记录'}
            </Button>
          </View>
        </View>
      )}
    </Screen>
  );
}
