import { describe, expect, it } from "vitest";
import { parseNominatimHits, parseNominatimReverse } from "./nominatim";

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

  it("검색에서는 번지보다 장소 이름을 쓴다", () => {
    const places = parseNominatimHits([
      {
        lat: "35.8241",
        lon: "127.1481",
        name: "전주시청",
        display_name: "전주시청, 기린대로, 서노송동, 전주시",
        address: { road: "기린대로", suburb: "서노송동" },
      },
    ]);
    expect(places[0]?.name).toBe("전주시청");
  });

  it("역지오코딩은 번지 대신 도로명을 쓴다", () => {
    const place = parseNominatimReverse(
      {
        lat: "37.5663",
        lon: "126.9779",
        name: "110",
        display_name: "110, 세종대로, 태평로1가, 중구, 서울",
        address: { house_number: "110", road: "세종대로", suburb: "태평로1가" },
      },
      37.5663,
      126.9779,
    );
    expect(place.name).toBe("태평로1가 세종대로");
  });
});
