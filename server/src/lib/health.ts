import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 存活探针 —— 不只答「进程活着」,还答「真的能干活」:数据库能查、媒体目录能写。
 *
 * 只回 ok 的 /health 有个盲区:容器里数据卷被重挂成只读、数据库连接池枯竭的时候,
 * 进程往往还活得好好的,探针一路绿灯,直到第一个用户上传失败才被发现。
 * 这里把那两件事真的做一遍:查一条 `SELECT 1`,往媒体目录写一个探针文件再删掉
 * (文件名带点:媒体目录走静态服务,`dotfiles: 'deny'` 会挡住它,不会被当成用户内容访问)。
 *
 * 拆成独立函数(而不是写在路由里)是为了能单测:入口文件一 import 就 listen,
 * 测试没法碰;这里的两个失败分支(库不可用 / 目录不可写)正是这个探针存在的全部意义。
 *
 * @param mediaDir 媒体目录的绝对路径(不存在会建 —— 建不出来本身就是不健康)
 * @param pingDb 查一下数据库(入口传 Prisma 的 `$queryRaw`;测试传假实现)
 */
export async function healthCheck(
  mediaDir: string,
  pingDb: () => Promise<unknown>
): Promise<{ ok: true } | { ok: false; why: 'db' | 'media' }> {
  try {
    await pingDb();
  } catch {
    return { ok: false, why: 'db' };
  }
  try {
    await mkdir(mediaDir, { recursive: true });
    const probe = join(mediaDir, '.health-probe');
    await writeFile(probe, String(Date.now()));
    await rm(probe);
  } catch {
    return { ok: false, why: 'media' };
  }
  return { ok: true };
}
