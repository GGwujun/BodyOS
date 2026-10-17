import { useEffect, useState } from 'react';
import { Button, Picker, Switch, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { trainingApi } from '@/services';
import { track } from '@/services/analytics';
import { todayStr } from '@/utils/date';
import { TIME_CHOICES, hasLocalReminder, hhmmText, loadReminder, saveReminder, type ReminderSettings } from '@/utils/reminder';
import { toast } from '@/utils/ui';
import { nudgeFor, NUDGE_TONES, NUDGE_TONE_DESC, NUDGE_TONE_ZH, gapText } from '../engine/nudge';
import { loadDayNotes, noteOf, noteText, type DayNotes } from '../engine/daynote';
import { loadDayAssigns } from '../engine/dayassign';
import { loadAlert, saveAlert, type AlertPrefs } from '../engine/alert';
import { loadLogs, loadPlan } from '../engine/store';
import './index.scss';
import { THEME } from '@/constants/theme';

/** 微信订阅消息的申请结果:每个模板 id 一个 'accept' | 'reject' | 'ban' */
type SubResult = Record<string, string>;

/**
 * 在线时把设置镜像到服务器 —— 订阅消息只能由服务端发,它得知道几点发、按哪个时区算。
 * 离线/未登录时不影响本机设置,只是这一项同步不上去,所以失败只提示不拦。
 */
async function pushToServer(next: ReminderSettings): Promise<{ ok: boolean; dto?: trainingApi.ReminderDto }> {
  try {
    const dto = await trainingApi.putReminder({
      enabled: next.enabled,
      time: next.time,
      tone: next.tone,
      nudge: next.nudge,
      tzOffsetMin: next.tzOffsetMin
    });
    return { ok: true, dto };
  } catch {
    return { ok: false };
  }
}

/**
 * 训练提醒 —— 小程序没法规矩地自己响铃,所以这里如实做三件事:
 *   1. **小程序里的提醒**:你打开小程序,它就按你的节奏和语气说一句(不用设置也生效);
 *   2. **微信发一条消息**:要你亲手点一下授权,一次授权只发一条,这是微信的规矩;
 *   3. **练的时候怎么提示你**:保屏 + 震动(见 engine/alert.ts),这一份只存本机。
 */
export default function ReminderPage() {
  const [s, setS] = useState<ReminderSettings>(loadReminder);
  const [alert, setAlert] = useState<AlertPrefs>(loadAlert);
  const [tmplId, setTmplId] = useState('');
  const [grants, setGrants] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dayNotes] = useState<DayNotes>(loadDayNotes);

  const today = todayStr();
  const todayNote = noteOf(dayNotes, today);
  // 今天该不该提一句 —— 直接拿本机计划与日志现算,让用户当场看到效果。
  // 预览也必须带上改练:预览说「今天练推」而点进去开练是拉,那这个预览就是骗人的
  const nudge = nudgeFor(
    { plan: loadPlan(), logs: loadLogs(), tone: s.tone, notes: dayNotes, assigns: loadDayAssigns() },
    today
  );

  useEffect(() => {
    track('reminder_view', 'other');
    void (async () => {
      try {
        const dto = await trainingApi.getReminder();
        setTmplId(dto.tmplId);
        setGrants(dto.grants);
        if (hasLocalReminder()) {
          // 本机存过:设置以本机为准,服务器只是照着发 —— 顺手把服务器对齐过来。
          // (反过来做的话,离线改过设置的人一联网就会被服务器上的旧值悄悄改回去)
          const r = await pushToServer(s);
          setOnline(r.ok);
          if (r.dto) setGrants(r.dto.grants);
        } else {
          // 换手机/重装:本机一片空白,这时服务器上那份才是用户最后的样子
          setS(saveReminder({ enabled: dto.enabled, tone: dto.tone, time: dto.time }));
        }
      } catch {
        setOnline(false);
      }
    })();
  }, []);

  const apply = async (patch: Partial<ReminderSettings>) => {
    const next = saveReminder(patch);
    setS(next);
    const r = await pushToServer(next);
    setOnline(r.ok);
    if (r.dto) setGrants(r.dto.grants);
  };

  /** 申请一次订阅消息授权。微信一次授权只能发一条 —— 所以这是「领额度」不是「开开关」 */
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

  const toggle = async (v: boolean) => {
    if (busy) return;
    if (!v) {
      await apply({ enabled: false });
      return;
    }
    if (!tmplId) {
      toast('后台还没配提醒模板,现在只有小程序里的提醒');
      return;
    }
    setBusy(true);
    try {
      const accepted = await askSubscribe();
      if (!accepted) {
        toast('没拿到微信授权,消息发不出来;小程序里照样提醒你');
        return;
      }
      await apply({ enabled: true });
      try {
        const dto = await trainingApi.grantReminder(accepted);
        setGrants(dto.grants);
        toast('设好了,到点会给你发一条');
      } catch {
        toast('授权拿到了,但没存上,稍后再开一次');
      }
    } finally {
      setBusy(false);
    }
  };

  /** 「练的时候」那两项是**本机设置**(这块屏、这部机器),存下来就完事,不用往服务器推 */
  const setAlertPref = (patch: Partial<AlertPrefs>) => setAlert(saveAlert(patch));

  const addGrant = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const accepted = await askSubscribe();
      if (!accepted) {
        toast('这次没授权,下次再点');
        return;
      }
      const dto = await trainingApi.grantReminder(accepted);
      setGrants(dto.grants);
      toast('好了,又能给你发一条');
    } catch {
      setOnline(false);
      toast('没连上服务器,稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen className="rm-page">
      <View className="card rm-head">
        <Text className="fs-h1">训练提醒</Text>
        <Text className="fs-caption">
          小程序没法自己在后台响铃(微信的限制),所以这里做三件事:你在小程序里打开就看到提醒;
          想要微信给你发一条消息,得你亲手点一下授权;练的过程中怎么提示你,在下面「练的时候」里定。
        </Text>
      </View>

      <View className="card rm-preview">
        <Text className="rm-preview-label">今天会这样提醒你</Text>
        {todayNote ? (
          <>
            <Text className="rm-preview-title">今天不提醒你</Text>
            <Text className="fs-mini text-secondary">
              你在计划页记了「今天{noteText(todayNote)}」—— 请假的日子连消息也不发。
              销假之后照常提醒。
            </Text>
          </>
        ) : nudge ? (
          <>
            <Text className="rm-preview-title">{nudge.title}</Text>
            <Text className="rm-preview-line">{nudge.line}</Text>
            <Text className="fs-mini text-secondary">
              {gapText(nudge.gapDays, nudge.missedCount)} · 建议练「{nudge.dayTitle}」
            </Text>
          </>
        ) : (
          <>
            <Text className="rm-preview-title">今天不用提醒你</Text>
            <Text className="fs-mini text-secondary">
              要么今天已经练过了,要么按你的节奏还没到该练的时候 —— 这两种情况都不打扰。
            </Text>
          </>
        )}
      </View>

      <View className="card rm-tone">
        <Text className="fs-h1">提醒的语气</Text>
        <Text className="fs-caption">同样的提醒,换个说法</Text>
        <View className="rm-chips">
          {NUDGE_TONES.map((t) => (
            <View
              key={t}
              className={`rm-chip${s.tone === t ? ' is-on' : ''}`}
              onClick={() => void apply({ tone: t })}
            >
              <Text className="rm-chip-name">{NUDGE_TONE_ZH[t]}</Text>
              <Text className="fs-mini rm-chip-desc">{NUDGE_TONE_DESC[t]}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className="card rm-msg">
        <View className="rm-row">
          <View className="rm-row-text">
            <Text className="rm-row-title">微信给我发提醒</Text>
            <Text className="fs-mini text-secondary">
              {!online
                ? '没连上服务器,这项设置暂时存不了'
                : !tmplId
                  ? '后台还没配好提醒模板,现在只有小程序里的提醒'
                  : s.enabled
                    ? `开着 · 还能发 ${grants} 条`
                    : '关着'}
            </Text>
          </View>
          <Switch
            checked={s.enabled}
            disabled={!online || !tmplId || busy}
            color={THEME.primary}
            onChange={(e) => void toggle(e.detail.value)}
          />
        </View>

        {online && tmplId ? (
          <View className="rm-time">
            <Text className="rm-row-title">提醒时间</Text>
            <Picker
              mode="selector"
              range={TIME_CHOICES}
              value={Math.max(0, TIME_CHOICES.indexOf(s.time))}
              onChange={(e) => void apply({ time: TIME_CHOICES[Number(e.detail.value)] ?? s.time })}
            >
              <View className="rm-picker">{hhmmText(s.time)}</View>
            </Picker>
          </View>
        ) : null}

        <View className="rm-row rm-row--sub">
          <View className="rm-row-text">
            <Text className="rm-row-title">计划日没练也提一句</Text>
            <Text className="fs-mini text-secondary">该练没练的日子,当晚再说一次,不会天天念</Text>
          </View>
          <Switch checked={s.nudge} color={THEME.primary} onChange={(e) => void apply({ nudge: e.detail.value })} />
        </View>

        {online && tmplId && s.enabled ? (
          <Button className="btn btn--secondary btn--block rm-grant" loading={busy} disabled={busy} onClick={addGrant}>
            再领一条提醒额度
          </Button>
        ) : null}
      </View>

      {/* 练的时候怎么提示你 —— 两项都**只存本机**:它们管的是这块屏和这部机器,换设备该重定一次 */}
      <View className="card rm-alert">
        <Text className="fs-h1">练的时候</Text>
        <Text className="fs-caption">练的过程中手机怎么配合你</Text>

        <View className="rm-row">
          <View className="rm-row-text">
            <Text className="rm-row-title">屏幕保持常亮</Text>
            <Text className="fs-mini text-secondary">
              组间歇看着倒计时,屏幕不会自己灭;离开小程序就恢复
            </Text>
          </View>
          <Switch
            checked={alert.keepAwake}
            color={THEME.primary}
            onChange={(e) => setAlertPref({ keepAwake: e.detail.value })}
          />
        </View>

        <View className="rm-row rm-row--sub">
          <View className="rm-row-text">
            <Text className="rm-row-title">勾组和休息结束时震一下</Text>
            <Text className="fs-mini text-secondary">
              勾完一组、休息剩最后 3 秒、休息结束各震一次;手机静音也照样有
            </Text>
          </View>
          <Switch
            checked={alert.vibrate}
            color={THEME.primary}
            onChange={(e) => setAlertPref({ vibrate: e.detail.value })}
          />
        </View>
      </View>

      <View className="card rm-note">
        <Text className="rm-note-title">提醒的规矩</Text>
        <Text className="fs-mini rm-note-line">· 微信规定一次授权只给发一条,发完要再点一次 —— 所以额度会一直显示还剩几条。</Text>
        <Text className="fs-mini rm-note-line">· 过了当天晚上就不再补发:凌晨收到「今天该练了」比收不到更糟。</Text>
        <Text className="fs-mini rm-note-line">· 连着三次该练没练就不再催了。断久了回来,这里只会说一句「回来就好」。</Text>
        <Text className="fs-mini rm-note-line">· 提醒时间按你手机所在时区算,出差换时区会跟着变。</Text>
        <Text className="fs-mini rm-note-line">· 关掉这个页面里的开关不影响你自己开小程序练,只是不再给你发消息。</Text>
        <Text className="fs-mini rm-note-line">· 「练的时候」那两项只管当前这台手机 —— 它管的是这块屏和这部机器,换手机自己重新定一次。</Text>
        <Text className="fs-mini rm-note-line">· 提示靠震动而不是声音:小程序一退到后台就不再运行了,声音要在你正看着屏幕时才有意义,而静音时震得到。</Text>
      </View>
    </Screen>
  );
}
