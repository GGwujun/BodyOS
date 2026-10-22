import { themedColor } from '@/utils/theme';
import { Image } from '@tarojs/components';
import { ClockOutlined, CompletedOutlined, Replay } from '@taroify/icons';
import dumbbellIcon from '@/assets/icons/dumbbell.png';
import { THEME } from '@/constants/theme';

/**
 * 「今天练什么」的状态图标 —— 首页那张卡和训练 tab 共用一份。
 *
 * 以前这五个状态各是一个 emoji(见 utils/training-digest 的旧 STATE_EMOJI)。
 * emoji 在不同系统/微信版本里字形不一样,和全站的线性图标摆在一起也像两种语言。
 * 现在统一成同一套线性图标:该练=哑铃、练过=勾、休息/请假=钟、改练=换。
 */
export type TrainStateIconState = 'none' | 'todo' | 'done' | 'rest' | 'off' | 'moved';

export default function TrainStateIcon({ state, size = 24 }: { state: TrainStateIconState; size?: number }) {
  if (state === 'done') return <CompletedOutlined size={size} color={themedColor(THEME.primary)} />;
  if (state === 'off' || state === 'rest') return <ClockOutlined size={size} color={themedColor(THEME.info)} />;
  if (state === 'moved') return <Replay size={size} color={themedColor(THEME.warning)} />;
  return <Image className="train-state-icon" src={dumbbellIcon} mode="aspectFit" style={{ width: `${size}px`, height: `${size}px` }} />;
}
