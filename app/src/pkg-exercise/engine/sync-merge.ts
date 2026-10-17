/**
 * 云同步的合并规则 —— 纯函数,不碰 Taro/网络,单测直接覆盖。
 *
 * 规则只有一条:**按 (kind, docKey) 取并集,同一键取「客户端修改时间更晚」的那份**。
 * 听上去太简单,但它正好落在两类数据上:
 *  - 日志/single 文档(每条训练一个文档)→ 取并集 = 两台设备各自练的都留住;
 *  - 计划/渐进/备注/器材(各只有一个文档)→ 取并集退化成取新的那份。
 * 这样客户端与服务端(逐条 last-write-wins)用的是同一条规则,反复同步必然收敛,
 * 不会出现两端来回覆盖的振荡。
 */

export interface SyncDoc {
  kind: string;
  docKey: string;
  payload: unknown;
  clientUpdatedAt: string;
}

export const docId = (d: { kind: string; docKey: string }): string => `${d.kind}|${d.docKey}`;

/** 时间戳解析:解不出来当 0(脏数据不参与「谁更新」的竞争) */
const ms = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

export interface MergeResult {
  /** 合并后的全集(顺序:本机原有在前,云端补进来的按云端顺序接在后面) */
  docs: SyncDoc[];
  /** 采纳了云端版本的条数 */
  fromRemote: number;
  /** 保留本机版本的条数 */
  fromLocal: number;
}

export function mergeDocs(local: SyncDoc[], remote: SyncDoc[]): MergeResult {
  const out: SyncDoc[] = [];
  const seen = new Set<string>();
  const remoteByKey = new Map(remote.map((d) => [docId(d), d]));
  let fromRemote = 0;
  let fromLocal = 0;

  for (const l of local) {
    const r = remoteByKey.get(docId(l));
    if (!r) { out.push(l); fromLocal++; continue; }
    // 同一毫秒的两份取云端那份(>=)—— 与服务端同规则,反复同步才收敛得下来
    if (ms(r.clientUpdatedAt) >= ms(l.clientUpdatedAt)) { out.push(r); fromRemote++; }
    else { out.push(l); fromLocal++; }
    seen.add(docId(l));
  }
  for (const r of remote) {
    if (seen.has(docId(r))) continue;
    out.push(r);       // 本机没有 → 从云端补回来(换设备后的第一次同步主要靠这一步)
    fromRemote++;
  }
  return { docs: out, fromRemote, fromLocal };
}

/**
 * 文档太多时只留最近的 N 条 —— 本机 storage 有限,而云端那份留着就够了。
 * 只对日志类(有多个 docKey 的 kind)生效;单例 kind 永远保留(否则会把计划删掉)。
 */
export function capDocs(docs: SyncDoc[], cap: number, multiKinds: string[]): SyncDoc[] {
  const byKind = new Map<string, SyncDoc[]>();
  const keep: SyncDoc[] = [];
  for (const d of docs) {
    if (!multiKinds.includes(d.kind)) { keep.push(d); continue; }
    const list = byKind.get(d.kind) ?? [];
    list.push(d);
    byKind.set(d.kind, list);
  }
  for (const list of byKind.values()) {
    list.sort((a, b) => (ms(a.clientUpdatedAt) < ms(b.clientUpdatedAt) ? 1 : -1));
    keep.push(...list.slice(0, cap));
  }
  return keep;
}
