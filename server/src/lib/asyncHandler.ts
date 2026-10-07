import type { Request, Response, RequestHandler } from 'express';

/**
 * Express 4 不会捕获 async handler 里抛出的 rejection:
 * Prisma 校验错/脏参数会变成 unhandledRejection,直接打挂整个进程。
 * 所有 async 路由统一用 wrap() 包一层,rejection 转发给全局错误中间件。
 */
export function wrap(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
