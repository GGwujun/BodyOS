import { useState } from 'react';
import { Button, Input, Text, View } from '@tarojs/components';
import { bodyApi } from '@/services';
import { toast } from '@/utils/ui';
import './index.scss';

interface WeightSheetProps {
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调,父页面据此刷新数据 */
  onSaved?: () => void;
}

/** 记录体重底部弹层 — 体重数据页 / 方案页共用 */
export default function WeightSheet({ open, onClose, onSaved }: WeightSheetProps) {
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const save = async () => {
    if (saving) return;
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0) { toast('请输入大于 0 的体重', 'none'); return; }
    if (value > 500) { toast('体重超出合理范围，请检查', 'none'); return; }
    setSaving(true);
    try {
      await bodyApi.createBodyMeasurement({ measuredAt: new Date().toISOString(), weightKg: value });
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
      </View>
    </View>
  );
}
