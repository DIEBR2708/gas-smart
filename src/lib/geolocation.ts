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

export function readDevicePosition(): Promise<GeolocationPosition> {
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
