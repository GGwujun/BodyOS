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
