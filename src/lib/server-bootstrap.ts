import { setCatalogStore } from "@/lib/providers/opinet/catalog-store";
import { nodeCatalogStore } from "@/lib/providers/opinet/catalog-store-node";

/**
 * 서버에서 돌 때의 플랫폼 배선.
 *
 * API 라우트가 import 하는 것만으로 적용된다. 여기서만 `node:fs`가 딸려오므로
 * 클라이언트 번들은 이 파일을 거치지 않는다.
 *
 * 나가는 HTTP는 손대지 않는다. 서버는 브라우저가 아니라서 CORS를 안 받는다.
 */
setCatalogStore(nodeCatalogStore);
