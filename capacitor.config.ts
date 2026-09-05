import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "kr.fuelplanner.app",
  appName: "주유 플래너",
  // next build --output export 결과. scripts/build-app.mjs 가 만든다.
  webDir: "out",
  android: {
    // 오피넷은 JSON을 text/html로 돌려준다. 웹뷰가 파일을 내려받으려 들지 않게 한다.
    allowMixedContent: false,
  },
  plugins: {
    /*
      나가는 요청을 웹뷰 fetch가 아니라 안드로이드 네이티브 HTTP로 보낸다.
      오피넷과 카카오가 Access-Control-Allow-Origin을 주지 않아서, 웹뷰가
      직접 부르면 응답을 받고도 JS에 넘겨주지 않는다.

      전역 fetch를 통째로 바꾸지는 않는다(`enabled` 미설정). 지도 타일까지
      네이티브로 끌고 가면 얻는 것 없이 느려진다. 대신 src/lib/http.ts의
      fetchOutbound 한 곳에서만 CapacitorHttp를 직접 부른다.
    */
    CapacitorHttp: { enabled: false },
  },
};

export default config;
