import { PrismaClient } from '@prisma/client';
import { DEV_USER_ID } from '../src/lib/currentUser';

const prisma = new PrismaClient();

/** Initialize only the local account. Never create or replace health records. */
async function main() {
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {},
    create: { id: DEV_USER_ID, nickname: '本地用户', timezone: 'Asia/Shanghai' }
  });
  console.log('本地账号已就绪；未生成健康数据，未覆盖已有资料。');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
