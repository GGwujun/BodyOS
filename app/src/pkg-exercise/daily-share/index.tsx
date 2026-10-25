import { useEffect, useRef, useState } from 'react';
import { Button, Canvas, Text, View } from '@tarojs/components';
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import Screen from '@/components/Screen';
import bgAsset from '@/assets/daily-card.jpg';
import { todayStr } from '@/utils/date';
import { mediaUrl } from '@/utils/media';
import { toast } from '@/utils/ui';
import { track } from '@/services/analytics';
import { getDailySummary } from '@/services/summary';
import { getDailyQuote, getWxacode } from '@/services/dailyQuote';
import { pickFallbackQuote } from '@/constants/dailyQuotes';
import { dailyVerdict, type DailyVerdict, type VerdictTraining } from '@/engine/dailyVerdict';
import { loadLogs } from '../engine/store';
import { drawQuote, drawReport, DAILY_H, DAILY_W, type CardImages, type Ctx2D } from '../engine/daily-card';
import type { DailySummary } from '@/services/types';
import './index.scss';

/** 导出 2 倍图:1500×2668,朋友圈点开全屏也清楚 */
const SCALE = 2;
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];

/** 画布节点上用到的那几个方法 —— Taro 官方类型对 2d canvas 的 node 标注不全(scale/createImage 没有),自己列 */
interface CanvasNode {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D & { scale(x: number, y: number): void };
  createImage(): { src: string; onload: (() => void) | null; onerror: (() => void) | null };
}

/** 10月25日 · 周六 —— 卡顶上的日期行(本地时区,和 todayStr 同口径) */
function dateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEK_ZH[d.getDay()]}`;
}

/** 今天练没练:本地日志里找日期命中的那一场(合并训练也是一条日志,不用挑) */
function trainingOfToday(today: string): VerdictTraining | null {
  const hit = loadLogs().find((l) => l.date === today);
  if (!hit) return null;
  return { title: hit.dayTitle, minutes: Math.round(hit.durationSec / 60), sets: hit.totalSets };
}

function verdictOf(today: string, s: DailySummary | null): DailyVerdict {
  return dailyVerdict({
    intakeCalories: s?.intakeCalories ?? 0,
    kcalTarget: s?.macroTarget?.calories ?? 0,
    proteinG: s?.nutrition?.proteinG ?? 0,
    proteinTargetG: s?.macroTarget?.proteinG ?? 0,
    steps: s?.steps ?? 0,
    stepGoal: s?.stepGoal ?? 0,
    training: trainingOfToday(today)
  });
}

/**
 * 每日分享卡 —— 发到朋友圈/群里的那张图,两个模板:
 *   成绩单:今天目的达到没有(热量/蛋白质/训练/运动四行证据 + 一句人话点评)
 *   金句:圈外人也看得懂的扎心一句(拉新向)
 * 隐私下限:图上没有体重、没有照片、没有昵称,只有「坚持记录 N 天」。
 */
export default function DailySharePage() {
  const today = useRef(todayStr()).current;
  /* 这页本身就挂着「发给朋友」的大按钮(发图);右上角菜单的口子给的是**链接**转发,
     两条路都通,人从哪儿分享都行 */
  useShareAppMessage(() => ({ title: '轻身记 · 记录，是改变的开始', path: '/pages/home/index' }));
  useShareTimeline(() => ({ title: '轻身记 · 记录，是改变的开始' }));
  const [mode, setMode] = useState<'report' | 'quote'>('report');
  const [tmp, setTmp] = useState('');
  const [ready, setReady] = useState(false);
  // 数据只拼一次,模板切换只重画;图片对象也缓存住,切模板不再重新下载
  const pack = useRef<{
    verdict: DailyVerdict;
    quote: { text: string; sub: string };
    recordDays: number;
  } | null>(null);
  const imgs = useRef<CardImages>({});
  const qrUrl = useRef('');

  useEffect(() => {
    track('daily_share_view', 'other');
    let alive = true;
    (async () => {
      // 三路数据各败各的:接口挂了卡也要出得来(金句走本地兜底,码画圆章)
      const [summaryR, quoteR, qrR] = await Promise.allSettled([
        getDailySummary(today),
        getDailyQuote(today),
        getWxacode('daily')
      ]);
      if (!alive) return;
      const summary = summaryR.status === 'fulfilled' ? summaryR.value : null;
      const fallback = pickFallbackQuote(today);
      const quote =
        quoteR.status === 'fulfilled' && quoteR.value?.quote?.text
          ? { text: quoteR.value.quote.text, sub: quoteR.value.quote.sub }
          : { text: fallback.text, sub: fallback.sub };
      pack.current = {
        verdict: verdictOf(today, summary),
        quote,
        recordDays: quoteR.status === 'fulfilled' ? quoteR.value.recordDays : 0
      };
      if (qrR.status === 'fulfilled' && qrR.value?.url) {
        qrUrl.current = mediaUrl(qrR.value.url);
      }
      setReady(true);
    })();
    return () => { alive = false; };
  }, [today]);

  useEffect(() => {
    if (!ready || !pack.current) return;
    // 等画布节点就绪再画:首帧 query 拿不到 node 是常见坑
    const timer = setTimeout(paint, 60);
    return () => clearTimeout(timer);
  }, [ready, mode]);

  /** canvas 的 Image 是异步加载的;失败返回 null,让绘制层走兜底 */
  const loadImg = (canvas: CanvasNode, src: string): Promise<unknown> =>
    new Promise((resolve) => {
      const img = canvas.createImage();
      const timer = setTimeout(() => resolve(null), 5000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });

  const paint = () => {
    const data = pack.current;
    if (!data) return;
    const query = Taro.createSelectorQuery();
    query.select('#daily-card').fields({ node: true, size: true }).exec(async (res) => {
      const canvas = res?.[0]?.node as CanvasNode | undefined;
      if (!canvas) return;
      canvas.width = DAILY_W * SCALE;
      canvas.height = DAILY_H * SCALE;
      const ctx = canvas.getContext('2d');
      ctx.scale(SCALE, SCALE);

      // 图片只加载一次,后续切模板直接复用
      if (!imgs.current.bg) imgs.current.bg = await loadImg(canvas, bgAsset);
      if (qrUrl.current && imgs.current.qr === undefined) {
        imgs.current.qr = await loadImg(canvas, qrUrl.current);
      }

      if (mode === 'report') {
        drawReport(ctx as unknown as Ctx2D, { dateLabel: dateLabel(today), verdict: data.verdict, recordDays: data.recordDays }, imgs.current);
      } else {
        drawQuote(ctx as unknown as Ctx2D, { dateLabel: dateLabel(today), quote: data.quote, recordDays: data.recordDays }, imgs.current);
      }
      Taro.canvasToTempFilePath({
        canvas,
        destWidth: DAILY_W * SCALE,
        destHeight: DAILY_H * SCALE,
        success: (r: { tempFilePath: string }) => setTmp(r.tempFilePath),
        fail: () => toast('图片生成失败,退出去重进试试')
      } as never);
    });
  };

  const saveToAlbum = async () => {
    if (!tmp) { toast('图片还在生成,稍等一下'); return; }
    try {
      await Taro.saveImageToPhotosAlbum({ filePath: tmp });
      track('daily_share_save', 'other');
      toast('已存到相册');
    } catch (e) {
      const msg = String((e as { errMsg?: string })?.errMsg ?? e);
      if (msg.includes('auth') || msg.includes('deny')) {
        const { confirm } = await Taro.showModal({
          title: '需要相册权限',
          content: '存图要允许「保存到相册」,去设置里打开一下。'
        });
        if (confirm) Taro.openSetting({});
      } else if (!msg.includes('cancel')) {
        toast('保存失败,请再试一次');
      }
    }
  };

  const shareImage = () => {
    if (!tmp) { toast('图片还在生成,稍等一下'); return; }
    track('daily_share_send', 'other');
    // 微信自带的图片分享面板(能给好友/朋友圈);旧版本没有这个 API 就退回存相册
    const fn = (Taro as unknown as { showShareImageMenu?: (o: { path: string }) => Promise<unknown> }).showShareImageMenu;
    if (!fn) { saveToAlbum(); return; }
    fn.call(Taro, { path: tmp }).catch(() => undefined);
  };

  const p = pack.current;
  return (
    <Screen className="ds-page">
      <View className="card ds-head">
        <Text className="fs-h1">今日分享卡</Text>
        <Text className="fs-caption">发到朋友圈或群里,让人一眼看懂「我为什么记录」。图上没有体重、没有照片。</Text>
      </View>

      <View className="ds-tabs">
        <Button
          className={`btn ${mode === 'report' ? 'btn--primary' : 'btn--secondary'} ds-tab`}
          onClick={() => setMode('report')}
        >成绩单</Button>
        <Button
          className={`btn ${mode === 'quote' ? 'btn--primary' : 'btn--secondary'} ds-tab`}
          onClick={() => setMode('quote')}
        >金句</Button>
      </View>

      <View className="card ds-stage">
        <Canvas type="2d" id="daily-card" className="ds-canvas" />
        {!tmp && <Text className="fs-mini text-secondary ds-hint">图片生成中…</Text>}
      </View>

      <View className="ds-actions">
        <Button className="btn btn--primary ds-btn" disabled={!tmp} onClick={saveToAlbum}>保存到相册</Button>
        <Button className="btn btn--secondary ds-btn" disabled={!tmp} onClick={shareImage}>发给朋友</Button>
      </View>

      {p && mode === 'report' ? (
        <View className="card ds-note">
          <Text className="fs-mini ds-note-line">· 成绩单说的是「今天目的达到没有」:热量、蛋白质参与判定,训练和步数如实展示。</Text>
          <Text className="fs-mini ds-note-line">· 还没记录的行会明说「还没有记录」——这张卡不装样子,空着也发得出去。</Text>
        </View>
      ) : null}
      {p && mode === 'quote' ? (
        <View className="card ds-note">
          <Text className="fs-mini ds-note-line">· 金句每天换一条,全站同一天是同一句;发给没在记录的人看,刚好。</Text>
        </View>
      ) : null}
    </Screen>
  );
}
