import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { fmtSpan } from '@/utils/duration';
import { volumeText } from '../engine/share-card';
import type { WorkoutLog } from '../engine/types';
import './index.scss';
import { navigate } from '@/utils/nav';

/**
 * 一条训练记录 —— 它长什么样、以及能拿它做什么。
 *
 * **为什么单拎成一个组件**:两处要看同一条记录 —— 计划页的「最近训练」(最近 5 次)和
 * 训练记录页(全部)。两处各写一遍,迟早一处会多出「分享这次训练」、另一处忘了带「补录」标记,
 * 而这两处说的是**同一条历史**;更要紧的是容量那一行(见 volumeText)必须处处同一个口径,
 * 不然用户会以为哪边算错了。
 *
 * 三件事都能走通:照这次再来一遍(把这次的重量次数铺进下一次训练)、改这条记录
 * (补录页也是「改记录」,没有 id 就是新补一条)、把它做成分享卡。
 * 页面级埋点在**目的地**(log-edit / share 各自进入时上报),这里不重复报。
 */
export default function LogCard({ log }: { log: WorkoutLog }) {
  return (
    <View className="lc-row">
      <View className="lc-head">
        <View className="lc-copy">
          <View className="lc-name-line">
            <Text className="lc-name">{log.dayTitle}</Text>
            {/* 补录那次没有墙钟时长,手填的重量次数也不该动渐进目标 —— 标出来 */}
            {log.manual && <Text className="lc-tag-manual">补录</Text>}
            {/* 「不算进步」用琥珀色而不是灰:它是用户主动做的一个决定,该被看见 */}
            {log.noProg && <Text className="lc-tag-noprog">不算进步</Text>}
          </View>
          {/* 时长和完成页、补录页同一个口径(fmtSpan,不低于 1 分钟、到点进位成小时)——
              这一行是「什么时候练的、练了多久」,精确到秒没人读 */}
          <Text className="fs-mini text-secondary">
            {log.date}
            {log.durationSec > 0 ? ` · ${fmtSpan(log.durationSec)}` : ''}
          </Text>
        </View>
        <View className="lc-right">
          {/* 容量走分享卡那个口径(volumeText):同一行数字在历史、分享卡、「复制成文字」
              三处必须写成一样,不然用户会以为哪里算错了 */}
          <Text className="fs-mini text-secondary">
            {log.totalSets} 组 · {log.totalReps} 次 · {volumeText(log.totalVolumeKg)}
          </Text>
          {log.avgRir != null && <Text className="fs-mini text-secondary">强度 RIR {log.avgRir}</Text>}
        </View>
      </View>
      {log.note && <Text className="fs-mini lc-note-line">感受:{log.note}</Text>}
      <View className="lc-ops">
        <Text
          className="lc-op"
          onClick={() => navigate(`/pkg-exercise/workout/index?key=${log.dayKey}&repeat=${log.id}`)}
        >
          照这次再来一遍
        </Text>
        <Text className="lc-op" onClick={() => navigate(`/pkg-exercise/log-edit/index?id=${log.id}`)}>
          修改记录
        </Text>
        <Text className="lc-op" onClick={() => navigate(`/pkg-exercise/share/index?logId=${log.id}`)}>
          分享这次训练
        </Text>
      </View>
    </View>
  );
}
