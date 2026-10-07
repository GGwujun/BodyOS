import { View, Text, Button } from '@tarojs/components';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { dataSourceApi } from '@/services';
import { track } from '@/services/analytics';
import type { DataSource, Provider, SyncStatus } from '@/services/types';
import { useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Passed, LinkOutlined, ShieldOutlined, Replay, Wechat, Like } from '@taroify/icons';
import './index.scss';

/** 08 Data Sources */
const STATUS_LABELS: Record<SyncStatus, string> = {disconnected:'未连接',connecting:'授权中',connected:'已授权 · 等待首次同步',syncing:'同步中',synced:'已同步',error:'同步异常'};

export default function DataSources() {
  const { data, loading, error, refresh } = useAsync<DataSource[]>(() => dataSourceApi.listDataSources(), []);
  const [busy, setBusy] = useState<Provider | null>(null);
  const pending = useRef(false);
  const [actionError, setActionError] = useState('');

  const act = async (provider: Provider, operation: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(provider);
    setActionError('');
    try { await operation(); await refresh(); }
    catch (e) { setActionError((e as {message?:string})?.message || '操作失败，请重试'); }
    finally { pending.current = false; setBusy(null); }
  };

  const onSync = async (provider: Provider) => {
    track('datasource_sync_start', 'datasource', { provider });
    await act(provider, async () => {
      await dataSourceApi.syncProvider(provider);
      track('datasource_sync_success', 'datasource', { provider });
    });
  };

  const onConnect = async (provider: Provider) => {
    await act(provider, () => dataSourceApi.connectProvider(provider));
  };

  const onDisconnect = async (provider: Provider) => {
    const result = await Taro.showModal({title:'断开数据来源',content:'停止该来源的同步，已保存的记录不会删除。是否继续？'});
    if (result.confirm) await act(provider, () => dataSourceApi.disconnectProvider(provider));
  };

  const sources = data ?? [];

  return (
    <Screen className="data-sources-page">
      {loading && <Text className="fs-caption text-secondary">加载中…</Text>}
      {error && <View className="ds-error"><Text>数据来源加载失败：{error}</Text><Button size="mini" onClick={refresh}>重新加载</Button></View>}
      {actionError && <View className="ds-error">{actionError}</View>}

      {sources.map((s) => (
        <View key={s.provider} className="ds-card">
          <View className="provider-icon">{s.provider === 'wechat' ? <Wechat /> : s.provider === 'apple_health' ? <Like color="#f43f5e" /> : <LinkOutlined />}</View>
          <View className="provider-copy"><Text className="provider-name">{s.name}</Text><Text className="provider-status">{!s.available ? '暂未接入' : STATUS_LABELS[s.status]}{s.available && s.lastSyncAt ? ` · ${formatTime(s.lastSyncAt)}` : ''}</Text>{s.lastError && <Text className="provider-error">{s.lastError}</Text>}</View>
          <View className="provider-action">
            {!s.available ? (
              <Button className="connect-btn" size="mini" onClick={() => Taro.showModal({title:s.name,content:s.unavailableReason || '真实同步服务尚未接入，不会生成模拟运动记录。',showCancel:false})}>查看说明</Button>
            ) : s.status === 'disconnected' ? (
              <Button disabled={busy !== null} loading={busy === s.provider} className="connect-btn" size="mini" onClick={() => onConnect(s.provider)}>连接</Button>
            ) : (
              <View className="connected-actions">{s.status === 'synced' && <Passed />}<Button disabled={busy !== null} loading={busy === s.provider} className="connect-btn" size="mini" onClick={() => onSync(s.provider)}><Replay />同步</Button><Button disabled={busy !== null} className="connect-btn" size="mini" onClick={() => onDisconnect(s.provider)}>断开</Button></View>
            )}
            {!s.available && s.hasStoredConnection && <Button disabled={busy !== null} className="connect-btn" size="mini" onClick={() => onDisconnect(s.provider)}>清除旧连接</Button>}
          </View>
        </View>
      ))}
      <View className="privacy-note"><ShieldOutlined /><Text>数据安全：所有数据仅用于你的身体管理和分析</Text></View>
    </Screen>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
    return `${Math.floor(diffMin / 1440)} 天前`;
  } catch {
    return iso;
  }
}
