import { useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { ingredientApi } from '@/services';
import type { IngredientScanResult } from '@/services/types';
import { track } from '@/services/analytics';
import { fileToBase64 } from '@/utils/file';
import { toast } from '@/utils/ui';
import { Photograph, BulbOutlined, InfoOutlined } from '@taroify/icons';
import './index.scss';

type ScanState = 'idle' | 'scanning' | 'done' | 'failed';

export default function Ingredient() {
  const [state, setState] = useState<ScanState>('idle');
  const [result, setResult] = useState<IngredientScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [shot, setShot] = useState<string>(''); // 最近一次拍摄的本地预览路径

  const scan = async (sourceType: 'camera' | 'album') => {
    try {
      const media = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: [sourceType]
      });
      const file = media.tempFiles[0].tempFilePath;
      setShot(file);
      setState('scanning');
      setErrorMsg('');
      track('ingredient_scan_start', 'other', { source: sourceType });
      const base64 = await fileToBase64(file);
      const r = await ingredientApi.scanIngredients(base64);
      setResult(r);
      setState('done');
      track('ingredient_scan_done', 'other', { count: r.ingredients.length });
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      if (msg?.includes('cancel') || msg?.includes('fail cancel')) return; // 用户取消选图
      setErrorMsg(msg || '识别失败');
      setState('failed');
    }
  };

  const reset = () => {
    setResult(null);
    setShot('');
    setErrorMsg('');
    setState('idle');
  };

  return (
    <Screen className="ing-page">
      {state === 'idle' && (
        <View className="card intro-card">
          <View className="intro-emoji">🧾</View>
          <Text className="fs-h1">看懂配料表</Text>
          <Text className="fs-caption text-secondary">
            拍下食品包装上的配料表，按排列顺序读出配料（排得越靠前，含量越高），并给出选购提示。
          </Text>
          <View className="row intro-actions">
            <Button className="btn btn--primary" onClick={() => scan('camera')}>
              <Photograph /> 拍照识别
            </Button>
            <Button className="btn btn--secondary" onClick={() => scan('album')}>
              从相册选择
            </Button>
          </View>
        </View>
      )}

      {state === 'idle' && (
        <View className="card tip-card">
          <View className="tip-title"><BulbOutlined /><Text>怎么拍更准</Text></View>
          <Text className="fs-mini text-secondary">1. 对准包装背面的配料表区域，让文字铺满画面。</Text>
          <Text className="fs-mini text-secondary">2. 光线充足、避免反光，小字建议凑近拍。</Text>
          <Text className="fs-mini text-secondary">3. 一张图只拍一个产品的配料表，识别更完整。</Text>
        </View>
      )}

      {state === 'scanning' && (
        <View className="card">
          <Text className="fs-caption text-info">正在读取配料表…</Text>
          {shot ? <Text className="fs-mini text-secondary mt-2">通常需要几秒钟，请稍候。</Text> : null}
        </View>
      )}

      {state === 'done' && result && (
        <>
          <View className="card">
            <View className="between">
              <Text className="fs-h1">配料清单</Text>
              <Text className="fs-mini text-secondary">共 {result.ingredients.length} 项</Text>
            </View>
            <Text className="fs-mini text-secondary">按包装上的排列顺序列出，越靠前含量越高。</Text>
            <View className="ing-list">
              {result.ingredients.map((name, i) => (
                <View key={`${i}-${name}`} className="ing-row">
                  <Text className={`ing-no${i < 3 ? ' is-top' : ''}`}>{i + 1}</Text>
                  <Text className="ing-name">{name}</Text>
                  {i === 0 && <Text className="ing-flag">含量最高</Text>}
                </View>
              ))}
            </View>
          </View>

          {result.notes.length > 0 && (
            <View className="card">
              <Text className="fs-h1">选购提示</Text>
              {result.notes.map((n, i) => (
                <View key={i} className={`note-row note-row--${n.level}`}>
                  <Text className="note-dot">{n.level === 'warn' ? '!' : '✓'}</Text>
                  <Text className="note-text">{n.text}</Text>
                </View>
              ))}
            </View>
          )}

          <View className="card tip-card">
            <View className="tip-title"><InfoOutlined /><Text>小提示</Text></View>
            <Text className="fs-mini text-secondary">
              配料表按含量从高到低排列：前三位基本决定了这个产品的主要成分。营养标签要看「每 100g」一栏，再结合净含量换算。
            </Text>
          </View>

          <Button className="btn btn--primary btn--block" onClick={reset}>识别另一个产品</Button>
          <Text className="fs-mini text-secondary disclaimer">结果由图像识别生成，可能存在误差，仅供参考。</Text>
        </>
      )}

      {state === 'failed' && (
        <View className="card">
          <Text className="fs-h2 text-danger">识别失败</Text>
          <Text className="fs-caption">{errorMsg}。未影响数据，请对准配料表重试。</Text>
          <View className="row intro-actions">
            <Button className="btn btn--primary" onClick={() => scan('camera')}>重新拍照</Button>
            <Button className="btn btn--secondary" onClick={reset}>返回</Button>
          </View>
        </View>
      )}
    </Screen>
  );
}
