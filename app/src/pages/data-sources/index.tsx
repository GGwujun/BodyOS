import { View, Text, Button } from '@tarojs/components';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { dataSourceApi } from '@/services';
import { track } from '@/services/analytics';
import type { DataSource, Provider, SyncStatus } from '@/services/types';
import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Passed, ShieldOutlined, Replay, Wechat, Like, LinkOutlined } from '@taroify/icons';
import { navigate } from '@/utils/nav';
import './index.scss';

/** 08 Data Sources */
const STATUS_LABELS: Record<SyncStatus, string> = {disconnected:'未连接',connecting:'授权中',connected:'已授权 · 等待首次同步',syncing:'同步中',synced:'已同步',error:'同步异常'};

export default function DataSources() {
  const { data, loading, error, refresh } = useAsync<DataSource[]>(() => dataSourceApi.listDataSources(), []);
  const [busy, setBusy] = useState<Provider | null>(null);
  const pending = useRef(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => { track('datasource_view', 'datasource'); }, []);

  /** onSuccess/onError 挂在 act 上而不是各调用点自己 try/catch ——
      成功/失败埋点(算同步成功率的那一对)必须和操作的成败是同一个判定,两处各判一遍迟早对不上 */
  const act = async (
    provider: Provider,
    operation: () => Promise<unknown>,
    hooks?: { onSuccess?: () => void; onError?: () => void }
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(provider);
    setActionError('');
    try { await operation(); hooks?.onSuccess?.(); await refresh(); }
    catch (e) { hooks?.onError?.(); setActionError((e as {message?:string})?.message || '操作失败，请重试'); }
    finally { pending.current = false; setBusy(null); }
  };

  const onSync = async (provider: Provider) => {
    track('datasource_sync_start', 'datasource', { provider });
    await act(provider, async () => {
      // 微信运动:服务层负责取加密步数包推送 + 会话过期自愈重取
      if (provider === 'wechat') await dataSourceApi.syncWechatRun();
      else await dataSourceApi.syncProvider(provider);
    }, {
      onSuccess: () => track('datasource_sync_success', 'datasource', { provider }),
      onError: () => track('datasource_sync_error', 'datasource', { provider })
    });
  };

  const onConnect = async (provider: Provider) => {
    track('datasource_connect_start', 'datasource', { provider });
    await act(provider, () => dataSourceApi.connectProvider(provider), {
      onSuccess: () => track('datasource_connect_success', 'datasource', { provider })
    });
  };

  const onDisconnect = async (provider: Provider) => {
    const result = await Taro.showModal({title:'断开数据来源',content:'停止该来源的同步，已保存的记录不会删除。是否继续？'});
    if (result.confirm) await act(provider, () => dataSourceApi.disconnectProvider(provider));
  };

  // 只展示已接入的数据源;未接入的由底部"持续接入中"提示带过,不再出占位卡片
  const sources = (data ?? []).filter((s) => s.available);

  return (
    <Screen className="data-sources-page">
      {loading && <Text className="fs-caption text-secondary">加载中…</Text>}
      {error && <View className="ds-error"><Text>数据来源加载失败：{error}</Text><Button className="btn btn--mini btn--secondary" onClick={refresh}>重新加载</Button></View>}
      {actionError && <View className="ds-error">{actionError}</View>}

      {sources.map((s) => (
        <View key={s.provider} className="ds-card">
          <View className="provider-icon">{s.provider === 'wechat' ? <Wechat /> : s.provider === 'apple_health' ? <Like color="#f43f5e" /> : <LinkOutlined />}</View>
          <View className="provider-copy"><Text className="provider-name">{s.name}</Text><Text className="provider-status">{STATUS_LABELS[s.status]}{s.lastSyncAt ? ` · ${formatTime(s.lastSyncAt)}` : ''}</Text>{s.lastError && <Text className="provider-error">{s.lastError}</Text>}</View>
          <View className="provider-action">
            {s.status === 'disconnected' ? (
              <Button disabled={busy !== null} loading={busy === s.provider} className="connect-btn" size="mini" onClick={() => onConnect(s.provider)}>连接</Button>
            ) : (
              <View className="connected-actions">{s.status === 'synced' && <Passed />}<Button disabled={busy !== null} loading={busy === s.provider} className="connect-btn" size="mini" onClick={() => onSync(s.provider)}><Replay />同步</Button><Button disabled={busy !== null} className="connect-btn" size="mini" onClick={() => onDisconnect(s.provider)}>断开</Button></View>
            )}
          </View>
        </View>
      ))}
      {/* 拉失败的时候那句「更多持续接入中」会读成「本来就没有数据源」——
          和上面的错误框说的是两件事,那就别说 */}
      {!error && <View className="ds-more"><Text>更多数据来源持续接入中</Text></View>}
      <View className="privacy-note"><ShieldOutlined /><Text>数据安全：所有数据仅用于你的身体管理和分析</Text></View>
      {/* 同步失败时给一条**带上下文**的反馈入口:页面路径写死在 from=sync 里,
          用户不用解释自己在哪一页,我们也不用猜 */}
      {(actionError || sources.some((s) => s.status === 'error')) && (
        <View className="ds-feedback" onClick={() => navigate('/pages/feedback/index?kind=bug&from=sync')}>
          <Text className="ds-feedback-text">同步老失败？把当时的情况告诉我们</Text>
          <Text className="ds-feedback-act">去反馈 ›</Text>
        </View>
      )}
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
