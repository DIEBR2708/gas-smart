import { Capacitor } from "@capacitor/core";

/**
 * 지금 안드로이드 앱 안에서 도는가, 브라우저에서 도는가.
 *
 * 갈리는 것은 딱 하나다. 앱에는 계산을 대신해 줄 서버가 없어서 화면이 엔진을
 * 직접 부르고, 브라우저에서는 API 라우트를 거친다. 오피넷과 카카오가 CORS
 * 헤더를 주지 않아 브라우저가 직접 부르면 응답을 읽지 못하기 때문이다.
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
