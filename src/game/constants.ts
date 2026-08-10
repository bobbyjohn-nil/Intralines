import type { BusModelSpec } from './types';

// Economy tuning lives here so balance passes are one-file edits.

// Tight on purpose: covers a level-1 depot ($150k), one Sparrow minibus
// ($95k), stops for a medium line (~10 x $4k) and a small wage buffer —
// build one solid starter line, then earn the rest (or take the loan).
export const START_CASH = 310_000;
// Sandbox mode: the treasury is bottomless. Cash is pinned here every tick
// so purchases never bite; the UI shows ∞ instead of the number.
export const SANDBOX_CASH = 999_999_999;
// The only lender left in town is Talon & Grasp Savings — and they know it.
// A fat arrangement fee off the top, brutal interest forever, and the only
// exit is buying your way out at a premium.
export const LOAN_AMOUNT = 500_000;
export const LOAN_FEE = 50_000; // skimmed before the money arrives
export const LOAN_INTEREST_PER_DAY = 2_300; // never amortizes
export const LOAN_PAYOFF = 750_000; // the only way to make them go away

// Harbor Mutual, the reputable bank: smaller loans, fair terms — but they
// pull your credit score and size the offer accordingly.
export const GOOD_LOAN_MAX = 400_000;
export const GOOD_LOAN_MIN_SCORE = 580; // below this they politely decline
export const GOOD_LOAN_DAILY_RATE = 0.0006; // interest per day on the balance
/** short label for a score band */
export function creditBand(score: number): string {
  return score >= 780 ? 'Excellent' : score >= 700 ? 'Great' : score >= 640 ? 'Good'
    : score >= 580 ? 'Fair' : score >= 500 ? 'Poor' : 'Dismal';
}

export const DEPOT_COST = 150_000;
export const MAX_DEPOTS = 5; // city planning won't zone any more of them
/** each additional depot costs 50% more — land gets scarce */
export const DEPOT_COST_GROWTH = 1.5;
/** price of the next depot when you already own `count`: $150k, $225k, $340k, $505k, $760k */
export function nextDepotCost(count: number): number {
  return Math.round((DEPOT_COST * Math.pow(DEPOT_COST_GROWTH, count)) / 5000) * 5000;
}
export const DEPOT_UPGRADE_COST: Record<number, number> = { 2: 220_000, 3: 450_000 };
export const DEPOT_CAPACITY: Record<number, number> = { 1: 6, 2: 14, 3: 30 };
export const DEPOT_UPKEEP_PER_DAY: Record<number, number> = { 1: 300, 2: 700, 3: 1_400 };
export const WORKSHOP_COST = 80_000; // -25% running cost per km
export const WASH_BAY_COST = 45_000; // +6 satisfaction
export const CHARGERS_COST = 120_000; // enables electric buses

// Stops are infrastructure too: a pole and sign to start, upgradeable to a
// shelter and a full station. Nicer stops feel closer/comfier, so they pull
// riders from a little further out.
export const STOP_COST = 4_000;
export const STOP_UPGRADE_COST: Record<number, number> = {
  2: 12_000, 3: 35_000, 4: 90_000, 5: 200_000,
};
export const STOP_TIER_NAMES: Record<number, string> = {
  1: 'Sign stop', 2: 'Shelter', 3: 'Station', 4: 'Interchange', 5: 'Transfer Hub',
};
/** perceived minutes shaved off the walk to a stop, by tier */
export const STOP_TIER_WALK_BONUS: Record<number, number> = {
  1: 0, 2: 0.8, 3: 1.8, 4: 2.6, 5: 3.4,
};
/**
 * comfortable boardings/day by tier — past this a stop is overcrowded:
 * waiting riders spill off the curb, some give up, satisfaction drops.
 */
export const STOP_TIER_CAPACITY: Record<number, number> = {
  1: 250, 2: 700, 3: 1600, 4: 3500, 5: 8000,
};
/**
 * big-hub tiers need the traffic to justify them: minimum number of lines
 * calling at the stop before the upgrade is allowed.
 */
export const STOP_TIER_MIN_LINES: Record<number, number> = { 4: 3, 5: 5 };
/** transfer penalty in minutes at a Transfer Hub (vs TRANSFER_PENALTY_MIN) */
export const HUB_TRANSFER_PENALTY_MIN = 2;
/** fastest road a bus stop may sit on — no stops on motorways/trunks */
export const STOP_MAX_KMH = 55;

/** the city pays you per boarding on top of the fare (transit contracts!) */
export const SUBSIDY_PER_RIDER = 1.6;

// Fleet wear & upgrades. Buses in service grind down; worn buses cost more
// per km and drag the safety grade. Refurbishing resets wear; upgrading a
// model line (Mk I -> II -> III) adds capacity and trims running costs.
export const WEAR_PER_DAY = 2.2; // full-use wear/day before modifiers
export const WEAR_COST_PENALTY = 0.35; // +35% running cost at 100% wear
export const REFURB_COST_SHARE = 0.12; // of list price at full wear, per bus
export const FLEET_TIER_NAMES: Record<number, string> = { 1: 'Mk I', 2: 'Mk II', 3: 'Mk III' };
export const FLEET_TIER_CAP: Record<number, number> = { 1: 1, 2: 1.1, 3: 1.2 };
export const FLEET_TIER_COST: Record<number, number> = { 1: 1, 2: 0.93, 3: 0.87 };
/** per-bus upgrade price as a share of list price, keyed by target tier */
export const FLEET_UPGRADE_COST_SHARE: Record<number, number> = { 2: 0.15, 3: 0.22 };
export function wearLabel(wear: number): string {
  return wear < 25 ? 'Fresh' : wear < 50 ? 'Good' : wear < 75 ? 'Worn' : 'Ragged';
}

// The game calendar: 10 days to a quarter, 4 quarters to a year. The
// Transit Authority grades the network at the end of every quarter and
// pays a grant (or levies a fee) based on the overall mark.
export const DAYS_PER_QUARTER = 10;
export const QUARTERS_PER_YEAR = 4;
export const QUARTER_MIN = DAYS_PER_QUARTER * 1440;
export const YEAR_MIN = QUARTER_MIN * QUARTERS_PER_YEAR;
/** "Year 2 Quarter 3" label for the n-th quarter since opening (1-based) */
export function quarterLabel(q: number): string {
  const y = Math.floor((q - 1) / QUARTERS_PER_YEAR) + 1;
  return `Year ${y} Quarter ${((q - 1) % QUARTERS_PER_YEAR) + 1}`;
}
export const REPORT_GRANT_PER_POINT = 1600; // $ per overall point above 55
export const REPORT_FINE = 8_000; // flat non-compliance fee below 35 overall

export const DRIVER_WAGE_PER_HOUR = 26;
export const MECHANIC_WAGE_PER_DAY = 260;
export const BUSES_PER_MECHANIC = 6; // short-staffed => +40% running cost
export const OFFICE_OVERHEAD_PER_DAY = 250;

export const DWELL_SEC = 20; // stop dwell time
export const LAYOVER_MIN = 4; // rest at each end of a round trip
/** rush-hour clock hours — lines can run a tighter headway during these */
export const PEAK_HOURS = new Set([7, 8, 16, 17]);
export function isPeakHour(h: number): boolean {
  return PEAK_HOURS.has(((Math.floor(h) % 24) + 24) % 24);
}
/** minutes a bus spends topping up its tank back at the depot */
export const REFUEL_MIN = 7;
export const WALK_MIN_PER_KM = 12;
export const MAX_WALK_M = 650; // catchment radius around stops
export const TRANSFER_PENALTY_MIN = 6;
export const CAR_PARK_PENALTY_MIN = 10; // parking hunt + walk + cost, in minutes
/** share of commuters without a car available — they ride if service is usable */
export const CAPTIVE_SHARE = 0.13;
/** logit temperature (min) for bus-vs-car choice; higher = softer */
export const MODE_TAU = 9;
export const MAX_WAIT_MIN = 15; // schedule-timing caps effective wait

/**
 * Visitor trips generated per tourism-sector job per day. A hotel desk, a
 * gallery attendant and a waiter each stand for a handful of visitors moving
 * around the city.
 */
export const VISITOR_TRIPS_PER_TOURISM_JOB = 1.2;
/** how strongly the airport and the station pull, against another sight */
export const DEPARTURE_PULL = 0.8;

/**
 * Visitors keep different hours: no dawn rush, a long middle of the day going
 * from sight to sight, and a drift back to the hotel through the evening.
 * Sums to 1, like the commuter profile.
 */
export const TOURIST_PROFILE = [
  0.0041, 0.002, 0.001, 0.001, 0.002, 0.0082, 0.0184, 0.0306, 0.0459, 0.0633,
  0.0765, 0.0816, 0.0837, 0.0816, 0.0796, 0.0755, 0.0694, 0.0633, 0.0592, 0.0531,
  0.0449, 0.0306, 0.0163, 0.0082,
];

/** hourly share of daily demand (sums to 1) — twin commute peaks */
export const HOURLY_PROFILE = [
  0.002, 0.001, 0.001, 0.002, 0.006, 0.02, 0.055, 0.095, 0.085, 0.055,
  0.045, 0.045, 0.05, 0.048, 0.05, 0.065, 0.09, 0.1, 0.07, 0.045,
  0.032, 0.022, 0.012, 0.005,
];

export const BUS_MODELS: BusModelSpec[] = [
  {
    id: 'minibus',
    name: 'Sparrow Minibus',
    capacity: 28,
    price: 95_000,
    costPerKm: 0.9,
    fuelPerKm: 0.38,
    tankKm: 260,
    kmh: 26,
    unlockRiders: 0,
    short: 'Mini',
    lengthFactor: 0.55,
    blurb: 'Cheap and nimble. Perfect for your first neighborhood line.',
  },
  {
    id: 'citybus',
    name: 'Metro 40 City Bus',
    capacity: 70,
    price: 260_000,
    costPerKm: 1.5,
    fuelPerKm: 0.62,
    tankKm: 420,
    kmh: 25,
    unlockRiders: 0,
    short: 'City',
    lengthFactor: 1,
    blurb: 'The workhorse. Solid capacity for trunk routes.',
  },
  {
    id: 'artic',
    name: 'Goliath Articulated',
    capacity: 115,
    price: 440_000,
    costPerKm: 2.2,
    fuelPerKm: 0.95,
    tankKm: 480,
    kmh: 23,
    unlockRiders: 25_000,
    short: 'Artic',
    lengthFactor: 1.6,
    blurb: 'A bendy giant for your busiest corridors. Unlocks at 25k riders served.',
  },
  {
    id: 'doubledeck',
    name: 'Skyline Double-Decker',
    capacity: 130,
    price: 520_000,
    costPerKm: 1.9,
    fuelPerKm: 0.8,
    tankKm: 400,
    kmh: 22,
    unlockRiders: 40_000,
    short: 'DD',
    lengthFactor: 1.05,
    blurb: 'Two floors of riders on one bus length. Slow but mighty. Unlocks at 40k riders served.',
  },
  {
    id: 'electric',
    name: 'Volt-E Electric',
    capacity: 75,
    price: 380_000,
    costPerKm: 0.7,
    fuelPerKm: 0.16,
    tankKm: 300,
    kmh: 26,
    unlockRiders: 60_000,
    needsCharger: true,
    short: 'E-Bus',
    lengthFactor: 1,
    blurb: 'Quiet, cheap to run, riders love it (+satisfaction). Needs depot chargers. Unlocks at 60k riders.',
  },
];

export const LINE_COLORS = [
  '#e5484d', '#3a76d6', '#2f9e44', '#f08c00', '#9c36b5',
  '#0ca678', '#e64980', '#795548', '#5f3dc4', '#f59f00',
];

export const HEADWAY_CHOICES = [5, 8, 10, 12, 15, 20, 30, 45, 60];

export const SPEEDS: { label: string; gameMinPerSec: number }[] = [
  { label: '▶', gameMinPerSec: 0.25 },
  { label: '▶▶', gameMinPerSec: 2 },
  { label: '▶▶▶', gameMinPerSec: 10 },
];

export const SAVE_VERSION = 1;
export const SAVE_KEY_PREFIX = 'intralines-save-';

/**
 * Street congestion by hour of day: 1 = free flow. Buses visibly slow down,
 * pause longer at lights and bunch up when this climbs. Piecewise-linear so
 * rush hour ramps in and out instead of snapping.
 */
const TRAFFIC_ANCHORS: [number, number][] = [
  [0, 0.9], [5, 0.92], [6.5, 1.1], [7.5, 1.45], [9, 1.32], [10, 1.12],
  [12, 1.18], [14.5, 1.15], [16, 1.42], [17.5, 1.52], [19, 1.15],
  [21, 1.0], [24, 0.9],
];

/**
 * How strongly a stretch of road feels rush hour. Road class dominates —
 * commuter traffic funnels onto arterials and highways, so they jam hard,
 * while local streets stay passable even downtown. Urban surroundings
 * scale the effect (a downtown arterial crawls; a country highway just
 * thickens a little).
 */
export function congestionGain(kmh: number, urban: number, measured = -1): number {
  const classWeight =
    kmh >= 70 ? 1.35 : kmh >= 42 ? 1.15 : kmh >= 35 ? 0.55 : 0.18;
  // Where a highway agency has actually counted this part of town, its
  // published average daily traffic replaces the density guess. Road class
  // still decides each street's share of it: agencies count arterials, not
  // the residential blocks beside them, so a quiet street in a busy cell must
  // not inherit the arterial's jam.
  const busy = measured >= 0 ? measured : Math.min(Math.max(urban, 0), 1);
  return classWeight * (0.35 + 0.65 * Math.min(Math.max(busy, 0), 1));
}

/**
 * Measured busyness 0..1 for a spot, or -1 where nothing was counted nearby
 * and the modeled estimate should stand in. Normalized against the city's own
 * busiest counted corridor, so a small city reads on the same scale as a big
 * one.
 */
export function measuredBusyness(
  grid: { aadt: number[]; busiest: number; cell: number; lng0: number; lat0: number; cols: number; rows: number } | null | undefined,
  pt: [number, number],
): number {
  if (!grid || !grid.busiest) return -1;
  const x = Math.floor((pt[0] - grid.lng0) / grid.cell);
  const y = Math.floor((pt[1] - grid.lat0) / grid.cell);
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return -1;
  const aadt = grid.aadt[y * grid.cols + x] || 0;
  if (aadt <= 0) return -1;
  // square-root so the busiest road does not flatten everything below it
  return Math.min(1, Math.sqrt(aadt / grid.busiest));
}

// ---------------------------------------------------------------------------
// Timetables
//
// Two ways to write one, because the two halves of the job pull in opposite
// directions. Normal mode asks the question an operator asks — how many buses
// can I put out at rush hour? — and reports the frequency that buys. Advanced
// mode asks the question a passenger asks — how long will I wait? — across
// finer slices of the day, and works out the buses needed to keep that promise.

export type SchedMode = 'simple' | 'advanced';

/** the day, cut into windows a timetable can address */
export const SCHED_PERIODS = [
  { key: 'am', label: 'AM rush', short: '07–09', from: 7, to: 9 },
  { key: 'mid', label: 'Midday', short: '09–16', from: 9, to: 16 },
  { key: 'pm', label: 'PM rush', short: '16–18', from: 16, to: 18 },
  { key: 'off', label: 'Early & evening', short: 'rest of the day', from: 18, to: 7 },
] as const;

/** which advanced period an hour falls in */
export function periodOfHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 9) return 0;
  if (h >= 9 && h < 16) return 1;
  if (h >= 16 && h < 18) return 2;
  return 3;
}

/** normal mode splits the day in two: rush, and everything else */
export const SIMPLE_PERIODS = [
  { label: 'Rush hours', short: '07–09 & 16–18' },
  { label: 'Off-peak', short: 'the rest of the day' },
] as const;

/** the band the advanced frequency dial fine-tunes within */
export const ADV_HEADWAY_MIN = 10;
export const ADV_HEADWAY_MAX = 15;
export const ADV_HEADWAY_STEP = 0.5;
/** buses cannot physically follow each other closer than this */
export const MIN_HEADWAY_MIN = 2;

interface SchedLine {
  schedMode?: SchedMode;
  /** normal mode: buses out in [rush, off-peak] */
  periodBuses?: number[];
  /** advanced mode: minutes between buses, per SCHED_PERIODS entry */
  periodHeadwayMin?: number[];
  headwayMin: number;
  peakHeadwayMin?: number;
}

/** buses needed to hold a headway on a route with this round-trip time */
export function busesForHeadway(cycleMin: number, headwayMin: number): number {
  return Math.max(1, Math.ceil(cycleMin / Math.max(headwayMin, MIN_HEADWAY_MIN)));
}

/** the frequency a given number of buses buys on this route */
export function headwayForBuses(cycleMin: number, buses: number): number {
  if (buses <= 0) return Infinity; // nothing running: no service this period
  return Math.max(MIN_HEADWAY_MIN, cycleMin / buses);
}

/**
 * The timetable, whichever way it was written. Lines saved before timetable
 * modes existed still carry plain rush/off-peak headways, and read exactly as
 * they always did.
 */
export function headwayAtHour(l: SchedLine, hour: number, cycleMin: number): number {
  if (l.schedMode === 'advanced' && l.periodHeadwayMin?.length) {
    return Math.max(MIN_HEADWAY_MIN, l.periodHeadwayMin[periodOfHour(hour)]);
  }
  if (l.schedMode === 'simple' && l.periodBuses?.length) {
    return headwayForBuses(cycleMin, l.periodBuses[isPeakHour(hour) ? 0 : 1]);
  }
  return isPeakHour(hour) ? (l.peakHeadwayMin ?? l.headwayMin) : l.headwayMin;
}

/** most buses this timetable ever has on the road at once */
export function peakBusesNeeded(l: SchedLine, cycleMin: number): number {
  let most = 1;
  for (let h = 0; h < 24; h++) {
    const hw = headwayAtHour(l, h, cycleMin);
    if (!isFinite(hw)) continue;
    most = Math.max(most, busesForHeadway(cycleMin, hw));
  }
  return most;
}

// ---------------------------------------------------------------------------
// Express service
//
// A line earns express status by how it is built, not by a switch: long, with
// stops spaced far enough apart that it is skipping neighborhoods to move
// people across the city. Fewer stops already makes such a line quicker; these
// are the rewards on top of that.

/** minimum end-to-end length before a line can count as express */
export const EXPRESS_MIN_LEN_M = 5_000;
/** minimum average distance between consecutive stops */
export const EXPRESS_MIN_SPACING_M = 1_200;
/** minimum stops — a two-stop shuttle is not a route */
export const EXPRESS_MIN_STOPS = 3;
/**
 * Riders prefer limited-stop service by more than the minutes it saves them:
 * fewer starts and stops, a seat further out, a trip that feels direct. Their
 * perceived time on board is scaled by this.
 */
export const EXPRESS_RIDE_WEIGHT = 0.85;
/** express riders shrug off this much of a fare rise (0 = none, 1 = all) */
export const EXPRESS_FARE_TOLERANCE = 0.5;
/** the Transit Authority pays this much more per express rider */
export const EXPRESS_SUBSIDY_MULT = 1.5;

/**
 * Fare the riders in this city consider normal. Charging it costs nothing;
 * everything above or below is what they actually react to.
 */
export const FARE_REFERENCE = 2.25;
/** what a rider's time is worth, in dollars per minute, for fare tradeoffs */
export const FARE_VALUE_PER_MIN = 0.18;

/** average metres between consecutive stops, or 0 for a line with no legs */
export function stopSpacingM(pathLenM: number, stopCount: number): number {
  return stopCount > 1 ? pathLenM / (stopCount - 1) : 0;
}

/** does this line run as an express? Shared by the sim, the ledger and the UI */
export function isExpress(pathLenM: number, stopCount: number): boolean {
  return (
    stopCount >= EXPRESS_MIN_STOPS &&
    pathLenM >= EXPRESS_MIN_LEN_M &&
    stopSpacingM(pathLenM, stopCount) >= EXPRESS_MIN_SPACING_M
  );
}

/**
 * How many minutes of perceived travel a line's fare adds. Only the gap from
 * the going rate counts, so the default fare leaves the ride exactly as
 * attractive as it has always been — undercut it and riders come, gouge them
 * and they drive instead. Express riders are half as touchy.
 */
export function fareTimePenaltyMin(fare: number, express: boolean): number {
  const gap = (fare - FARE_REFERENCE) / FARE_VALUE_PER_MIN;
  return gap * (express ? EXPRESS_FARE_TOLERANCE : 1);
}

export function trafficFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < TRAFFIC_ANCHORS.length; i++) {
    const [h1, f1] = TRAFFIC_ANCHORS[i];
    if (h <= h1) {
      const [h0, f0] = TRAFFIC_ANCHORS[i - 1];
      const t = (h - h0) / Math.max(h1 - h0, 1e-6);
      return f0 + (f1 - f0) * t;
    }
  }
  return 0.9;
}
