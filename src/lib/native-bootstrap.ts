import { CapacitorHttp } from "@capacitor/core";
import { setNativeHttp } from "@/lib/http";
import { setCatalogStore } from "@/lib/providers/opinet/catalog-store";
import { capacitorCatalogStore } from "@/lib/providers/opinet/catalog-store-capacitor";

/**
 * 안드로이드 앱 안에서 돌 때의 플랫폼 배선.
 *
 * 서버가 없으므로 두 가지를 앱이 직접 떠맡는다. 나가는 HTTP는 웹뷰의 fetch가
 * 아니라 안드로이드 네이티브 스택으로 내보내야 하고(오피넷·카카오가 CORS
 * 헤더를 주지 않는다), 오늘치 유가 목록은 기기에 남겨야 한다.
 *
 * 이 파일은 네이티브에서만 import 된다. 웹에서 부르면 아무 일도 하지 않는다.
 */

let done = false;

export function bootstrapNative(): void {
  if (done) return;
  done = true;

  setCatalogStore(capacitorCatalogStore);

  setNativeHttp(async (url, headers, timeoutMs) => {
    const response = await CapacitorHttp.request({
      url,
      method: "GET",
      headers,
      readTimeout: timeoutMs,
      connectTimeout: timeoutMs,
      // 오피넷은 JSON을 text/html로 돌려준다. 플러그인이 멋대로 파싱하면
      // 원문을 잃어버리므로 문자열로 받아 호출부가 직접 해석하게 둔다.
      responseType: "text",
    });

    const body =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data ?? null);

    return new Response(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });
}
