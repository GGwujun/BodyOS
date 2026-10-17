/**
 * 取一个 URL 参数 —— **必须解一次码**。
 *
 * 下发方(动作库那种)是 `encodeURIComponent` 之后拼的,而 Taro 的 router params
 * **不会自动解**:`?bp=upper%20arms` 拿到的就是 `upper%20arms`。
 * 不解的后果是**静默**的 —— 部位 `in BODYPART_ZH` 判假、预选整个落空,
 * 页面照常打开,只是该填的没填,谁都不会发现;筛选条件对不上还会变成「一个结果都没有」。
 *
 * 解不开就原样用(`'100%'` 这种真·百分号会抛):名字里多一个百分号,
 * 也好过整页崩掉 —— 这是唯一一处值得为参数牺牲严格性的地方。
 */
export function param(raw: string | undefined): string {
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}
