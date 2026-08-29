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

const TILES = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution:
    '지도 &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · 타일 &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

interface Props {
  route: Route;
  options: RankedOption[];
  shapes: Record<string, LatLng[]>;
  selectedId: string | null;
  bestId: string | null;
  onSelect: (stationId: string) => void;
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

export default function RouteMap({
  route,
  options,
  shapes,
  selectedId,
  bestId,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedRouteRef = useRef<string | null>(null);

  const polyline = useMemo(
    () => route.polyline.map((p) => [p.lat, p.lng] as [number, number]),
    [route],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    });
    L.tileLayer(TILES.url, {
      attribution: TILES.attribution,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 경로 레이어
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    L.polyline(polyline, {
      color: "#1e3a8a",
      weight: 11,
      opacity: 0.45,
      lineJoin: "round",
    }).addTo(layer);
    L.polyline(polyline, {
      color: "#60a5fa",
      weight: 4,
      opacity: 0.95,
      lineJoin: "round",
    }).addTo(layer);

    const endpoint = (p: LatLng, label: string, fill: string) =>
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;gap:6px;transform:translate(-9px,-9px)">
            <span style="width:14px;height:14px;border-radius:9999px;background:${fill};border:3px solid #0b1020;box-shadow:0 0 0 2px ${fill}55"></span>
            <span style="background:#0b1020cc;color:#e2e8f0;font-size:11px;padding:2px 6px;border-radius:6px;white-space:nowrap">${label}</span>
          </div>`,
          iconSize: [0, 0],
        }),
        interactive: false,
      }).addTo(layer);

    endpoint(route.origin, route.origin.name, "#38bdf8");
    endpoint(route.destination, route.destination.name, "#f472b6");

    if (fittedRouteRef.current !== route.id) {
      map.fitBounds(L.latLngBounds(polyline).pad(0.12));
      fittedRouteRef.current = route.id;
    }
  }, [polyline, route]);

  // 후보 마커와 선택된 후보의 우회 구간
  useEffect(() => {
    const layer = layersRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const option of options) {
      const selected = option.station.id === selectedId;
      const isBest = option.station.id === bestId;

      if (selected || isBest) {
        const shape = shapes[option.station.id];
        if (shape?.length) {
          L.polyline(
            shape.map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: isBest ? "#f5b544" : "#e2e8f0",
              weight: 3,
              opacity: 0.9,
              dashArray: "6 6",
            },
          ).addTo(layer);
        }
      }

      const marker = L.marker([option.station.lat, option.station.lng], {
        icon: markerIcon(option, bestId, selected),
        zIndexOffset: isBest ? 1000 : selected ? 800 : 0,
      })
        .addTo(layer)
        .bindPopup(popupHtml(option), { closeButton: false });

      marker.on("click", () => onSelect(option.station.id));
      if (selected) marker.openPopup();
    }
  }, [options, shapes, selectedId, bestId, onSelect]);

  return <div ref={containerRef} className="h-full w-full" />;
}
