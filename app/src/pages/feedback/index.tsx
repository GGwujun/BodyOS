import { useMemo, useState } from 'react';
import { Button, Image, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { AddOutlined, ChatOutlined, Passed, PhoneOutlined } from '@taroify/icons';
import Screen from '@/components/Screen';
import { feedbackApi, trainingApi } from '@/services';
import { track } from '@/services/analytics';
import { mediaUrl } from '@/utils/media';
import { fileToBase64 } from '@/utils/file';
import { toast } from '@/utils/ui';
import { switchTab } from '@/utils/nav';
import './index.scss';

type Kind = 'bug' | 'idea';

const KINDS: Array<{ key: Kind; label: string }> = [
  { key: 'bug', label: '问题反馈' },
  { key: 'idea', label: '功能建议' }
];

const PLACEHOLDER: Record<Kind, string> = {
  bug: '哪一步不对？当时在做什么、看到什么、期望是什么。',
  idea: '希望加什么？你会在什么场景下用它。'
};

/** 只收用户主动写的 + 排障上下文;健康数据、openid、令牌一律不带 */
interface Context {
  pagePath: string;
  appVersion: string;
  sdkVersion: string;
  platform: string;
}

/**
 * 意见反馈 / 功能建议 —— 一个入口、两种类型。
 *
 * 不拆成两个菜单项:用户往往分不清自己要说的是「坏了」还是「想要」,
 * 两个入口只会让他先纠结选哪个。类型只是页内一个段选。
 *
 * 成功态**不只是一句 toast**:反馈最容易让人不放心的是「到底发出去没有」,
 * 所以原地切成「已收到」,并给出去向(再提一条 / 返回)。
 */
export default function Feedback() {
  const router = Taro.getCurrentInstance().router;
  const initialKind: Kind = router?.params?.kind === 'idea' ? 'idea' : 'bug';
  const from = router?.params?.from ?? '';

  const [kind, setKind] = useState<Kind>(initialKind);
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [shots, setShots] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useDidShow(() => { track('feedback_view', 'other', { kind: initialKind, from }); });

  /**
   * 上下文只在进页时取一次。页面路径取**上一页**(反馈页自己不该被报上去),
   * 从数据源同步失败那条链接进来的则明确写成数据源页 —— URL 里的 from 比栈更可信。
   */
  const ctx = useMemo<Context>(() => {
    let appVersion = '';
    try {
      const acc = Taro.getAccountInfoSync();
      appVersion = acc?.miniProgram?.version || acc?.miniProgram?.envVersion || '';
    } catch { /* 老版本基础库没有这个接口,留空即可 */ }
    let sdkVersion = '';
    let platform = '';
    try {
      const info = Taro.getSystemInfoSync();
      sdkVersion = info.SDKVersion ?? '';
      platform = [info.brand, info.model, info.system].filter(Boolean).join(' · ');
    } catch { /* 同上 */ }
    const stack = Taro.getCurrentPages?.() ?? [];
    const prev = stack.length > 1 ? (stack[stack.length - 2] as { route?: string } | undefined) : undefined;
    const pagePath = from === 'sync'
      ? '/pages/data-sources/index'
      : prev?.route ? `/${prev.route.replace(/^\//, '')}` : '';
    return { pagePath, appVersion, sdkVersion, platform };
  }, [from]);

  const addShots = async () => {
    if (uploading || shots.length >= 3) return;
    try {
      const media = await Taro.chooseMedia({
        count: 3 - shots.length,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });
      const files = media.tempFiles ?? [];
      if (!files.length) return;
      setUploading(true);
      const urls: string[] = [];
      for (const f of files) {
        const base64 = await fileToBase64(f.tempFilePath);
        const r = await trainingApi.uploadMedia(base64);
        urls.push(r.url);
      }
      setShots((prev) => [...prev, ...urls].slice(0, 3));
    } catch (e) {
      const msg = String((e as { errMsg?: string; message?: string })?.errMsg
        ?? (e as { message?: string })?.message ?? '');
      if (!msg.includes('cancel')) toast('截图没加上，再试一次', 'none');
    } finally {
      setUploading(false);
    }
  };

  const removeShot = (url: string) => {
    setShots((prev) => prev.filter((u) => u !== url));
  };

  const preview = (url: string) => {
    void Taro.previewImage({ current: mediaUrl(url), urls: shots.map(mediaUrl) });
  };

  const canSubmit = content.trim().length >= 4 && !submitting && !uploading;

  const submit = async () => {
    if (!canSubmit) {
      if (content.trim().length < 4) toast('再多写一句吧，至少 4 个字', 'none');
      return;
    }
    setSubmitting(true);
    try {
      await feedbackApi.submitFeedback({
        kind,
        content: content.trim(),
        contact: contact.trim() || undefined,
        images: shots.length ? shots : undefined,
        pagePath: ctx.pagePath || undefined,
        appVersion: ctx.appVersion || undefined,
        sdkVersion: ctx.sdkVersion || undefined,
        platform: ctx.platform || undefined
      });
      track('feedback_submit', 'other', { kind, hasImages: shots.length > 0 });
      setSubmitted(true);
    } catch (e) {
      toast((e as { message?: string })?.message || '没发出去，请稍后再试', 'none');
    } finally {
      setSubmitting(false);
    }
  };

  const restart = () => {
    setSubmitted(false);
    setContent('');
    setContact('');
    setShots([]);
    setKind(initialKind);
  };

  const back = () => {
    if ((Taro.getCurrentPages?.() ?? []).length > 1) {
      void Taro.navigateBack().catch(() => switchTab('/pages/profile/index'));
    } else {
      switchTab('/pages/profile/index');
    }
  };

  if (submitted) {
    return <Screen className="fb-page">
      <View className="card fb-done">
        <View className="fb-done-icon"><Passed /></View>
        <Text className="fb-done-title">已收到</Text>
        <Text className="fb-done-copy">
          我们会在 1–2 个工作日内查看。需要回复的话，会通过你留下的联系方式联系你。
        </Text>
        <Button className="btn btn--primary btn--block" onClick={restart}>再提一条</Button>
        <Button className="btn btn--secondary btn--block" onClick={back}>返回</Button>
      </View>
      <View className="card fb-service-card">
        <View className="fb-service-copy">
          <Text className="fs-h2">想直接说？</Text>
          <Text className="fs-mini text-secondary">在线客服会打开微信的对话窗口，工作时间内回复更快。</Text>
        </View>
        <Button
          className="btn btn--secondary btn--mini fb-service-btn"
          openType="contact"
          onContact={() => track('feedback_service_open', 'other', { from: 'done' })}
        >
          <PhoneOutlined /> 在线客服
        </Button>
      </View>
    </Screen>;
  }

  const count = content.length;
  return <Screen className="fb-page">
    <View className="card fb-intro">
      <View className="fb-intro-head">
        <ChatOutlined />
        <Text className="fs-h1">意见反馈</Text>
      </View>
      <Text className="fs-mini text-secondary fb-intro-copy">
        用着哪里不对，或者希望加什么功能，都可以写在这里。截图和联系方式都是选填。
      </Text>
    </View>

    <View className="card fb-form">
      <View className="fb-kinds">
        {KINDS.map((k) => <View
          key={k.key}
          className={`fb-kind${kind === k.key ? ' is-on' : ''}`}
          onClick={() => setKind(k.key)}
        >
          <Text className="fb-kind-name">{k.label}</Text>
        </View>)}
      </View>

      <View className={`fb-textarea${count > 0 ? ' is-filled' : ''}`}>
        <Textarea
          className="fb-textarea-input"
          value={content}
          maxlength={1000}
          autoHeight
          placeholder={PLACEHOLDER[kind]}
          placeholderClass="fb-placeholder"
          onInput={(e) => setContent(e.detail.value)}
        />
        <Text className={`fb-count${count > 1000 ? ' is-over' : ''}`}>{count} / 1000</Text>
      </View>

      <View className="fb-label-row">
        <Text className="fs-caption fb-label">截图</Text>
        <Text className="fs-mini text-secondary">最多 3 张</Text>
      </View>
      <View className="fb-shots">
        {shots.map((url) => <View key={url} className="fb-shot">
          <Image className="fb-shot-img" src={mediaUrl(url)} mode="aspectFill" onClick={() => preview(url)} />
          <View className="fb-shot-del" onClick={() => removeShot(url)}>✕</View>
        </View>)}
        {shots.length < 3 && <View className={`fb-shot-add${uploading ? ' is-busy' : ''}`} onClick={() => void addShots()}>
          <AddOutlined />
          <Text className="fs-mini text-secondary">{uploading ? '上传中…' : '添加'}</Text>
        </View>}
      </View>

      <View className="fb-label-row">
        <Text className="fs-caption fb-label">联系方式</Text>
        <Text className="fs-mini text-secondary">选填</Text>
      </View>
      <View className="fb-contact">
        <Textarea
          className="fb-contact-input"
          value={contact}
          maxlength={80}
          autoHeight
          placeholder="微信号或邮箱，方便我们回你"
          placeholderClass="fb-placeholder"
          onInput={(e) => setContact(e.detail.value)}
        />
      </View>

      <Text className="fb-context">
        提交时会附带：页面、小程序版本、基础库与机型，不会附带任何健康数据。
      </Text>

      <Button
        className={`btn btn--primary btn--block${canSubmit ? '' : ' btn--dim'}`}
        disabled={!canSubmit}
        loading={submitting}
        onClick={() => void submit()}
      >
        {submitting ? '正在提交…' : '提交'}
      </Button>
    </View>

    <View className="card fb-service-card">
      <View className="fb-service-copy">
        <Text className="fs-h2">也可以直接找客服</Text>
        <Text className="fs-mini text-secondary">微信的对话窗口，适合说清楚一句话就能解决的问题。</Text>
      </View>
      <Button
        className="btn btn--secondary btn--mini fb-service-btn"
        openType="contact"
        onContact={() => track('feedback_service_open', 'other', { from: 'form' })}
      >
        <PhoneOutlined /> 在线客服
      </Button>
    </View>
  </Screen>;
}
