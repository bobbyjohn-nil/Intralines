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
    zoom: 12.9,
    bbox: [-100.072, 41.4457, -99.928, 41.5543],
    calib: { workforceRate: 0.47, gravityBetaKm: 3.2, carSpeedKmh: 34 },
    dataSource: 'Procedurally generated demonstration data',
  },
  {
    id: 'worcester',
    name: 'Worcester',
    region: 'Massachusetts · pop ≈ 206k',
    kind: 'real',
    center: [-71.8023, 42.2626],
    zoom: 13.1,
    bbox: [-71.95, 42.16, -71.65, 42.4],
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
    zoom: 12.9,
    bbox: [-93.9, 41.455, -93.42, 41.725],
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
    zoom: 12.9,
    bbox: [-89.645, 42.9075, -89.135, 43.2225],
    counties: [{ state: '55', county: '025' }], // Dane
    lodesState: 'wi',
    calib: { workforceRate: 0.52, gravityBetaKm: 4.5, carSpeedKmh: 37 },
  },
];

export function cityById(id: string): CityMeta | undefined {
  return CITIES.find((c) => c.id === id);
}
