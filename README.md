# 경로 위에서 가장 싸게 주유하기

내비게이션 경로를 따라가면서 **실제로 가장 저렴하게** 주유할 수 있는 곳을 찾는
웹 앱입니다. 리터당 표시가격만 비교하지 않습니다. 우회 거리에 태우는 연료,
늘어나는 시간, 통행료 증분, 탱크에 남는 연료의 가치까지 모두 원으로 환산해
"여행을 끝내는 데 드는 실질 총비용"으로 후보를 줄세웁니다.

리터당 40원 싼 주유소가 3km 벗어나 있으면 대개 손해입니다. 이 앱은 그 사실을
숫자로 보여주고, **우회할 가치가 없을 때는 우회하지 말라고 말합니다.**

## 지금 할 수 있는 것

- **경로에서** 출발·도착을 정하거나, **이 자리에서** 목적지 없이 주변
  주유소만 비교함
- 지도에서 **주소·지명 검색**으로 출발·도착을 정함. 목록에 도로명 주소를
  보여 주고, "부산"·"서울"처럼 도시명은 역·시청을 앞에 둔다.
  카카오 로컬이 꺼져 있으면 OpenStreetMap Nominatim으로 주소를 찾음
- **필요한 만큼** 주입은 목적지 도착 때 탱크의 20%가 남게 넣는다
- 카카오 길찾기가 부산↔서울처럼 긴 구간에서 끊기면 **경부고속도로 회랑**으로
  이어서 계산한다. 직선 근사는 짧은 구간 실패 시에만 쓴다
- 산 정상처럼 **도로와 이어지지 않은 지점**을 고르면 가장 가까운 차량 진입
  지점(주차장·주유소·편의점)으로 옮겨 길을 잡고, 얼마나 옮겼는지 알려 준다
- **현재 위치** 또는 **지도에서 찍기**. 버튼은 좌표를 바로 넣고, 주소는
  뒤에서 채운다. 미리보기 iframe이 위치를 막으면 새 탭에서 열거나 지도를
  눌러 지정하면 됨
- 계산이 길어지면 화면을 덮고 **경로 로드중**을 띄운다. 그동안에도 출발·도착은
  바꿀 수 있다
- **밝은 모드·어두운 모드**. 처음에는 기기 설정을 따르고, 헤더에서 바꾸면
  이 브라우저에 남는다. 지도 타일도 모드에 맞춰 바뀐다
- 차량 조건(시간 여유, 셀프·고속도로 진출, 유종, 주입량, 연비, 탱크)
- 공통 카드 할인과 **브랜드 조건부 할인 프로필**
- 최대 우회 거리·시간, 이 금액 미만은 절약으로 보지 않음
- 탱크가 짧으면 **나눠 넣는 일정**(다회 주유)
- 통신 실패 시 **마지막 계획 캐시**와 경고
- 지도에서 경로, 후보 마커, 우회 구간, 비용 분해, 연료 잔량
- 나눠 넣는 일정은 카카오맵 웹 경로로 넘겨서 확인

## 실행

```bash
npm install
npm run dev     # http://localhost:43127
```

```bash
npm test        # 비용 모델 단위 테스트
npm run lint
npm run typecheck
```

## API 키

**키 없이도 앱 전체가 동작합니다.** 키가 없으면 결정론적 샘플 데이터를 쓰고,
계산 로직은 실데이터와 완전히 동일합니다.

실데이터로 바꾸려면 `.env.local`에 키를 넣습니다. `.env.example`을 복사해 쓰세요.

```bash
# 오피넷(한국석유공사) 유가정보 오픈 API 인증키
# https://www.opinet.co.kr/user/custapi/custApiInfo.do
OPINET_CERT_KEY=

# 카카오 REST API 키 (카카오모빌리티 길찾기)
# https://developers.kakao.com
KAKAO_REST_API_KEY=
```

웹으로 띄우면 키는 서버에서만 읽습니다. 추천 계산이 `/api/plan`에 있는 이유입니다.
브라우저로 내려보내면 그대로 도용됩니다.

> 오피넷에 인증키를 넘기는 파라미터 이름은 `code`입니다. `certkey`가 아닙니다.
> 이름이 틀리면 오피넷은 거절하지 않고 HTTP 200에 빈 목록을 돌려줍니다.
> "그 근처에 주유소가 없다"와 똑같은 응답이라, 전국 어디를 찍어도 0건이 되고
> 앱은 조용히 샘플 데이터로 내려앉습니다.

## 안드로이드 APK

Capacitor로 APK를 뽑을 수 있습니다. **서버 없이 앱 혼자 돕니다.** 화면이
오피넷과 카카오를 직접 부르고 계산도 기기 안에서 합니다.

```bash
npm run apk            # → android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:release    # → android/app/build/outputs/apk/release/app-release.apk
```

빌드하려면 JDK 21과 Android SDK(platform 36, build-tools 36)가 필요하고,
`android/local.properties`에 `sdk.dir=<SDK 경로>`가 있어야 합니다.

### 릴리스 서명

안드로이드는 서명 없는 APK를 설치하지 않습니다. `npm run apk:release`를 쓰려면
키스토어를 먼저 만들어야 합니다. 한 번만 하면 됩니다.

```bash
cd android
keytool -genkeypair -v -keystore fuel-planner-release.jks \
  -alias fuel-planner -keyalg RSA -keysize 4096 -validity 10000

cat > keystore.properties <<'EOF'
storeFile=fuel-planner-release.jks
storePassword=여기에_비밀번호
keyAlias=fuel-planner
keyPassword=여기에_비밀번호
EOF
```

**이 두 파일은 git에 올리지 마세요**(`.gitignore`에 넣어 뒀습니다). 서명 키가
공개되면 누구든 이 앱의 업데이트로 인식되는 APK를 만들 수 있습니다.

**그리고 잃어버리지 마세요.** 안드로이드는 서명이 다른 APK를 같은 앱의 업데이트로
받지 않습니다. 키가 바뀌면 사용자가 기존 앱을 지우고 새로 설치해야 합니다.

키스토어가 없으면 `assembleRelease`는 서명 없는 APK를 만들고(설치 불가),
`npm run apk`(디버그)는 평소대로 동작합니다.

APK에서 실데이터를 쓰려면 `.env.local`에 `NEXT_PUBLIC_` 접두사가 붙은 키도
넣어야 합니다. 값은 위와 같습니다.

```bash
NEXT_PUBLIC_OPINET_CERT_KEY=
NEXT_PUBLIC_KAKAO_REST_API_KEY=
```

**이 키들은 APK를 뜯으면 나옵니다.** 서버 없이 도는 앱의 대가입니다. 개인·프로젝트
용도로만 쓰고, 배포할 거라면 키를 서버에 두고 앱이 그 서버를 부르게 바꾸세요.

### 왜 이렇게 갈라져 있나

오피넷과 카카오는 `Access-Control-Allow-Origin` 헤더를 보내지 않습니다.
브라우저는 응답을 받고도 JS에 넘겨주지 않습니다. 서버에서 부를 때 되는 이유는
서버가 브라우저가 아니어서입니다.

APK 안에는 대신 불러 줄 서버가 없으므로, 나가는 요청을 웹뷰 fetch가 아니라
안드로이드 네이티브 HTTP로 내보냅니다. 역시 브라우저가 아니라 같은 이유로 통합니다.

플랫폼이 갈리는 지점은 네 곳뿐입니다.

| 갈리는 것 | 이음매 | 웹 | 앱 |
|---|---|---|---|
| 키 | `lib/runtime-keys.ts` | 서버 환경변수 | 번들에 박힌 `NEXT_PUBLIC_` |
| 나가는 HTTP | `lib/http.ts`의 `fetchOutbound` | 서버가 그냥 fetch | 네이티브 HTTP |
| 계산 위치 | `lib/plan-client.ts` | `/api/plan` 호출 | 엔진 직접 호출 |
| 일일 유가 캐시 | `opinet/catalog-store.ts` | `.data/` 파일 | Capacitor Preferences |

계산 자체(`lib/engine/`)는 양쪽이 같은 코드입니다. HTTP를 모릅니다.

`npm run apk`는 빌드 동안 `src/app/api`를 잠깐 옆으로 치웠다가 되돌립니다.
Next는 `Request`에 의존하는 Route Handler를 정적 export 하지 못해서, 파일이
자리에 있는 것만으로 빌드가 실패합니다. 앱에서는 안 쓰는 라우트지만 웹 개발에는
필요하므로 지우지 않습니다.

## 구조

```
src/
  lib/domain/          비용 모델 (순수 함수, 프레임워크 의존 없음)
    types.ts           도메인 타입
    cost.ts            정규화 총비용, 손익분기, 도달 가능성
    plan.ts            후보 선별, 프루닝, 랭킹, 판정
    itinerary.ts       다회 주유 순서
    economy.ts         주유 기록 연비 학습
    traffic.ts         출발 시각 정체 배수
    geo.ts             하버사인, 폴리라인 투영, 경로 샘플링
  lib/providers/       데이터 소스 (인터페이스 + 어댑터)
    mock/              샘플 데이터 (키 불필요)
    opinet/            오피넷 유가 API (KATEC 좌표 변환 포함)
    kakao/             길찾기·로컬 검색
  lib/engine/          계산 본체. HTTP를 모른다. 웹과 앱이 같이 쓴다
    plan-engine.ts     경로 확정 → 어림 순위 → 정밀 순위
    places-engine.ts   주소·지명 검색
  app/api/plan/        웹 전용. 엔진을 NDJSON으로 감싸는 전송 계층
  app/api/places/      웹 전용. 엔진을 JSON으로 감싸는 전송 계층
  components/          지도와 화면
android/               Capacitor 안드로이드 프로젝트 (권한·설정)
scripts/build-app.mjs  APK용 정적 export
docs/design.md         설계, 결정해야 할 사항, 위험 분석
```

비용 모델은 프레임워크에 의존하지 않는 순수 함수로 분리했습니다. 이 계산이
틀리면 앱이 사용자를 손해 보게 만드는 도구가 되기 때문에, 화면보다 먼저
테스트로 고정했습니다.

자세한 설계 근거와 위험 분석은 [docs/design.md](docs/design.md)에 있습니다.

## 알아두어야 할 한계

- 샘플 모드의 우회 거리는 도로망이 아닌 **기하학적 추정치**입니다. 강이나
  중앙분리대를 모르기 때문에 실제와 크게 다를 수 있고, 화면에도 그렇게 표시됩니다.
  카카오 키를 넣으면 실제 경유지 길찾기로 계산합니다.
- 유가는 주유소가 신고한 값이라 현장 가격과 다를 수 있습니다.
- 다회 주유는 가격이 알려진 1차원 경로에서 최적인 그리디입니다. 실시간 가격
  변동과 도로 제약을 모두 넣으면 최적성이 깨질 수 있습니다.
- 전기차·화물차는 비용 구조가 달라 이 모델을 그대로 쓰면 틀린 답이 나옵니다.
- 연비 기록·제보·할인 프로필은 이 브라우저의 `localStorage`에만 있습니다.
- APK는 빌드와 정적 검증까지만 확인했습니다. 실제 기기에서 켜 보지는
  못했습니다(개발 환경에서 안드로이드 에뮬레이터의 게스트 커널이 부팅되지
  않음). 계산 엔진이 서버 없이 실시간 오피넷 데이터를 만들어 내는 것까지는
  `lib/engine/live-check.test.ts`로 확인했고, 남은 미검증 구간은
  `CapacitorHttp`가 기기에서 기대대로 동작하는지 하나입니다.

## 안전

이 앱은 직접 길안내를 하지 않습니다. 주유소 선택은 출발 전에 끝내고 실제 안내는
검증된 내비 앱에 넘깁니다. 주행 중에는 화면을 조작하지 마세요.
