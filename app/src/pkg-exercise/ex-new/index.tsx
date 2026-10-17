import { useEffect, useRef, useState } from 'react';
import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import Screen from '@/components/Screen';
import { track } from '@/services/analytics';
import { setLeaveGuard } from '@/utils/leave-guard';
import { confirmDelete, toast } from '@/utils/ui';
import { param } from '@/utils/url-param';
import { BODYPART_ZH, EQUIPMENT_ZH, MUSCLE_ZH } from '../data/exercises';
import {
  MUSCLE_OF_BODYPART, NAME_MAX, PICKABLE_MUSCLES,
  addCustom, findCustom, updateCustom, type CustomDraft
} from '../engine/custom';
import { purgeCustom, undoPurge } from '../engine/custom-purge';
import { KIT_EQUIPMENT, loadKit } from '../engine/kit';
import { loadNotes, setNote } from '../engine/store';
import './index.scss';

/** 备注长度与动作库的常驻备注同一处口径(`store.setNote` 会截到 60) */
const NOTE_MAX = 60;
/** 器械可选项:器材清单那份(按动作数排过序,常见在前),去掉「卧推凳/单杠」这类配件 */
const EQ_CHOICES = KIT_EQUIPMENT.filter((e) => e in EQUIPMENT_ZH);
const BP_CHOICES = Object.keys(BODYPART_ZH);
const zh = (map: Record<string, string>, k: string) => map[k] ?? k;

/**
 * 新建 / 编辑自定义动作 — 动作库里没有的那台器械,自己建一个。
 *
 * 建出来的是一个**正经的动作**:有部位、有器械、有肌群,所以按 id 走的那一整套口径
 * (单侧折算、重量怎么说、肌群统计、恢复、换动作候选)一处都不用改就都认它。
 * 页面里问的每一项都对应下游的一个决定,不是表单凑数 —— 说明都写在每一项下面。
 */
export default function ExerciseNewPage() {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const editId = params.id || '';
  /** 从动作库带进来的部位(从那组点进来说明他就在建那个部位的动作) */
  const preBp = param(params.bp);
  /** 从动作库带进来的名字 —— 搜「推胸机」没搜到,那个词就是他要建的名字(空手进表单还得再打一遍) */
  const preName = param(params.name).slice(0, NAME_MAX);

  const [name, setName] = useState(preName);
  const [bp, setBp] = useState(preBp && preBp in BODYPART_ZH ? preBp : '');
  const [eq, setEq] = useState('');
  const [target, setTarget] = useState('');
  const [secondary, setSecondary] = useState<string[]>([]);
  const [sided, setSided] = useState(false);
  const [assisted, setAssisted] = useState(false);
  const [note, setNoteText] = useState('');
  const [err, setErr] = useState('');
  /** 用户自己点过肌群 → 不再跟着部位自动改(别把他选的顶掉) */
  const [muscleTouched, setMuscleTouched] = useState(false);
  const [ready, setReady] = useState(!editId);

  useEffect(() => {
    track('custom_ex_view', 'other');
    if (editId) {
      const ex = findCustom(editId);
      if (!ex || ex.deletedAt) {
        toast('这个动作已经不在了', 'none');
        Taro.navigateBack();
        return;
      }
      setName(ex.name);
      setBp(ex.bodyPart);
      setEq(ex.equipment);
      setTarget(ex.target);
      setSecondary(ex.secondary);
      setSided(ex.sided);
      setAssisted(ex.assisted);
      setNoteText(loadNotes()[ex.id] ?? '');
      setMuscleTouched(true);
      setReady(true);
      return;
    }
    // 新动作:部位跟着进来的筛选走(从「胸」那一组点进来说明他就在建胸的动作),
    // 器械默认他登记过的唯一那种 —— 自己建的动作九成就是家里/馆里那台
    const own = loadKit().equipment ?? [];
    if (own.length === 1) setEq(own[0]);
    setTarget(MUSCLE_OF_BODYPART[preBp] ?? '');
  }, []);

  /**
   * 填了一半 → 底栏那一下 switchTab 会把这页**关掉**(微信的语义),填的内容就没了。
   * 判断方式是跟「进页面时那份底稿」比:编辑一个已有动作时几个字段本来就是填满的,
   * 不能拿「有没有值」当脏;底稿在 ready 变 true 那一帧拍下来(那时载入已经写进 state)。
   * 只拦我们自己那个底栏,不给原生返回加询问 —— 表单是几分钟的东西,原生返回是用户
   * 明确的动作(训练页不同:那一场丢了就没法复原,那边两条路都拦)。
   */
  const draftKey = JSON.stringify([name, bp, eq, target, secondary, sided, assisted, note]);
  const baseRef = useRef('');
  const dirtyRef = useRef(false);
  dirtyRef.current = ready && baseRef.current !== '' && draftKey !== baseRef.current;
  useEffect(() => {
    if (ready) baseRef.current = draftKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    setLeaveGuard({
      dirty: () => dirtyRef.current,
      title: '还没保存',
      content: '这个动作还没保存,离开的话刚填的内容就没了。',
      confirmText: '放弃'
    });
    return () => setLeaveGuard(null);
  }, []);

  const pickBp = (k: string) => {
    setBp(k);
    // 部位换了,主要肌群还没自己动过 → 跟着换一个默认的(不然会留在上一个部位的肌群上)
    if (!muscleTouched) setTarget(MUSCLE_OF_BODYPART[k] ?? '');
  };

  const pickMuscle = (k: string) => {
    setMuscleTouched(true);
    setTarget(target === k ? '' : k);
    setSecondary((s) => s.filter((m) => m !== k));
  };

  const toggleSecond = (k: string) => {
    if (k === target) return;   // 主要肌群不能再挂一遍次要(统计里会重复记)
    setSecondary((s) => (s.includes(k) ? s.filter((m) => m !== k) : [...s, k]));
  };

  const save = () => {
    const draft: CustomDraft = { name, bodyPart: bp, equipment: eq, target, secondary, sided, assisted };
    const r = editId ? updateCustom(editId, draft) : addCustom(draft);
    if (!r.ok) {
      setErr(r.why);
      toast(r.why, 'none');
      return;
    }
    // 备注走**既有的动作备注**(按动作 id 存的那一份):训练页那一行、动作库详情
    // 读的都是它,所以自定义动作的要点不用另开一个字段(见 engine/custom.ts 的决定①)
    setNote(r.ex.id, note);
    track('custom_ex_save', 'other');
    toast(editId ? '已保存' : '建好了', 'success');
    Taro.navigateBack();
  };

  const remove = async () => {
    const ok = await confirmDelete(
      `删除「${name}」`,
      '动作库和计划里都不再出现它,收藏、备注、力量基准也一并清掉。'
      + '已经练过的记录还留着 —— 那几次的组数照旧算进肌群统计。'
    );
    if (!ok) return;
    const r = purgeCustom(editId);
    track('custom_ex_delete', 'other');
    if (!r.retired) { toast('这个动作已经不在了', 'none'); Taro.navigateBack(); return; }
    /* 删完**挡着问一句要不要撤销**:这个动作是用户手打出来的,误删一下不只是列表里
     * 少一行 —— 计划里那几处编排、力量基准(下次开多重看它)、常驻备注会一起没,
     * 而这三样都没有别的地方能复原。engine 那边已经把被摘掉的几格抄下来了
     * (见 custom-purge.ts 的 undoPurge),这里只负责问一句。
     * 两个按钮都写成明确的动词,避免「确认/取消」在第二个弹窗里反过来读。 */
    const { confirm } = await Taro.showModal({
      title: r.planned ? `已删除,计划里去掉 ${r.planned} 处` : '已删除',
      content: '动作库和计划里都不再出现它了。要是点错了,这里还能把它拿回来。',
      confirmText: '撤销删除',
      cancelText: '知道了'
    });
    if (confirm) {
      const u = undoPurge();
      if (!u.ok) toast(u.why, 'none');
      else {
        track('custom_ex_delete_undo', 'other');
        // 计划那份是按位置存的,撤销时比对不过(那几秒里计划被别处改过)就不动它 ——
        // 这时候动作回来了、计划里那几处没回来,得说清楚,不能让他以为都好了
        if (u.plan) toast('已拿回来', 'success');
        else toast('动作已拿回来,计划里那几处要自己再加一下', 'none');
      }
    }
    Taro.navigateBack();
  };

  if (!ready) return <Screen className="xn-page" />;

  const canSave = Boolean(name.trim() && bp && eq);
  const nameHasAssist = /助力/.test(name);

  return <Screen className="xn-page">
    <View className="card xn-intro">
      <Text className="fs-h1">{editId ? '编辑动作' : '新建动作'}</Text>
      <Text className="fs-caption">
        健身房里那台动作库里没有的器械、教练给你改的变式,建成自己的动作之后就能像库里的动作一样
        排进计划、记组数,也会算进肌群统计与恢复。名字、部位、器械是必填的三项。
      </Text>
    </View>

    <View className="card xn-block">
      <Text className="xn-label">名字</Text>
      <Input
        className="xn-input"
        value={name}
        maxlength={NAME_MAX}
        placeholder="比如:器械推胸机"
        placeholderClass="xn-ph"
        onInput={(e) => { setName(e.detail.value); setErr(''); }}
      />
      <Text className="fs-mini text-secondary xn-hint">
        起个你自己认得出的名字就行 —— 训练页那一行、历史记录里显示的都是它。
      </Text>
    </View>

    <View className="card xn-block">
      <Text className="xn-label">部位</Text>
      <View className="xn-chips">
        {BP_CHOICES.map((k) => (
          <Text className={`xn-chip${bp === k ? ' on' : ''}`} key={k} onClick={() => pickBp(k)}>
            {zh(BODYPART_ZH, k)}
          </Text>
        ))}
      </View>
      <Text className="fs-mini text-secondary xn-hint">
        决定统计时算哪个部位,也决定「推拉比」「上下肢比」里它算哪一边。
      </Text>
    </View>

    <View className="card xn-block">
      <Text className="xn-label">器械</Text>
      <View className="xn-chips">
        {EQ_CHOICES.map((k) => (
          <Text className={`xn-chip${eq === k ? ' on' : ''}`} key={k} onClick={() => setEq(k)}>
            {zh(EQUIPMENT_ZH, k)}
          </Text>
        ))}
      </View>
      <Text className="fs-mini text-secondary xn-hint">
        决定那个数字怎么念:杠铃/哑铃/器械是重量,助力器械是「助力」,负自重是「附加重量」。
      </Text>
    </View>

    <View className="card xn-block">
      <Text className="xn-label">主要练哪里</Text>
      <View className="xn-chips">
        {PICKABLE_MUSCLES.map((k) => (
          <Text className={`xn-chip${target === k ? ' on' : ''}`} key={k} onClick={() => pickMuscle(k)}>
            {zh(MUSCLE_ZH, k)}
          </Text>
        ))}
      </View>
      <Text className="fs-mini text-secondary xn-hint">
        挑一个,练完的组数就记到这个肌群上(不挑的话这个动作不进肌群统计)。
      </Text>
    </View>

    <View className="card xn-block">
      <Text className="xn-label">还练到(可多选)</Text>
      <View className="xn-chips">
        {PICKABLE_MUSCLES.map((k) => (
          <Text
            className={`xn-chip${secondary.includes(k) ? ' on' : ''}${k === target ? ' off' : ''}`}
            key={k}
            onClick={() => toggleSecond(k)}
          >
            {zh(MUSCLE_ZH, k)}
          </Text>
        ))}
      </View>
      <Text className="fs-mini text-secondary xn-hint">
        协同肌群按半组折算 —— 比如推胸机主要练胸、还练到手臂和肩,那就把这两个也点上。不点也行。
      </Text>
    </View>

    <View className="card xn-block">
      <Text className="xn-label">动作特点</Text>
      <View className="xn-toggle" onClick={() => setSided((v) => !v)}>
        <View className="xn-toggle-main">
          <Text className="xn-toggle-name">单侧动作</Text>
          <Text className="fs-mini text-secondary">一次只练一边(单臂划船、弓步)。次数按两侧合计记,显示时折半。</Text>
        </View>
        <Text className={`xn-switch${sided ? ' on' : ''}`}>{sided ? '是' : '否'}</Text>
      </View>
      <View className="xn-toggle" onClick={() => setAssisted((v) => !v)}>
        <View className="xn-toggle-main">
          <Text className="xn-toggle-name">助力器械</Text>
          <Text className="fs-mini text-secondary">
            器械替你分担体重的那种(助力引体机)。这个数字是器械帮你的力,越大越轻松,所以它不进力量纪录。
          </Text>
        </View>
        <Text className={`xn-switch${assisted ? ' on' : ''}`}>{assisted ? '是' : '否'}</Text>
      </View>
      {nameHasAssist && !assisted && (
        <Text className="fs-mini xn-warn">名字里有「助力」—— 这类动作记得把上面的开关打开。</Text>
      )}
    </View>

    <View className="card xn-block">
      <Text className="xn-label">备注(可留空)</Text>
      <Input
        className="xn-input"
        value={note}
        maxlength={NOTE_MAX}
        placeholder="比如:插销放第 3 格"
        placeholderClass="xn-ph"
        onInput={(e) => setNoteText(e.detail.value)}
      />
      <Text className="fs-mini text-secondary xn-hint">
        和库里动作的「动作备注」是同一个地方 —— 训练时点动作右边那个 🗒 也能改。
      </Text>
    </View>

    {err && <Text className="fs-caption xn-err">{err}</Text>}

    <Button className={`btn btn--primary btn--block${canSave ? '' : ' xn-dim'}`} onClick={save}>
      {editId ? '保存' : '建好这个动作'}
    </Button>
    <Text className="fs-mini text-secondary xn-foot">
      自己建的动作只在你的账号里,不会进公共动作库;换设备登录同一账号会同步过去。
      {editId ? '' : '它也不会被自动生成计划挑中 —— 想练就自己加进计划里。'}
    </Text>

    {editId && (
      <Text className="xn-del" onClick={remove}>删除这个动作</Text>
    )}
  </Screen>;
}
