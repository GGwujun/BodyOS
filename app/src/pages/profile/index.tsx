import { useEffect, useState } from 'react';
import { View, Text, Input, Button, Picker, Textarea, Image } from '@tarojs/components';
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { UserOutlined, ArrowRight, Aim, RecordsOutlined, CalendarOutlined, LikeOutlined, InfoOutlined, AppsOutlined, Award, GuideOutlined, BagOutlined, SettingOutlined, ChatOutlined, PhoneOutlined, BillOutlined, WechatMoments } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import { useTabBarMask } from '@/hooks/useTabBarMask';
import Screen from '@/components/Screen';
import { RoutePath, TAB_PAGES } from '@/constants/routes';
import { userApi } from '@/services';
import type { Goal, Profile } from '@/services/types';
import { ASSESSMENTS } from '@/data/assessments';
import { toast } from '@/utils/ui';
import './index.scss';
import { todayStr } from '@/utils/date';
import { navigate, switchTab } from '@/utils/nav';
import { consumeBodyEditRequest } from '@/utils/profile-edit';
import { statusBarHeight } from '@/utils/status-bar';
import heroLeaves from '@/assets/profile-leaves.jpg';

const STATUS_BAR = statusBarHeight();

const GENDERS=[{key:'other',label:'未提供 / 其他'},{key:'male',label:'男'},{key:'female',label:'女'}] as const;

const ACTIVITY=[{key:'sedentary',label:'久坐'},{key:'light',label:'轻度活动'},{key:'moderate',label:'中度活动'},{key:'active',label:'高度活动'},{key:'very_active',label:'非常活跃'}];
const goalLabel:Record<string,string>={fat_loss:'减脂',muscle_gain:'增肌',maintain:'维持',endurance:'耐力'};
export default function ProfilePage(){
  const go=(p:RoutePath)=>TAB_PAGES.includes(p)?switchTab(`/${p}`):navigate(`/${p}`);
  /* 挂上转发/朋友圈钩子:右上角菜单里这两个口子默认是灰的 */
  useShareAppMessage(()=>({title:'轻身记 · 记录，是改变的开始',path:'/pages/home/index'}));
  useShareTimeline(()=>({title:'轻身记 · 记录，是改变的开始'}));
  const {data:profile,refresh:refreshProfile}=useAsync<Profile>(()=>userApi.getProfile(),[]);
  const {data:goals,refresh:refreshGoals}=useAsync<Goal[]>(()=>userApi.listGoals(),[]);
  const {data:me,refresh:refreshMe}=useAsync(()=>userApi.getMe(),[]);
  /** 首页说「去补资料」时带过来的一次性请求 —— 等资料加载好再拉起编辑面板 */
  const [editRequested,setEditRequested]=useState(false);
  // tab 页常驻内存:从 onboarding/其他页返回时重拉,目标与资料不滞后
  useDidShow(()=>{
    void refreshProfile();void refreshGoals();void refreshMe();
    if(consumeBodyEditRequest()) setEditRequested(true);
  });
  const [editing,setEditing]=useState(false); const [height,setHeight]=useState(''); const [weight,setWeight]=useState(''); const [actIdx,setActIdx]=useState(2);
  const [birth,setBirth]=useState('');
  const [genderIdx,setGenderIdx]=useState(0);
  const [savingBody,setSavingBody]=useState(false);
  const [bodyError,setBodyError]=useState('');
  const [dietEditing,setDietEditing]=useState(false);
  const [nickEditing,setNickEditing]=useState(false);
  const [nick,setNick]=useState('');
  const [savingNick,setSavingNick]=useState(false);
  const [nickError,setNickError]=useState('');
  useTabBarMask(editing || dietEditing || nickEditing);
  const openNick=()=>{const current=me?.nickname||'';setNick(current&&current!=='微信用户'&&current!=='用户'?current:'');setNickError('');setNickEditing(true)};
  const saveNick=async()=>{
    if(savingNick)return;
    const value=nick.trim();
    if(!value){setNickError('请输入昵称，或点键盘上方一键填入微信昵称');return}
    setSavingNick(true);setNickError('');
    try{await userApi.updateMe({nickname:value});await refreshMe();setNickEditing(false);toast('昵称已保存')}
    catch(e){setNickError((e as {message?:string})?.message||'保存失败，请重试')}
    finally{setSavingNick(false)}
  };
  const [diet,setDiet]=useState('');
  const [savingDiet,setSavingDiet]=useState(false);
  const [dietError,setDietError]=useState('');
  const openDiet=()=>{if(!profile){toast('资料尚未加载，请稍后重试','error');return}setDiet(profile.dietPreference || '');setDietError('');setDietEditing(true)};
  const saveDiet=async()=>{
    if(savingDiet)return;
    setSavingDiet(true);setDietError('');
    try{await userApi.updateProfile({dietPreference:diet.trim()});await refreshProfile();setDietEditing(false);toast('饮食偏好已保存')}
    catch(e){setDietError((e as {message?:string})?.message || '保存失败，请重试')}
    finally{setSavingDiet(false)}
  };
  const goal=goals?.[0];
  const openEdit=()=>{if(!profile){toast('资料尚未加载，请稍后重试','error');return}setHeight(profile.heightCm?String(profile.heightCm):'');setWeight(profile.weightKg?String(profile.weightKg):'');setBirth(profile.birthDate?.slice(0,10)||'');setGenderIdx(Math.max(0,GENDERS.findIndex(g=>g.key===profile.gender)));setBodyError('');const i=ACTIVITY.findIndex(a=>a.key===profile.activityLevel);setActIdx(i>=0?i:2);setEditing(true)};
  // 首页「补全资料」跳过来时直接展开这一层:用户已经表达过一次意图,不该再让他找入口
  useEffect(()=>{if(editRequested&&profile){setEditRequested(false);openEdit();}},[editRequested,profile]);
  const save=async()=>{
    if(savingBody)return;
    if([height,weight].some(value=>value.trim()&&(!Number.isFinite(Number(value))||Number(value)<=0))){setBodyError('身高和体重必须为大于0的数字');return}
    if(birth&&birth>todayStr()){setBodyError('出生日期不能晚于今天');return}
    setSavingBody(true);setBodyError('');
    try{await userApi.updateProfile({heightCm:height.trim()?Number(height):null,weightKg:weight.trim()?Number(weight):null,birthDate:birth?`${birth}T00:00:00.000Z`:null,gender:GENDERS[genderIdx].key,activityLevel:ACTIVITY[actIdx].key as Profile['activityLevel']});toast('已保存');setEditing(false);await refreshProfile()}
    catch(e){setBodyError((e as {message?:string})?.message||'保存失败，请重试')}
    finally{setSavingBody(false)}
  };
  const showAbout=()=>Taro.showModal({title:'关于轻身记',content:'轻身记 v1.0.0\n\n记录饮食、运动与身体数据，看清每一天的变化。\n\n数据安全：所有数据仅用于你的身体管理和分析，不会提供给第三方。',showCancel:false});
  /**
   * 菜单行。**每行自己带动作**,不再拿 label 去反查 —— 以前那一串
   * `item.label==='我的目标'?…:item.label==='身体数据'?…` 既难读,加一行就得再串一个分支,
   * 而 label 是文案:改一个字,那一行的点击就悄悄没了。
   */
  /* 每行 = 图标 + 名称 + 右侧读数。设计稿里右侧那列就是这一行的答案
     (减脂 / 78 kg / 偏重口味…),不再摆副标题 —— 两行字会把每一格撑高,
     而这一页是目录,一眼扫完比讲清楚每一格更重要 */
  /**
   * `service` 那一行必须是原生 `<Button open-type="contact">` —— 微信的客服会话
   * 没有可在代码里调用的 API,只能由一个 open-type=contact 的按钮打开。
   * 样式仍然复用 .menu-row,只在下面补一条把原生按钮底样式清掉的规则。
   */
  type MenuRow={label:string;icon:React.ReactNode;value?:string;onTap?:()=>void;service?:boolean};
  const groups:{rows:MenuRow[]}[]=[
    {rows:[
      {label:'我的目标',icon:<Aim/>,value:goal?goalLabel[goal.type]??goal.type:'未设置',onTap:()=>navigate('/pages/onboarding/index?from=nav')},
      {label:'身体数据',icon:<RecordsOutlined/>,value:profile?.weightKg?`${profile.weightKg} kg`:'未填写',onTap:openEdit},
      {label:'本周报告',icon:<CalendarOutlined/>,onTap:()=>go(RoutePath.WeeklyReport)},
      /* 每日分享卡 —— 发朋友圈的那张图,和「本周报告」同一性质(把记录变成能晒的东西) */
      {label:'每日分享卡',icon:<WechatMoments/>,value:'晒今天 · 发朋友圈',onTap:()=>navigate('/pkg-exercise/daily-share/index')},
      {label:'饮食偏好',icon:<LikeOutlined/>,value:profile?.dietPreference||'未设置',onTap:openDiet}
    ]},
    /* 训练那两格。**它们是这一页最该有、却一直没有的东西**:「有哪些动作可练」「我手上有什么器械」
       都是和计划无关的问题,而它们原先只在训练分包的「计划页 → 训练工具」里各占一格 ——
       想看看动作库里有什么,得先有一份计划、再滚到那个页脚。没有计划的人根本到不了。 */
    {rows:[
      {label:'动作库',icon:<GuideOutlined/>,value:'按部位 / 器械挑动作',onTap:()=>navigate('/pkg-exercise/library/index')},
      {label:'我的器材',icon:<BagOutlined/>,value:'哑铃 · 弹力带 · 家用',onTap:()=>navigate('/pkg-exercise/kit/index')}
    ]},
    {rows:[
      {label:'健康工具箱',icon:<AppsOutlined/>,value:'小工具 · 测评 · 百科',onTap:()=>navigate('/pages/toolbox/index')},
      {label:'健康测评',icon:<Award/>,value:`${ASSESSMENTS.length} 项测试`,onTap:()=>navigate('/pages/assessment/index')},
      {label:'数据源管理',icon:<RecordsOutlined/>,value:'设备与应用',onTap:()=>go(RoutePath.DataSources)},
      {label:'数据导出',icon:<BillOutlined/>,value:'体重 · 饮食,复制带走',onTap:()=>navigate('/pages/data-export/index')},
      {label:'意见反馈',icon:<ChatOutlined/>,value:'问题 · 建议',onTap:()=>navigate('/pages/feedback/index')},
      {label:'联系客服',icon:<PhoneOutlined/>,value:'在线对话',service:true},
      {label:'关于轻身记',icon:<InfoOutlined/>,value:'v1.0.0',onTap:showAbout}
    ]}
  ];
  return <Screen className="profile-page">
    {/* 深绿页头:状态栏 + 叶子 + 头像那一行。统计卡**不在它里面** ——
        它要压在页头下沿上、露出下半截到纸面上(设计稿那一层叠的关系),
        放在里面的话页头会跟着卡片一起结束,压边就变成了内边距 */}
    <View className="profile-hero" style={{ paddingTop: STATUS_BAR + 16 }}>
      <Image className="hero-leaves" src={heroLeaves} mode="widthFix" />
      <View className="hero-glow" />
      <View className="hero-top">
        <View className="avatar"><UserOutlined/></View>
        <View className="hero-copy">
          <View className="hero-name-row" onClick={openNick}>
            <Text className="user-name">{me?.nickname||'轻身记用户'}</Text>
            <Text className="goal-pill">{goal?goalLabel[goal.type]??goal.type:'健康管理'}</Text>
          </View>
          <Text className="user-id">自律让你更自由</Text>
        </View>
        <View className="hero-edit" onClick={openEdit}><SettingOutlined/></View>
      </View>
    </View>
    {/* 三格读数:数字大、单位小(参考稿就是这个层级)。单位跟着数字一起用
        20px 的字会读成一个词「172cm」,拆开才像一个读数 */}
    <View className="stat-card">
      <Stat label="身高" value={profile?.heightCm} unit="cm" />
      <Stat label="体重" value={profile?.weightKg} unit="kg" />
      <Stat label="目标周期" value={goal?.durationWeeks} unit="周" empty="未设置" />
    </View>
    {groups.map((group, index) => <View className="menu-group" key={index}>
      <View className="menu-card">{group.rows.map(item=>item.service
        ? <Button className="menu-row menu-row--btn" key={item.label} openType="contact">
            <View className="menu-icon">{item.icon}</View>
            <Text className="menu-label">{item.label}</Text>
            {item.value&&<Text className="menu-value">{item.value}</Text>}
            <ArrowRight className="menu-arrow"/>
          </Button>
        : <View className="menu-row" key={item.label} onClick={item.onTap}>
            <View className="menu-icon">{item.icon}</View>
            <Text className="menu-label">{item.label}</Text>
            {item.value&&<Text className="menu-value">{item.value}</Text>}
            <ArrowRight className="menu-arrow"/>
          </View>)}</View>
    </View>)}
    {dietEditing&&<View className="mask" onClick={()=>!savingDiet&&setDietEditing(false)}><View className="edit-sheet" catchMove onClick={e=>e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">编辑饮食偏好</Text><Text className="diet-help">填写口味、忌口及过敏原；留空可清除偏好。</Text><Textarea className="diet-input" value={diet} maxlength={500} onInput={e=>setDiet(e.detail.value)} placeholder="请输入你的饮食偏好"/><Text className="diet-count">{diet.length}/500</Text>{dietError&&<Text className="diet-error">{dietError}</Text>}<Button className="sheet-save" loading={savingDiet} disabled={savingDiet} onClick={saveDiet}>保存偏好</Button><Button className="sheet-cancel" disabled={savingDiet} onClick={()=>setDietEditing(false)}>取消</Button></View></View>}
    {nickEditing&&<View className="mask" onClick={()=>!savingNick&&setNickEditing(false)}><View className="edit-sheet" catchMove onClick={e=>e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">设置昵称</Text><Text className="diet-help">点击键盘上方的微信昵称可一键填入。</Text><Input className="nick-input" type="nickname" value={nick} maxlength={30} onInput={e=>setNick(e.detail.value)} placeholder="输入昵称"/>{nickError&&<Text className="diet-error">{nickError}</Text>}<Button className="sheet-save" loading={savingNick} disabled={savingNick} onClick={saveNick}>保存昵称</Button><Button className="sheet-cancel" disabled={savingNick} onClick={()=>setNickEditing(false)}>取消</Button></View></View>}
    {editing&&<View className="mask" onClick={()=>!savingBody&&setEditing(false)}><View className="edit-sheet body-sheet" catchMove onClick={e=>e.stopPropagation()}>
      <View className="sheet-handle" />
      <Text className="sheet-title">编辑身体信息</Text>
      <Text className="diet-help">出生日期、身高、体重都填上，才能算出基础代谢和每日消耗；留空会清除对应信息。</Text>
      <Field label="性别（用于公式）"><Picker mode="selector" range={GENDERS.map(g=>g.label)} value={genderIdx} onChange={e=>setGenderIdx(Number(e.detail.value))}><View className="picker-value">{GENDERS[genderIdx].label}</View></Picker></Field>
      <Field label="出生日期"><Picker mode="date" end={todayStr()} value={birth} onChange={e=>setBirth(String(e.detail.value))}><View className="picker-value">{birth||'请选择出生日期'}</View></Picker>{birth&&<Text onClick={()=>setBirth('')}>清除</Text>}</Field>
      <Field label="身高 (cm)"><Input className="form-input" type="digit" value={height} onInput={e=>setHeight(e.detail.value)} placeholder="请输入身高"/></Field>
      <Field label="体重 (kg)"><Input className="form-input" type="digit" value={weight} onInput={e=>setWeight(e.detail.value)} placeholder="请输入体重"/></Field>
      <Field label="活动水平"><Picker mode="selector" range={ACTIVITY.map(a=>a.label)} value={actIdx} onChange={e=>setActIdx(Number(e.detail.value))}><View className="picker-value">{ACTIVITY[actIdx].label}</View></Picker></Field>
      {bodyError&&<Text className="diet-error">{bodyError}</Text>}
      <Button className="sheet-save" loading={savingBody} disabled={savingBody} onClick={save}>保存身体信息</Button><Button className="sheet-cancel" disabled={savingBody} onClick={()=>setEditing(false)}>取消</Button>
    </View></View>}
  </Screen>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <View className="field-row"><Text>{label}</Text>{children}</View>}
function Stat({label,value,unit,empty='未填写'}:{label:string;value?:number|null;unit:string;empty?:string}){return <View className="stat">
  <Text className="stat-label">{label}</Text>
  {value == null
    ? <Text className="stat-value is-empty">{empty}</Text>
    : <View className="stat-pair"><Text className="stat-value">{value}</Text><Text className="stat-unit">{unit}</Text></View>}
</View>}
