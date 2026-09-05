import { NextResponse } from "next/server";
import {
  isRejection,
  preparePlan,
  type PlanMessage,
  type PlanRequestBody,
} from "@/lib/engine/plan-engine";
import "@/lib/server-bootstrap";

/**
 * 계산 엔진을 NDJSON으로 감싸는 전송 계층. 계산 자체는 plan-engine이 한다.
 *
 * 웹에서만 쓴다. 오피넷·카카오 키가 브라우저로 새면 그대로 도용되므로,
 * 브라우저는 좌표와 차량 정보만 보내고 결과만 받는다. 안드로이드 앱에는
 * 이 라우트가 없고 화면이 엔진을 직접 부른다.
 */

export async function POST(request: Request) {
  let body: PlanRequestBody;
  try {
    body = (await request.json()) as PlanRequestBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const startedAt = Date.now();
  const prepared = await preparePlan(body);
  if (isRejection(prepared)) {
    return NextResponse.json(
      { error: prepared.error, code: prepared.code },
      { status: 400 },
    );
  }
  const routeMs = Date.now() - startedAt;

  /*
    브라우저가 먼저 떠난 스트림에 쓰거나 닫으면 그 자체가 예외가 된다.
    출발지를 바꿔 이전 조회를 취소하는 것은 정상적인 사용이므로, 그때마다
    서버 로그에 처리되지 않은 예외를 남길 이유가 없다.
  */
  let closed = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (message: PlanMessage) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          closed = true;
        }
      };

      await prepared.emitAll(write, request.signal);

      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // 이미 끊긴 스트림이다.
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // 어느 단계가 느린지 브라우저 네트워크 탭에서 바로 읽는다.
      "Server-Timing": `route;dur=${routeMs}`,
    },
  });
}
