import { Router } from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';
import { logError } from '../lib/log';
import { getAccessToken } from '../lib/wechatSend';
import { getMediaDir } from '../lib/mediaDir';

/**
 * 小程序码 —— 分享卡右下角那枚「扫进来」的入口。
 *
 * GET /wxacode?scene=daily
 * 用 wxacode.getwxacodeunlimit 生成(check_path:false,未发布路径也不至于报错),
 * 结果按 scene 缓存在媒体目录:码的内容永远不变,生成一次永久复用,不打微信接口配额。
 * 走既有 /media 静态服务,域名白名单现成。
 *
 * 扩展名按返回内容的魔数定:文档说 PNG,**实际会回 JPEG**(线上验过,JFIF 头),
 * 后缀写错会让静态路由报错 content-type,严格的客户端就不认了。
 */

const router = Router();

/** scene 白名单:小程序码 scene 上限 32 字符,取值收敛到 [a-z0-9_-],文件名拼接才安全 */
export function wxacodeSceneOk(scene: string): boolean {
  return /^[a-z0-9_-]{1,32}$/.test(scene);
}

/** 按魔数认图片格式;认不出给 null(当失败处理,别把垃圾字节当码存下来) */
export function wxacodeExtOf(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return null;
}

router.get('/', wrap(async (req, res) => {
  const scene = String(req.query.scene ?? 'daily');
  if (!wxacodeSceneOk(scene)) return err(res, 400, 'scene 只能是小写字母/数字/下划线/中划线,最长 32 位');

  const mediaDir = getMediaDir();
  const { existsSync } = await import('node:fs');
  // 缓存命中:两种扩展名都可能有(历史上先按 png 存过)
  for (const ext of ['png', 'jpg'] as const) {
    const cached = join(mediaDir, `wxacode-${scene}.${ext}`);
    if (existsSync(cached)) return ok(res, { url: `/media/wxacode-${scene}.${ext}` });
  }

  try {
    const token = await getAccessToken();
    const r = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene,
        // 进小程序落在首页;check_path 关掉,免得审核版还没上线时生成失败
        page: 'pages/home/index',
        check_path: false,
        env_version: 'release',
        width: 430,
        auto_color: false,
        line_color: { r: 23, g: 107, b: 85 }
      })
    });
    const buf = Buffer.from(await r.arrayBuffer());
    // 失败时微信回的是 JSON(errcode/errmsg),成功是图片二进制 —— 按内容分辨
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json') || (buf.length > 0 && buf[0] === 0x7b /* '{' */)) {
      const body = JSON.parse(buf.toString('utf8')) as { errcode?: number; errmsg?: string };
      logError('wxacode', '小程序码生成失败', undefined, { scene, errcode: body.errcode, errmsg: body.errmsg });
      return err(res, 502, '小程序码生成失败,请稍后再试', { affectsData: false });
    }
    const ext = wxacodeExtOf(buf);
    if (!ext) {
      logError('wxacode', '返回的内容不是图片', undefined, { scene, head: buf.subarray(0, 4).toString('hex') });
      return err(res, 502, '小程序码生成失败,请稍后再试', { affectsData: false });
    }
    const file = `wxacode-${scene}.${ext}`;
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, file), buf);
    return ok(res, { url: `/media/${file}` });
  } catch (e) {
    logError('wxacode', '小程序码接口异常', e, { scene });
    return err(res, 502, '小程序码生成失败,请稍后再试', { affectsData: false });
  }
}));

export default router;
