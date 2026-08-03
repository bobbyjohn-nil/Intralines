import type { CityMeta } from '../types';

// The launch cities. bboxes are deliberately "city + inner suburbs" — big
// enough to be interesting, small enough that the one-time OSM/census
// download stays manageable.

export const CITIES: CityMeta[] = [
  {
    id: 'demo',
    name: 'Riverton',
    region: 'Demo city — instant play, no downloads',
    kind: 'demo',
    center: [-100.0, 41.5],
    zoom: 13.1,
    bbox: [-100.04, 41.47, -99.96, 41.53],
    calib: { workforceRate: 0.47, gravityBetaKm: 3.2, carSpeedKmh: 34 },
    dataSource: 'Procedurally generated demonstration data',
  },
  {
    id: 'worcester',
    name: 'Worcester',
    region: 'Massachusetts · pop ≈ 206k',
    kind: 'real',
    center: [-71.8023, 42.2626],
    zoom: 12.6,
    bbox: [-71.9, 42.2, -71.7, 42.36],
    counties: [{ state: '25', county: '027' }],
    lodesState: 'ma',
    calib: { workforceRate: 0.46, gravityBetaKm: 4.5, carSpeedKmh: 37 },
  },
  {
    id: 'desmoines',
    name: 'Des Moines',
    region: 'Iowa · pop ≈ 214k',
    kind: 'real',
    center: [-93.6091, 41.5868],
    zoom: 12.4,
    bbox: [-93.82, 41.5, -93.5, 41.68],
    counties: [
      { state: '19', county: '153' }, // Polk
      { state: '19', county: '049' }, // Dallas
      { state: '19', county: '181' }, // Warren
    ],
    lodesState: 'ia',
    calib: { workforceRate: 0.5, gravityBetaKm: 5.0, carSpeedKmh: 40 },
  },
  {
    id: 'madison',
    name: 'Madison',
    region: 'Wisconsin · pop ≈ 272k',
    kind: 'real',
    center: [-89.4012, 43.0731],
    zoom: 12.4,
    bbox: [-89.56, 42.96, -89.22, 43.17],
    counties: [{ state: '55', county: '025' }], // Dane
    lodesState: 'wi',
    calib: { workforceRate: 0.52, gravityBetaKm: 4.5, carSpeedKmh: 37 },
  },
];

export function cityById(id: string): CityMeta | undefined {
  return CITIES.find((c) => c.id === id);
}
