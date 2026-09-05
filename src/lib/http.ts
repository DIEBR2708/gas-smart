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

/**
 * 외부 API로 나가는 유일한 통로.
 *
 * 오피넷과 카카오는 `Access-Control-Allow-Origin`을 보내지 않는다. 브라우저는
 * 그 응답을 받고도 JS에 넘겨주지 않는다. 서버에서 부를 때 되는 이유는 서버가
 * 브라우저가 아니어서다.
 *
 * 안드로이드 앱에는 대신 불러 줄 서버가 없다. 그래서 웹뷰의 fetch가 아니라
 * 안드로이드 네이티브 HTTP로 내보낸다. 역시 브라우저가 아니므로 같은 이유로
 * 통한다. 어느 경로로 나가든 호출하는 쪽은 Response 하나만 본다.
 */
type NativeHttp = (
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
) => Promise<Response>;

let nativeHttp: NativeHttp | null = null;

/** 네이티브 부트스트랩이 시작할 때 한 번 꽂는다. */
export function setNativeHttp(impl: NativeHttp | null): void {
  nativeHttp = impl;
}

export async function fetchOutbound(
  url: string | URL,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 6_000;
  try {
    if (nativeHttp) {
      return await nativeHttp(String(url), init.headers, timeoutMs);
    }
    return await fetch(url, {
      headers: init.headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return new Response(null, { status: 599, statusText: "network" });
  }
}

/** 취소로 중단됐음을 fetch와 같은 이름으로 알린다. */
export function abortError(): Error {
  const error = new Error("계산이 취소되었습니다.");
  error.name = "AbortError";
  return error;
}

/**
 * 신호가 오면 결과를 기다리는 쪽만 손을 뗀다.
 *
 * 진행 중인 작업 자체는 끊지 않는다. 여러 요청이 같은 인플라이트 프로미스를
 * 나눠 쓰는 구조에서 원본을 취소해 버리면, 아직 결과를 원하는 다른 요청까지
 * 빈손으로 만든다. 남은 호출은 그대로 끝나 캐시를 채우고, 취소한 쪽만 빠진다.
 */
export function raceAbort<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
