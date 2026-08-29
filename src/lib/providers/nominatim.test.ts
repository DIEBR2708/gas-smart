import { describe, expect, it } from "vitest";
import { parseNominatimHits } from "./nominatim";

describe("parseNominatimHits", () => {
  it("한국 좌표만 남기고 이름을 줄인다", () => {
    const places = parseNominatimHits([
      {
        lat: "37.4979",
        lon: "127.0276",
        name: "강남역",
        display_name: "강남역, 강남대로, 서울",
      },
      { lat: "35.0", lon: "139.0", name: "도쿄", display_name: "Tokyo" },
    ]);
    expect(places).toEqual([{ name: "강남역", lat: 37.4979, lng: 127.0276 }]);
  });
});
