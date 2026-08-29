"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng, RankedOption, Route } from "@/lib/domain/types";
import { krw, perLiter } from "@/lib/format";

/**
 * 경로와 주유소 후보를 지도에 그린다.
 *
 * Leaflet + OpenStreetMap을 쓰는 이유는 API 키 없이 동작해야 하기 때문이다.
 * 카카오맵 JS SDK로 바꾸려면 이 컴포넌트만 교체하면 된다. 다만 카카오는
 * 지도 없이 좌표만 표시하는 사용을 약관으로 제한하므로, 카카오 데이터로
 * 계산한 결과를 다른 지도 위에 그리는 조합은 검토가 필요하다.
 */

/**
 * 표준 OpenStreetMap 타일. 키가 필요 없고 출처 표시만 하면 된다.
 * 밝은 톤이므로 어두운 테마에 맞추기 위해 CSS에서 타일 페인만 반전시킨다
 * (`.leaflet-tile-pane` 필터). 마커와 경로선은 필터 영향을 받지 않는다.
 *
 * CARTO의 dark_all 타일은 이제 키 없이 쓰면 "API KEY REQUIRED" 워터마크가
 * 찍히므로 쓰지 않는다.
 */
const TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '지도 데이터 &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
};

/** 경로를 받기 전에 보여줄 기본 뷰 (남한 전체) */
const INITIAL_CENTER: L.LatLngTuple = [36.4, 127.8];
const INITIAL_ZOOM = 7;

interface Props {
  route: Route;
  options: RankedOption[];
  shapes: Record<string, LatLng[]>;
  selectedId: string | null;
  bestId: string | null;
  onSelect: (stationId: string) => void;
  pickEnabled?: boolean;
  onPickPoint?: (lat: number, lng: number) => void;
}

function markerColor(option: RankedOption, bestId: string | null): string {
  if (option.station.id === bestId) return "#f5b544";
  if (option.savingKrw > 300) return "#4ade80";
  if (option.savingKrw > -300) return "#94a3b8";
  return "#f87171";
}

function markerIcon(
  option: RankedOption,
  bestId: string | null,
  selected: boolean,
): L.DivIcon {
  const color = markerColor(option, bestId);
  const isBest = option.station.id === bestId;
  const size = isBest ? 34 : selected ? 30 : 24;
  const label = isBest ? "최저" : String(option.rank);
  return L.divIcon({
    className: "",
    html: `<div class="station-marker${isBest ? " station-marker--best" : ""}" style="width:${size}px;height:${size}px;background:${color};${
      selected && !isBest ? "outline:2px solid rgba(255,255,255,.75);" : ""
    }">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function popupHtml(option: RankedOption): string {
  const detourKm = (option.detour.extraDistanceM / 1000).toFixed(1);
  const saving =
    option.savingKrw >= 0
      ? `<span style="color:#4ade80">${krw(option.savingKrw)} 절약</span>`
      : `<span style="color:#f87171">${krw(-option.savingKrw)} 손해</span>`;
  return `
    <div style="min-width:190px">
      <div style="font-weight:600;margin-bottom:4px">${option.station.name}</div>
      <div style="color:#94a3b8">${perLiter(option.listPriceKrwPerL)} · 할인 후 ${perLiter(option.effectivePriceKrwPerL)}</div>
      <div style="color:#94a3b8">우회 ${detourKm}km</div>
      <div style="margin-top:6px">기준선 대비 ${saving}</div>
    </div>`;
}

function endpointMarker(place: LatLng & { name: string }, fill: string) {
  return L.marker([place.lat, place.lng], {
    icon: L.divIcon({
      className: "",
      html: `<div style="display:flex;align-items:center;gap:6px">
        <span style="width:12px;height:12px;border-radius:9999px;background:${fill};border:3px solid #131a2e;box-shadow:0 0 0 2px ${fill}55"></span>
        <span style="background:#131a2ecc;color:#e2e8f0;font-size:11px;padding:2px 6px;border-radius:6px;white-space:nowrap">${place.name}</span>
      </div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    }),
    interactive: false,
  });
}

export default function RouteMap({
  route,
  options,
  shapes,
  selectedId,
  bestId,
  onSelect,
  pickEnabled = false,
  onPickPoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const stationLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const fittedRouteRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const onPickPointRef = useRef(onPickPoint);
  const pickEnabledRef = useRef(pickEnabled);

  const polyline = useMemo(
    () => route.polyline.map((p) => [p.lat, p.lng] as L.LatLngTuple),
    [route],
  );

  // 마커 클릭 핸들러는 마커를 만들 때 한 번만 붙인다. 콜백이 바뀔 때마다
  // 마커를 다시 만들지 않도록 최신 콜백을 ref로 들고 있는다.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
    pickEnabledRef.current = pickEnabled;
    const container = mapRef.current?.getContainer();
    container?.classList.toggle("pick-mode", pickEnabled);
  }, [onPickPoint, pickEnabled]);

  // 언마운트 시 지도 인스턴스를 정리한다.
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      stationLayerRef.current = null;
      markersRef.current.clear();
      fittedRouteRef.current = null;
    },
    [],
  );

  /**
   * 지도 생성과 모든 그리기를 하나의 이펙트에서 처리한다.
   *
   * 생성과 그리기를 별도 이펙트로 나누면, 한쪽만 재실행됐을 때 레이어가
   * 사라진 지도에 붙는 순서 버그가 생긴다. 또 Leaflet은 뷰(center/zoom)가
   * 정해지기 전에 추가한 레이어를 큐에 넣어두고 DOM에 그리지 않기 때문에,
   * 타일 레이어를 붙이기 전에 setView를 먼저 호출해야 한다.
   */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let map = mapRef.current;
    if (!map) {
      map = L.map(element, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
      });
      map.setView(INITIAL_CENTER, INITIAL_ZOOM);
      L.tileLayer(TILES.url, {
        attribution: TILES.attribution,
        maxZoom: 19,
      }).addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      stationLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      map.on("click", (event) => {
        if (!pickEnabledRef.current) return;
        onPickPointRef.current?.(event.latlng.lat, event.latlng.lng);
      });
      map.getContainer().classList.toggle("pick-mode", pickEnabledRef.current);

      // flex 레이아웃 안에서 컨테이너 크기가 나중에 바뀌면 Leaflet이 캐시한
      // 크기가 틀어져 타일이 잘리거나 클릭 좌표가 밀린다.
      const observer = new ResizeObserver(() => map?.invalidateSize());
      observer.observe(element);
      observerRef.current = observer;
    }

    const routeLayer = routeLayerRef.current;
    const stationLayer = stationLayerRef.current;
    if (!routeLayer || !stationLayer) return;

    map.invalidateSize();

    routeLayer.clearLayers();
    const driveable = route.driveable !== false && polyline.length >= 2;
    const via = selectedId ? shapes[selectedId] : undefined;
    const viaLine =
      via && via.length > 1
        ? via.map((p) => [p.lat, p.lng] as L.LatLngTuple)
        : null;

    if (driveable && viaLine) {
      L.polyline(polyline, {
        color: "#64748b",
        weight: 5,
        opacity: 0.28,
        lineJoin: "round",
      }).addTo(routeLayer);
      L.polyline(viaLine, {
        color: "#1e3a8a",
        weight: 11,
        opacity: 0.45,
        lineJoin: "round",
      }).addTo(routeLayer);
      L.polyline(viaLine, {
        color: "#f5b544",
        weight: 4,
        opacity: 0.95,
        lineJoin: "round",
      }).addTo(routeLayer);
    } else if (driveable) {
      L.polyline(polyline, {
        color: "#1e3a8a",
        weight: 11,
        opacity: 0.45,
        lineJoin: "round",
      }).addTo(routeLayer);
      L.polyline(polyline, {
        color: "#60a5fa",
        weight: 4,
        opacity: 0.95,
        lineJoin: "round",
      }).addTo(routeLayer);
    }
    endpointMarker(route.origin, "#38bdf8").addTo(routeLayer);
    endpointMarker(route.destination, "#f472b6").addTo(routeLayer);

    if (fittedRouteRef.current !== route.id) {
      const bounds = driveable
        ? L.latLngBounds(polyline)
        : L.latLngBounds([
            [route.origin.lat, route.origin.lng],
            [route.destination.lat, route.destination.lng],
          ]);
      map.fitBounds(bounds.pad(0.12));
      fittedRouteRef.current = route.id;
    }

    /*
      마커는 지우고 다시 만드는 대신 제자리에서 갱신한다.
      매번 새로 만들면 사용자가 마커를 클릭해 열린 팝업이, 그 클릭이 유발한
      선택 상태 변경 때문에 곧바로 사라진다. 슬라이더를 움직일 때 마커가
      깜빡이는 문제도 같은 원인이다.
    */
    const alive = new Set<string>();
    for (const option of options) {
      const stationId = option.station.id;
      alive.add(stationId);
      const selected = stationId === selectedId;
      const isBest = stationId === bestId;

      const icon = markerIcon(option, bestId, selected);
      const zIndexOffset = isBest ? 1000 : selected ? 800 : 0;
      const existing = markersRef.current.get(stationId);

      if (existing) {
        existing.setLatLng([option.station.lat, option.station.lng]);
        existing.setIcon(icon);
        existing.setZIndexOffset(zIndexOffset);
        existing.setPopupContent(popupHtml(option));
        continue;
      }

      const marker = L.marker([option.station.lat, option.station.lng], {
        icon,
        zIndexOffset,
        title: option.station.name,
      })
        .addTo(stationLayer)
        .bindPopup(popupHtml(option), { closeButton: false });

      // 팝업은 사용자가 마커를 눌렀을 때만 열린다(Leaflet 기본 동작).
      // 선택 상태를 팝업으로 자동 표시하면 경로와 다른 후보를 가려버린다.
      marker.on("click", () => onSelectRef.current(stationId));
      markersRef.current.set(stationId, marker);
    }

    for (const [stationId, marker] of markersRef.current) {
      if (alive.has(stationId)) continue;
      marker.remove();
      markersRef.current.delete(stationId);
    }
  }, [polyline, route, options, shapes, selectedId, bestId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
