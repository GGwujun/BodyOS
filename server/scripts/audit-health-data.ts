import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { USER_ID } from '../src/lib/currentUser';

const prisma = new PrismaClient();
async function main() {
  const where = { userId: USER_ID };
  const orderBy = { id: 'asc' as const };
  const tables = await prisma.$transaction(async tx => ({
    profiles: await tx.userProfile.findMany({where,orderBy}),
    goals: await tx.goal.findMany({where,orderBy}),
    foods: await tx.foodLog.findMany({where,orderBy}),
    activities: await tx.activityRecord.findMany({where,orderBy}),
    measurements: await tx.bodyMeasurement.findMany({where,orderBy}),
    sources: await tx.dataSource.findMany({where,orderBy}),
    conversations: await tx.aIConversation.findMany({where,orderBy})
  }), {isolationLevel:'RepeatableRead'});
  // Only fingerprints/counts leave this audit; no profile contents are printed.
  console.log(JSON.stringify(Object.fromEntries(Object.entries(tables).map(([name,rows]) => [name, {
    count: rows.length,
    sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }])), null, 2));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
