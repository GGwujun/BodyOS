import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const prisma=new PrismaClient();
async function main(){
  const userId=`transaction-check-${randomUUID()}`;
  await assert.rejects(prisma.$transaction(async tx=>{
    await tx.user.create({data:{id:userId,nickname:'transaction-only'}});
    await tx.goal.create({data:{userId,type:'fat_loss',targetValue:1,unit:'kg',isActive:true}});
    await tx.goal.create({data:{userId,type:'maintain',targetValue:70,unit:'kg',isActive:true}});
  }), (error: unknown)=>(error as {code?:string}).code==='P2002');
  assert.equal(await prisma.user.findUnique({where:{id:userId}}),null);
  assert.equal(await prisma.goal.count({where:{userId}}),0);
  console.log('唯一活跃目标约束通过；验证事务已回滚，没有遗留测试账号或目标。');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
