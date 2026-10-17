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

  /* 「再刷一遍」和「换一份数据」是两件事,以前跑的是同一条路径 —— 每次都把 data 清成 null。
     于是从体重弹层退回来、从记录页切回首页,整页会先闪成「正在加载…」再由真值接上,
     首页的能量卡瞬间读成「今天还没有能量记录」。那句话只该在**真的没数据**时出现。
     判据是参数有没有变:同一个 viewDate 上重拉,旧数据留着(SWR);换了日期,
     拉的已经是另一天,旧数字留着才是骗人,那就照旧清掉。 */
  const depsKey = JSON.stringify(deps);
  const lastDepsKey = useRef(depsKey);

  const run = useCallback(async () => {
    const requestId = ++sequence.current;
    const sameDeps = lastDepsKey.current === depsKey;
    lastDepsKey.current = depsKey;
    setState((prev) => {
      const kept = sameDeps ? prev.data : null;
      return { data: kept, loading: kept == null, error: null };
    });
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
