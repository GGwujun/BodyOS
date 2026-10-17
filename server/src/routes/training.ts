import { Router } from 'express';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { getUserId } from '../lib/currentUser';
import { ok, err } from '../lib/http';
import { wrap } from '../lib/asyncHandler';

/**
 * 训练数据上云 —— 计划/渐进/日志/备注/器材/照片索引原本只在小程序本机 storage,
 * 换设备、清缓存就没了。这里给它们一个云端镜像。
 *
 * 设计:**服务端只做哑存储**,不做业务合并。每条文档按 (userId, kind, docKey) 唯一,
 * 冲突走 last-write-wins(比客户端时间戳)。真正的合并规则在客户端(utils/training-sync):
 * 日志按 id 取并集(两边各自练的都要留),计划和器材按时间戳取新的。
 * 之所以把合并放客户端 —— 只有客户端知道每种数据的语义,服务端猜错会静默丢数据。
 */

const router = Router();

/** 单条文档的 JSON 体积上限 —— 防一条脏数据把库和响应都撑大 */
const MAX_DOC_BYTES = 64 * 1024;
/** 一次推送的文档条数上限(首次同步最多也就几百条日志) */
const MAX_DOCS_PER_PUSH = 500;
/** 拉取上限:超过说明客户端该分批了,但先不让一条 GET 拖垮内存 */
const MAX_DOCS_PER_PULL = 2000;

/**
 * daynotes = 请假条(哪天不练),dayassign = 按天改练(哪天练哪一套),
 * favs = 收藏的动作,custom = 自己建的动作;服务端同样只当哑存储,不解释内容。
 * 两者是**两份**文档,别合并 —— 语义不同(见客户端 engine/dayassign.ts)。
 */
const KINDS = ['plan', 'progress', 'logs', 'notes', 'kit', 'photos', 'maxes', 'daynotes', 'dayassign', 'favs', 'custom'] as const;

export const DocSchema = z.object({
  kind: z.enum(KINDS),
  docKey: z.string().min(1).max(64),
  /** 客户端最后修改时间(ISO);冲突比较用它,不用服务端收到的时间 */
  clientUpdatedAt: z.string().datetime(),
  // refine 一层:z.unknown() 会被推断成可选字段,这里要的是「必须有,内容不限」
  payload: z.unknown().refine((v) => v !== undefined, '文档内容不能为空')
});

export const PushSchema = z.object({
  docs: z.array(DocSchema).min(1).max(MAX_DOCS_PER_PUSH)
});

export interface DocRow {
  kind: string;
  docKey: string;
  payload: unknown;
  rev: number;
  clientUpdatedAt: string;
}

/** 推送里的一条文档(纯数据,便于单测) */
export interface IncomingDoc {
  kind: string;
  docKey: string;
  payload: unknown;
  clientUpdatedAt: string;
}

/**
 * 决定每条推送文档是新建、覆盖还是丢弃(纯函数 —— 冲突规则值得单独测)。
 * 服务端已有的更新(或一样新)就保留服务端的:两端都改过同一条时,
 * 让「后改的」赢,而不是让「后同步的」赢 —— 否则慢的那台设备一开就会把新的覆盖回去。
 * 返回 { creates, updates, result } —— result 是推完之后的最终状态,直接回给客户端。
 */
export function planPush(
  existing: DocRow[],
  incoming: IncomingDoc[]
): { creates: IncomingDoc[]; updates: IncomingDoc[]; result: DocRow[] } {
  const byKey = new Map(existing.map((d) => [`${d.kind}|${d.docKey}`, d]));
  const creates: IncomingDoc[] = [];
  const updates: IncomingDoc[] = [];
  const result: DocRow[] = [];
  for (const doc of incoming) {
    const key = `${doc.kind}|${doc.docKey}`;
    const cur = byKey.get(key);
    if (!cur) {
      creates.push(doc);
      result.push({ ...doc, rev: 1 });
      continue;
    }
    const incomingAt = new Date(doc.clientUpdatedAt).getTime();
    const serverAt = new Date(cur.clientUpdatedAt).getTime();
    if (incomingAt > serverAt) {
      updates.push(doc);
      result.push({ ...doc, rev: cur.rev + 1 });
    } else {
      result.push(cur); // 服务端这份更新 → 原样回传,让客户端改成服务端的版本
    }
  }
  return { creates, updates, result };
}

/** 该文档序列化后是否超限(JSON 里中文占多字节,按字节算而不是按字符) */
export function oversized(payload: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(payload) ?? '', 'utf8') > MAX_DOC_BYTES;
  } catch {
    return true; // 循环引用等序列化不了的一律当超限
  }
}

/** GET /training/docs — 拉全量文档(客户端合并后再推回) */
router.get('/docs', wrap(async (_req, res) => {
  const rows = await prisma.trainingDoc.findMany({
    where: { userId: getUserId(res) },
    orderBy: { updatedAt: 'desc' },
    take: MAX_DOCS_PER_PULL
  });
  return ok(res, {
    docs: rows.map((r) => ({
      kind: r.kind,
      docKey: r.docKey,
      payload: r.payload,
      rev: r.rev,
      clientUpdatedAt: r.clientUpdatedAt.toISOString()
    })),
    truncated: rows.length >= MAX_DOCS_PER_PULL
  });
}));

/**
 * PUT /training/docs — 推送本地文档。
 * 逐条 last-write-wins,再把最终状态整份回传 —— 客户端不用自己推演冲突结果,
 * 直接以返回的为准即可(避免两端算出不同的结论)。
 */
router.put('/docs', wrap(async (req, res) => {
  const parsed = PushSchema.safeParse(req.body);
  if (!parsed.success) {
    return err(res, 400, parsed.error.issues[0]?.message || '参数错误', { affectsData: false });
  }
  const docs = parsed.data.docs;
  const bad = docs.find((d) => oversized(d.payload));
  if (bad) return err(res, 400, `「${bad.kind}」这条数据太大了,先精简一下再同步`, { affectsData: false });

  const userId = getUserId(res);
  // 只查这次推送涉及的键(一次同步几百条,全量查一次更省事,量级都是几十到几百)
  const existing = await prisma.trainingDoc.findMany({ where: { userId } });
  const { creates, updates, result } = planPush(
    existing.map((r) => ({
      kind: r.kind,
      docKey: r.docKey,
      payload: r.payload,
      rev: r.rev,
      clientUpdatedAt: r.clientUpdatedAt.toISOString()
    })),
    docs
  );

  // 同一批里既可能新建也可能覆盖,逐条落库;条数少,不必包事务(单条失败不影响其它条)
  for (const d of creates) {
    await prisma.trainingDoc.create({
      data: {
        userId,
        kind: d.kind,
        docKey: d.docKey,
        payload: d.payload as object,
        clientUpdatedAt: new Date(d.clientUpdatedAt)
      }
    });
  }
  for (const d of updates) {
    await prisma.trainingDoc.update({
      where: { userId_kind_docKey: { userId, kind: d.kind, docKey: d.docKey } },
      data: { payload: d.payload as object, clientUpdatedAt: new Date(d.clientUpdatedAt), rev: { increment: 1 } }
    });
  }

  return ok(res, {
    docs: result,
    created: creates.length,
    updated: updates.length,
    kept: result.length - creates.length - updates.length
  });
}));

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
/** 单张照片上限 5MB(手机直出照片一般 2-4MB) */
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export const MediaSchema = z.object({
  /** data URL 或裸 base64(客户端 chooseMedia 拿到的临时文件读出来) */
  data: z.string().min(1),
  mime: z.string().optional()
});

/**
 * POST /training/media — 上传一张照片,返回可长期访问的 URL。
 * 文件名取内容哈希:同一张照片重复上传只落一份,配上 immutable 缓存头也永远不用失效。
 */
router.post('/media', wrap(async (req, res) => {
  const parsed = MediaSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, '缺少图片数据', { affectsData: false });

  const raw = parsed.data.data;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(raw);
  const mime = (m ? m[1] : parsed.data.mime) || 'image/jpeg';
  const b64 = m ? m[2] : raw;
  const ext = EXT_BY_MIME[mime.toLowerCase()];
  if (!ext) return err(res, 400, '只支持 JPG / PNG / WebP 图片', { affectsData: false });

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return err(res, 400, '图片数据读不出来,请重新选择', { affectsData: false });
  }
  if (!buf.length) return err(res, 400, '图片是空的,请重新选择', { affectsData: false });
  if (buf.length > MAX_MEDIA_BYTES) return err(res, 400, '这张照片太大了(超过 5MB),先压缩一下再传', { affectsData: false });

  const dir = isAbsolute(env.mediaDir) ? env.mediaDir : resolve(process.cwd(), env.mediaDir);
  const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), buf);

  return ok(res, { url: `/media/${name}`, bytes: buf.length });
}));

export default router;
