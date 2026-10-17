import { useEffect, useState } from 'react';
import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Delete } from '@taroify/icons';
import { bodyApi } from '@/services';
import { toast } from '@/utils/ui';
import { nowISO } from '@/utils/date';
import type { BodyMeasurement } from '@/services/types';
import './index.scss';

interface WeightSheetProps {
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调,父页面据此刷新数据 */
  onSaved?: () => void;
  /**
   * 要不要带那截历史(默认带)。
   * **记错一笔是常事**(小数点点错、早上称完晚上想改),而删掉它的门以前只有一处:
   * 记录页那个弹层自己写的版本。速记页、体重页、方案页用的是这个共用版,没有历史 ——
   * 同一个动作在三个地方三种长相,而且只有在其中一处能改错。
   *
   * 训练中那一次(`workout`)传 false:那一趟是练到一半顺手站上秤,
   * 历史列表会跟「回到训练」抢地方。
   */
  history?: boolean;
}

/** 记录体重底部弹层 — 速记 / 记录 / 体重数据 / 方案 / 训练中 共用 */
export default function WeightSheet({ open, onClose, onSaved, history = true }: WeightSheetProps) {
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  // 历史:每次打开都重拉(含刚存进去的那笔),失败可就地重试
  const [list, setList] = useState<BodyMeasurement[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const loadList = () => {
    setListLoading(true);
    bodyApi.listBodyMeasurements({ pageSize: 20 })
      .then((r) => setList(r.items.filter((m) => m.weightKg != null)))
      .catch(() => setList(null))
      .finally(() => setListLoading(false));
  };
  useEffect(() => {
    if (open && history) loadList();
    // 关掉时把上一次的列表清掉:再打开时不该先闪一眼旧数据
    if (!open) setList(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, history]);

  if (!open) return null;

  const remove = async (id: string) => {
    if (deletingId) return;
    const { confirm } = await Taro.showModal({ title: '删除记录', content: '确定删除这条体重记录吗？' });
    if (!confirm) return;
    setDeletingId(id);
    try {
      await bodyApi.deleteBodyMeasurement(id);
      setList((l) => l?.filter((m) => m.id !== id) ?? null);
      toast('已删除');
      onSaved?.();
    } catch (e) {
      toast((e as { message?: string })?.message || '删除失败，请重试', 'error');
    } finally {
      setDeletingId('');
    }
  };

  const save = async () => {
    if (saving) return;
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0) { toast('请输入大于 0 的体重', 'none'); return; }
    // 上限是防手滑多按一个 0(500 公斤以上不是记录,是错字)
    if (value > 500) { toast('体重超出合理范围，请检查', 'none'); return; }
    setSaving(true);
    try {
      await bodyApi.createBodyMeasurement({ measuredAt: nowISO(), weightKg: value });
      toast('已记录');
      setWeight('');
      onClose();
      onSaved?.();
    } catch (e) {
      toast((e as { message?: string })?.message || '保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="ws-mask" onClick={() => !saving && onClose()}>
      <View className="ws-sheet" catchMove onClick={(e) => e.stopPropagation()}>
        <View className="ws-handle" />
        <Text className="ws-title">记录体重</Text>
        <View className="ws-input-row">
          <Input
            className="ws-input" type="digit" placeholder="请输入体重" disabled={saving}
            value={weight} onInput={(e) => setWeight(e.detail.value)} focus
          />
          <Text className="ws-unit">kg</Text>
        </View>
        <Button className="ws-save" loading={saving} disabled={saving} onClick={save}>
          {saving ? '正在保存…' : '保存记录'}
        </Button>

        {history && <View className="ws-history">
          <Text className="ws-history__title">历史记录</Text>
          {listLoading && <Text className="ws-history__empty">正在加载…</Text>}
          {!listLoading && list?.length === 0 && <Text className="ws-history__empty">暂无体重记录</Text>}
          {!listLoading && list == null && (
            <Text className="ws-history__empty" onClick={loadList}>历史加载失败，点击重试</Text>
          )}
          <View className="ws-history__list">
            {(list ?? []).map((m) => (
              <View className="ws-history__row" key={m.id}>
                <Text className="ws-history__date">{fmtMeasured(m.measuredAt)}</Text>
                <Text className="ws-history__value">{m.weightKg != null ? `${m.weightKg} kg` : '—'}</Text>
                <Text
                  className={`ws-history__del${deletingId === m.id ? ' is-busy' : ''}`}
                  onClick={() => remove(m.id)}
                >
                  <Delete size={16} />
                </Text>
              </View>
            ))}
          </View>
        </View>}
      </View>
    </View>
  );
}

/** 日期按**本地**算:measuredAt 是 UTC,直接切字符串在 UTC+8 的上午会退回前一天 */
function fmtMeasured(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
