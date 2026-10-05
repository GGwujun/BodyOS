import test from 'node:test';
import assert from 'node:assert/strict';
import { calcBMR, calcTDEE, calcEnergy } from './energy';
import { targetCalorieRange, weightTrend, goalProgress, goalScore } from './goal';
import { calcMacroTarget, nutritionScore } from './nutrition';
import { energyScore, activityScore, recoveryScore, bodyScore } from './score';
import { chat } from '../ai/zhipu';
import { env } from '../env';
import { recognizeAndCalculate } from '../ai/foodRecognition';
import { presentDataSource } from '../sync/registry';
import { buildCoachContext, ChatInputSchema } from '../ai/coachContext';
import { completeCoachTurn } from '../ai/coachTurn';
import { hasEnergyProfile } from './dataAvailability';
import { ProfileSchema } from '../lib/profileValidation';
import { summaryNeedsRefresh } from '../lib/summaryFreshness';
import { countRecordedDays } from '../lib/recordedDays';
import { observedWeightChange } from '../lib/weightChange';
import { CreateActivitySchema } from '../routes/activity';
import { measurementWindow } from '../lib/trendWindow';
import { CreateBodySchema } from '../routes/body';

test('AI quota errors are readable and do not expose provider response bodies', async () => {
  const previousFetch=globalThis.fetch;
  const previousKey=env.zhipuApiKey;
  try {
    env.zhipuApiKey='local-test-only';
    globalThis.fetch=async()=>({ok:false,status:429,text:async()=>'{"private":"provider-internal-id"}'} as Response);
    await assert.rejects(chat([{role:'user',content:'local transport test'}]),error=>{
      const message=(error as Error).message;
      assert.match(message,/额度|限流/);
      assert.equal(message.includes('provider-internal-id'),false);
      return true;
    });
  } finally { globalThis.fetch=previousFetch;env.zhipuApiKey=previousKey; }
});

test('body measurements reject absent, impossible, and future observations', () => {
  const measuredAt='2026-01-01T00:00:00.000Z';
  for(const fields of [{},{weightKg:-1},{weightKg:0},{bodyFatPct:101},{muscleKg:-1}]) {
    assert.equal(CreateBodySchema.safeParse({measuredAt,...fields}).success,false);
  }
  assert.equal(CreateBodySchema.safeParse({measuredAt:'2999-01-01T00:00:00.000Z',weightKg:70}).success,false);
  assert.equal(CreateBodySchema.safeParse({measuredAt,weightKg:70}).success,true);
  assert.equal(CreateBodySchema.safeParse({measuredAt,bodyFatPct:0}).success,true);
});

test('trend measurements include local first-day midnight and exclude following days', () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Shanghai';
    const bounds = measurementWindow('2026-09-03', '2026-09-09');
    assert.equal(bounds.gte.toISOString(), '2026-09-02T16:00:00.000Z');
    assert.equal(bounds.lt?.toISOString(), '2026-09-09T16:00:00.000Z');
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test('activity input rejects negative observations and blank type',()=>{
  const base={type:'跑步',calories:100,startedAt:'2026-09-01T00:00:00.000Z'};
  for(const patch of [{calories:-1},{steps:-1},{type:'   '},{confidence:2}]) {
    assert.equal(CreateActivitySchema.safeParse({...base,...patch}).success,false);
  }
  assert.equal(CreateActivitySchema.safeParse({...base,calories:0,steps:0}).success,true);
});

test('weight change requires two observations and preserves genuine zero change', () => {
  assert.equal(observedWeightChange([]),null);
  assert.equal(observedWeightChange([70]),null);
  assert.equal(observedWeightChange([70,70]),0);
  assert.equal(observedWeightChange([70,69]),-1);
});

test('recorded days count unique observed dates rather than available scores', () => {
  assert.equal(countRecordedDays(['2026-09-01','2026-09-01'],['2026-09-02'],['2026-09-02','2026-09-03']),3);
  assert.equal(countRecordedDays([],[],[]),0);
});

test('profile edits invalidate summary even during the cache TTL', () => {
  assert.equal(summaryNeedsRefresh(new Date(1000),new Date(2000),true,true),true);
  assert.equal(summaryNeedsRefresh(new Date(2000),new Date(1000),true,true),false);
  assert.equal(summaryNeedsRefresh(null,null,false,true),true);
  assert.equal(summaryNeedsRefresh(new Date(2000),null,true,false),true);
});

test('profile rejects invalid measurements and future birth dates', () => {
  for(const data of [{heightCm:0},{weightKg:-5},{heightCm:Infinity},{birthDate:'2999-01-01T00:00:00.000Z'},{dietPreference:'x'.repeat(501)}]) {
    assert.equal(ProfileSchema.safeParse(data).success,false);
  }
  assert.equal(ProfileSchema.safeParse({heightCm:175,weightKg:70,birthDate:'1990-01-01T00:00:00.000Z',gender:'female'}).success,true);
  assert.equal(ProfileSchema.safeParse({heightCm:null,weightKg:null,birthDate:null}).success,true);
});

test('energy estimates require real complete profile fields', () => {
  assert.equal(hasEnergyProfile({gender:'male',age:30,heightCm:175,weightKg:70}),true);
  for(const partial of [{age:null},{heightCm:null},{weightKg:null},{gender:'other'},{weightKg:0},{heightCm:NaN}]) {
    assert.equal(hasEnergyProfile({gender:'male',age:30,heightCm:175,weightKg:70,...partial}),false);
  }
});

test('failed AI turn does not persist a partial conversation', async () => {
  const previousKey=env.zhipuApiKey;
  let persisted=false;
  try {
    env.zhipuApiKey='';
    await assert.rejects(completeCoachTurn([], '晚餐怎么安排？', {}, async()=>{persisted=true}), /尚未配置/);
    assert.equal(persisted,false);
  } finally { env.zhipuApiKey=previousKey; }
});

test('coach context carries saved preferences without leaking profile identifiers', () => {
  const context = buildCoachContext({dietPreference:'花生过敏',trainingPref:'游泳',heightCm:170,weightKg:65}, {today:{steps:1200}});
  assert.equal(context.profile.dietPreference, '花生过敏');
  assert.equal(context.profile.trainingPreference, '游泳');
  assert.equal(context.profile.heightCm, 170);
  assert.deepEqual(context.today, {steps:1200});
  assert.equal(buildCoachContext(null, {}).profile.dietPreference, null);
});

test('chat input requires a nonblank latest user message', () => {
  for(const messages of [[],[{role:'user',content:'   '}],[{role:'assistant',content:'你好'}]]) {
    assert.equal(ChatInputSchema.safeParse({messages}).success, false);
  }
  assert.equal(ChatInputSchema.safeParse({messages:[{role:'user',content:'晚餐怎么安排？'}]}).success,true);
});

test('unavailable adapters cannot expose legacy connections as operational', () => {
  const result = presentDataSource('wechat', {status:'connected',lastSyncAt:new Date('2026-01-01'),permissions:null,lastError:null});
  assert.equal(result.available, false);
  assert.equal(result.status, 'disconnected');
  assert.equal(result.lastSyncAt, null);
  assert.equal(result.hasStoredConnection, true);
  assert.ok(result.unavailableReason);
});

test('food recognition rejects absent evidence before requesting AI', async () => {
  for (const text of [undefined, '', '   ']) {
    await assert.rejects(recognizeAndCalculate(text), /食物描述或图片/);
  }
});

test('food recognition propagates image failure without inventing a text result', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = env.zhipuApiKey;
  let calls = 0;
  try {
    env.zhipuApiKey = 'test-only';
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('image unavailable');
    }) as typeof fetch;
    await assert.rejects(recognizeAndCalculate(undefined, 'test-image'), /image unavailable/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    env.zhipuApiKey = previousKey;
  }
});

test('food recognition rejects malformed AI amounts instead of substituting 100g', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = env.zhipuApiKey;
  try {
    env.zhipuApiKey = 'test-only';
    for (const item of [{name:'鸡蛋',grams:0}, {name:'鸡蛋',grams:-1}, {name:'鸡蛋',grams:'100'}, {name:'',grams:100}]) {
      globalThis.fetch = (async () => ({ok:true, json:async () => ({content:[{type:'text',text:JSON.stringify({items:[item]})}]})})) as unknown as typeof fetch;
      await assert.rejects(recognizeAndCalculate('鸡蛋'), /识别结果/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    env.zhipuApiKey = previousKey;
  }
});

test('calcBMR applies Mifflin-St Jeor for male and female profiles', () => {
  assert.equal(calcBMR({ gender: 'male', age: 30, heightCm: 175, weightKg: 70 }), 1648.75);
  assert.equal(calcBMR({ gender: 'female', age: 30, heightCm: 175, weightKg: 70 }), 1482.75);
});

test('calcEnergy uses BMR plus observed activity without double-counting TDEE', () => {
  const result = calcEnergy({ gender:'male', age:30, heightCm:175, weightKg:70, activityLevel:'moderate', intakeCalories:2000, activeCalories:300, exerciseCalories:200 });
  assert.equal(result.burnCalories, 2148.75);
  assert.equal(result.netCalories, -148.75);
  assert.equal(result.confidence, 1);
  assert.equal(result.tdee, calcTDEE(result.bmr, 'moderate'));
});

test('calcEnergy lowers confidence when profile fields are missing', () => {
  assert.equal(calcEnergy({ gender:'other', age:null, heightCm:null, weightKg:null, activityLevel:'moderate', intakeCalories:0, activeCalories:0, exerciseCalories:0 }).confidence, 0.35);
});

test('weightTrend sorts dates and returns the daily regression slope', () => {
  assert.equal(weightTrend([{date:'2026-01-03',weightKg:68},{date:'2026-01-01',weightKg:70},{date:'2026-01-02',weightKg:69}]), -1);
  assert.equal(weightTrend([{date:'2026-01-01',weightKg:70}]), 0);
});

test('goalProgress clamps fat-loss and muscle-gain progress', () => {
  assert.equal(goalProgress({type:'fat_loss',startValue:80,currentValue:75,targetChange:10}), .5);
  assert.equal(goalProgress({type:'muscle_gain',startValue:70,currentValue:75,targetChange:4}), 1);
});

test('targetCalorieRange returns a five-percent band', () => {
  assert.deepEqual(targetCalorieRange(2000), [1900, 2100]);
});

test('activity and recovery scores respect their caps', () => {
  assert.equal(activityScore(100000, 1000), 100);
  assert.equal(recoveryScore({hasRecentRecords:true,consecutiveDays:100,weightVolatilityPct:0}), 80);
});

test('energyScore is clamped between zero and one hundred', () => {
  assert.equal(energyScore({netCalories:0,targetNetCalories:0,targetCalories:2000}), 100);
  assert.equal(energyScore({netCalories:10000,targetNetCalories:0,targetCalories:2000}), 0);
});

test('macro targets and nutrition score produce finite non-negative values', () => {
  const target = calcMacroTarget({tdee:2200,goalType:'fat_loss',weightKg:70});
  assert.ok(target.targetCalories > 0 && target.targetProteinG > 0 && target.targetCarbG >= 0 && target.targetFatG >= 0);
  const score = nutritionScore({proteinG:120,carbG:180,fatG:60,fiberG:20}, target);
  assert.ok(Number.isFinite(score) && score >= 0 && score <= 100);
});

test('bodyScore returns every bounded score dimension', () => {
  const result = bodyScore({netCalories:-300,targetNetCalories:-300,targetCalories:2000,nutritionScore:80,steps:8000,exerciseMin:30,goalScore:75,hasRecentRecords:true,consecutiveDays:5,weightVolatilityPct:.7});
  for (const value of Object.values(result)) assert.ok(value >= 0 && value <= 100);
});

test('inactive goals receive the neutral score', () => {
  assert.equal(goalScore({progress:0,trend:9,type:'fat_loss',isActive:false}), 70);
});

test('missing AI credentials fail explicitly without fabricated data', async () => {
  const original = env.zhipuApiKey;
  try {
    env.zhipuApiKey = '';
    await assert.rejects(chat([{role:'user',content:'测试'}]), /尚未配置/);
  } finally { env.zhipuApiKey = original; }
});
