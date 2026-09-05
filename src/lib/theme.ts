/**
 * 밝은/어두운 모드.
 *
 * 선택은 기기에만 남긴다. 서버는 사용자의 모드를 모르는 상태로 HTML을 보내므로,
 * 첫 페인트 전에 인라인 스크립트가 <html>에 클래스를 입혀야 화면이 번쩍이지 않는다.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "fuel-theme";

export function readThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    /* 사파리 시크릿 모드처럼 저장이 막혀도 이번 세션은 동작해야 한다 */
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(choice: ThemeChoice): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return systemPrefersDark();
}

export function applyThemeChoice(choice: ThemeChoice): void {
  document.documentElement.classList.toggle("dark", resolveDark(choice));
}

/**
 * <head>에서 동기 실행되는 부트 스크립트.
 * 저장된 값이 없으면 운영체제 설정을 따른다.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=c==="dark"||(c!=="light"&&(!window.matchMedia||window.matchMedia("(prefers-color-scheme: dark)").matches));document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;
