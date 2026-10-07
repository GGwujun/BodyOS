import { useState } from 'react';
import { View, Text, Input, Button, Picker, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { UserOutlined, ArrowRight, Aim, RecordsOutlined, CalendarOutlined, LikeOutlined, InfoOutlined, Edit, AppsOutlined, Award } from '@taroify/icons';
import { useAsync } from '@/hooks/useAsync';
import { useTabBarMask } from '@/hooks/useTabBarMask';
import Screen from '@/components/Screen';
import { RoutePath } from '@/constants/routes';
import { userApi } from '@/services';
import type { Goal, Profile } from '@/services/types';
import { toast } from '@/utils/ui';
import './index.scss';
import { todayStr } from '@/utils/date';

const GENDERS=[{key:'other',label:'未提供 / 其他'},{key:'male',label:'男'},{key:'female',label:'女'}] as const;

const ACTIVITY=[{key:'sedentary',label:'久坐'},{key:'light',label:'轻度活动'},{key:'moderate',label:'中度活动'},{key:'active',label:'高度活动'},{key:'very_active',label:'非常活跃'}];
const goalLabel:Record<string,string>={fat_loss:'减脂',muscle_gain:'增肌',maintain:'维持',endurance:'耐力'};
export default function ProfilePage(){
  const go=(p:RoutePath)=>Taro.navigateTo({url:`/pages/${p.split('/')[1]}/index`});
  const {data:profile,refresh:refreshProfile}=useAsync<Profile>(()=>userApi.getProfile(),[]);
  const {data:goals}=useAsync<Goal[]>(()=>userApi.listGoals(),[]);
  const {data:me,refresh:refreshMe}=useAsync(()=>userApi.getMe(),[]);
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
  const save=async()=>{
    if(savingBody)return;
    if([height,weight].some(value=>value.trim()&&(!Number.isFinite(Number(value))||Number(value)<=0))){setBodyError('身高和体重必须为大于0的数字');return}
    if(birth&&birth>todayStr()){setBodyError('出生日期不能晚于今天');return}
    setSavingBody(true);setBodyError('');
    try{await userApi.updateProfile({heightCm:height.trim()?Number(height):null,weightKg:weight.trim()?Number(weight):null,birthDate:birth?`${birth}T00:00:00.000Z`:null,gender:GENDERS[genderIdx].key,activityLevel:ACTIVITY[actIdx].key as Profile['activityLevel']});toast('已保存');setEditing(false);await refreshProfile()}
    catch(e){setBodyError((e as {message?:string})?.message||'保存失败，请重试')}
    finally{setSavingBody(false)}
  };
  const groups=[
    [{label:'我的目标',icon:<Aim/>,value:goal?goalLabel[goal.type]??goal.type:'未设置'},{label:'身体数据',icon:<RecordsOutlined/>,value:profile?.weightKg?`${profile.weightKg} kg`:''},{label:'本周报告',icon:<CalendarOutlined/>,value:''},{label:'饮食偏好',icon:<LikeOutlined/>,value:profile?.dietPreference||''}],
    [{label:'健康工具箱',icon:<AppsOutlined/>,value:'小工具 · 测评 · 百科'},{label:'生活方式测评',icon:<Award/>,value:'5 套测评'}],
    [{label:'关于轻身记',icon:<InfoOutlined/>,value:''}]
  ];
  const showAbout=()=>Taro.showModal({title:'关于轻身记',content:'轻身记 v1.0.0\n\n记录饮食、运动与身体数据，看清每一天的变化。\n\n数据安全：所有数据仅用于你的身体管理和分析，不会提供给第三方。',showCancel:false});
  return <Screen className="profile-page">
    <View className="profile-hero"><View className="avatar"><UserOutlined/></View><View className="hero-copy"><View onClick={openNick}><Text className="user-name">{me?.nickname||'轻身记用户'}</Text><Text className="goal-pill">{goal?goalLabel[goal.type]??goal.type:'健康管理'}</Text></View><Text className="user-id">{me?.nickname?'点击昵称可修改 · 你的个人健康空间':'点击设置昵称 · 你的个人健康空间'}</Text></View><Edit className="edit-icon" onClick={openEdit}/></View>
    <View className="stat-card"><View><Text>身高</Text><Text>{profile?.heightCm != null ? `${profile.heightCm} cm` : '未填写'}</Text></View><View><Text>体重</Text><Text>{profile?.weightKg != null ? `${profile.weightKg} kg` : '未填写'}</Text></View><View><Text>目标周期</Text><Text>{goal?.durationWeeks ? `${goal.durationWeeks}周` : '未设置'}</Text></View></View>
    {groups.map((group,index)=><View className="menu-card" key={index}>{group.map(item=><View className="menu-row" key={item.label} onClick={()=>item.label==='我的目标'?Taro.navigateTo({url:'/pages/onboarding/index'}):item.label==='身体数据'?openEdit():item.label==='本周报告'?go(RoutePath.WeeklyReport):item.label==='饮食偏好'?openDiet():item.label==='健康工具箱'?Taro.navigateTo({url:'/pages/toolbox/index'}):item.label==='生活方式测评'?Taro.navigateTo({url:'/pages/assessment/index'}):showAbout()}><View className="menu-icon">{item.icon}</View><Text className="menu-label">{item.label}</Text>{item.value&&<Text className="menu-value">{item.value}</Text>}<ArrowRight/></View>)}</View>)}
    {dietEditing&&<View className="mask" onClick={()=>!savingDiet&&setDietEditing(false)}><View className="edit-sheet" catchMove onClick={e=>e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">编辑饮食偏好</Text><Text className="diet-help">填写口味、忌口及过敏原；留空可清除偏好。</Text><Textarea className="diet-input" value={diet} maxlength={500} onInput={e=>setDiet(e.detail.value)} placeholder="请输入你的饮食偏好"/><Text className="diet-count">{diet.length}/500</Text>{dietError&&<Text className="diet-error">{dietError}</Text>}<Button className="sheet-save" loading={savingDiet} disabled={savingDiet} onClick={saveDiet}>保存偏好</Button><Button className="sheet-cancel" disabled={savingDiet} onClick={()=>setDietEditing(false)}>取消</Button></View></View>}
    {nickEditing&&<View className="mask" onClick={()=>!savingNick&&setNickEditing(false)}><View className="edit-sheet" catchMove onClick={e=>e.stopPropagation()}><View className="sheet-handle" /><Text className="sheet-title">设置昵称</Text><Text className="diet-help">点击键盘上方的微信昵称可一键填入。</Text><Input className="nick-input" type="nickname" value={nick} maxlength={30} onInput={e=>setNick(e.detail.value)} placeholder="输入昵称"/>{nickError&&<Text className="diet-error">{nickError}</Text>}<Button className="sheet-save" loading={savingNick} disabled={savingNick} onClick={saveNick}>保存昵称</Button><Button className="sheet-cancel" disabled={savingNick} onClick={()=>setNickEditing(false)}>取消</Button></View></View>}
    <View className="menu-card"><View className="menu-row" onClick={()=>go(RoutePath.DataSources)}><View className="menu-icon"><RecordsOutlined/></View><Text className="menu-label">数据源管理</Text><ArrowRight/></View></View>
    {editing&&<View className="mask" onClick={()=>!savingBody&&setEditing(false)}><View className="edit-sheet body-sheet" catchMove onClick={e=>e.stopPropagation()}>
      <View className="sheet-handle" />
      <Text className="sheet-title">编辑身体信息</Text>
      <Text className="diet-help">填写真实资料用于能量估算；留空可清除对应信息。</Text>
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
