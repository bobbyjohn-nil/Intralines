import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { BusLine, CityPack, LngLat, Stop } from '../game/types';
import type { DraftLine } from '../game/store';

// Game overlays drawn on top of the basemap: census demand heatmap, bus
// lines, stops, draft line preview and the depot.

const EMPTY = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

import type { ExpressionSpecification } from 'maplibre-gl';

export type HeatMode = 'pop' | 'jobs' | 'tour' | 'edu' | 'modes';

/** dot colors for the travel-mode view (dominant mode per block group) */
export const MODE_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  car: { fill: '#8a8f98', stroke: '#5c6068', label: 'Driving' },
  bus: { fill: '#2f9e44', stroke: '#1e7030', label: 'Riding the bus' },
  walk: { fill: '#3a9bd6', stroke: '#2270a4', label: 'Walking' },
  bike: { fill: '#e0a13c', stroke: '#aa7318', label: 'Biking' },
};

/**
 * Demand dot colors: translucent fill, crisp solid outline — sharp-edged
 * circles instead of fuzzy heat blobs, so even a lone pocket of demand out
 * past the city limits reads clearly.
 * purple = residents, teal = jobs, amber = tourism, blue = education.
 */
const HEAT_COLORS: Record<Exclude<HeatMode, 'modes'>, { fill: string; stroke: string }> = {
  pop: { fill: '#7a54e0', stroke: '#5230b8' },
  jobs: { fill: '#0e7a92', stroke: '#075a6e' },
  tour: { fill: '#db742c', stroke: '#a8480e' },
  edu: { fill: '#2f6fd0', stroke: '#1a4b9e' },
};

/**
 * Grey out everything beyond the playable city and draw its boundary.
 * The mask is a world-sized polygon with the city bbox as a hole, added
 * after the basemap's own layers (so it covers roads and 3D buildings out
 * there) and before the game overlays (so lines/stops/dots stay on top).
 */
export function addBoundaryMask(
  map: MLMap,
  bbox: [number, number, number, number],
): void {
  const [w, s, e, n] = bbox;
  const ring: [number, number][] = [[w, s], [e, s], [e, n], [w, n], [w, s]];
  // four opaque panels around the bbox (a world-sized polygon with a hole
  // tessellates unreliably); 4 degrees of skirt is far beyond the camera
  // leash, so the grey always reaches the horizon
  const M = 4;
  const rect = (x1: number, y1: number, x2: number, y2: number) => ({
    type: 'Feature' as const,
    properties: { kind: 'mask' },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
    },
  });
  if (!map.getSource('boundary-src')) {
    map.addSource('boundary-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          rect(w - M, n, e + M, n + M), // north
          rect(w - M, s - M, e + M, s), // south
          rect(w - M, s, w, n), // west
          rect(e, s, e + M, n), // east
          {
            type: 'Feature',
            properties: { kind: 'edge' },
            geometry: { type: 'LineString', coordinates: ring },
          },
        ],
      },
    });
  }
  if (!map.getLayer('boundary-mask')) {
    map.addLayer({
      id: 'boundary-mask',
      type: 'fill',
      source: 'boundary-src',
      filter: ['==', ['get', 'kind'], 'mask'],
      paint: { 'fill-color': '#75746e', 'fill-opacity': 0.62 },
    });
    map.addLayer({
      id: 'boundary-edge',
      type: 'line',
      source: 'boundary-src',
      filter: ['==', ['get', 'kind'], 'edge'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#3c3728',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 4],
        'line-dasharray': [2.5, 2],
        'line-opacity': 0.75,
      },
    });
  }
}

export function ensureOverlays(map: MLMap): void {
  const addSrc = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  };
  ['heatmap-src', 'lines-src', 'stops-src', 'draft-src', 'draft-cursor-src', 'depot-src'].forEach(
    addSrc,
  );

  if (!map.getLayer('heatmap-blob')) {
    // crisp demand dots over block-group centroids, drawn ABOVE the basemap
    // (roads and buildings included) but beneath the game's own line/stop
    // overlays added after this. Fill stays lightly translucent so streets
    // show through; the solid outline keeps the shape rigid.
    const f: ExpressionSpecification = ['+', 0.45, ['get', 'w']]; // 0.45..1.45
    map.addLayer({
      id: 'heatmap-blob',
      type: 'circle',
      source: 'heatmap-src',
      paint: {
        'circle-radius': [
          'interpolate', ['exponential', 1.7], ['zoom'],
          10, ['*', 3.5, f],
          13, ['*', 9, f],
          16, ['*', 24, f],
        ],
        'circle-color': HEAT_COLORS.pop.fill,
        'circle-opacity': 0.3,
        'circle-stroke-color': HEAT_COLORS.pop.stroke,
        'circle-stroke-width': 1.6,
        'circle-stroke-opacity': 0.95,
      },
    });
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
  bgModes?: { bus: number; car: number; walk: number; bike: number }[],
): void {
  if (mode === 'off') {
    setData(map, 'heatmap-src', EMPTY);
    return;
  }

  if (mode === 'modes') {
    // dominant travel mode per block group; dot size = commuters
    const totals = pack.blockGroups.map((_, i) => {
      const m = bgModes?.[i];
      return m ? m.bus + m.car + m.walk + m.bike : 0;
    });
    const positive = totals.filter((t) => t > 0).sort((a, b) => a - b);
    const norm = positive[Math.floor(positive.length * 0.92)] || 1;
    // each dot's color is a mix of the four mode colors in proportion to
    // the trips they carry. Shares pass through a mild power curve so the
    // minority modes tint visibly instead of drowning in car-gray.
    const rgb = (hexColor: string): [number, number, number] => [
      parseInt(hexColor.slice(1, 3), 16),
      parseInt(hexColor.slice(3, 5), 16),
      parseInt(hexColor.slice(5, 7), 16),
    ];
    const MODE_RGB = {
      car: rgb(MODE_COLORS.car.fill),
      bus: rgb(MODE_COLORS.bus.fill),
      walk: rgb(MODE_COLORS.walk.fill),
      bike: rgb(MODE_COLORS.bike.fill),
    };
    const features = pack.blockGroups.flatMap((bg, i) => {
      const m = bgModes?.[i];
      const total = totals[i];
      if (!m || total < 8) return [];
      const keys = ['car', 'bus', 'walk', 'bike'] as const;
      // 0.35 exponent: car's 80% majority would otherwise gray out every
      // dot; this keeps the mix visibly tinted by the smaller modes while
      // car-only neighborhoods still read gray
      const weights = keys.map((k) => Math.pow(m[k] / total, 0.35));
      const wsum = weights.reduce((s, v) => s + v, 0) || 1;
      let r = 0;
      let g = 0;
      let b = 0;
      keys.forEach((k, ki) => {
        const c = MODE_RGB[k];
        const w = weights[ki] / wsum;
        r += c[0] * w;
        g += c[1] * w;
        b += c[2] * w;
      });
      // averaging four colors washes out; re-saturate the mix around its
      // own luminance so the blended hue stays vivid (hue is unchanged)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const K = 3;
      r = Math.max(0, Math.min(255, lum + (r - lum) * K));
      g = Math.max(0, Math.min(255, lum + (g - lum) * K));
      b = Math.max(0, Math.min(255, lum + (b - lum) * K));
      return [
        {
          type: 'Feature' as const,
          properties: {
            w: Math.pow(Math.min(total / norm, 1), 0.75),
            bg: i,
            fill: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`,
            stroke: `rgb(${Math.round(r * 0.68)},${Math.round(g * 0.68)},${Math.round(b * 0.68)})`,
          },
          geometry: { type: 'Point' as const, coordinates: bg.centroid },
        },
      ];
    });
    if (map.getLayer('heatmap-blob')) {
      map.setPaintProperty('heatmap-blob', 'circle-color', ['get', 'fill']);
      map.setPaintProperty('heatmap-blob', 'circle-stroke-color', ['get', 'stroke']);
    }
    setData(map, 'heatmap-src', { type: 'FeatureCollection', features });
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
  // paint whole residential neighborhoods as work demand. Cells above the
  // cut become dots with a minimum size, so a small satellite town's
  // demand is just as legible as downtown's.
  const cut = mode === 'pop' ? 0.03 : 0.12;
  const features = pack.blockGroups.flatMap((bg, i) => {
    const rel = dens[i] / norm;
    if (rel < cut) return [];
    return [
      {
        type: 'Feature' as const,
        properties: { w: Math.pow(Math.min(rel, 1), 0.75), bg: i },
        geometry: { type: 'Point' as const, coordinates: bg.centroid },
      },
    ];
  });
  if (map.getLayer('heatmap-blob')) {
    map.setPaintProperty('heatmap-blob', 'circle-color', HEAT_COLORS[mode].fill);
    map.setPaintProperty('heatmap-blob', 'circle-stroke-color', HEAT_COLORS[mode].stroke);
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
