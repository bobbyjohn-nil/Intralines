import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { BusLine, CityPack, LngLat, Stop } from '../game/types';
import type { DraftLine } from '../game/store';

// Game overlays drawn on top of the basemap: census demand heatmap, bus
// lines, stops, draft line preview and the depot.

const EMPTY = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

export function ensureOverlays(map: MLMap): void {
  const addSrc = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  };
  ['heatmap-src', 'lines-src', 'stops-src', 'draft-src', 'draft-cursor-src', 'depot-src'].forEach(
    addSrc,
  );

  if (!map.getLayer('heatmap-fill')) {
    // slide the heatmap underneath roads + buildings so it tints the ground
    // instead of washing over the whole scene
    const layers = map.getStyle().layers ?? [];
    const beforeId = layers.find(
      (l) => l.id.startsWith('road') || l.id.startsWith('building'),
    )?.id;
    map.addLayer(
      {
        id: 'heatmap-fill',
        type: 'fill',
        source: 'heatmap-src',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['get', 'op'],
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer('lines-halo')) {
    map.addLayer({
      id: 'lines-halo',
      type: 'line',
      source: 'lines-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 16],
        'line-opacity': 0.9,
      },
    });
  }
  if (!map.getLayer('lines-line')) {
    map.addLayer({
      id: 'lines-line',
      type: 'line',
      source: 'lines-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          11, ['case', ['==', ['get', 'selected'], 1], 5, 3],
          16, ['case', ['==', ['get', 'selected'], 1], 10, 6],
        ],
        'line-opacity': ['case', ['==', ['get', 'inactive'], 1], 0.35, 0.92],
      },
    });
  }
  if (!map.getLayer('lines-hit')) {
    map.addLayer({
      id: 'lines-hit',
      type: 'line',
      source: 'lines-src',
      paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 18 },
    });
  }
  if (!map.getLayer('stops-pt')) {
    map.addLayer({
      id: 'stops-pt',
      type: 'circle',
      source: 'stops-src',
      minzoom: 11.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 6],
        'circle-color': '#ffffff',
        'circle-stroke-color': '#3c3728',
        'circle-stroke-width': 1.6,
      },
    });
  }
  if (!map.getLayer('draft-line')) {
    map.addLayer({
      id: 'draft-line',
      type: 'line',
      source: 'draft-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2b6fd4', 'line-width': 5, 'line-opacity': 0.85 },
    });
  }
  if (!map.getLayer('draft-cursor')) {
    map.addLayer({
      id: 'draft-cursor',
      type: 'line',
      source: 'draft-cursor-src',
      paint: {
        'line-color': '#2b6fd4',
        'line-width': 2.5,
        'line-opacity': 0.55,
        'line-dasharray': [2, 2],
      },
    });
  }
  if (!map.getLayer('draft-stops')) {
    map.addLayer({
      id: 'draft-stops',
      type: 'circle',
      source: 'draft-src',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 6,
        'circle-color': '#2b6fd4',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });
  }
  if (!map.getLayer('depot-pt')) {
    map.addLayer({
      id: 'depot-pt',
      type: 'circle',
      source: 'depot-src',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 14],
        'circle-color': '#3c3728',
        'circle-stroke-color': '#f7b267',
        'circle-stroke-width': 3,
      },
    });
  }
}

function setData(map: MLMap, id: string, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
}

export function updateHeatmap(
  map: MLMap,
  pack: CityPack,
  mode: 'off' | 'pop' | 'jobs',
): void {
  if (mode === 'off') {
    setData(map, 'heatmap-src', EMPTY);
    return;
  }
  const dens = pack.blockGroups.map((bg) =>
    (mode === 'pop' ? bg.pop : bg.jobs) / Math.max(bg.areaKm2, 0.02),
  );
  const sorted = [...dens].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const features = pack.blockGroups.map((bg, i) => {
    const t = Math.min(dens[i] / p95, 1);
    const color = mode === 'pop' ? '#6741d9' : '#0b7285';
    return {
      type: 'Feature' as const,
      properties: { color, op: 0.06 + t * 0.42 },
      geometry: {
        type: 'Polygon' as const,
        coordinates: bg.rings.map((r) => [...r, r[0]]),
      },
    };
  });
  setData(map, 'heatmap-src', { type: 'FeatureCollection', features });
}

export function updateNetwork(
  map: MLMap,
  stops: Stop[],
  lines: BusLine[],
  selectedId: string | null,
): void {
  setData(map, 'lines-src', {
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature' as const,
      properties: {
        id: l.id,
        color: l.color,
        selected: l.id === selectedId ? 1 : 0,
        inactive: l.active && l.vehicles > 0 ? 0 : 1,
      },
      geometry: { type: 'LineString' as const, coordinates: l.path },
    })),
  });
  setData(map, 'stops-src', {
    type: 'FeatureCollection',
    features: stops.map((s) => ({
      type: 'Feature' as const,
      properties: { id: s.id, name: s.name },
      geometry: { type: 'Point' as const, coordinates: s.pt },
    })),
  });
}

export function updateDraft(map: MLMap, draft: DraftLine | null): void {
  if (!draft) {
    setData(map, 'draft-src', EMPTY);
    setData(map, 'draft-cursor-src', EMPTY);
    return;
  }
  const features: GeoJSON.Feature[] = draft.stops.map((s) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: s.pt },
  }));
  for (const leg of draft.legs) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: leg.path },
    });
  }
  setData(map, 'draft-src', { type: 'FeatureCollection', features });
}

export function updateDraftCursor(map: MLMap, from: LngLat | null, to: LngLat | null): void {
  if (!from || !to) {
    setData(map, 'draft-cursor-src', EMPTY);
    return;
  }
  setData(map, 'draft-cursor-src', {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [from, to] },
      },
    ],
  });
}

export function updateDepot(map: MLMap, pt: LngLat | null): void {
  setData(
    map,
    'depot-src',
    pt
      ? {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt } },
          ],
        }
      : EMPTY,
  );
}
