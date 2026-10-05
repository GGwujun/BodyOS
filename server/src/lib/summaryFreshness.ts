export function summaryNeedsRefresh(recalculatedAt: Date | null, profileUpdatedAt: Date | null, isToday: boolean, withinTTL: boolean) {
  return !recalculatedAt ||
    !!(profileUpdatedAt && profileUpdatedAt.getTime() > recalculatedAt.getTime()) ||
    (isToday && !withinTTL);
}
