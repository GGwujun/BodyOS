/** 缺哪几项就没法算基础代谢(算成人的年龄要由出生日期推,所以对外叫 birthDate) */
export type EnergyProfileField = 'birthDate' | 'heightCm' | 'weightKg';

/**
 * 一份能算能量的资料还缺什么。
 *
 * 性别**不在**这里:公式对「未提供 / 其他」用男女常数的中点(见 engine/energy.ts),
 * 不能因为用户不愿说性别就永远看不到消耗和评分。
 */
export function missingEnergyFields(
  profile: {age:number|null;heightCm:number|null;weightKg:number|null}
): EnergyProfileField[] {
  const missing: EnergyProfileField[] = [];
  if (!(typeof profile.age==='number' && Number.isFinite(profile.age) && profile.age>0)) missing.push('birthDate');
  if (!(typeof profile.heightCm==='number' && Number.isFinite(profile.heightCm) && profile.heightCm>0)) missing.push('heightCm');
  if (!(typeof profile.weightKg==='number' && Number.isFinite(profile.weightKg) && profile.weightKg>0)) missing.push('weightKg');
  return missing;
}

export function hasEnergyProfile(profile: {gender:string;age:number|null;heightCm:number|null;weightKg:number|null}): boolean {
  return missingEnergyFields(profile).length === 0;
}
