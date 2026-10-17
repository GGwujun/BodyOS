/**
 * 媒体地址拼装 —— 服务端返回的是站点相对地址(`/media/...`),
 * 小程序 `Image` 只认完整 URL,而 `apiBase` 已经带了 `/api/v1` 后缀,
 * 所以拼之前要把版本段切掉。
 *
 * 单独放在 utils(而不是 services/training)是因为 `utils/photos.ts` 也要用它:
 * 备份/同步的冒烟测试用纯 tsc 编译这些模块,不认 `@/` 别名,也不该为了拼一个
 * 字符串把整个请求层拖进来。
 */
import { config } from '../config';

export function mediaUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  const origin = config.apiBase.replace(/\/api\/v\d+\/?$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
