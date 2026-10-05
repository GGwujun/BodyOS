export function sourceStatusLabel(status: string, lastSyncAt?: string | null): string {
  if (status === 'syncing') return '正在同步';
  if (status === 'error') return '同步异常';
  if (status !== 'connected' && status !== 'synced') return '尚未连接';
  if (!lastSyncAt) return status === 'synced' ? '已连接，同步时间未知' : '已连接，尚未同步';
  const date = new Date(lastSyncAt);
  if (!Number.isFinite(date.getTime())) return '已连接，同步时间未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `上次同步 ${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
