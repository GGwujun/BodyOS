import { useEffect, useState } from 'react';
import { Button, Canvas, Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import { track } from '@/services/analytics';
import { copyText, toast } from '@/utils/ui';
import { navigate } from '@/utils/nav';
import { personalRecords } from '../engine/history';
import { sidedInPlan } from '../engine/sided';
import { loadLogs, loadPlan } from '../engine/store';
import { CARD_H, CARD_W, cardDataOf, drawCard, type Ctx2D } from '../engine/share-card';
import { workoutText } from '../engine/workout-text';
import './index.scss';

/** 导出用 2 倍图:1200×1800,发到聊天里点开也够清楚 */
const SCALE = 2;

/**
 * 训练分享卡 —— 练完那一刻分享欲最强,而小程序默认只能分享一个链接。
 * 这里把这次训练画成一张图,存相册或直接发出去。
 * 传 `?logId=` 看指定那次;不传就看最近的一次。
 */
export default function SharePage() {
  const [log, setLog] = useState<ReturnType<typeof loadLogs>[number] | null>(null);
  const [prText, setPrText] = useState<string | null>(null);
  const [tmp, setTmp] = useState('');

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params ?? {};
    const logs = loadLogs();
    // 最近的在前(appendLog 就是往前插的);指定 id 找不到时退回最近一次
    const hit = (params.logId ? logs.find((l) => l.id === params.logId) : null) ?? logs[0] ?? null;
    if (!hit) return;
    setLog(hit);
    const data = cardDataOf(hit, personalRecords(logs));
    setPrText(data.prText ?? null);
    track('training_share_view', 'other');

    // 等画布节点就绪再画:首帧 query 拿不到 node 是常见坑
    setTimeout(() => paint(hit, logs), 60);
  }, []);

  const paint = (hit: NonNullable<typeof log>, logs: ReturnType<typeof loadLogs>) => {
    const query = Taro.createSelectorQuery();
    query.select('#share-card').fields({ node: true, size: true }).exec((res) => {
      const canvas = res?.[0]?.node;
      if (!canvas) return;
      canvas.width = CARD_W * SCALE;
      canvas.height = CARD_H * SCALE;
      const ctx = canvas.getContext('2d');
      ctx.scale(SCALE, SCALE);
      drawCard(ctx as unknown as Ctx2D, cardDataOf(hit, personalRecords(logs)));
      // 画完就导出临时文件:存相册和发出去都要它
      Taro.canvasToTempFilePath({
        canvas,
        destWidth: CARD_W * SCALE,
        destHeight: CARD_H * SCALE,
        // 整个 options 被 as never 抹掉了类型(canvas 字段官方类型里还没有),回调参数得自己写
        success: (r: { tempFilePath: string }) => setTmp(r.tempFilePath),
        fail: () => toast('图片生成失败,退出去重进试试')
      } as never);
    });
  };

  const saveToAlbum = async () => {
    if (!tmp) { toast('图片还在生成,稍等一下'); return; }
    try {
      await Taro.saveImageToPhotosAlbum({ filePath: tmp });
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
    // 微信自带的图片分享面板(能给好友/朋友圈);旧版本没有这个 API 就退回存相册
    const fn = (Taro as unknown as { showShareImageMenu?: (o: { path: string }) => Promise<unknown> }).showShareImageMenu;
    if (!fn) { saveToAlbum(); return; }
    fn.call(Taro, { path: tmp }).catch(() => undefined);
  };

  /**
   * 复制成文字 —— 图是一个整体,教练拿去得照着敲;文字能直接贴进表格、也能在后面添两句。
   * 顺带带上计划,好知道哪个动作是单侧(次数要折成「每侧 N」,见 engine/workout-text)。
   */
  const copyWorkoutText = async () => {
    if (!log) return;
    const plan = loadPlan();
    const ok = await copyText(workoutText(log, { sidedOf: (id) => sidedInPlan(plan, id) }));
    toast(ok ? '已复制,可以粘到微信里' : '复制失败,再试一次', ok ? 'success' : 'none');
  };

  if (!log) {
    /* 空态要说清楚「下一步点哪里」——只说缺什么就是个死胡同(这一页多半是从
       历史/计划页点进来的,用户手里的动作是「那我去练一次」)。有计划的直接开练,
       没计划的先去生成。 */
    const hasPlan = Boolean(loadPlan());
    return (
      <Screen className="sh-page">
        <View className="card sh-empty">
          <Image className="sh-empty-icon" src={dumbbellIcon} mode="aspectFit" />
          <Text className="fs-h1">还没有训练记录</Text>
          <Text className="fs-caption text-secondary">
            先完成一次训练,这里才有可以分享的内容。
          </Text>
          <Button
            className="btn btn--primary sh-empty-cta"
            onClick={() => navigate(hasPlan ? '/pkg-exercise/workout/index' : '/pkg-exercise/plan-create/index')}
          >
            {hasPlan ? '去练一次' : '先建一个计划'}
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen className="sh-page">
      <View className="card sh-head">
        <Text className="fs-h1">训练分享卡</Text>
        <Text className="fs-caption">
          这就是要发出去的那张图。存到相册后可以自己发,也可以直接发给朋友。
        </Text>
      </View>

      <View className="card sh-stage">
        {/* 画布按 2:3 显示,导出的是 1200×1800 */}
        <Canvas type="2d" id="share-card" className="sh-canvas" />
        {!tmp && <Text className="fs-mini text-secondary sh-hint">图片生成中…</Text>}
      </View>

      {prText ? <Text className="fs-mini sh-pr">{prText}</Text> : null}

      <View className="sh-actions">
        <Button className="btn btn--primary sh-btn" disabled={!tmp} onClick={saveToAlbum}>保存到相册</Button>
        <Button className="btn btn--secondary sh-btn" disabled={!tmp} onClick={shareImage}>发给朋友</Button>
      </View>

      <Button className="btn btn--secondary btn--block sh-copy" onClick={copyWorkoutText}>复制文字版</Button>

      <View className="card sh-note">
        <Text className="fs-mini sh-note-line">· 图上只有这次训练的数据,没有照片、没有体重。</Text>
        <Text className="fs-mini sh-note-line">· 「复制文字版」出来的是一段纯文字:发给教练之后他能在后面添两句,也能直接贴进表格。</Text>
        <Text className="fs-mini sh-note-line">· 想换一次分享:去计划页的历史记录里点「分享这次训练」。</Text>
      </View>
    </Screen>
  );
}
