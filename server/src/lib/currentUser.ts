/**
 * 请求级用户解析 + 令牌签发。
 *
 * 静默登录链路:小程序 wx.login 拿 code → POST /auth/wechat(code2session 换 openid)
 * → 按 openid 找/建 User → 签发 AuthToken → 客户端 Bearer 携带。
 *
 * 兼容策略:无 Authorization 头时回落开发用户 u_1(本地调试/H5 开发不登录也能用);
 * 令牌无效/过期返回 401,客户端清 token 后重新静默登录。
 */
import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';

/** 本地开发用户(无登录时的回落,也是历史 MVP 数据归属) */
export const DEV_USER_ID = 'u_1';

const TOKEN_TTL_DAYS = 30;

/** 从请求上下文取当前用户;无登录信息时回落开发用户 */
export function getUserId(res: Response): string {
  return ((res.locals as Record<string, unknown> | undefined)?.userId as string | undefined) ?? DEV_USER_ID;
}

/** 签发不透明随机令牌(32 字节 hex),有效期 30 天;一并保存微信 session_key(解密加密数据用) */
export async function issueToken(userId: string, sessionKey?: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.authToken.create({ data: { token, userId, sessionKey: sessionKey ?? null, expiresAt } });
  return token;
}

/** Express 中间件:Bearer 令牌 → res.locals.userId */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next(); // 无令牌:回落开发用户(见 getUserId)

  try {
    const auth = await prisma.authToken.findUnique({ where: { token } });
    if (!auth || auth.expiresAt.getTime() < Date.now()) {
      res.status(401).json({ code: 401, message: '登录已过期，请重新进入小程序', data: null });
      return;
    }
    (res.locals as Record<string, unknown>).userId = auth.userId;
    (res.locals as Record<string, unknown>).sessionKey = auth.sessionKey;
    next();
  } catch (error) {
    next(error);
  }
}
