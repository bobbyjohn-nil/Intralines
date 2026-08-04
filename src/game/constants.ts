import type { BusModelSpec } from './types';

// Economy tuning lives here so balance passes are one-file edits.

export const START_CASH = 900_000;
export const LOAN_AMOUNT = 500_000;
export const LOAN_WEEKLY_INTEREST = 4_000;

export const DEPOT_COST = 150_000;
export const DEPOT_UPGRADE_COST: Record<number, number> = { 2: 220_000, 3: 450_000 };
export const DEPOT_CAPACITY: Record<number, number> = { 1: 6, 2: 14, 3: 30 };
export const DEPOT_UPKEEP_PER_DAY: Record<number, number> = { 1: 300, 2: 700, 3: 1_400 };
export const WORKSHOP_COST = 80_000; // -25% running cost per km
export const WASH_BAY_COST = 45_000; // +6 satisfaction
export const CHARGERS_COST = 120_000; // enables electric buses

/** the city pays you per boarding on top of the fare (transit contracts!) */
export const SUBSIDY_PER_RIDER = 1.6;

export const DRIVER_WAGE_PER_HOUR = 26;
export const MECHANIC_WAGE_PER_DAY = 260;
export const BUSES_PER_MECHANIC = 6; // short-staffed => +40% running cost
export const OFFICE_OVERHEAD_PER_DAY = 250;

export const DWELL_SEC = 20; // stop dwell time
export const LAYOVER_MIN = 4; // rest at each end of a round trip
export const WALK_MIN_PER_KM = 12;
export const MAX_WALK_M = 650; // catchment radius around stops
export const TRANSFER_PENALTY_MIN = 6;
export const CAR_PARK_PENALTY_MIN = 10; // parking hunt + walk + cost, in minutes
/** share of commuters without a car available — they ride if service is usable */
export const CAPTIVE_SHARE = 0.13;
/** logit temperature (min) for bus-vs-car choice; higher = softer */
export const MODE_TAU = 9;
export const MAX_WAIT_MIN = 15; // schedule-timing caps effective wait

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
    kmh: 23,
    unlockRiders: 25_000,
    short: 'Artic',
    lengthFactor: 1.6,
    blurb: 'A bendy giant for your busiest corridors. Unlocks at 25k riders served.',
  },
  {
    id: 'electric',
    name: 'Volt-E Electric',
    capacity: 75,
    price: 380_000,
    costPerKm: 0.7,
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
