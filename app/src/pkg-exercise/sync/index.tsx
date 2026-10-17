import { useEffect, useState } from 'react';
import { Button, Switch, Text, View } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { toast } from '@/utils/ui';
import { loadPhotos } from '@/utils/photos';
import { kitDocEmpty, loadKitDoc } from '../engine/kit';
import { loadLogs, loadNotes, loadPlan } from '../engine/store';
import {
  autoSyncOn, lastSyncedAt, setAutoSync, syncNow, type SyncSummary
} from '../engine/sync';
import './index.scss';
import { THEME } from '@/constants/theme';

/** 「10-15 20:11」这种够用的时间;同步时间看到分钟即可 */
function when(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 本机有什么,同步前先让人看见自己攒了多少东西 */
function localCounts() {
  const logs = loadLogs();
  const photos = loadPhotos();
  const notes = Object.keys(loadNotes()).length;
  return {
    plan: loadPlan() ? 1 : 0,
    logs: logs.length,
    photos: photos.length,
    notes,
    // 数的是**整份**(几套器材都算)—— 传上去的就是整份,这里只数当前那套的话,
    // 数字和真正要传的东西对不上
    kit: kitDocEmpty(loadKitDoc()) ? 0 : 1
  };
}

/**
 * 训练数据同步 —— 计划/渐进/日志/备注/器材/照片本来只在这台手机上,换手机就没了。
 * 这里把它们镜像到账号下;合并规则(谁改得晚听谁的)在 engine/sync.ts。
 */
export default function SyncPage() {
  const [counts, setCounts] = useState(localCounts);
  const [last, setLast] = useState<string | null>(lastSyncedAt);
  const [auto, setAuto] = useState(autoSyncOn);
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncSummary | null>(null);

  useEffect(() => { track('sync_view', 'other'); }, []);
  /* 回到这一页时重算「本机有什么」:用户可能刚从训练页练完一次再点回来
     (push 进来的页面回来不重挂载,只在挂载时算会一直停在旧数字上 —— 显示的份数
     和实际要传的东西对不上,是这页最容易让人看不懂的地方)。上次同步时间同理,
     别处(训练完成后的静默同步)也会让它往前走。 */
  useDidShow(() => { setCounts(localCounts()); setLast(lastSyncedAt()); });

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await syncNow(setStep);
      setResult(r);
      setLast(lastSyncedAt());
      setCounts(localCounts());
      if (r.failed) toast('部分数据没传上去,稍后再试一次');
      else toast('同步完成');
    } catch (e) {
      // 服务端不通时按原样提示,别把「网络异常」吞成「同步成功」
      toast((e as { message?: string })?.message || '同步失败,请稍后重试');
    } finally {
      setStep('');
      setBusy(false);
    }
  };

  const toggleAuto = (v: boolean) => {
    setAuto(v);
    setAutoSync(v);
  };

  return (
    <Screen className="sy-page">
      <View className="card sy-head">
        <Text className="fs-h1">训练数据同步</Text>
        <Text className="fs-caption">
          计划、渐进重量、训练日志、动作备注、器材清单、进度照片本来只存在这台手机上,
          换手机或清理小程序缓存就全没了。同步一次,换台设备也能接着练。
        </Text>
      </View>

      <View className="card sy-state">
        <View className="sy-row">
          <Text className="sy-k">上次同步</Text>
          <Text className="sy-v">{last ? when(last) : '还没同步过'}</Text>
        </View>
        <View className="sy-row">
          <Text className="sy-k">本机数据</Text>
          <Text className="sy-v">
            {[
              counts.plan ? '计划 1 份' : null,
              counts.logs ? `训练日志 ${counts.logs} 次` : null,
              counts.notes ? `动作备注 ${counts.notes} 条` : null,
              counts.kit ? '器材清单' : null,
              counts.photos ? `照片 ${counts.photos} 张` : null
            ].filter(Boolean).join(' · ') || '还没有训练数据'}
          </Text>
        </View>
      </View>

      <Button
        className="btn btn--primary btn--block sy-btn"
        loading={busy}
        disabled={busy}
        onClick={run}
      >
        {busy ? '正在同步…' : '立即同步'}
      </Button>
      {busy && step ? <Text className="fs-caption text-secondary sy-step">{step}</Text> : null}

      {result && (
        <View className="card sy-result">
          <Text className="sy-result-title">{result.failed ? '同步了大部分数据' : '同步完成'}</Text>
          <Text className="fs-mini sy-line">
            上传:新建 {result.created} 条 · 更新 {result.updated} 条
          </Text>
          <Text className="fs-mini sy-line">
            下载:云端补回 {result.pulled} 条{result.adopted ? ` · 换上新版 ${result.adopted} 条` : ''}
          </Text>
          {result.photosUploaded > 0 && (
            <Text className="fs-mini sy-line">照片:上传 {result.photosUploaded} 张</Text>
          )}
          {result.photosFailed > 0 && (
            <Text className="fs-mini sy-line sy-warn">有 {result.photosFailed} 张照片没传上去,下次同步会自动重试</Text>
          )}
          {result.failed > 0 && (
            <Text className="fs-mini sy-line sy-warn">
              有 {result.failed} 批没传上去(网络原因),本机数据一条没动,下次同步会补上
            </Text>
          )}
        </View>
      )}

      <View className="card sy-auto">
        <View className="sy-auto-row">
          <View className="sy-auto-text">
            <Text className="sy-auto-title">练完自动同步</Text>
            <Text className="fs-mini text-secondary">每次练完顺手传一次,不用记着手动点</Text>
          </View>
          <Switch checked={auto} color={THEME.primary} onChange={(e) => toggleAuto(e.detail.value)} />
        </View>
      </View>

      <View className="card sy-note">
        <Text className="sy-note-title">同步的规矩</Text>
        <Text className="fs-mini sy-note-line">· 同一份数据两边都改过时,以「改得晚」的那台为准 —— 换设备不会把新的覆盖回去。</Text>
        <Text className="fs-mini sy-note-line">· 两台设备各自练的日志都会留着,不会互相盖掉。</Text>
        <Text className="fs-mini sy-note-line">· 在一台上删掉整个计划,同步后另一台也跟着删。</Text>
        <Text className="fs-mini sy-note-line">· 本机只保留最近 300 次训练日志,更早的仍在云端,不会因为这个同步丢掉。</Text>
        <Text className="fs-mini sy-note-line">· 照片上传后,在小程序里删掉只会删掉这条记录,服务器上的图片文件不会自动清除。</Text>
      </View>
    </Screen>
  );
}
