import type { StyleSpecification } from 'maplibre-gl';
import type { CityPack } from '../game/types';

// A warm, colorful map look — deliberately NOT the all-black Subway Builder
// style. Cream land, blue water, green parks, amber highways, pastel 3D
// buildings. Real cities pull OpenFreeMap vector tiles (OpenMapTiles schema);
// the demo city is fully self-contained.

export const PALETTE = {
  land: '#f3edda',
  landDark: '#20242e',
  water: '#8ec8ee',
  park: '#b7dd9a',
  wood: '#a3d18c',
  grass: '#c8e5ab',
  residential: '#efe5cd',
  industrial: '#e4e0e8',
  commercial: '#f4e3cf',
  building: '#ddD1bd',
  building3d: '#e6dac4',
  motorway: '#f7b267',
  motorwayCasing: '#e08e3c',
  primary: '#fdd8a2',
  primaryCasing: '#e4b56e',
  tertiary: '#fff3d9',
  tertiaryCasing: '#dbc9a3',
  street: '#ffffff',
  streetCasing: '#d8cfba',
  rail: '#b5a8c9',
  label: '#4a4636',
  labelHalo: 'rgba(255,252,240,0.85)',
};

export function buildRealStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      ofm: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PALETTE.land } },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': PALETTE.wood, 'fill-opacity': 0.55 },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'grass'],
        paint: { 'fill-color': PALETTE.grass, 'fill-opacity': 0.5 },
      },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'landuse',
        filter: ['==', ['get', 'class'], 'residential'],
        paint: { 'fill-color': PALETTE.residential, 'fill-opacity': 0.55 },
      },
      {
        id: 'landuse-commercial',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['commercial', 'retail']]],
        paint: { 'fill-color': PALETTE.commercial, 'fill-opacity': 0.5 },
      },
      {
        id: 'landuse-industrial',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['industrial', 'quarry', 'railway']]],
        paint: { 'fill-color': PALETTE.industrial, 'fill-opacity': 0.5 },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'park',
        paint: { 'fill-color': PALETTE.park, 'fill-opacity': 0.7 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'water',
        paint: { 'fill-color': PALETTE.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'ofm',
        'source-layer': 'waterway',
        paint: {
          'line-color': PALETTE.water,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.5, 16, 5],
        },
      },
      {
        id: 'aeroway',
        type: 'line',
        source: 'ofm',
        'source-layer': 'aeroway',
        minzoom: 10,
        paint: { 'line-color': '#e8e4da', 'line-width': 4 },
      },
      // --- roads (casing then fill) ---
      {
        id: 'road-minor-casing',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 11.5,
        filter: [
          'in', ['get', 'class'],
          ['literal', ['minor', 'service']],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.streetCasing,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 1.7, 15, 6.5, 18, 20],
        },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 11.5,
        filter: [
          'in', ['get', 'class'],
          ['literal', ['minor', 'service']],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.street,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 1.1, 15, 5, 18, 16],
        },
      },
      {
        id: 'road-tertiary-casing',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'tertiary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.tertiaryCasing,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.7, 15, 8, 18, 23],
        },
      },
      {
        id: 'road-tertiary',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'tertiary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.tertiary,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 1.1, 15, 6, 18, 18],
        },
      },
      {
        id: 'road-secondary-casing',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['secondary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.streetCasing,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 2, 15, 9, 18, 25],
        },
      },
      {
        id: 'road-secondary',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['secondary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#fff8ea',
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 1.4, 15, 7, 18, 19.5],
        },
      },
      {
        id: 'road-primary-casing',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.primaryCasing,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 2, 15, 11, 18, 30],
        },
      },
      {
        id: 'road-primary',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.primary,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 1.4, 15, 8.5, 18, 24],
        },
      },
      {
        id: 'road-motorway-casing',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.motorwayCasing,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 7, 2.4, 15, 13, 18, 36],
        },
      },
      {
        id: 'road-motorway',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': PALETTE.motorway,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 7, 1.7, 15, 10, 18, 29],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'rail'],
        paint: {
          'line-color': PALETTE.rail,
          'line-width': 1.6,
          'line-dasharray': [3, 3],
        },
      },
      // --- 3D buildings (extrude when you tilt, Subway Builder style) ---
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'ofm',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': PALETTE.building3d,
          // clamp: one mis-tagged OSM building (hi, Des Moines) shouldn't
          // punch a kilometer-tall spike through the sky
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['zoom'],
            13, 0,
            14.2, ['min', ['coalesce', ['get', 'render_height'], 6], 210],
          ],
          'fill-extrusion-base': [
            'min', ['coalesce', ['get', 'render_min_height'], 0], 200,
          ],
          'fill-extrusion-opacity': 0.86,
        },
      },
      // --- labels ---
      {
        id: 'road-label',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'transportation_name',
        minzoom: 14,
        layout: {
          'symbol-placement': 'line',
          'text-font': ['Noto Sans Regular'],
          'text-field': ['get', 'name'],
          'text-size': 11,
        },
        paint: {
          'text-color': PALETTE.label,
          'text-halo-color': PALETTE.labelHalo,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'water-label',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'water_name',
        layout: {
          'text-font': ['Noto Sans Italic'],
          'text-field': ['get', 'name'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#3d6f9e',
          'text-halo-color': PALETTE.labelHalo,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'place-suburb',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'place',
        minzoom: 11,
        maxzoom: 15,
        filter: [
          'in', ['get', 'class'],
          ['literal', ['suburb', 'neighbourhood', 'quarter', 'village', 'hamlet']],
        ],
        layout: {
          'text-font': ['Noto Sans Regular'],
          'text-field': ['get', 'name'],
          // District names were a flat 12px at every zoom, so at z11 — where a
          // screen holds a dozen of them — they were the loudest thing on the
          // map. They now shrink with the view and step back in weight.
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 8.5, 13, 11, 15, 13],
          'text-transform': 'uppercase',
          'text-letter-spacing': ['interpolate', ['linear'], ['zoom'], 11, 0.04, 14, 0.08],
        },
        paint: {
          'text-color': '#8a7f63',
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 13.5, 1],
          'text-halo-color': PALETTE.labelHalo,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'place-city',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'place',
        maxzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: {
          'text-font': ['Noto Sans Bold'],
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 13, 13, 19],
        },
        paint: {
          'text-color': '#3c3728',
          'text-halo-color': PALETTE.labelHalo,
          'text-halo-width': 1.6,
        },
      },
    ],
  };
}

/**
 * Fully offline style drawn from the city pack itself: real streets from the
 * cached OSM graph, water/parks polygons, and stylized 3D buildings. Used for
 * the demo city and for real cities in offline mode (or when tiles are
 * unreachable).
 */
export function buildPackStyle(pack: CityPack): StyleSpecification {
  const roadFeatures = pack.edges.map((e) => ({
    type: 'Feature' as const,
    properties: { kmh: e.kmh },
    geometry: {
      type: 'LineString' as const,
      coordinates: [pack.nodes[e.a], ...e.pts, pack.nodes[e.b]],
    },
  }));
  const polys = (rings: [number, number][][] | undefined) => ({
    type: 'FeatureCollection' as const,
    features: (rings ?? []).map((ring) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] },
    })),
  });
  const buildings = {
    type: 'FeatureCollection' as const,
    features: (pack.buildings ?? []).map((b) => ({
      type: 'Feature' as const,
      properties: { h: b.h },
      geometry: { type: 'Polygon' as const, coordinates: [[...b.ring, b.ring[0]]] },
    })),
  };

  return {
    version: 8,
    sources: {
      'demo-roads': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: roadFeatures },
      },
      'demo-water': { type: 'geojson', data: polys(pack.water) },
      'demo-parks': { type: 'geojson', data: polys(pack.parks) },
      'demo-buildings': { type: 'geojson', data: buildings },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PALETTE.land } },
      {
        id: 'parks',
        type: 'fill',
        source: 'demo-parks',
        paint: { 'fill-color': PALETTE.park, 'fill-opacity': 0.8 },
      },
      {
        id: 'parks-outline',
        type: 'line',
        source: 'demo-parks',
        paint: { 'line-color': '#8fbc72', 'line-width': 1, 'line-opacity': 0.7 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'demo-water',
        paint: { 'fill-color': PALETTE.water },
      },
      {
        id: 'water-outline',
        type: 'line',
        source: 'demo-water',
        paint: { 'line-color': '#6aaede', 'line-width': 1.2, 'line-opacity': 0.8 },
      },
      {
        id: 'road-casing',
        type: 'line',
        source: 'demo-roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['>=', ['get', 'kmh'], 70], PALETTE.motorwayCasing,
            ['>=', ['get', 'kmh'], 42], PALETTE.primaryCasing,
            ['>=', ['get', 'kmh'], 38], PALETTE.tertiaryCasing,
            PALETTE.streetCasing,
          ],
          'line-width': [
            'interpolate', ['exponential', 1.5], ['zoom'],
            11, [
              'case',
              ['>=', ['get', 'kmh'], 70], 3.4,
              ['>=', ['get', 'kmh'], 42], 2.6,
              ['>=', ['get', 'kmh'], 38], 2,
              1.4,
            ],
            14, [
              'case',
              ['>=', ['get', 'kmh'], 70], 11,
              ['>=', ['get', 'kmh'], 42], 8.5,
              ['>=', ['get', 'kmh'], 38], 6.5,
              5,
            ],
            18, [
              'case',
              ['>=', ['get', 'kmh'], 70], 42,
              ['>=', ['get', 'kmh'], 42], 34,
              ['>=', ['get', 'kmh'], 38], 27,
              22,
            ],
          ],
        },
      },
      {
        id: 'road',
        type: 'line',
        source: 'demo-roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['>=', ['get', 'kmh'], 70], PALETTE.motorway,
            ['>=', ['get', 'kmh'], 42], PALETTE.primary,
            ['>=', ['get', 'kmh'], 38], PALETTE.tertiary,
            PALETTE.street,
          ],
          'line-width': [
            'interpolate', ['exponential', 1.5], ['zoom'],
            11, [
              'case',
              ['>=', ['get', 'kmh'], 70], 2.5,
              ['>=', ['get', 'kmh'], 42], 1.9,
              ['>=', ['get', 'kmh'], 38], 1.4,
              1,
            ],
            14, [
              'case',
              ['>=', ['get', 'kmh'], 70], 8.5,
              ['>=', ['get', 'kmh'], 42], 6.5,
              ['>=', ['get', 'kmh'], 38], 5,
              3.8,
            ],
            18, [
              'case',
              ['>=', ['get', 'kmh'], 70], 34,
              ['>=', ['get', 'kmh'], 42], 27,
              ['>=', ['get', 'kmh'], 38], 21,
              17,
            ],
          ],
        },
      },
      {
        id: 'road-centerline',
        type: 'line',
        source: 'demo-roads',
        minzoom: 13.2,
        filter: ['>=', ['get', 'kmh'], 38],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#e9c46a',
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13.2, 0.5, 18, 2.4],
          'line-dasharray': [4, 3],
          'line-opacity': 0.85,
        },
      },
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'demo-buildings',
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'h'],
            6, '#eadfc8',
            24, PALETTE.building3d,
            70, '#d3cbc0',
          ],
          'fill-extrusion-height': ['min', ['get', 'h'], 120],
          'fill-extrusion-opacity': 0.9,
        },
      },
    ],
  };
}
