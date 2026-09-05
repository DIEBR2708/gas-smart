#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import path from "node:path";

/**
 * 안드로이드 APK에 넣을 정적 파일을 뽑는다.
 *
 * `output: 'export'`는 Request에 의존하는 Route Handler를 지원하지 않는다.
 * /api/plan은 POST라 정적화가 원천적으로 불가능하고, 파일이 자리에 있는 것만으로
 * 빌드가 실패한다. 앱에서는 어차피 안 쓰는 라우트다. 화면이 계산 엔진을 직접
 * 부르기 때문이다.
 *
 * 그래서 빌드 동안만 옆으로 치웠다가 되돌린다. 삭제하지 않는 이유는 웹 개발에는
 * 여전히 필요해서다. 브라우저는 오피넷·카카오를 직접 못 부른다(CORS).
 *
 * 실패하든 중단되든 반드시 되돌린다. 한 번이라도 치워진 채로 남으면 다음
 * `npm run dev`에서 API가 통째로 사라진 것처럼 보인다.
 */

const root = path.resolve(import.meta.dirname, "..");
const apiDir = path.join(root, "src", "app", "api");
const parkedDir = path.join(root, "src", "app", "_api.build-parked");

let parked = false;

async function restore() {
  if (!parked) return;
  parked = false;
  if (existsSync(parkedDir)) await rename(parkedDir, apiDir);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await restore();
    process.exit(1);
  });
}

async function main() {
  if (existsSync(parkedDir)) {
    // 지난 빌드가 되돌리지 못하고 죽었다. 먼저 정리한다.
    if (existsSync(apiDir)) {
      throw new Error(
        `src/app/api 와 ${path.basename(parkedDir)} 가 둘 다 있습니다. 어느 쪽이 최신인지 확인하고 하나를 지운 뒤 다시 실행하세요.`,
      );
    }
    await rename(parkedDir, apiDir);
  }

  if (existsSync(apiDir)) {
    await rename(apiDir, parkedDir);
    parked = true;
  }

  const result = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "app" },
  });

  await restore();

  if (result.status !== 0) {
    throw new Error(`next build 실패 (종료 코드 ${result.status})`);
  }
}

try {
  await main();
} catch (error) {
  await restore();
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
