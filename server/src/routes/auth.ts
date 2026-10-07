/**
 * 微信静默登录。
 *
 * POST /auth/wechat { code }
 * - 已配置 WECHAT_APPID/SECRET:code2session 换 openid → 找/建用户 → 签发 token
 * - 未配置:回落开发用户 u_1(返回 dev 标记),本地调试不依赖真实凭据
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { ok, err } from '../lib/http';
import { issueToken, DEV_USER_ID } from '../lib/currentUser';

const router = Router();

const WechatLoginSchema = z.object({ code: z.string().min(1, '缺少登录凭证') });

interface Code2SessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

async function code2Session(code: string): Promise<Code2SessionResponse> {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', env.wechatAppId);
  url.searchParams.set('secret', env.wechatAppSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  const res = await fetch(url, { method: 'GET' });
  return res.json() as Promise<Code2SessionResponse>;
}

router.post('/wechat', async (req, res, next) => {
  const parsed = WechatLoginSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, parsed.error.issues[0]?.message || '参数错误', { affectsData: false });

  try {
    // 本地开发回落:未配置微信凭据时签发开发用户令牌,保证链路可联调
    if (!env.wechatAppId || !env.wechatAppSecret) {
      console.warn('⚠️  未配置 WECHAT_APPID/WECHAT_APP_SECRET,/auth/wechat 回落开发用户 u_1');
      await prisma.user.upsert({
        where: { id: DEV_USER_ID },
        update: {},
        create: { id: DEV_USER_ID, nickname: '本地用户', timezone: 'Asia/Shanghai' }
      });
      const token = await issueToken(DEV_USER_ID);
      return ok(res, { token, userId: DEV_USER_ID, dev: true });
    }

    const session = await code2Session(parsed.data.code);
    if (!session.openid || session.errcode) {
      console.error('微信 code2session 失败:', session.errcode, session.errmsg);
      return err(res, 401, session.errmsg || '微信登录失败，请重试', { affectsData: false });
    }

    // openid → 用户(首次登录自动建号,空目标会引导进目标设置)
    const user = await prisma.user.upsert({
      where: { openid: session.openid },
      update: {},
      create: { openid: session.openid, nickname: '微信用户', timezone: 'Asia/Shanghai' }
    });
    const isNewUser = user.createdAt.getTime() > Date.now() - 60 * 1000;

    const token = await issueToken(user.id);
    return ok(res, { token, userId: user.id, isNewUser });
  } catch (error) { next(error); }
});

export default router;
