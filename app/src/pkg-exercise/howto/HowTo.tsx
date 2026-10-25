import { useMemo } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Image } from '@tarojs/components';
import { mediaUrl } from '@/services/training';
import { customImage, isCustomId } from '../engine/custom';
import { demoUrl } from '../engine/ex-media';
import { figureUrl, figureView } from '../engine/ex-figure';
import {
  BODYPART_ZH, CATEGORY_ZH, EQUIPMENT_ZH, FORCE_ZH, LEVEL_ZH, MECHANIC_ZH, MUSCLE_ZH,
  type ExerciseEntry
} from '../data/exercises';
import './index.scss';

/**
 * 一个动作「怎么做」的那一块 —— 演示图(有图才摆)、部位/器械/分类/难度/发力/结构那几个 chip、
 * 主要肌群、动作步骤,以及(调用方给了才显示的)用户自己写的那条常驻备注。
 *
 * **为什么单拎成一个组件**:有两处要看同一份东西 —— 动作库的详情弹层(挑动作的时候看)
 * 和训练页的速查栏(练到一半忘了怎么做的时候看)。两处各抄一遍的下场不是重复代码,
 * 是**两处教的不一样**,而训练中那一次恰恰是最不能出错的那一次。
 * 演示图和署名也是靠这一点才没有变成「动作库里有、训练中没有」。
 *
 * 自定义动作(`c-` 开头)没有库里的教学文字:`steps` 是空的,分类/难度/发力/结构也是空的
 * (那几格是动作库那套「编排」属性)—— 它只有用户自己写的备注,所以 `note` 由调用方决定
 * 传不传(没有东西可显示时不留一个空标题)。演示图同理是「库里才有的东西」;自定义动作
 * 传过配图的话,顶上那块摆的是用户那张(见下面的 MineImage),不是演示图。
 */

/** 中文映射查表 — 数据里的 key 是 string,各 ZH 表是窄字面量联合,统一在这里收口,查不到回退原值 */
const zh = (map: Record<string, string>, key: string): string => map[key] ?? key;

/**
 * 动作演示图 —— 一张**自己会循环**的 GIF,一个 Image 就完了。
 *
 * 上一版不是这样:那张是 Everkinetic 的「放松位 / 发力位」两张静止图交替放,
 * 靠客户端起个定时器假装在动 —— 用户一眼就看穿了(「这就不是动作啊,静态的」)。
 * GIF 自带循环,客户端不用做任何事,所以定时器、帧索引、显隐切换全删了。
 *
 * **没有「点一下暂停」**:微信用 `<Image>` 放的 GIF 停不下来。摆一句点不动的提示
 * 比不摆更糟 —— 那会让人以为是自己没点对。这一块因此**没有任何事件**,
 * 也就不必再操心 taro-events 那套(见 utils/taro-events)。
 */
export function DemoImage({ url }: { url: string }) {
  return (
    <View className="howto-demo">
      {/* aspectFit 而不是 widthFix:宽高在样式里写死了(180×180,上游就是这个尺寸,
          铺满会糊 —— 见 index.scss 那一段),widthFix 会拿图片比例去覆盖那个高度。
          aspectFit 是「框给定,图按比例塞进去」,框和图都是方的,正好 1:1 */}
      <View className="howto-demo__stage">
        <Image className="howto-demo__img" src={mediaUrl(url)} mode="aspectFit" />
      </View>
      <View className="howto-demo__bar">
        <Text className="howto-demo__pos">循环演示</Text>
      </View>
      {/* 署名:**许可要求每处用法都带这一行**,不是装饰。删了就是无署名使用
          (图和它的许可证说明见 THIRD-PARTY-NOTICES.md 第 3 节) */}
      <Text className="howto-demo__credit">动作图示 © Gym visual · gymvisual.com</Text>
    </View>
  );
}

/**
 * 自建动作的用户配图 —— 用户自己拍/选的那张(见 ex-new 表单的「配图」)。
 * 长得和上面的演示图一个模子,但有两处**故意不一样**:
 *   ① **没有署名行** —— `howto-demo__credit` 那行是 Gym visual 许可的要求,只属于那批图;
 *     摆在用户自己的照片下面就成了「这张图是 Gym visual 的」,那是错的。
 *   ② **点得开** —— 静态图放大了能看清插销在哪个孔;演示图那张是 GIF,微信的 Image 停不了
 *     也放不大,所以那边干脆不做点击。底部那句把自己的身份说清楚(「自己传的」),
 *     不然和演示图长得一样,用户分不清哪张是库里的教学、哪张是自己拍的。
 */
export function MineImage({ url }: { url: string }) {
  const preview = () => {
    void Taro.previewImage({ current: mediaUrl(url), urls: [mediaUrl(url)] });
  };
  return (
    <View className="howto-demo" onClick={preview}>
      <View className="howto-demo__stage">
        {/* aspectFit:机器照片多半不是方的,方框里按比例塞进去,不裁边 */}
        <Image className="howto-demo__img" src={mediaUrl(url)} mode="aspectFit" />
      </View>
      <View className="howto-demo__bar">
        <Text className="howto-demo__pos">自己传的配图 · 点开放大</Text>
      </View>
    </View>
  );
}

/**
 * 「练哪儿」示意图 —— 没有演示图的动作,详情最上面那块摆这个。
 *
 * 为什么不干脆空着:那一块是整页最先看到的,空着读起来像「这个页面没做完」。
 * 而「练哪儿」本来就是打开一个陌生动作时前两个问题之一(另一个是「怎么做」),
 * 答不上后者不等于前者也没得答 —— 库里 1324 条动作**每条都标了主要肌群**。
 *
 * 图是自己画的,所以没有署名行;这一点和上面的演示图不同,别顺手抄过去。
 */
export function FigureImage({ target }: { target?: string }) {
  const url = figureUrl(target);
  if (!url) return null;
  return (
    <View className="howto-figure">
      {/* 明说一句「没有演示图」——不写的话,这块看上去像是**演示图加载坏了**:
          用户知道自己点开的是「怎么做」,却看到一张不动的身体图,只能理解成出错。
          这一句只在这个组件里写(它只作为图的那条优先级链的**最后一环**出现,
          见上面 ExHowTo 那段)。库里的动作都有演示图,所以这句话基本只对
          没传配图的自定义动作可见 —— 而那正是最该说清楚的一类 */}
      <Text className="howto-figure__note">这个动作还没有演示图 · 下面是它练哪儿</Text>
      {/* aspectFit 而不是 widthFix:高度由样式封顶(见 index.scss 那一段) */}
      <Image className="howto-figure__img" src={mediaUrl(url)} mode="aspectFit" />
      <View className="howto-figure__bar">
        <Text className="howto-figure__pos">{figureView(target)}示意</Text>
        {/* 亮的是哪块肌肉**不在这里写名字** —— 下面「主要肌群」那一行就是它的名字,
            再说一遍是同一个信息占两行。这里只解释「亮起来意味着什么」 */}
        <Text className="howto-figure__hint">亮起的是主要发力肌群</Text>
      </View>
    </View>
  );
}

export default function ExHowTo({ ex, note }: { ex: ExerciseEntry; note?: string }) {
  const demo = useMemo(() => demoUrl(ex.id), [ex.id]);
  const mine = useMemo(() => customImage(ex.id), [ex.id]);
  return (
    <>
      {/* 图放最前 —— 训练中打开速查栏多半就是「忘了怎么做,给我看一眼」。
          库里 1324 条**每条都有 GIF**,所以走的几乎永远是上面那支;中间那支只接住
          自建动作里用户自己传了配图的(优先于肌群示意图 —— 拍的就是那台机器,
          比「它练哪儿」更能回答「我该站成什么样」);最下面兜肌群示意图。
          三支的优先级定在 engine/custom 的 customImage 注释里,两处渲染不改口径 */}
      {demo ? <DemoImage url={demo} /> : mine ? <MineImage url={mine} /> : <FigureImage target={ex.target} />}

      <View className="howto-chips">
        <Text className="howto-chip howto-chip-bp">{zh(BODYPART_ZH, ex.bodyPart)}</Text>
        <Text className="howto-chip">{zh(EQUIPMENT_ZH, ex.equipment)}</Text>
        {/* 分类/难度/发力/结构是动作库那套编排属性,自定义动作没有 —— 换成一个「我建的」 */}
        {isCustomId(ex.id)
          ? <Text className="howto-chip howto-chip-mine">我建的</Text>
          : <Text className="howto-chip">{zh(CATEGORY_ZH, ex.category)}</Text>}
        {!!ex.level && <Text className="howto-chip howto-chip-lv">{zh(LEVEL_ZH, ex.level)}</Text>}
        {!!ex.force && <Text className="howto-chip">{zh(FORCE_ZH, ex.force)}类</Text>}
        {!!ex.mechanic && <Text className="howto-chip">{zh(MECHANIC_ZH, ex.mechanic)}</Text>}
      </View>

      {/* 没指明肌群的动作(自定义动作可以留空)不摆这一块,免得出现「主要肌群:」后面没字 */}
      {(!!ex.target || ex.secondary.length > 0) && (
        <View className="howto-muscles">
          {!!ex.target && <Text className="fs-mini">主要肌群:{zh(MUSCLE_ZH, ex.target)}</Text>}
          {ex.secondary.length > 0 && (
            <Text className="fs-mini text-secondary">次要:{ex.secondary.map((k) => zh(MUSCLE_ZH, k)).join(' · ')}</Text>
          )}
        </View>
      )}

      {ex.steps.length > 0 && (
        <View className="howto-steps">
          <Text className="fs-h1">动作步骤</Text>
          {ex.steps.map((s, i) => (
            <View className="howto-step" key={i}>
              <Text className="howto-step-no">{i + 1}</Text>
              <Text className="howto-step-text">{s}</Text>
            </View>
          ))}
          {/* 免责跟着步骤走(它就是这几句话的限定),不放在某一个页面的页脚 ——
              那样另一处(训练中的速查栏)就漏了 */}
          <Text className="fs-mini text-secondary howto-foot">
            动作步骤为通用教学参考;训练中如感不适应立即停止,必要时咨询专业人士。
          </Text>
        </View>
      )}

      {!!note && (
        <View className="howto-steps">
          <Text className="fs-h1">我的备注</Text>
          <Text className="fs-caption howto-note">{note}</Text>
        </View>
      )}
    </>
  );
}
