import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { USER_ID } from '../src/lib/currentUser';

const prisma = new PrismaClient();
const execute = process.argv.includes(`--confirm-user=${USER_ID}`);
async function main() {
  await prisma.$transaction(async tx => {
    const where = {userId:USER_ID};
    const tables = {
      userProfile:await tx.userProfile.findMany({where}),
      goal:await tx.goal.findMany({where}),
      foodLog:await tx.foodLog.findMany({where}),
      activityRecord:await tx.activityRecord.findMany({where}),
      bodyMeasurement:await tx.bodyMeasurement.findMany({where}),
      dailySummary:await tx.dailySummary.findMany({where}),
      dataSource:await tx.dataSource.findMany({where}),
      syncRawRecord:await tx.syncRawRecord.findMany({where}),
      aIConversation:await tx.aIConversation.findMany({where}),
      analyticsEvent:await tx.analyticsEvent.findMany({where})
    };
    const counts=Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length]));
    if(!execute){console.log(JSON.stringify({mode:'read-only',userId:USER_ID,counts},null,2));return;}
    const directory=path.resolve(__dirname,'../backups');
    await mkdir(directory,{recursive:true});
    const backup=path.join(directory,`test-data-${USER_ID}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
    const body=JSON.stringify({version:1,userId:USER_ID,createdAt:new Date().toISOString(),tables},null,2);
    await writeFile(backup,body,{flag:'wx'});
    if(await readFile(backup,'utf8')!==body)throw new Error('备份校验失败，未清理数据');
    await tx.analyticsEvent.deleteMany({where});
    await tx.aIConversation.deleteMany({where});
    await tx.syncRawRecord.deleteMany({where});
    await tx.dataSource.deleteMany({where});
    await tx.dailySummary.deleteMany({where});
    await tx.bodyMeasurement.deleteMany({where});
    await tx.activityRecord.deleteMany({where});
    await tx.foodLog.deleteMany({where});
    await tx.goal.deleteMany({where});
    await tx.userProfile.deleteMany({where});
    return {backup,counts};
  },{isolationLevel:'Serializable',timeout:30000}).then(result=>{
    if(result)console.log(JSON.stringify({mode:'cleared',userId:USER_ID,...result},null,2));
  });
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
