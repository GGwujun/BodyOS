import { useMemo, useRef, useState } from 'react';
import { Button, Image, ScrollView, Slider, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { toast } from '@/utils/ui';
import { todayStr } from '@/utils/date';
import { track } from '@/services/analytics';
import {
  POSES, POSE_TIP, POSE_ZH, SHOOT_TIPS, addPhoto, ageOf, byMonth, countOf, dayGap, defaultPair,
  gapText, loadPhotos, monthLabel, photosOf, removePhoto, samePair, srcOf,
  type PhotoEntry, type Pose
} from '@/utils/photos';
import './index.scss';
import { THEME } from '@/constants/theme';

/** 进度照片 — 同角度的前后对比,滑块一拉就知道这两个月练了什么 */
export default function PhotosPage() {
  const [list, setList] = useState<PhotoEntry[]>([]);
  const [pose, setPose] = useState<Pose>('front');
  const [pair, setPair] = useState<{ before: string | null; after: string | null }>({ before: null, after: null });
  const [slot, setSlot] = useState<'before' | 'after'>('after');
  const [pct, setPct] = useState(50);
  const [shooting, setShooting] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const booted = useRef(false);

  useDidShow(() => {
    const current = loadPhotos();
    setList(current);
    if (!booted.current) {
      booted.current = true;
      track('photos_view', 'other');
      const p = defaultPair(current, pose);
      setPair({ before: p.before?.id ?? null, after: p.after?.id ?? null });
    }
  });

  const strip = useMemo(() => photosOf(list, pose), [list, pose]);
  const byId = (id: string | null) => (id ? strip.find((p) => p.id === id) ?? null : null);
  const before = byId(pair.before);
  const after = byId(pair.after);
  const comparable = !!before && !!after && !samePair(before, after);
  const gap = gapText(dayGap(before, after));
  const months = useMemo(() => byMonth(list), [list]);

  const switchPose = (next: Pose) => {
    setPose(next);
    const p = defaultPair(list, next);
    setPair({ before: p.before?.id ?? null, after: p.after?.id ?? null });
    setSlot('after');
    setPct(50);
  };

  const shoot = async (source: 'camera' | 'album') => {
    if (shooting) return;
    setShooting(true);
    try {
      const media = await Taro.chooseMedia({
        count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: [source]
      });
      const file = media.tempFiles?.[0]?.tempFilePath;
      if (!file) return;
      const entry = await addPhoto(file, pose, todayStr());
      const next = loadPhotos();
      setList(next);
      setPair((prev) => ({ before: prev.before, after: entry.id }));
      setSlot('after');
      toast('已加入时间线');
      track('photos_add', 'other', { pose });
    } catch (e) {
      const msg = String((e as { errMsg?: string; message?: string })?.errMsg ?? (e as { message?: string })?.message ?? '');
      if (msg.includes('cancel')) return;      // 用户自己取消的,不打扰
      toast((e as { message?: string })?.message || '拍照失败,请再试一次', 'error');
    } finally { setShooting(false); }
  };

  const pick = (p: PhotoEntry) => {
    setPair((prev) => ({ ...prev, [slot]: p.id }));
  };

  const remove = async (p: PhotoEntry) => {
    const { confirm } = await Taro.showModal({
      title: '删除照片',
      content: `删除 ${p.date} 的${POSE_ZH[p.pose]}照片吗?删了就找不回来了。`
    });
    if (!confirm) return;
    const next = removePhoto(p.id);
    setList(next);
    setPair((prev) => ({
      before: prev.before === p.id ? null : prev.before,
      after: prev.after === p.id ? null : prev.after
    }));
    toast('已删除');
  };

  const preview = (p: PhotoEntry) => {
    // 一律走 srcOf:同步回来的照片只有云端地址,没有本地文件
    const urls = strip.map(srcOf).filter(Boolean);
    Taro.previewImage({ current: srcOf(p), urls }).catch(() => undefined);
  };

  return (
    <Screen className="photos-page">
      <View className="card ph-intro">
        <Text className="fs-h1">进度照片</Text>
        <Text className="fs-caption">
          体重天天在浮动,照片不会。同一个角度、同样的光,隔一个月并排一比,
          变化比任何数字都直观。照片默认只存在这台手机上;到「训练数据同步」里同步一次,
          换设备也能看到。
        </Text>
        <Text className="ph-tip-toggle" onClick={() => setTipOpen((v) => !v)}>
          {tipOpen ? '收起拍照建议 ▲' : '怎么拍才有得比 ▼'}
        </Text>
        {tipOpen && (
          <View className="ph-tips">
            {SHOOT_TIPS.map((t) => <Text className="fs-mini text-secondary ph-tip" key={t}>· {t}</Text>)}
          </View>
        )}
      </View>

      <View className="card ph-block">
        <View className="ph-chips">
          {POSES.map((p) => (
            <Text
              className={`ph-chip${pose === p ? ' ph-chip--on' : ''}`}
              key={p}
              onClick={() => switchPose(p)}
            >
              {POSE_ZH[p]}{countOf(list, p) ? ` ${countOf(list, p)}` : ''}
            </Text>
          ))}
        </View>

        {strip.length === 0 && (
          <View className="ph-empty">
            <Text className="ph-empty-emoji">📷</Text>
            <Text className="fs-h1">还没有{POSE_ZH[pose]}照片</Text>
            <Text className="fs-caption">{POSE_TIP[pose]}</Text>
          </View>
        )}

        {strip.length > 0 && (
          <>
            <View className="ph-compare">
              {comparable ? (
                <>
                  <View className="ph-stage">
                    <Image className="ph-stage-img" src={srcOf(after!)} mode="aspectFill" onClick={() => preview(after!)} />
                    <View className="ph-clip" style={{ width: `${pct}%` }}>
                      <Image className="ph-stage-img" src={srcOf(before!)} mode="aspectFill" />
                    </View>
                    <View className="ph-line" style={{ left: `${pct}%` }} />
                    <Text className="ph-tag ph-tag--left">之前 {before!.date.slice(5)}</Text>
                    <Text className="ph-tag ph-tag--right">现在 {after!.date.slice(5)}</Text>
                  </View>
                  <Slider
                    className="ph-slider"
                    min={0}
                    max={100}
                    value={pct}
                    activeColor={THEME.primary}
                    backgroundColor="#e5e7eb"
                    blockSize={24}
                    onChange={(e) => setPct(e.detail.value)}
                  />
                  <Text className="fs-mini text-secondary ph-gap">
                    {gap}{before!.date !== after!.date ? ` · 拖动滑块看变化` : ''}
                  </Text>
                </>
              ) : (
                <Text className="fs-caption text-secondary ph-hint">
                  {strip.length === 1
                    ? `现在只有一张${POSE_ZH[pose]}照片。过几周再拍一张,这里就会变成可以拖动的前后对比。`
                    : '下面选两张不同的照片就能对比 —— 点「之前」或「现在」那个格子,再点照片。'}
                </Text>
              )}
            </View>

            <View className="ph-slots">
              <View
                className={`ph-slot${slot === 'before' ? ' ph-slot--on' : ''}`}
                onClick={() => setSlot('before')}
              >
                <Text className="ph-slot-k">之前</Text>
                <Text className="ph-slot-v">{before ? before.date.slice(5) : '未选择'}</Text>
              </View>
              <View
                className={`ph-slot${slot === 'after' ? ' ph-slot--on' : ''}`}
                onClick={() => setSlot('after')}
              >
                <Text className="ph-slot-k">现在</Text>
                <Text className="ph-slot-v">{after ? after.date.slice(5) : '未选择'}</Text>
              </View>
            </View>

            <ScrollView className="ph-strip" scrollX enableFlex>
              <View className="ph-strip-inner">
                {strip.map((p) => (
                  <View
                    className={`ph-thumb${p.id === pair.before ? ' ph-thumb--a' : ''}${p.id === pair.after ? ' ph-thumb--b' : ''}`}
                    key={p.id}
                    onClick={() => pick(p)}
                    onLongPress={() => remove(p)}
                  >
                    /* 照片墙可能有几十张,一次全解码会把首屏拖住 —— 微信的 lazy-load 按可视区再取 */
                    <Image className="ph-thumb-img" src={srcOf(p)} mode="aspectFill" lazyLoad />
                    <Text className="ph-thumb-date">{p.date.slice(5)}</Text>
                    {p.id === pair.before && <Text className="ph-badge ph-badge--a">前</Text>}
                    {p.id === pair.after && <Text className="ph-badge ph-badge--b">现</Text>}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text className="fs-mini text-secondary ph-strip-note">
              点照片放进当前格子里 · 长按删除 · {strip.length} 张{POSE_ZH[pose]}
            </Text>
          </>
        )}

        <View className="ph-actions">
          <Button className="btn btn--primary ph-btn" loading={shooting} disabled={shooting} onClick={() => shoot('camera')}>
            {shooting ? '处理中…' : '拍一张'}
          </Button>
          <Button className="btn btn--secondary ph-btn" disabled={shooting} onClick={() => shoot('album')}>
            从相册选
          </Button>
        </View>
        {/* 这一句在空态那张卡里已经说过一遍(见上面的 ph-empty):
            没有照片时同一屏说两遍,只会显得像出了两次提示 */}
        {strip.length > 0 && <Text className="fs-mini text-secondary ph-hint">{POSE_TIP[pose]}</Text>}
      </View>

      {months.length > 0 && (
        <View className="card ph-block">
          <Text className="fs-h1">全部照片</Text>
          {months.map((m) => (
            <View className="ph-month" key={m.month}>
              <Text className="ph-month-label">{monthLabel(m.month)} · {m.items.length} 张</Text>
              <View className="ph-grid">
                {m.items.map((p) => (
                  <View className="ph-cell" key={p.id} onClick={() => preview(p)} onLongPress={() => remove(p)}>
                    <Image className="ph-cell-img" src={srcOf(p)} mode="aspectFill" lazyLoad />
                    <View className="ph-cell-foot">
                      <Text className="ph-cell-pose">{POSE_ZH[p.pose]}</Text>
                      <Text className="ph-cell-age">{ageOf(list, p)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Text className="fs-mini text-secondary ph-hint">
            点开看大图,长按删除。坚持每两周拍一次,比每天称体重有用。
          </Text>
        </View>
      )}
    </Screen>
  );
}
