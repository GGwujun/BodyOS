import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 一次性回填:资料里有体重、但从来没有身体测量记录的用户,
 * 按资料更新时间补一条测量记录,让趋势页/体重数据页立刻有数据可画。
 * (PUT /profile 已改为保存体重时自动同步测量,此脚本只兜历史数据。)
 */
async function main() {
  const profiles = await prisma.userProfile.findMany({
    where: { weightKg: { not: null } },
    select: { userId: true, weightKg: true, updatedAt: true }
  });
  let created = 0;
  for (const p of profiles) {
    const count = await prisma.bodyMeasurement.count({ where: { userId: p.userId } });
    if (count > 0) {
      console.log(`skip  ${p.userId} (已有 ${count} 条测量)`);
      continue;
    }
    await prisma.bodyMeasurement.create({
      data: { userId: p.userId, measuredAt: p.updatedAt, weightKg: p.weightKg! }
    });
    created++;
    console.log(`fill  ${p.userId} weight=${p.weightKg}kg at ${p.updatedAt.toISOString()}`);
  }
  console.log(`done: backfilled ${created} user(s)`);
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
