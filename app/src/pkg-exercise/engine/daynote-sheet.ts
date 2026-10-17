/**
 * 请假条的交互 —— 「选个原因 → 可选补一句 → 存下来」。
 *
 * 放在 engine 里而不是各页面各写一份:计划页和统计页(热力图)都能标请假,
 * 两处的用词、可选范围、失败处理必须一模一样 —— 否则同一个动作在两个入口
 * 会给出不同的结果,而用户根本不知道哪次生效了。
 *
 * 交互上用系统原生的 ActionSheet / Modal 而不是自绘面板:这两个都是**一屏一次性**的
 * 轻操作,自绘面板要多写一层遮罩、滚动穿透和关闭逻辑,不值得。
 */
import Taro from '@tarojs/taro';
import { NOTE_KINDS, NOTE_KIND_ZH, cleanText, setDayNote, type DayNote, type DayNotes, type NoteKind } from './daynote';

/**
 * 让用户挑一个请假原因。取消返回 null。
 * 选项顺序 = NOTE_KINDS 的顺序(越「真没办法」的越靠前),ActionSheet 的 tapIndex
 * 直接就是它的下标 —— 所以两处顺序必须来自同一个数组,不能各写一份中文表。
 */
export async function askNoteKind(): Promise<NoteKind | null> {
  try {
    const res = await Taro.showActionSheet({ itemList: NOTE_KINDS.map((k) => NOTE_KIND_ZH[k]) });
    return NOTE_KINDS[res.tapIndex] ?? null;
  } catch {
    return null; // 用户点了取消
  }
}

/**
 * Taro 3.6 的 showModal 类型里没有 `editable`(微信基础库 2.17.1 起才支持带输入框的弹窗),
 * 所以在这里开一个窄口子 —— 和 reminder 页调 requestSubscribeMessage 是同一个办法:
 * 只把缺的那几个字段补上,不把整个 Taro 断言成 any。
 */
type EditableModal = {
  showModal(o: {
    title?: string; content?: string; editable?: boolean; placeholderText?: string; confirmText?: string;
  }): Promise<{ confirm: boolean; content?: string }>;
};

/**
 * 可选的一句补充说明。用户点了取消也返回原值 —— 说好的是「可选」,
 * 不填就是不想填,不该因此把整件事作废,更不该反复追问。
 */
export async function askNoteText(note: DayNote): Promise<string> {
  let res: { confirm: boolean; content?: string };
  try {
    res = await (Taro as unknown as EditableModal).showModal({
      title: '补一句(可以不填)',
      editable: true,
      placeholderText: '比如:低烧,睡了一天',
      content: note.text,
      confirmText: '保存'
    });
  } catch {
    return note.text; // 用户点了取消
  }
  if (!res.confirm) return note.text;
  // content 是 undefined 说明这台设备的基础库还不支持输入框弹窗 ——
  // 这时候保存等于把原来那句清掉,所以宁可什么都不改(空串 ≠ 没拿到)
  return typeof res.content === 'string' ? cleanText(res.content) : note.text;
}

/**
 * 记一天请假。成功返回新的请假表,用户中途取消返回原表(引用不变 —— 调用方
 * 可以直接用 `next === prev` 判断要不要 setState)。
 */
export async function recordDayOff(notes: DayNotes, date: string, today: string): Promise<DayNotes> {
  const kind = await askNoteKind();
  if (!kind) return notes;
  return setDayNote(notes, date, kind, '', today);
}

/** 带补充说明的完整流程(卡片上「补充说明」那个入口) */
export async function editDayNoteText(notes: DayNotes, date: string, note: DayNote, today: string): Promise<DayNotes> {
  const text = await askNoteText(note);
  if (text === note.text) return notes;
  return setDayNote(notes, date, note.kind, text, today);
}
