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
  /** education jobs (schools, campuses) — subset of jobs */
  edu?: number;
  /** tourism jobs (venues, hotels, restaurants) — subset of jobs */
  tour?: number;
  /** air travellers + airport staff needing ground transport per day */
  air?: number;
  /** regional-rail passengers transferring to/from local transit per day */
  rail?: number;
}

/** named point of interest that generates special demand */
export interface Poi {
  kind: 'airport' | 'rail';
  pt: LngLat;
  name: string;
}

export interface RoadEdge {
  a: number;
  b: number;
  lenM: number;
  kmh: number;
  /** intermediate shape points (excluding endpoints) */
  pts: LngLat[];
  /** street name from OSM (used to name stops) */
  name?: string;
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
  /** airports and regional rail stations (special demand generators) */
  pois?: Poi[];
}

// ---------------------------------------------------------------------------
// Player state

export interface Stop {
  id: string;
  name: string;
  /** road graph node index */
  node: number;
  pt: LngLat;
  /** amenity level: 1 = sign stop, 2 = shelter, 3 = station */
  tier: number;
  /** build + upgrade spend so far (drives demolition refunds) */
  invested: number;
}

export interface BusModelSpec {
  id: string;
  name: string;
  capacity: number;
  price: number;
  /** running cost $ / km (fuel + maintenance) */
  costPerKm: number;
  /** the fuel (or charge) slice of costPerKm, paid at the depot pump */
  fuelPerKm: number;
  /** km of range on a full tank / charge */
  tankKm: number;
  kmh: number;
  /** total riders served needed to unlock */
  unlockRiders: number;
  needsCharger?: boolean;
  /** short label used on compact buttons */
  short: string;
  /** relative silhouette length for icons (1 = standard bus) */
  lengthFactor: number;
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
  /** off-peak headway (minutes between buses) */
  headwayMin: number;
  /** rush-hour headway (7-9 & 16-18); defaults to headwayMin on old saves */
  peakHeadwayMin: number;
  /** how this line's timetable is written; absent on saves from before modes */
  schedMode?: 'simple' | 'advanced';
  /** normal mode: buses on the road in [rush, off-peak] */
  periodBuses?: number[];
  /** advanced mode: minutes between buses per SCHED_PERIODS window */
  periodHeadwayMin?: number[];
  /**
   * schedule padding at every stop, seconds. Slows the timetable but
   * absorbs traffic delays, keeping buses punctual.
   */
  stopBufferSec: number;
  firstHour: number;
  lastHour: number;
  fare: number;
  /** buses assigned per model — routes can mix types */
  vehiclesByModel: Record<string, number>;
  /** total buses assigned (kept in sync with vehiclesByModel) */
  vehicles: number;
  /** legacy single-model field from old saves (migrated on load) */
  modelId?: string;
  active: boolean;
}

export interface LineStats {
  lineId: string;
  dailyBoardings: number;
  /** boardings by hour of day (length 24) */
  hourly: number[];
  peakLoadFactor: number; // riders on busiest hour vs capacity offered
  /** running as an express: long route, stops spaced far apart */
  express: boolean;
  dailyRevenue: number;
  dailyCost: number;
  vehiclesNeeded: number;
  cycleMin: number;
  /** actual off-peak headway after fleet shortage stretching */
  headwayEffMin: number;
  /** actual rush-hour headway after fleet shortage stretching */
  headwayEffPeakMin: number;
  /** vehicles actually running (fleet- and driver-limited) */
  vehiclesUsed: number;
  /** fuel spend included in dailyCost */
  dailyFuelCost: number;
  /** times each bus tops up at the depot per day (daily km vs tank) */
  refuelsPerDay: number;
  /**
   * ridership-weighted minutes buses run behind timetable (traffic).
   * Passengers time their arrival to the schedule, so this is how long
   * they're left standing at the stop.
   */
  avgDelayMin: number;
}

export interface NetworkStats {
  coveragePct: number; // % of residents within walk of a stop
  totalDailyRiders: number;
  satisfaction: number; // 0..100
  perLine: LineStats[];
  /** commuters by chosen travel mode per block group (same order as pack) */
  bgModes?: { bus: number; car: number; walk: number; bike: number }[];
  /** stops handling more daily boardings than their tier comfortably fits */
  crowdedStops?: { stopId: string; load: number; cap: number }[];
}

export interface Depot {
  id: string;
  /** player-editable; defaults to the nearest street's name */
  name: string;
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
  /** average wear across this model group, 0 (fresh) .. 100 (ragged) */
  wear: number;
  /** upgrade tier for this model line: 1 = Mk I .. 3 = Mk III */
  tier: number;
}

export interface ReportScore {
  key: string;
  label: string;
  score: number; // 0..100
}

/** the Transit Authority's quarterly grade sheet */
export interface ReportCard {
  quarter: number; // 1-based
  issuedAtMin: number;
  scores: ReportScore[];
  overall: number; // 0..100
  payout: number; // grant (+) or fee (−) applied when issued
}

export type Tool =
  | 'select'
  | 'line-new'
  | 'line-extend'
  | 'route-edit'
  | 'depot-place';

export interface SaveGame {
  version: number;
  cityId: string;
  cash: number;
  /** minutes since Year 1 Q1 Day 1, 00:00 (16-day quarters, 4 per year) */
  clockMin: number;
  stops: Stop[];
  lines: BusLine[];
  depots: Depot[];
  /** legacy single depot from saves written before multi-depot support */
  depot?: Depot | null;
  staff: Staff;
  fleet: FleetEntry[];
  totalRidersServed: number;
  loanTaken: boolean;
  /** outstanding Harbor Mutual balance (absent in old saves) */
  goodLoan?: number;
  /** quarterly report card history (absent in old saves) */
  reports?: ReportCard[];
  /** player company identity (absent in old saves) */
  companyName?: string;
  companyColor?: string;
  /** sandbox game: infinite money (absent in old saves) */
  sandbox?: boolean;
  /** wall-clock ms when the save was written (absent in old saves) */
  savedAt?: number;
}
