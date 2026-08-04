/** release notes shown on the home screen's Changelog tab (newest first) */
export interface LogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: LogEntry[] = [
  {
    version: '0.8',
    date: 'Aug 4, 2026',
    title: 'Sharper demand',
    items: [
      'Two new demand layers: Tourism (venues, hotels, restaurants) and Education (schools, campuses) — real LODES sector data in real cities. Pick them from the new dropdown next to the Residents/Work toggles; they can overlap the other layers since campuses and hotels are workplaces too.',
      'Work demand no longer glows across residential neighborhoods — a handful of corner-store jobs is no longer a hotspot.',
      'The heatmap itself is tighter and translucent: defined cores around real hotspots instead of one washed-out blob.',
      'Residents / Work toggles are bigger and clearer in the dock.',
    ],
  },
  {
    version: '0.7',
    date: 'Aug 4, 2026',
    title: 'Names on the map',
    items: [
      'Station name labels on the map: zoom right in to see them, or flip them on everywhere from the new Map options menu in the dock.',
      'Map options menu collects the basemap Auto / Offline switch too.',
      'Home screen reworked into drill-in pages with big menu strips (Play, Saves, Settings, Changelog).',
      'Fixed spare buses doing a pointless depot round-trip after the service window closed.',
    ],
  },
  {
    version: '0.6',
    date: 'Aug 4, 2026',
    title: 'Vultures & deadheads',
    items: [
      'Loans got predatory: Talon & Grasp Savings skims a $50k fee, charges $16k a week forever, and only lets you go for $750k.',
      'Buses now drive from the depot to their first stop before service starts, and drive home after the last run — no more teleporting.',
      'Traffic knows where it is: downtown main roads grind to a near-standstill at rush hour while country lanes stay clear all day.',
      'Bigger maps — the demo city grew to ~14 km with two satellite towns, and all three real cities cover ~25% more area per side.',
      'Small pockets of demand now show up on the heatmap, and People / Jobs are separate half-size toggles in the dock.',
    ],
  },
  {
    version: '0.5',
    date: 'Aug 4, 2026',
    title: 'Stations & streets',
    items: [
      'Stops are infrastructure: $4k to build, upgradeable to a Shelter ($12k) or full Station ($35k) that pulls riders from further out.',
      'Starting cash rebalanced to $310k — a depot, one Sparrow minibus and a medium line, then you earn the rest.',
      'Fixed routes that looped around a whole block: near-miss street junctions are now healed in the map data.',
      'Routing tuned so a faster road is worth a modest detour, never a lap around the neighborhood.',
    ],
  },
  {
    version: '0.4',
    date: 'Aug 4, 2026',
    title: 'Realism pass',
    items: [
      'Buses come to a full stop only at real intersections; in traffic they visibly slow instead of freezing mid-block.',
      'Waiting passengers show as filling ring gauges at each stop.',
      'Stops are named after their streets ("Oak St & 3rd Ave"), and stops within a short walk act as one transfer station.',
      'Roads darken to asphalt tones at night; more defined map with road tiers, centerlines and height-tinted buildings.',
      'Routes are planned by travel time on real speed limits, with turn penalties.',
    ],
  },
  {
    version: '0.3',
    date: 'Aug 3, 2026',
    title: 'Living city',
    items: [
      'Passengers walk from their doorsteps to the stop and linger until their bus actually pulls in.',
      'Real acceleration and braking, rush-hour congestion, red lights, night windows and headlights.',
      'UI overhaul: labeled bottom dock, proper icons instead of emoji, toggleable smooth-area heatmap.',
    ],
  },
  {
    version: '0.2',
    date: 'Aug 3, 2026',
    title: 'Real cities, anywhere',
    items: [
      'Worcester, Des Moines and Madison playable on real census and street data, pre-baked for fast loads.',
      'Full offline mode with a built-in basemap — the game never needs to be online.',
      'Hosted on the web, and renamed to Intralines Bus Simulator.',
    ],
  },
  {
    version: '0.1',
    date: 'Aug 3, 2026',
    title: 'First departure',
    items: [
      'Depot, fleet, staff and finances; line editor that snaps to real streets.',
      'Census-driven ridership model (gravity + bus-vs-car choice) and 3D animated buses on a colorful, tiltable map.',
    ],
  },
];
