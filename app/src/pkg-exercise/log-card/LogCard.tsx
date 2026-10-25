import { useMemo, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { fmtSpan } from '@/utils/duration';
import { volumeText } from '../engine/share-card';
import { orderUnits } from '../engine/order';
import { sidedInPlan } from '../engine/sided';
import { prsOfLog } from '../engine/history';
import { loadLogs, loadPlan } from '../engine/store';
import { setText } from '../engine/workout-text';
import { didSet, type WorkoutLog } from '../engine/types';
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
 * 四件事都能走通:展开看这次每个动作每组怎么练的(只读)、照这次再来一遍(把这次的
 * 重量次数铺进下一次训练)、改这条记录(补录页也是「改记录」,没有 id 就是新补一条)、
 * 把它做成分享卡。**看和改分开**:展开在卡片里就地摊开,「修改记录」始终是明确点一下
 * 才进的编辑页 —— 以前想看一眼每组多少,只能进编辑表单,看着看着就动了不该动的数据。
 * 页面级埋点在**目的地**(log-edit / share 各自进入时上报),这里不重复报。
 */
export default function LogCard({ log }: { log: WorkoutLog }) {
  /** 展开全部动作:逐组明细摊在本卡里。默认收着 —— 一行摘要能答「那天练没练」,细看的人才展开 */
  const [open, setOpen] = useState(false);
  const entries = log.entries ?? [];
  const units = open ? orderUnits(entries) : [];
  /* 计划只读一次(每个动作都要问它单侧开关,逐组去读就太密了)。收起时不读 */
  const plan = open ? loadPlan() : null;
  /* 这场里破纪录的动作 —— 也是展开才算(要把全部日志扫一遍,收着的卡不需要) */
  const prs = useMemo(() => (open ? prsOfLog(log, loadLogs()) : []), [open, log]);

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

      {/* ===== 逐组明细(只读) ===== */}
      <Text className="lc-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起动作 ▴' : `展开全部动作(${entries.length} 个) ▾`}
      </Text>
      {open && (
        <View className="lc-detail">
          {units.map((unit, ui) => (
            <View className="lc-unit" key={ui}>
              {/* 只有同组号且相邻的才算一块(和「复制成文字」同一刀);块里只剩一个成员
                  (另一个动作当时删掉了)就不标 —— 标了反而像少写了一个 */}
              {unit.length > 1 && <Text className="lc-unit-tag">超级组</Text>}
              {unit.map((i) => {
                const e = entries[i];
                // 和文字版同一条判据:次数>0 或秒数>0 才算练了;跳过的组灰在最后报个数
                const done = e.sets.filter(didSet);
                const skipped = e.sets.length - done.length;
                return (
                  <View className="lc-ex" key={`${e.exerciseId}-${i}`}>
                    <View className="lc-ex-name-line">
                      {/* 点动作名进它的历史曲线 —— 从「这一场里它练成什么样」直接接到
                          「这个动作一路是怎么练过来的」,不用先退出去再从动作库找它 */}
                      <Text
                        className="lc-ex-name"
                        onClick={() => navigate(`/pkg-exercise/exercise-history/index?exerciseId=${e.exerciseId}`)}
                      >
                        {e.nameZh}
                        {e.noProg ? '(不算进步)' : ''} ›
                      </Text>
                      {/* 这一场里它破了自己的纪录(见 prsOfLog):和「补录/不算进步」一样
                          是用户该看见的事实,金色而不只是文字 —— 纪录是这套数据里唯一的奖杯 */}
                      {prs.includes(e.exerciseId) && <Text className="lc-tag-pr">破纪录</Text>}
                    </View>
                    <View className="lc-sets">
                      {done.map((s, si) => (
                        <Text className="lc-set" key={si}>
                          {/* 每组的念法和分享卡/编辑页同一套原子(setText:自重/每侧 N/秒数)。
                              单侧判定带计划:用户在计划里关过单侧开关的,这里不能被名字规则翻回来 */}
                          {setText(e.exerciseId, s, sidedInPlan(plan, e.exerciseId))}
                          {s.rir != null ? ` · RIR ${s.rir}` : ''}
                        </Text>
                      ))}
                      {skipped > 0 && <Text className="lc-set lc-set--skip">跳过 {skipped} 组</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
          {!entries.length && (
            <Text className="fs-mini text-secondary">这条是老记录,逐组明细没存下来 —— 摘要看上面那行。</Text>
          )}
        </View>
      )}

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
