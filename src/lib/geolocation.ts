import { isNativeApp } from "./platform";

/** 브라우저 위치 API. iframe에서 window.top을 읽다 죽지 않게 감싼다. */

export const GEO_PERMISSION_DENIED = 1;
export const GEO_UNAVAILABLE = 2;
export const GEO_TIMEOUT = 3;

export function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function geolocationAvailable(): boolean {
  if (isNativeApp()) return true;
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    Boolean(navigator.geolocation)
  );
}

export function geolocationErrorText(
  code: number,
  embedded: boolean,
): string {
  if (code === GEO_PERMISSION_DENIED) {
    // 앱에서는 주소창도 자물쇠도 없다. 안내할 곳은 안드로이드 설정뿐이다.
    if (isNativeApp()) {
      return "위치 권한이 거부되었습니다. 안드로이드 설정 > 앱 > 권한에서 위치를 허용하거나, 지도를 눌러 지정하세요.";
    }
    return embedded
      ? "미리보기 창에서는 브라우저가 위치를 막는 경우가 많습니다. 오른쪽 위 새 탭으로 열거나, 주소창 자물쇠에서 위치를 허용하세요. 아니면 지도를 눌러 지정하세요."
      : "위치 권한이 거부되었습니다. 주소창 자물쇠에서 허용하거나, 지도를 눌러 지정하세요.";
  }
  if (code === GEO_TIMEOUT) {
    return "위치를 읽는 데 시간이 너무 걸렸습니다. 다시 누르거나 지도를 눌러 주세요.";
  }
  return "현재 위치를 읽지 못했습니다. 지도를 눌러 출발·도착을 찍어 주세요.";
}

export function parseQueryCoord(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 안드로이드 앱의 위치 읽기.
 *
 * 웹뷰의 navigator.geolocation은 안드로이드 권한이 먼저 승인돼야 동작하는데,
 * 웹뷰는 그 권한 창을 스스로 띄우지 못한다. 플러그인을 거쳐야 네이티브
 * 권한 요청이 뜬다. 거부는 브라우저와 같은 코드로 바꿔 돌려준다.
 */
async function readNativePosition(): Promise<GeolocationPosition> {
  const { Geolocation } = await import("@capacitor/geolocation");
  try {
    const status = await Geolocation.checkPermissions();
    if (status.location !== "granted") {
      const asked = await Geolocation.requestPermissions();
      if (asked.location !== "granted") {
        throw { code: GEO_PERMISSION_DENIED, message: "denied" };
      }
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 15_000,
    });
    return position as unknown as GeolocationPosition;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    throw { code: GEO_UNAVAILABLE, message: String(error) };
  }
}

export function readDevicePosition(): Promise<GeolocationPosition> {
  if (isNativeApp()) return readNativePosition();

  return new Promise((resolve, reject) => {
    if (!geolocationAvailable()) {
      reject({ code: GEO_UNAVAILABLE, message: "unavailable" });
      return;
    }

    let settled = false;
    const finishOk = (pos: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      resolve(pos);
    };
    const finishErr = (err: { code: number; message?: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      reject(err);
    };
    const watchdog = window.setTimeout(() => {
      finishErr({ code: GEO_TIMEOUT, message: "timeout" });
    }, 16_000);

    navigator.geolocation.getCurrentPosition(
      finishOk,
      (err) => {
        if (err.code === GEO_TIMEOUT || err.code === GEO_UNAVAILABLE) {
          navigator.geolocation.getCurrentPosition(finishOk, finishErr, {
            enableHighAccuracy: false,
            timeout: 8_000,
            maximumAge: 120_000,
          });
          return;
        }
        finishErr(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 15_000,
      },
    );
  });
}
