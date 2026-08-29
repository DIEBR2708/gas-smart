import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
