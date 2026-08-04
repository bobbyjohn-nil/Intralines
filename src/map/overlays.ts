import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { BusLine, CityPack, LngLat, Stop } from '../game/types';
import type { DraftLine } from '../game/store';

// Game overlays drawn on top of the basemap: census demand heatmap, bus
// lines, stops, draft line preview and the depot.

const EMPTY = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

import type { ExpressionSpecification } from 'maplibre-gl';

export type HeatMode = 'pop' | 'jobs' | 'tour' | 'edu';

/**
 * Color ramps for the demand heatmap. Deliberately translucent (nothing
 * above ~0.5 alpha) with a hole below 0.18 density and steep mid stops, so
 * hotspots read as defined cores instead of one washed-out blob.
 * purple = residents, teal = jobs, amber = tourism, blue = education.
 */
const HEAT_COLORS: Record<HeatMode, ExpressionSpecification> = {
  pop: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(122,88,224,0)',
    0.18, 'rgba(139,106,232,0.05)',
    0.4, 'rgba(122,84,224,0.28)',
    0.7, 'rgba(103,63,211,0.42)',
    1, 'rgba(82,44,180,0.52)',
  ],
  jobs: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(16,128,148,0)',
    0.18, 'rgba(22,148,168,0.05)',
    0.4, 'rgba(16,128,150,0.28)',
    0.7, 'rgba(12,106,128,0.44)',
    1, 'rgba(8,84,104,0.54)',
  ],
  tour: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(224,123,57,0)',
    0.18, 'rgba(228,138,74,0.05)',
    0.4, 'rgba(219,116,44,0.28)',
    0.7, 'rgba(198,94,26,0.44)',
    1, 'rgba(168,72,14,0.54)',
  ],
  edu: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(47,111,208,0)',
    0.18, 'rgba(72,130,216,0.05)',
    0.4, 'rgba(47,111,208,0.28)',
    0.7, 'rgba(30,88,180,0.44)',
    1, 'rgba(18,64,142,0.54)',
  ],
};

export function ensureOverlays(map: MLMap): void {
  const addSrc = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  };
  ['heatmap-src', 'lines-src', 'stops-src', 'draft-src', 'draft-cursor-src', 'depot-src'].forEach(
    addSrc,
  );

  if (!map.getLayer('heatmap-blob')) {
    // a true smooth heatmap over block-group centroids (soft general areas,
    // not hard census-block edges), slid underneath roads + buildings
    const layers = map.getStyle().layers ?? [];
    const beforeId = layers.find(
      (l) => l.id.startsWith('road') || l.id.startsWith('building'),
    )?.id;
    map.addLayer(
      {
        id: 'heatmap-blob',
        type: 'heatmap',
        source: 'heatmap-src',
        paint: {
          'heatmap-weight': ['get', 'w'],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'], 10, 1.5, 13, 2.5, 16, 3.4,
          ],
          // tighter radius: defined cores around real hotspots, not one
          // city-wide wash
          'heatmap-radius': [
            'interpolate', ['exponential', 1.6], ['zoom'], 10, 12, 12, 26, 14, 52, 16, 100,
          ],
          'heatmap-opacity': 0.62,
          'heatmap-color': HEAT_COLORS.pop,
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
  mode: 'off' | HeatMode,
): void {
  if (mode === 'off') {
    setData(map, 'heatmap-src', EMPTY);
    return;
  }
  const value = (bg: CityPack['blockGroups'][number]): number =>
    mode === 'pop' ? bg.pop
    : mode === 'jobs' ? bg.jobs
    : mode === 'tour' ? bg.tour ?? 0
    : bg.edu ?? 0;
  const dens = pack.blockGroups.map((bg) => value(bg) / Math.max(bg.areaKm2, 0.02));
  const positive = dens.filter((d) => d > 0).sort((a, b) => a - b);
  const norm = positive[Math.floor(positive.length * 0.92)] || 1;
  // people live everywhere, so the residents layer keeps a low floor; the
  // workplace-style layers cut harder so scattered corner-store jobs don't
  // paint whole residential neighborhoods as work demand
  const cut = mode === 'pop' ? 0.06 : 0.16;
  const features = pack.blockGroups.map((bg, i) => {
    const rel = dens[i] / norm;
    return {
      type: 'Feature' as const,
      properties: { w: rel < cut ? 0 : Math.pow(Math.min(rel, 1), 0.75) },
      geometry: { type: 'Point' as const, coordinates: bg.centroid },
    };
  });
  if (map.getLayer('heatmap-blob')) {
    map.setPaintProperty('heatmap-blob', 'heatmap-color', HEAT_COLORS[mode]);
  }
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
