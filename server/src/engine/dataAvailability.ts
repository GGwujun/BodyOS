export function hasEnergyProfile(profile: {gender:string;age:number|null;heightCm:number|null;weightKg:number|null}): boolean {
  return ['male','female'].includes(profile.gender) &&
    [profile.age,profile.heightCm,profile.weightKg].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0);
}
