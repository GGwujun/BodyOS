import { themedColor } from '@/utils/theme';
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Switch } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { ArrowLeft, ArrowRight, Replay } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import Screen from '@/components/Screen';
import { summaryApi, weeklyPushApi } from '@/services';
import { track } from '@/services/analytics';
import { onIf } from '@/utils/taro-events';
import { switchTab } from '@/utils/nav';
import { toast } from '@/utils/ui';
import type { WeeklyAnalysis } from '@/services/types';
import { FireOutlined, GoldCoinOutlined, BarChartOutlined, BulbOutlined } from '@taroify/icons';
import { THEME } from '@/constants/theme';
import './index.scss';

/** 本地时区 YYYY-MM-DD(避免 toISOString 的 UTC 偏移把日期挪一天) */
function localDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 微信订阅消息的申请结果:每个模板 id 一个 'accept' | 'reject' | 'ban' */
type SubResult = Record<string, string>;

/** 06 Weekly Report — 周评分 / 变化 / Wins / Issues / 下周行动,支持切换往期 */
export default function WeeklyReport() {
  // weekOffset:0=本周(最近 7 天),负数往回翻周
  const [weekOffset, setWeekOffset] = useState(0);
  const [forceCount, setForceCount] = useState(0); // 重新生成计数
  const weekStart = useMemo(() => localDateStr(-6 + weekOffset * 7), [weekOffset]);
  const weekEnd = useMemo(() => localDateStr(weekOffset * 7), [weekOffset]);

  const { data, loading, error, refresh } = useAsync<WeeklyAnalysis>(
    () => summaryApi.weeklyAnalysis(weekStart, forceCount > 0),
    [weekStart, forceCount]
  );

  // —— 周报推送(每周一早上把上周摘要发给你)—— 开关和额度都在服务器上,
  // 这里只是照搬提醒页(训练 → 提醒)的同款流程:开关、领额度、如实说明配没配模板。
  const [pushOn, setPushOn] = useState(false);
  const [tmplId, setTmplId] = useState('');
  const [grants, setGrants] = useState(0);
  const [pushOnline, setPushOnline] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    track('weekly_push_view', 'other');
    void weeklyPushApi.getWeeklyPush().then((dto) => {
      setPushOn(dto.enabled);
      setTmplId(dto.tmplId);
      setGrants(dto.grants);
    }).catch(() => setPushOnline(false));
  }, []);

  /** 申请一次订阅消息授权。必须在用户点击的同步调用链里(微信的规矩) ——
   *  所以模板 id 用的是本页加载时缓存的那份,不能在这里先发请求再问。 */
  const askSubscribe = async (): Promise<number> => {
    const fn = (Taro as unknown as {
      requestSubscribeMessage?: (o: { tmplIds: string[] }) => Promise<SubResult>;
    }).requestSubscribeMessage;
    if (!fn) return 0; // 基础库太老,没有这个接口
    try {
      const res = await fn.call(Taro, { tmplIds: [tmplId] });
      return res?.[tmplId] === 'accept' ? 1 : 0;
    } catch {
      return 0;
    }
  };

  const togglePush = async (v: boolean) => {
    if (pushBusy) return;
    if (!v) {
      try {
        const dto = await weeklyPushApi.putWeeklyPush({ enabled: false });
        setPushOn(dto.enabled);
        toast('关了,周报还在小程序里看');
      } catch { setPushOnline(false); }
      return;
    }
    if (!tmplId) {
      toast('推送模板还没配好,先在小程序里看吧');
      return;
    }
    setPushBusy(true);
    try {
      const accepted = await askSubscribe();
      if (!accepted) {
        toast('没拿到微信授权,推送发不出来;周报照常在小程序里');
        return;
      }
      const dto = await weeklyPushApi.putWeeklyPush({ enabled: true });
      setPushOn(dto.enabled);
      const after = await weeklyPushApi.grantWeeklyPush(accepted);
      setGrants(after.grants);
      track('weekly_push_toggle', 'other', { enabled: true, grants: after.grants });
      toast('设好了,每周一早上给你发上周的摘要');
    } catch {
      setPushOnline(false);
      toast('没连上服务器,稍后再开一次');
    } finally {
      setPushBusy(false);
    }
  };

  const addGrant = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const accepted = await askSubscribe();
      if (!accepted) {
        toast('这次没授权,下次再点');
        return;
      }
      const dto = await weeklyPushApi.grantWeeklyPush(accepted);
      setGrants(dto.grants);
      toast('好了,又能多发一周');
    } catch {
      setPushOnline(false);
      toast('没连上服务器,稍后再试');
    } finally {
      setPushBusy(false);
    }
  };


  const isCurrentWeek = weekOffset === 0;
  const label = `${weekStart.slice(5).replace('-', '.')} - ${weekEnd.slice(5).replace('-', '.')}`;

  return (
    <Screen className="weekly-report-page">
      <View className="week-nav">
        <View className="week-arrow" onClick={() => setWeekOffset((v) => v - 1)}><ArrowLeft /></View>
        <Text className="week-label">{isCurrentWeek ? `本周 · ${label}` : label}</Text>
        {/* 写成**一个** View 而不是「禁用的一支 / 可点的一支」:两个分支同标签,
            React 会认成同一个节点去改 props,回到本周时那个 onClick 就被摘掉 ——
            「事件属性从函数变成没有」会让整棵子树崩掉(见 utils/taro-events)。
            禁用与否只是 className,能不能点写在函数体里。 */}
        <View
          className={isCurrentWeek ? 'week-arrow-disabled' : 'week-arrow'}
          onClick={onIf(!isCurrentWeek, () => setWeekOffset((v) => v + 1))}
        >
          <ArrowRight />
        </View>
      </View>

      {loading && (
        <View className="card">
          <Text className="fs-caption text-secondary">正在生成报告…</Text>
        </View>
      )}

      {!loading && (error || !data) && (
        <View className="error-panel">
          <BulbOutlined />
          <Text className="error-title">周报暂时无法生成</Text>
          <Text className="error-copy">{error || '数据不足，暂时无法生成报告。'}</Text>
          {/* 主路是「再算一次」;去记录是另一条路(数据不够时才是它),所以是次要长相 */}
          <Text className="retry" onClick={() => refresh()}>重新生成</Text>
          <Text className="retry-alt" onClick={() => switchTab('/pages/record/index')}>去记录本周数据 ›</Text>
        </View>
      )}

      {!loading && data && (
        <>
          {data.cached && (
            <View className="cache-row" onClick={() => setForceCount((v) => v + 1)}>
              <Text className="fs-mini text-secondary">{isCurrentWeek ? '本周已有缓存报告，新记录后可' : '已生成 · '}</Text>
              <Text className="fs-mini text-secondary regen-link"><Replay /> 重新生成</Text>
            </View>
          )}
          <View className="score-card">
            <Text className="fs-caption">{isCurrentWeek ? '本周评分' : '当期评分'}</Text>
            <Text className="score-value">{data.grade || '—'}</Text>
            <Text className="fs-mini">综合 {data.score} /100 · 继续保持</Text>
          </View>

          <View className="card">
            <Text className="fs-h1">关键数据</Text>
            {data.changes.length === 0 && <Text className="fs-mini text-secondary">暂无变化数据</Text>}
            {data.changes.map((c, i) => (
              <View key={i} className="report-row">
                <Text className="fs-caption"><BarChartOutlined /> {c.label}</Text>
                <Text className="text-primary">{c.value}</Text>
              </View>
            ))}
          </View>

          <View className="card win-card">
            <Text className="fs-h1 text-brand"><GoldCoinOutlined /> 做得好</Text>
            {data.wins.length === 0 && <Text className="fs-mini text-secondary">{isCurrentWeek ? '本周继续努力' : '当期暂无亮点'}</Text>}
            {data.wins.map((w, i) => (
              <Text key={i} className="fs-caption">· {w}</Text>
            ))}
          </View>

          <View className="card issue-card">
            <Text className="fs-h1 text-warning"><FireOutlined /> 需改进</Text>
            {data.issues.length === 0 && <Text className="fs-mini text-secondary">没有明显问题</Text>}
            {data.issues.map((is, i) => (
              <Text key={i} className="fs-caption">· {is}</Text>
            ))}
          </View>

          <View className="card ai-card">
            <Text className="fs-h1 text-info"><BulbOutlined /> 总结与下周行动</Text>
            {data.actions.length === 0 && <Text className="fs-mini text-secondary">保持现有节奏</Text>}
            {data.actions.map((a, i) => (
              <Text key={i} className="fs-caption">{i + 1}. {a}</Text>
            ))}
          </View>
        </>
      )}

      {/* 推送开关放在条件外面:报告生成失败时它照样能用 —— 推的是上周的数字摘要,不依赖本周报告 */}
      <View className="card push-card">
        <View className="push-row">
          <View className="push-row-text">
            <Text className="push-row-title">每周一早上发摘要给我</Text>
            <Text className="fs-mini text-secondary">
              {!pushOnline
                ? '没连上服务器,这项设置暂时存不了'
                : !tmplId
                  ? '推送模板还没配好,先在小程序里看'
                  : pushOn
                    ? `开着 · 还能发 ${grants} 条`
                    : '关着'}
            </Text>
          </View>
          <Switch
            checked={pushOn}
            disabled={!pushOnline || !tmplId || pushBusy}
            color={themedColor(THEME.primary)}
            onChange={(e) => void togglePush(e.detail.value)}
          />
        </View>
        <Text className="fs-mini push-note">
          微信规定一次授权只发一条,发完要再点一次。内容是上周的评分、体重变化和记录天数,
          点进去就是这份报告。
        </Text>
        {pushOnline && tmplId && pushOn ? (
          <Text
            className="push-grant"
            onClick={onIf(!pushBusy, () => void addGrant())}
          >
            再领一条额度{grants > 0 ? `(还剩 ${grants} 条)` : ''}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
