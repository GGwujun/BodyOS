import Taro from '@tarojs/taro';
import { request } from './request';

/**
 * 埋点上报(docs/03)
 * 本地队列 + 批量上报,失败静默(不打断业务)。
 */

export type EventCategory = 'activation' | 'home' | 'ai' | 'datasource' | 'other';

interface PendingEvent {
  name: string;
  category: EventCategory;
  props?: Record<string, unknown>;
  ts: number;
}

const QUEUE_KEY = 'bodyos_analytics_queue';
const FLUSH_THRESHOLD = 8;

/** 推入事件到本地队列,达阈值自动批量上报 */
export function track(name: string, category: EventCategory = 'other', props?: Record<string, unknown>) {
  const queue = readQueue();
  queue.push({ name, category, props, ts: Date.now() });
  Taro.setStorageSync(QUEUE_KEY, queue);
  if (queue.length >= FLUSH_THRESHOLD) {
    flush().catch(() => undefined);
  }
}

/** 立即批量上报队列 */
export async function flush(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;
  Taro.setStorageSync(QUEUE_KEY, []);
  try {
    await request({
      url: '/analytics/track-batch',
      method: 'POST',
      data: queue.map((e) => ({ name: e.name, category: e.category, props: e.props }))
    });
  } catch {
    // 失败放回队列,下次重试
    const cur = readQueue();
    Taro.setStorageSync(QUEUE_KEY, [...queue, ...cur]);
  }
}

/** 单条上报(关键事件,不进队列) */
export async function trackNow(name: string, category: EventCategory = 'other', props?: Record<string, unknown>) {
  try {
    await request({ url: '/analytics/track', method: 'POST', data: { name, category, props } });
  } catch {
    /* 静默 */
  }
}

function readQueue(): PendingEvent[] {
  return Taro.getStorageSync(QUEUE_KEY) || [];
}
