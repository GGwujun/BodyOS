/** Timestamp fields use local-day boundaries; @db.Date fields still use UTC dates. */
export function measurementWindow(start: string, end: string): { gte: Date; lt: Date } {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return { gte: new Date(sy, sm - 1, sd), lt: new Date(ey, em - 1, ed + 1) };
}
