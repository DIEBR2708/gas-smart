/**
 * 외부 API 키를 읽는 단일 창구.
 *
 * 같은 코드가 두 곳에서 돈다. 웹에서는 Next 서버 안에서 돌고, 안드로이드
 * APK 안에서는 서버 없이 앱 자체에서 돈다. 전자는 키를 서버 환경변수로
 * 숨길 수 있지만 후자는 숨길 데가 없다. 번들에 박아야 앱이 혼자 돈다.
 *
 * 그래서 서버 전용 이름을 먼저 보고, 없으면 번들에 박히는 NEXT_PUBLIC_ 이름을
 * 본다. 웹으로 띄우면 키가 서버에만 남고, APK로 빌드하면 앱 안으로 들어간다.
 * 호출하는 쪽은 어느 쪽인지 몰라도 된다.
 *
 * NEXT_PUBLIC_ 값은 APK를 뜯으면 나온다. 그게 서버 없는 앱의 대가다.
 */

function read(serverName: string, publicValue: string | undefined): string {
  // process.env 자체가 없는 실행 환경도 있다. 접근 자체를 감싼다.
  const fromServer =
    typeof process !== "undefined" ? process.env?.[serverName] : undefined;
  return (fromServer ?? publicValue ?? "").trim();
}

/**
 * 오피넷 인증키.
 *
 * NEXT_PUBLIC_ 쪽은 반드시 리터럴로 적어야 한다. Next는 `process.env.X`를
 * 빌드 때 문자열로 치환하는데, 변수로 조립한 이름은 치환 대상으로 보지 않아
 * 클라이언트 번들에서 undefined가 된다.
 */
export function opinetCertKey(): string {
  return read("OPINET_CERT_KEY", process.env.NEXT_PUBLIC_OPINET_CERT_KEY);
}

export function kakaoRestApiKey(): string {
  return read("KAKAO_REST_API_KEY", process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY);
}
