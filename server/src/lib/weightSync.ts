import { prisma } from '../db';

/**
 * 在资料里保存体重时,同步落一条当天的身体测量记录,
 * 让趋势页/体重数据页/方案页有据可查(与 POST /body-measurements 的正向同步对应)。
 * 当天已有测量则只更新其体重,避免反复编辑资料刷出重复曲线点。
 * 边界用本地时区当天 00:00 起的瞬时值,与 toDateStr 的"今天"口径一致。
 */
export async function syncWeightMeasurement(userId: string, weightKg: number) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const existing = await prisma.bodyMeasurement.findFirst({
    where: { userId, measuredAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { measuredAt: 'desc' }
  });

  if (existing) {
    return prisma.bodyMeasurement.update({
      where: { id: existing.id },
      data: { weightKg }
    });
  }
  return prisma.bodyMeasurement.create({
    data: { userId, measuredAt: now, weightKg }
  });
}

/**
 * 资料里的体重被清空时,把今天那笔「由资料同步出来的」测量也清掉。
 *
 * 不清的话会出现两个互相矛盾的事实:资料页写着没有体重,体重页/趋势页却还有今天这个数;
 * 用户再改一次身高保存,那个已经清掉的数又会被写回来。
 * 只动**今天**、而且只把 weightKg 置空:同一条里还有体脂/围度的话,那条记录本身要留着。
 */
export async function clearTodayWeightMeasurement(userId: string) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const where = { userId, measuredAt: { gte: dayStart, lt: dayEnd } };

  await prisma.bodyMeasurement.updateMany({
    where: { ...where, weightKg: { not: null } },
    data: { weightKg: null }
  });
  // 只剩一个空壳(当初就是为存体重建的)才删;带着其他测量数据的记录留着
  await prisma.bodyMeasurement.deleteMany({
    where: {
      ...where,
      weightKg: null,
      bodyFatPct: null,
      muscleKg: null,
      waistCm: null,
      chestCm: null,
      hipCm: null,
      armCm: null,
      thighCm: null
    }
  });
}
