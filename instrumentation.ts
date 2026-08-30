/**
 * 서버가 뜨는 즉시 당일 유가 수집을 시작한다.
 * 첫 검색을 막지 않는다. 경로에 필요한 칸은 검색이 끼어들어 먼저 받는다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const key = process.env.OPINET_CERT_KEY?.trim();
  if (!key) return;
  const { startOpinetDailyPrefetch } = await import(
    "@/lib/providers/opinet/fetch-queue"
  );
  void startOpinetDailyPrefetch(key);
}