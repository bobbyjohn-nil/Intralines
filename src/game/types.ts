// Shared game types. The city pack is the static world data (census + roads);
// everything else is player state.

export type LngLat = [number, number];

export interface CityCalibration {
  /** share of residents who commute to a job */
  workforceRate: number;
  /** gravity model distance-decay constant, km */
  gravityBetaKm: number;
  /** assumed door-to-door car speed, km/h */
  carSpeedKmh: number;
}

export interface CityMeta {
  id: string;
  name: string;
  region: string;
  kind: 'demo' | 'real';
  center: LngLat;
  zoom: number;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** counties used for census queries (real cities) */
  counties?: { state: string; county: string }[];
  /** two-letter lowercase state code for LODES download */
  lodesState?: string;
  calib: CityCalibration;
  dataSource?: string;
}

export interface BlockGroup {
  id: string;
  centroid: LngLat;
  /** simplified polygon ring(s), first is outer */
  rings: LngLat[][];
  pop: number;
  jobs: number;
  areaKm2: number;
}

export interface RoadEdge {
  a: number;
  b: number;
  lenM: number;
  kmh: number;
  /** intermediate shape points (excluding endpoints) */
  pts: LngLat[];
}

export interface DemoBuilding {
  ring: LngLat[];
  h: number;
}

export interface CityPack {
  meta: CityMeta;
  blockGroups: BlockGroup[];
  /** road graph node coordinates */
  nodes: LngLat[];
  edges: RoadEdge[];
  /** synthetic buildings — demo city only (real cities use basemap tiles) */
  buildings?: DemoBuilding[];
  /** synthetic water/park polygons — demo city only */
  water?: LngLat[][];
  parks?: LngLat[][];
}

// ---------------------------------------------------------------------------
// Player state

export interface Stop {
  id: string;
  name: string;
  /** road graph node index */
  node: number;
  pt: LngLat;
}

export interface BusModelSpec {
  id: string;
  name: string;
  capacity: number;
  price: number;
  /** running cost $ / km (fuel + maintenance) */
  costPerKm: number;
  kmh: number;
  /** total riders served needed to unlock */
  unlockRiders: number;
  needsCharger?: boolean;
  emoji: string;
  blurb: string;
}

export interface BusLine {
  id: string;
  name: string;
  color: string;
  stopIds: string[];
  /** street-following path through all stops (one direction) */
  path: LngLat[];
  /** cumulative distance (m) along path for each vertex */
  cum: number[];
  /** distance (m) along path of each stop */
  stopDist: number[];
  pathLenM: number;
  headwayMin: number;
  firstHour: number;
  lastHour: number;
  fare: number;
  modelId: string;
  /** buses the player assigned to this line */
  vehicles: number;
  active: boolean;
}

export interface LineStats {
  lineId: string;
  dailyBoardings: number;
  /** boardings by hour of day (length 24) */
  hourly: number[];
  peakLoadFactor: number; // riders on busiest hour vs capacity offered
  dailyRevenue: number;
  dailyCost: number;
  vehiclesNeeded: number;
  cycleMin: number;
  /** actual scheduled headway after fleet shortage stretching */
  headwayEffMin: number;
  /** vehicles actually running (fleet- and driver-limited) */
  vehiclesUsed: number;
}

export interface NetworkStats {
  coveragePct: number; // % of residents within walk of a stop
  totalDailyRiders: number;
  satisfaction: number; // 0..100
  perLine: LineStats[];
}

export interface Depot {
  pt: LngLat;
  node: number;
  level: number; // 1..3
  workshop: boolean;
  washBay: boolean;
  chargers: boolean;
}

export interface Staff {
  drivers: number;
  mechanics: number;
}

export interface FleetEntry {
  modelId: string;
  count: number;
}

export type Tool =
  | 'select'
  | 'line-new'
  | 'line-extend'
  | 'depot-place';

export interface SaveGame {
  version: number;
  cityId: string;
  cash: number;
  /** minutes since Monday 00:00 of week 1 */
  clockMin: number;
  stops: Stop[];
  lines: BusLine[];
  depot: Depot | null;
  staff: Staff;
  fleet: FleetEntry[];
  totalRidersServed: number;
  loanTaken: boolean;
}
