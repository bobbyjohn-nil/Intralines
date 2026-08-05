/**
 * Release notes shown on the home screen's Changelog tab (newest first).
 *
 * Versioning convention: ONE entry per working session, added when the
 * session's changes ship. Bump the version, date it, give the session a
 * short title and summarize everything that landed. The newest entry's
 * version is displayed as the game version on the home screen.
 */
export interface LogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: LogEntry[] = [
  {
    version: '1.5',
    date: 'Aug 5, 2026',
    title: 'Room to grow',
    items: [
      'Build up to five depots ($150k each). Every depot is named after its street and you can rename it any time in the Depots panel — the name shows on the map under its marker.',
      "Buses now pull out from whichever depot is closest to their line's first stop, and drive home to it after the last run — a garage on each side of town means shorter deadheads.",
      'Each depot has its own level and add-ons: fleet parking is the total across all depots, and upgrades, workshops, wash bays and chargers are bought per depot.',
      'Old saves migrate automatically — your existing depot picks up a street name.',
      'Startup safety net: if an update leaves a stale cached page, the game reloads itself once — and instead of a blank white screen you get a readable error panel with Reload and Clear-map-cache buttons.',
    ],
  },
  {
    version: '1.4',
    date: 'Aug 4, 2026',
    title: 'City limits',
    items: [
      'The world beyond your city is greyed out with a dashed boundary around the playable area — no more wandering across an endless unplayable map in online mode, and the camera stays near the city.',
      'The demo city grew real streets out to its full census extent, so Eastville and Weston are actually reachable by road now.',
    ],
  },
  {
    version: '1.3',
    date: 'Aug 4, 2026',
    title: 'Who rides, who drives',
    items: [
      'New "Travel modes" demand view: every neighborhood dot blends the four mode colors in proportion to how its commuters actually get around — slate for driving, green for the bus, blue for walking, amber for biking — straight from the mode-choice model. Build better service and watch neighborhoods shade green.',
      'Click any demand dot to inspect it: residents, jobs (with education and tourism slices), density, and a full travel-mode breakdown with percentage bars.',
      'Ridership eases traffic: bus riders who would have driven are off the road, so corridors with strong ridership see visibly lighter rush hours (and the rush-hour indicator reflects it citywide).',
      'Opposing buses no longer drive through each other — the keep-right offset now scales with how large buses are drawn, so they visibly pass in their own lanes at any zoom.',
      'Demand dots draw above the roads now — lightly translucent so the streets still show through, with the same rigid outline.',
    ],
  },
  {
    version: '1.2',
    date: 'Aug 4, 2026',
    title: 'Demand you can count',
    items: [
      'Demand layers redrawn as crisp translucent dots with sharp outlines — no more fuzzy heat blobs. Dot size scales with demand but never below a clearly visible floor, so a small town or lone pocket outside the city limits reads just as clearly as downtown.',
    ],
  },
  {
    version: '1.1',
    date: 'Aug 4, 2026',
    title: 'Rules of the road',
    items: [
      "Bus stops can't be placed on motorways or trunk highways anymore — the game tells you to pick a regular street (applies to new lines, route edits and stop moves).",
      'Buses keep to the right-hand side of the road in their direction of travel, so opposing buses pass each other instead of driving down the centerline.',
      'Chunkier, more detailed roads — widths up roughly 40% at street-level zooms with center-line markings on more road tiers, landing between the old look and City Bus Manager. Cities also open a step more zoomed-in, and buses are a touch larger.',
    ],
  },
  {
    version: '1.0',
    date: 'Aug 4, 2026',
    title: 'Route surgery',
    items: [
      'Routes are editable after creation: open a line and hit "Edit route" — click the map to add stops ($4k for brand-new ones, free to reuse existing), and every stop is listed in order by street name with Move (click the map to relocate) and Remove buttons. Orphaned stops are demolished for half their investment back.',
      'Buses are glued to the road: positions use true map projection (they used to drift a few meters off their line near the city edges), and schedules run on a traffic-adjusted clock so rush hour slows buses smoothly instead of teleporting them.',
      'Two new demand layers with real data: Tourism (venues, hotels, restaurants) and Education (schools, campuses), picked from a dropdown next to the bigger Residents/Work toggles — with a note that they can overlap the other layers.',
      'Work demand no longer glows across residential neighborhoods, and the heatmap is tighter and translucent: defined cores, not one washed-out blob.',
      'Routes stop cutting through alleys and parking aprons.',
    ],
  },
  {
    version: '0.5',
    date: 'Aug 4, 2026',
    title: 'A proper front door',
    items: [
      'Home screen rebuilt Subway Builder-style: big menu strips you tab into — Play, Saves, Settings and Changelog — with the credits pinned to the bottom.',
      'Saves page lists every company with its in-game clock, cash and fleet, plus per-save continue / export / delete and save-file import.',
      'Settings collects the basemap preference, per-city downloaded-data management and a full reset.',
      'Station names appear on the map when zoomed right in, or everywhere via the new Map options menu in the dock.',
    ],
  },
  {
    version: '0.4',
    date: 'Aug 4, 2026',
    title: 'A tougher city',
    items: [
      'Loans got predatory: Talon & Grasp Savings skims a $50k fee, charges $16k a week forever, and only lets you go for $750k.',
      'Buses drive from the depot to their first stop before service and drive home after the last run — no more teleporting into service.',
      'Traffic knows where it is: downtown main roads near-standstill at rush hour, country lanes clear all day.',
      'Bigger maps: the demo city grew to ~14 km with two satellite towns; all three real cities cover ~25% more area.',
      'Stops cost money ($4k) and upgrade into Shelters and Stations that pull riders from further out; starting cash rebalanced to $310k — one depot, one Sparrow, one medium line.',
    ],
  },
  {
    version: '0.3',
    date: 'Aug 4, 2026',
    title: 'Realism pass',
    items: [
      'Buses stop fully only at real intersections; in traffic they slow down instead of freezing mid-block, with real acceleration everywhere.',
      'Waiting passengers show as filling ring gauges; stops are named after their streets; nearby stops act as one transfer station.',
      'Roads darken at night; more defined map with road tiers, centerlines and height-tinted buildings.',
      'Routes are planned by travel time with turn penalties, near-miss junctions heal, and block-loop detours are gone.',
    ],
  },
  {
    version: '0.2',
    date: 'Aug 3, 2026',
    title: 'Living city',
    items: [
      'Passengers walk from their doorsteps, linger at the stop and board when the bus actually pulls in; buses accelerate, brake, queue at lights and get stuck in rush-hour traffic.',
      'Night comes with glowing windows and headlights.',
      'UI overhaul: labeled bottom dock, proper icons instead of emoji, toggleable smooth-area demand heatmap.',
    ],
  },
  {
    version: '0.1',
    date: 'Aug 3, 2026',
    title: 'First departure',
    items: [
      'Depot, fleet, staff and finances; line editor that snaps to real streets; census-driven ridership model and 3D animated buses on a colorful, tiltable map.',
      'Worcester, Des Moines and Madison playable on real census + street data, with full offline mode and web hosting.',
      'Named Intralines Bus Simulator.',
    ],
  },
];
