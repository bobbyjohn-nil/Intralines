import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { BusLine, CityPack, LngLat, Stop } from '../game/types';
import type { DraftLine } from '../game/store';

// Game overlays drawn on top of the basemap: census demand heatmap, bus
// lines, stops, draft line preview and the depot.

const EMPTY = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

import type { ExpressionSpecification } from 'maplibre-gl';

export type HeatMode = 'pop' | 'dest' | 'modes';

/** roughly how many demand dots a city should carry, whatever its size */
const TARGET_DOTS = 2600;
/** no single block group may carpet the map */
const MAX_DOTS_PER_BG = 40;

/** deterministic 0..1 from an integer — the scatter must not move on redraw */
function hash01(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function cosLatOf(pack: CityPack): number {
  return Math.cos((pack.meta.center[1] * Math.PI) / 180);
}

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
 * purple = where people live, teal = where they are going.
 */
const HEAT_COLORS: Record<Exclude<HeatMode, 'modes'>, { fill: string; stroke: string }> = {
  pop: { fill: '#7a54e0', stroke: '#5230b8' },
  dest: { fill: '#0e7a92', stroke: '#075a6e' },
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
  if (!map.getSource('heatmap-src')) {
    // Clustering is what lets the layer be scattered up close and calm from
    // afar: zoomed in you see the individual scatter, and as you pull back
    // MapLibre merges neighbours into one blob carrying their combined weight.
    map.addSource('heatmap-src', {
      type: 'geojson',
      data: EMPTY,
      cluster: true,
      clusterRadius: 40,
      // above this the scatter stands on its own; at or below it, neighbours
      // merge — which is the wide view people are used to
      clusterMaxZoom: 13,
      clusterProperties: { wsum: ['+', ['get', 'w']] },
    });
  }
  ['lines-src', 'stops-src', 'draft-src', 'draft-cursor-src', 'depot-src'].forEach(addSrc);

  if (!map.getLayer('heatmap-blob')) {
    // crisp demand dots over block-group centroids, drawn ABOVE the basemap
    // (roads and buildings included) but beneath the game's own line/stop
    // overlays added after this. Fill stays lightly translucent so streets
    // show through; the solid outline keeps the shape rigid.
    // A merged blob carries the summed weight of everything inside it, damped
    // so a dense downtown does not swell into one enormous circle. Individual
    // dots stay small — thousands of them are the texture, not the subject.
    const merged: ExpressionSpecification = [
      'min', 4.2, ['sqrt', ['coalesce', ['get', 'wsum'], 1]],
    ] as ExpressionSpecification;
    map.addLayer({
      id: 'heatmap-blob',
      type: 'circle',
      source: 'heatmap-src',
      paint: {
        // The zoom interpolation has to be the outermost expression — a
        // ['zoom'] nested inside a ['case'] is rejected and the whole layer
        // silently fails to build — so the cluster/point split lives in each
        // stop instead.
        'circle-radius': [
          'interpolate', ['exponential', 1.6], ['zoom'],
          10, ['case', ['has', 'point_count'], ['*', 3.2, merged], 1.8],
          13, ['case', ['has', 'point_count'], ['*', 6.5, merged], 2.8],
          15, ['case', ['has', 'point_count'], ['*', 11, merged], 4.2],
          17, ['case', ['has', 'point_count'], ['*', 16, merged], 6],
        ],
        'circle-color': HEAT_COLORS.pop.fill,
        'circle-opacity': ['case', ['has', 'point_count'], 0.3, 0.55],
        'circle-stroke-color': HEAT_COLORS.pop.stroke,
        'circle-stroke-width': ['case', ['has', 'point_count'], 1.6, 0.6],
        'circle-stroke-opacity': ['case', ['has', 'point_count'], 0.95, 0.5],
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
  if (!map.getLayer('stop-glow')) {
    // hover halo behind the stop dot (filtered to one stop at a time)
    map.addLayer({
      id: 'stop-glow',
      type: 'circle',
      source: 'stops-src',
      filter: ['==', ['get', 'id'], '___none'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 18],
        'circle-color': '#ffd43b',
        'circle-opacity': 0.5,
        'circle-stroke-color': '#f08c00',
        'circle-stroke-width': 3,
      },
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

  // A scatter, not a single dot per block group: each dot stands for a few
  // hundred people, sprinkled across the area they actually live or work in.
  // Up close that reads as texture — you can see a corridor thin out street by
  // street — and the source's clustering merges it back into blobs as you pull
  // away, so the wide view looks much as it always did.
  const value = (bg: CityPack['blockGroups'][number]): number =>
    mode === 'pop' ? bg.pop : bg.jobs + (bg.air ?? 0) + (bg.rail ?? 0);
  const values = pack.blockGroups.map(value);
  const total = values.reduce((a, b) => a + b, 0);
  // aim for a few thousand dots whatever the city's size
  const perDot = Math.max(40, total / TARGET_DOTS);
  const features: {
    type: 'Feature';
    properties: { w: number; bg: number };
    geometry: { type: 'Point'; coordinates: LngLat };
  }[] = [];
  pack.blockGroups.forEach((bg, i) => {
    const dots = Math.min(MAX_DOTS_PER_BG, Math.round(values[i] / perDot));
    if (dots < 1) return;
    // a block group's own footprint, so dots land inside the neighbourhood
    // rather than in a fixed blob around its centre
    const spread = Math.sqrt(Math.max(bg.areaKm2, 0.02)) * 0.0045;
    for (let k = 0; k < dots; k++) {
      // hashed, not random: the scatter must be identical on every redraw
      const h1 = hash01(i * 7919 + k * 104729);
      const h2 = hash01(i * 15485863 + k * 32452843);
      const r = Math.sqrt(h1) * spread;
      const a = h2 * Math.PI * 2;
      features.push({
        type: 'Feature',
        properties: { w: 0.5, bg: i },
        geometry: {
          type: 'Point',
          coordinates: [
            bg.centroid[0] + (r * Math.cos(a)) / Math.max(cosLatOf(pack), 0.2),
            bg.centroid[1] + r * Math.sin(a),
          ],
        },
      });
    }
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

// ---------------------------------------------------------------------------
// Traffic forecast overlay: main roads tinted by how congested they get at a
// chosen hour. Each edge's sensitivity ("gain") to citywide rush hour comes
// from how urban its surroundings are and whether it's a main road — the
// same recipe the bus animation uses to slow buses down.

import { congestionGain, measuredBusyness, trafficFactor } from '../game/constants';

let trafficFeatures: GeoJSON.Feature[] | null = null;
let trafficCity: string | null = null;

function buildTrafficFeatures(pack: CityPack): GeoJSON.Feature[] {
  const CELLD = 0.008;
  const dgrid = new Map<string, number>();
  const dens: number[] = [];
  for (const bg of pack.blockGroups) {
    const d = (bg.pop + bg.jobs) / Math.max(bg.areaKm2, 0.05);
    dens.push(d);
    const k = `${Math.floor(bg.centroid[0] / CELLD)}:${Math.floor(bg.centroid[1] / CELLD)}`;
    dgrid.set(k, Math.max(dgrid.get(k) ?? 0, d));
  }
  const sorted = [...dens].sort((a, b) => a - b);
  const norm = sorted[Math.floor(sorted.length * 0.85)] || 1;
  const urbanAt = (pt: LngLat): number => {
    const gx = Math.floor(pt[0] / CELLD);
    const gy = Math.floor(pt[1] / CELLD);
    let best = 0;
    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        best = Math.max(best, dgrid.get(`${x}:${y}`) ?? 0);
      }
    }
    return Math.min(best / norm, 1);
  };
  const feats: GeoJSON.Feature[] = [];
  for (const e of pack.edges) {
    if (e.kmh < 35) continue; // local lanes barely feel rush hour
    const a = pack.nodes[e.a];
    const b = pack.nodes[e.b];
    if (!a || !b) continue;
    const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const gain = congestionGain(e.kmh, urbanAt(mid), measuredBusyness(pack.traffic, mid));
    feats.push({
      type: 'Feature',
      properties: { gain: Math.round(gain * 100) / 100 },
      geometry: { type: 'LineString', coordinates: [a, ...e.pts, b] },
    });
  }
  return feats;
}

export function updateTraffic(
  map: MLMap,
  pack: CityPack,
  on: boolean,
  hour: number,
  relief = 1,
): void {
  if (!map.getSource('traffic-src')) {
    map.addSource('traffic-src', { type: 'geojson', data: EMPTY });
  }
  if (!map.getLayer('traffic-lines')) {
    map.addLayer(
      {
        id: 'traffic-lines',
        type: 'line',
        source: 'traffic-src',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 14, 4, 16.5, 8],
          'line-opacity': 0.8,
        },
      },
      map.getLayer('lines-halo') ? 'lines-halo' : undefined,
    );
  }
  if (!on) {
    map.setLayoutProperty('traffic-lines', 'visibility', 'none');
    return;
  }
  if (trafficCity !== pack.meta.id || !trafficFeatures) {
    trafficFeatures = buildTrafficFeatures(pack);
    trafficCity = pack.meta.id;
  }
  // (re)load data if this map instance hasn't seen this city's edges yet
  const holder = map as MLMap & { __trafficCity?: string };
  if (holder.__trafficCity !== pack.meta.id) {
    setData(map, 'traffic-src', {
      type: 'FeatureCollection',
      features: trafficFeatures,
    });
    holder.__trafficCity = pack.meta.id;
  }
  map.setLayoutProperty('traffic-lines', 'visibility', 'visible');
  const base = trafficFactor(hour);
  const eff = base >= 1 ? 1 + (base - 1) * relief : base;
  const cong: ExpressionSpecification = [
    '+', 1, ['*', eff - 1, ['get', 'gain']],
  ] as ExpressionSpecification;
  map.setPaintProperty('traffic-lines', 'line-color', [
    'interpolate', ['linear'], cong,
    0.95, '#3d9d50',
    1.08, '#8fbf3e',
    1.2, '#f0b41e',
    1.35, '#ee7c1b',
    1.55, '#dd3d3d',
  ]);
}

/** glow one stop on the map (hovered in the line editor); null clears */
export function updateStopHover(map: MLMap, stopId: string | null): void {
  if (!map.getLayer('stop-glow')) return;
  map.setFilter('stop-glow', ['==', ['get', 'id'], stopId ?? '___none']);
}

/**
 * Depot-placement zoning tint: paints the block groups where zoning will
 * approve a depot. Pass null to hide.
 */
export function updateZoning(
  map: MLMap,
  zones: { rings: LngLat[][] }[] | null,
): void {
  if (!map.getSource('zoning-src')) {
    map.addSource('zoning-src', { type: 'geojson', data: EMPTY });
  }
  if (!map.getLayer('zoning-fill')) {
    const before = map.getLayer('lines-halo') ? 'lines-halo' : undefined;
    map.addLayer(
      {
        id: 'zoning-fill',
        type: 'fill',
        source: 'zoning-src',
        paint: { 'fill-color': '#2f9e44', 'fill-opacity': 0.18 },
      },
      before,
    );
    map.addLayer(
      {
        id: 'zoning-line',
        type: 'line',
        source: 'zoning-src',
        paint: {
          'line-color': '#1e7030',
          'line-width': 1.4,
          'line-opacity': 0.55,
          'line-dasharray': [2, 1.6],
        },
      },
      before,
    );
  }
  setData(
    map,
    'zoning-src',
    zones && zones.length
      ? {
          type: 'FeatureCollection',
          features: zones.map((z) => ({
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Polygon' as const, coordinates: [z.rings[0]] },
          })),
        }
      : EMPTY,
  );
}

export function updateDepots(map: MLMap, pts: LngLat[]): void {
  setData(
    map,
    'depot-src',
    pts.length
      ? {
          type: 'FeatureCollection',
          features: pts.map((pt) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: pt },
          })),
        }
      : EMPTY,
  );
}
