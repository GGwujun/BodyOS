import type { Request } from 'express';

export interface PageQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** 从 query 解析分页,默认 page=1 pageSize=20 */
export function parsePage(req: Request, maxPageSize = 100): PageQuery {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number(req.query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(items: T[], total: number, q: PageQuery) {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
