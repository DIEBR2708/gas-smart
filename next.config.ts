import type { NextConfig } from "next";

/**
 * 안드로이드 APK용 빌드인가.
 *
 * 켜지면 서버 없이 도는 정적 파일만 뽑는다. Capacitor는 그 폴더를 앱 안에
 * 넣고, 화면은 API 라우트 대신 계산 엔진을 직접 부른다.
 */
const forApp = process.env.BUILD_TARGET === "app";

const nextConfig: NextConfig = {
  ...(forApp
    ? {
        output: "export" as const,
        // 정적 export에는 이미지를 줄여 줄 서버가 없다.
        images: { unoptimized: true },
      }
    : {}),

  /*
    응답 헤더는 서버가 붙이는 것이다. 정적 export에는 붙일 서버가 없어서
    Next가 무시하고 경고만 남긴다. 앱에서는 위치 권한을 안드로이드가
    관장하므로 이 헤더도 필요 없다.
  */
  ...(forApp
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [{ key: "Permissions-Policy", value: "geolocation=(self)" }],
            },
          ];
        },
      }),

  /**
   * Next 16은 dev 서버가 초기화된 호스트가 아닌 곳에서 온 `/_next/*` 요청을
   * cross-origin으로 보고 403으로 막는다. dev 서버는 `localhost`로 뜨는데
   * 브라우저나 프리뷰는 `127.0.0.1`, 컨테이너 사설 IP, 프록시 호스트로
   * 접근하기 때문에 정적 청크와 HMR 소켓이 전부 차단된다.
   * 화면이 통째로 비어 보이는 증상이 여기서 나온다.
   *
   * 아래 설정은 개발 모드에서만 적용된다. `*`는 호스트 라벨 하나에만
   * 대응하고 `.`은 경계로 취급되므로 `*.*.*.*`가 IPv4 주소를 덮는다.
   */
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "*.localhost",
    "*.*.*.*",
    "*.cursor.sh",
    "*.cursor.com",
  ],
};

export default nextConfig;
