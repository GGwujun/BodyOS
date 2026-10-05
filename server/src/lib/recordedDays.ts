/** Multiple observations on one calendar date count as one recorded day. */
export function countRecordedDays(...groups: string[][]): number {
  return new Set(groups.flat()).size;
}
