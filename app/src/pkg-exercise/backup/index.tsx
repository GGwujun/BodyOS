import { useState } from 'react';
import { Button, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { copyText, toast } from '@/utils/ui';
import {
  BACKUP_HEAD, BIG_BACKUP_CHARS, applyBundle, buildBundle, bundleText,
  countsOf, hasAnything, parseBundle, saveToFile, type BackupBundle, type ImportResult
} from '../engine/backup';
import './index.scss';
import { navigate } from '@/utils/nav';

const line = (n: number, unit: string) => (n ? `${n} ${unit}` : null);

/** 一句话说清这份备份里有什么 */
function describe(b: BackupBundle): string {
  const c = countsOf(b);
  return [
    c.plan ? '训练计划 1 份' : null,
    line(c.logs, '次训练记录'),
    line(c.maxes, '个力量基准'),
    line(c.notes, '条动作备注'),
    c.kit ? '器材清单' : null,
    line(c.photos, '张照片记录'),
    line(c.custom, '个自定义动作')
  ].filter(Boolean).join(' · ') || '没有训练数据';
}

/**
 * 导出与备份 —— 云同步之外的兜底:把训练数据变成一段能复制走的文本。
 * 手机上没有「存文件」这一步,所以主路径是复制到剪贴板;电脑端微信可以另外存成文件。
 */
export default function BackupPage() {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<{ chars: number; desc: string } | null>(null);
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<BackupBundle | null>(null);
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filePath, setFilePath] = useState('');
  /**
   * 本机有没有可备份的东西。**每次回到这页都重算**:用户可能就是从这页跳去练了一次
   * 再回来的(push 进来的页面回来不会重挂载,只在挂载时算会一直停在旧答案上)。
   * 初值给 true:先按「有」渲染,免得正常用户先看到一闪而过的空态。
   */
  const [anything, setAnything] = useState(true);
  useDidShow(() => setAnything(hasAnything(buildBundle())));

  const doExport = async () => {
    const bundle = buildBundle();
    if (!hasAnything(bundle)) {
      toast('还没有训练数据可以导出');
      return;
    }
    const t = bundleText(bundle);
    setText(t);
    setExported({ chars: t.length, desc: describe(bundle) });
    setResult(null);
    track('training_backup_export', 'other');
    const okCopy = await copyText(t);
    setCopied(okCopy);
    if (okCopy) toast(`已复制(${t.length} 字),粘贴到备忘录或发给自己就是备份`);
    else toast('复制没成功,请在下面长按手动全选复制');
  };

  const doSaveFile = async () => {
    if (!text) { toast('先点上面的「生成备份内容」'); return; }
    const p = await saveToFile(text);
    if (p) { setFilePath(p); toast('已存到小程序文件里'); }
    else toast('这台设备存不了文件,用复制的那份吧');
  };

  const doParse = (v: string) => {
    setPaste(v);
    setResult(null);
    const r = parseBundle(v);
    if (r.ok) { setParsed(r.bundle); setParseError(''); }
    else { setParsed(null); setParseError(v.trim() ? r.error : ''); }
  };

  const doImport = async (mode: 'merge' | 'replace') => {
    if (!parsed) return;
    if (mode === 'replace') {
      const { confirm } = await Taro.showModal({
        title: '覆盖本机数据',
        content: '本机现在的计划、日志、器材会被这份备份整份替换掉,不能撤销。确定吗?',
        confirmText: '覆盖'
      });
      if (!confirm) return;
    }
    const r = applyBundle(parsed, mode);
    setResult(r);
    track('training_backup_import', 'other');
    toast('导入完成');
  };

  return (
    <Screen className="bk-page">
      <View className="card bk-head">
        <Text className="fs-h1">导出与备份</Text>
        <Text className="fs-caption">
          训练数据平时在「训练数据同步」里传到云端。这里给你一份能带走的文本:
          复制到备忘录、发给自己,换手机或清缓存之后粘回来就能恢复。
        </Text>
      </View>

      {/* ---- 导出 ---- */}
      <View className="card bk-block">
        <Text className="bk-title">导出</Text>
        <Text className="fs-mini text-secondary bk-note">
          文本里是计划、训练记录、力量基准、动作备注、器材清单和照片记录(图片文件本身不包含)。
        </Text>
        <Button className="btn btn--primary btn--block" onClick={doExport}>生成备份内容</Button>
        {/* 本机什么都没有的时候,点了只会弹一句「没有数据」—— 那等于把用户堵在这页。
            顺手给个能真的产生数据的出口(练一次),别让他再自己找路。 */}
        {!anything && (
          <>
            <Text className="fs-mini text-secondary bk-note">
              这台设备上还没有训练数据,暂时没什么可备份的。
            </Text>
            <Button
              className="btn btn--secondary btn--block"
              onClick={() => navigate('/pkg-exercise/workout/index')}
            >
              去练一次
            </Button>
          </>
        )}
        {exported && (
          <Text className="fs-mini text-secondary bk-meta">共 {exported.chars} 字 · {exported.desc}</Text>
        )}
        {exported && (
          <View className="bk-actions">
            <View className="bk-act" onClick={doExport}>再复制一次</View>
            <View className="bk-act" onClick={doSaveFile}>存成文件</View>
          </View>
        )}
        {filePath && <Text className="fs-mini text-secondary bk-meta">已存:{filePath}</Text>}
        {exported && exported.chars > BIG_BACKUP_CHARS && (
          <Text className="fs-mini bk-warn">
            内容有点大,手机复制可能失败。试试「存成文件」(电脑端微信能直接另存到磁盘),
            或者先在小程序里删掉一些特别老的训练记录。
          </Text>
        )}
        {/* 复制成功就只给个开头看看(几万字的文本全渲染会卡);没复制成功才整份摊出来让人手动选 */}
        {!!text && (
          <Textarea
            className="bk-area"
            value={copied ? `${text.slice(0, 600)}\n…(完整内容已复制到剪贴板)` : text}
            maxlength={-1}
            onInput={() => undefined}
          />
        )}
      </View>

      {/* ---- 导入 ---- */}
      <View className="card bk-block">
        <Text className="bk-title">导入</Text>
        <Text className="fs-mini text-secondary bk-note">
          把备份文本粘到这里。默认只补本机没有的内容,不会动你现在正在练的计划。
        </Text>
        <Textarea
          className="bk-area bk-area--in"
          value={paste}
          placeholder={`粘贴以 ${BACKUP_HEAD} 开头的备份文本`}
          maxlength={-1}
          onInput={(e) => doParse(e.detail.value)}
        />
        {parseError ? <Text className="fs-mini bk-warn">{parseError}</Text> : null}
        {parsed && (
          <>
            <Text className="fs-mini bk-ok">读出来了:{describe(parsed)}</Text>
            <View className="bk-actions">
              <Button className="btn btn--primary bk-act-btn" onClick={() => doImport('merge')}>补进本机</Button>
              <Button className="btn btn--secondary bk-act-btn" onClick={() => doImport('replace')}>整份覆盖</Button>
            </View>
          </>
        )}
      </View>

      {result && (
        <View className="card bk-result">
          <Text className="bk-result-title">导入完成({result.mode === 'merge' ? '补充' : '覆盖'})</Text>
          <Text className="fs-mini bk-line">
            {[
              line(result.logsAdded, '次训练记录'),
              line(result.notesAdded, '条备注'),
              line(result.maxes, '个力量基准'),
              line(result.photosAdded, '张照片记录'),
              line(result.customAdded, '个自定义动作'),
              result.plan ? '训练计划' : null,
              result.kit ? '器材清单' : null
            ].filter(Boolean).join(' · ') || '没有新增内容(本机已经有了)'}
          </Text>
          <Text className="fs-mini text-secondary bk-line">
            导入的数据会在下次同步时一起传到云端。
          </Text>
        </View>
      )}

      <View className="card bk-tip">
        <Text className="bk-title">怎么存最稳妥</Text>
        <Text className="fs-mini bk-line">1. 打开「训练数据同步」确认一次同步(云端有一份)。</Text>
        <Text className="fs-mini bk-line">2. 再来这里生成备份,复制到微信收藏或发给自己。</Text>
        <Text className="fs-mini bk-line">3. 换手机:新设备登录后先同步;同步不到再用这份文本导入。</Text>
      </View>
    </Screen>
  );
}
