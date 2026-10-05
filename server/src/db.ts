import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * PrismaClient 单例。
 * dev 热重载会重复创建实例,挂到 globalThis 防止连接泄漏。
 */
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error']
  });

if (env.nodeEnv !== 'production') {
  globalForPrisma.__prisma = prisma;
}
