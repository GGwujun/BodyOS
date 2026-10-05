import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * 轻量异步 hook:自动执行 + 手动 refresh。
 * 用于页面加载时拉取数据。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const sequence = useRef(0);
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null
  });

  const run = useCallback(async () => {
    const requestId = ++sequence.current;
    setState({ data: null, loading: true, error: null });
    try {
      const data = await fn();
      if (requestId !== sequence.current) return null;
      setState({ data, loading: false, error: null });
      return data;
    } catch (e) {
      if (requestId !== sequence.current) return null;
      setState({ data: null, loading: false, error: (e as { message?: string })?.message || '加载失败' });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    return () => { sequence.current++; };
  }, [run]);

  return { ...state, refresh: run };
}
