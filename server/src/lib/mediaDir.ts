import { isAbsolute, resolve } from 'node:path';
import { env } from '../env';

/** 媒体目录绝对路径:index.ts 的静态挂载、/health 探针、wxacode 缓存都用这一份,口径别分叉 */
export function getMediaDir(): string {
  return isAbsolute(env.mediaDir) ? env.mediaDir : resolve(process.cwd(), env.mediaDir);
}
