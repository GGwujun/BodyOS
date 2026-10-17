import { useState } from 'react';
import { Button, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { copyText, toast } from '@/utils/ui';
import { loadText } from '../engine/load';
import { addImportedDays, planToText, parsePlanText, type PlanTextParse } from '../engine/plan-text';
import { schemeText } from '../engine/timed';
import { loadPlan, savePlan } from '../engine/store';
import type { PlanDay } from '../engine/types';
import './index.scss';
import { navigate } from '@/utils/nav';

/**
 * 计划分享 —— 把一份计划变成一段能贴进微信的文字,也能把别人发来的文字变回一份计划。
 *
 * 为什么是文字(而不是 openGym 那样导出一个文件):小程序**发不出文件**给微信好友,
 * 用户的出口只有剪贴板。所以「发给朋友」「存一份自己的」「教练发来的」这三件事
 * 在这一个页面上收口成同一段文字。
 *
 * 导进来有两个走法,默认那个是**不破坏的**:
 *   · 加进我的计划 —— 当成新的一天加进去,现在的计划一天都不动;
 *   · 整份替换 —— 把当前计划整份顶掉,要二次确认(并提示先把当前这份复制一份)。
 */
export default function PlanSharePage() {
  const [text, setText] = useState('');
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<PlanTextParse | null>(null);
  const [done, setDone] = useState('');

  useDidShow(() => {
    const p = loadPlan();
    setText(p ? planToText(p) : '');
    track('training_plan_share_view', 'other');
  });

  const plan = loadPlan();
  const dayCount = plan?.days.length ?? 0;

  const doCopy = async () => {
    if (!text) { toast('还没有计划可以分享', 'none'); return; }
    setDone('');
    const ok = await copyText(text);
    toast(ok ? '已复制,可以粘到微信里' : '复制没成功,请在下面长按全选复制', ok ? 'success' : 'none');
    track('training_plan_share_copy', 'other');
  };

  /** 读剪贴板省掉「长按 → 全选 → 粘贴」三步(小程序里那三步挺烦) */
  const readClipboard = async () => {
    try {
      const r = await Taro.getClipboardData({});
      const v = (r as { data?: string }).data ?? '';
      if (!v.trim()) { toast('剪贴板里没有文字', 'none'); return; }
      doParse(v);
    } catch {
      toast('读不到剪贴板,手动粘一下', 'none');
    }
  };

  const doParse = (v: string) => {
    setPaste(v);
    setDone('');
    if (!v.trim()) { setParsed(null); return; }
    setParsed(parsePlanText(v, {
      // 配置行没写清楚的部分照用户自己那份计划走:他本来就是那个目标、那个器械条件
      fallback: plan ? { goal: plan.goal, level: plan.level, access: plan.access } : undefined
    }));
  };

  const applyAddDay = (days: PlanDay[]) => {
    if (!plan) return;
    // 追加时 key 还要再避一次撞:你上一回导入的那几天也叫 imp-1(见 addImportedDays)
    const next = addImportedDays(plan, days);
    savePlan(next);
    track('training_plan_import_add', 'other');
    setDone(`已加进你的计划:${days.map((d) => d.title).join(' / ')}`);
    setParsed(null);
    setPaste('');
    setText(planToText(next));
    toast('已加进计划');
  };

  const applyReplace = async (next: NonNullable<PlanTextParse['plan']>) => {
    const cur = plan;
    const { confirm } = await Taro.showModal({
      title: '替换当前计划',
      content: cur
        ? `现在的 ${cur.days.length} 天计划会被这份顶掉(练过的记录不受影响)。替换前先用「复制」把当前这份存下来,就能随时粘回来。`
        : '会写入这份计划。',
      confirmText: '替换',
      cancelText: '再想想'
    });
    if (!confirm) return;
    savePlan(next);
    track('training_plan_import_replace', 'other');
    setDone(`已替换:${next.days.map((d) => d.title).join(' / ')}`);
    setParsed(null);
    setPaste('');
    setText(planToText(next));
    toast('计划已替换');
  };

  return (
    <Screen className="ps-page">
      <View className="card ps-head">
        <Text className="fs-h1">计划分享</Text>
        <Text className="fs-caption">
          一段文字带走一份计划。发给朋友,他粘进去就能用;换计划之前存一份自己的,
          以后想练回来再粘回来。
        </Text>
      </View>

      {/* ---- 导出 ---- */}
      <View className="card ps-block">
        <Text className="ps-title">分享我的计划</Text>
        {plan ? (
          <Text className="fs-mini text-secondary ps-note">
            当前这份计划有 {dayCount} 天。文字里只有动作、组次、重量、休息这些处方,
            没有你的训练记录、体重和进度 —— 那些对别人不成立。
          </Text>
        ) : (
          <Text className="fs-mini text-secondary ps-note">还没有计划可以分享,先去生成一份。</Text>
        )}
        <Button className="btn btn--primary btn--block" disabled={!plan} onClick={doCopy}>
          复制计划文字
        </Button>
        {/* 「先去生成一份」得真的能去 —— 按钮灰着、出口又不给,就成了死胡同。
            导入那半边不需要计划,所以这里只补导出这边的入口,不整页拦掉。 */}
        {!plan && (
          <Button
            className="btn btn--secondary btn--block ps-empty-cta"
            onClick={() => navigate('/pkg-exercise/plan-create/index')}
          >
            去生成一份计划
          </Button>
        )}
        {!!text && (
          <Textarea className="ps-area" value={text} maxlength={-1} onInput={() => undefined} />
        )}
      </View>

      {/* ---- 导入 ---- */}
      <View className="card ps-block">
        <Text className="ps-title">导入一份计划</Text>
        <Text className="fs-mini text-secondary ps-note">
          把别人发来的计划粘在这里。默认是**加进**你的计划(不动现在的内容);
          想整份换掉,读出来之后选「替换当前计划」。
        </Text>
        <View className="ps-actions">
          <View className="ps-act" onClick={readClipboard}>读剪贴板</View>
          <View className="ps-act" onClick={() => doParse('')}>清空</View>
        </View>
        <Textarea
          className="ps-area ps-area--in"
          value={paste}
          placeholder={'粘贴计划文字,例如:\n第 1 天 推 · 胸肩三头\n1 杠铃卧推 (0025) · 4 组 × 8-10 次 · 60kg · 休 1:30'}
          maxlength={-1}
          onInput={(e) => doParse(e.detail.value)}
        />

        {parsed && !parsed.plan && (
          <Text className="fs-mini ps-warn">{parsed.reason}</Text>
        )}

        {parsed?.plan && (
          <>
            <Text className="fs-mini ps-ok">
              读出来了 {parsed.days} 天 · {parsed.items} 个动作
              {plan ? `(你的计划现在是 ${dayCount} 天)` : ''}
            </Text>
            {parsed.plan.days.map((d) => (
              <View className="ps-preview" key={d.key}>
                <Text className="ps-preview-day">{d.title}</Text>
                {d.items.map((it, i) => (
                  <Text className="fs-mini ps-preview-item" key={`${it.exerciseId}-${i}`}>
                    {/* 预览的念法和计划页一致(组次走 schemeText、重量走 loadText)——
                        这里是用户唯一能核对「读对没有」的地方,它自己长成另一个样子就没用了 */}
                    {[
                      it.nameZh,
                      schemeText(it),
                      loadText(it.exerciseId, it.weightKg),
                      it.superset ? '超级组' : null
                    ].filter(Boolean).join(' · ')}
                  </Text>
                ))}
              </View>
            ))}
            {!!parsed.dropped.length && (
              <View className="ps-issues">
                <Text className="fs-mini ps-warn">
                  {parsed.dropped.length} 行没读出来(跳过,没算进去):
                </Text>
                {parsed.dropped.slice(0, 5).map((d) => (
                  <Text className="fs-mini ps-issue" key={`${d.line}-${d.text}`}>
                    第 {d.line} 行 · {d.why}
                  </Text>
                ))}
              </View>
            )}
            {!!parsed.notes.length && (
              <View className="ps-issues">
                {parsed.notes.slice(0, 3).map((n) => (
                  <Text className="fs-mini ps-note-line" key={`${n.line}-${n.text}`}>
                    第 {n.line} 行 · {n.why}({n.text})
                  </Text>
                ))}
              </View>
            )}
            <View className="ps-actions">
              <Button
                className="btn btn--primary ps-act-btn"
                disabled={!plan}
                onClick={() => applyAddDay(parsed.plan!.days)}
              >
                加进我的计划
              </Button>
              <Button
                className="btn btn--secondary ps-act-btn"
                onClick={() => applyReplace(parsed.plan!)}
              >
                替换当前计划
              </Button>
            </View>
            {!plan && (
              <Text className="fs-mini text-secondary ps-note">
                你现在还没有计划,「替换」会直接把这份写进去。
              </Text>
            )}
          </>
        )}
      </View>

      {done && (
        <View className="card ps-done">
          <Text className="ps-done-title">完成</Text>
          <Text className="fs-mini ps-done-line">{done}</Text>
          <Text className="fs-mini text-secondary ps-done-line">
            导入的动作如果在你的渐进里已经有进度,页面上会照你自己的数字走 ——
            别人的处方不该顶掉你练出来的重量。
          </Text>
        </View>
      )}

      <View className="card ps-tip">
        <Text className="ps-title">几句实话</Text>
        <Text className="fs-mini ps-note-line">· 文字里带动作编号,粘回来不会认错动作;手写的计划没编号,按名字认。</Text>
        <Text className="fs-mini ps-note-line">· 认不出来的行会原样列出来,不会猜着替你换一个动作。</Text>
        <Text className="fs-mini ps-note-line">· 计划里没写到的(备选动作、周期走到第几周)按你的情况现算,不跟着别人的走。</Text>
        <Text className="fs-mini ps-note-line">· 想连训练记录一起带走,用「导出与备份」。</Text>
      </View>
    </Screen>
  );
}
