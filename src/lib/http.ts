/** 느린 요청 하나에 전체가 멈추지 않게, 끝난 자리부터 다음을 넣는다. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () =>
      run(),
    ),
  );
  return out;
}

export async function fetchOutbound(
  url: string | URL,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      headers: init.headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? 6_000),
      cache: "no-store",
    });
  } catch {
    return new Response(null, { status: 599, statusText: "network" });
  }
}
