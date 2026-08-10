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
    version: '1.14',
    date: 'Aug 5, 2026',
    title: 'Arterials take the strain',
    items: [
      'Traffic got real: congestion now follows road class — commuters funnel onto arterials and highways, which crawl at rush hour (worst downtown), while local side streets stay passable even in the core. Bus corridors, the traffic forecast overlay and your running times all use the new model, so routing around the arterials is now a genuine strategy.',
      'Buffer time: every line has a per-stop schedule padding setting (0–45s). Padding slows the timetable slightly but soaks up traffic delays — the punctuality fix for lines that run chronically late.',
      'Placing a depot now tints every zone where zoning will approve it in green, so you can see the industrial land before you click.',
      'The line editor slimmed down: rush/off-peak/buffer and service hours are compact dropdowns now, the line’s stops show their names on the map while you edit, and hovering a stop in the list lights it up on the map.',
      'Station view runs on game time: the bus pull-in animation matches your speed setting, freezes on pause, and the platform crowd (and its counter) clears the moment the bus pulls away.',
    ],
  },
  {
    version: '1.13',
    date: 'Aug 5, 2026',
    title: 'Step inside the station',
    items: [
      'Click any stop to step inside it: a live 3D view of the platform with the actual tier of furniture (pole sign → glass shelter → canopied station) and a crowd that grows and shrinks with the real waiting count. Keep the tab open and buses that call there pull up in the view — doors open, riders swap, doors close, and it drives off.',
      'Punctual passengers: riders now check the timetable and reach the stop just before the bus is due. When traffic runs buses behind schedule, they stand there waiting — satisfaction drops, the line panel warns how many minutes late you run, and beating congestion (or adding buses) becomes a real lever.',
      'Company liveries: every bus now wears your brand color with a full-length stripe in its line color, and each model got its own look — the stubby Sparrow, the Goliath with a proper accordion joint, and the Volt-E with a roof battery pack and a green nose flash.',
      'The station panel also shows amenity capacity, the lines calling there, an overcrowding warning and a one-click upgrade.',
    ],
  },
  {
    version: '1.12',
    date: 'Aug 5, 2026',
    title: 'Planes, trains and paperwork',
    items: [
      'Airport and regional rail demand: cities now have an airport and rail stations (marked on the map) whose flyers and train riders want bus connections — serve them and they ride. Two new layers in the demand dropdown show where they are; real cities pull theirs from OpenStreetMap, and Riverton grew a Regional Airport plus Union, Eastville and Weston stations.',
      'Found your company: starting in a new city now opens with naming your transit company and picking its brand color — your first line wears it, and the company name sits in the top bar and on your saves.',
      'Zoning laws arrived: depots can only be built on industrial land (workplace-heavy, low-density) — no more bus garages in residential neighborhoods or the dense downtown core. Existing depots are grandfathered in.',
      'Quarters are now 10 days long, so report cards and grants come around faster.',
      'Depot names on the map only show while the Depot panel is open, and night roads are brighter — halfway between the old daytime look and full asphalt-dark — so the grid stays readable after sunset.',
    ],
  },
  {
    version: '1.11',
    date: 'Aug 5, 2026',
    title: 'Never a blank page',
    items: [
      'A loading splash appears the instant the page opens, so a broken start can never be a silent white screen — if the game fails to boot you now always get either the splash or, within a few seconds, the recovery panel with Reload and Clear-map-cache buttons.',
      'New hosting check at /status.html — if that page loads but the game doesn’t, the problem is in your browser cache, not the server.',
      'Note: the game’s address is https://bobbyjohn-nil.github.io/Intralines/ — update old bookmarks.',
    ],
  },
  {
    version: '1.10',
    date: 'Aug 5, 2026',
    title: 'Standing room only',
    items: [
      'Stations can overcrowd: every stop tier has a comfortable daily capacity (sign stop 250, shelter 700, station 1,600 boardings). Push past it and riders queue off the curb — some walk away, satisfaction sinks, and the route editor flags each offender with a red "Crowded" badge and its actual load. Upgrading the stop is the fix.',
      'Bus overcrowding bites harder: crush-loaded rush services now shed noticeably more would-be riders, and the line panel spells out how far over capacity you are and what to do about it.',
      "You'll get a notice the moment any stop tips into overcrowding.",
    ],
  },
  {
    version: '1.9',
    date: 'Aug 5, 2026',
    title: 'Timetables, gas and gridlock',
    items: [
      'Buses burn fuel: every model has a gas (or charge) price per km and a tank range, paid from company cash and pumped at your depots. The Finance panel and each line now itemize the fuel bill, worn engines guzzle more, and buses that outrun their tank lose top-up time back at the depot — the line panel tells you how often.',
      'Time-of-day timetables: every line has separate rush-hour (07–09, 16–18) and off-peak frequencies. The sim staffs, costs and schedules each hour on its own — run tight peaks and thin quiet hours, and watch buses actually return to the depot mid-day.',
      'Traffic forecast map: a new toggle in Map options tints main roads green-to-red by congestion at any hour you pick with a slider — busy downtown corridors jam hardest, and strong bus ridership visibly eases the reds.',
      "Plan while you draw: the line-drawing bar and panel now show the round trip time, rush-hour estimate and how many residents live within a short walk of your stops — before you spend a dollar. The line editor shows the same reach number for existing routes.",
      'The calendar now spells itself out — "Year 1 · Quarter 2 · Day 7" in the top bar, saves list and report cards.',
    ],
  },
  {
    version: '1.8',
    date: 'Aug 5, 2026',
    title: 'A new calendar',
    items: [
      'The game now runs on a proper transit calendar: 16-day quarters, 4 quarters to a year. The clock reads "Y1 Q2 · D7 06:04", saves show the same format, and report cards are labeled by year and quarter ("Y2 Q3 report card").',
      'Weeks are gone, so Talon & Grasp bill daily now: $2.3k of interest every day, forever — the same drain as before, just on the new calendar. The rotten quarterly fruit basket survives the transition.',
      'Existing saves carry over — the clock simply re-reads your elapsed time in the new calendar.',
    ],
  },
  {
    version: '1.7',
    date: 'Aug 5, 2026',
    title: 'Full house',
    items: [
      "Depot parking is now a real constraint for deadheads: every bus is garaged at the closest depot to its line that still has a free space, and once a depot fills up the overflow parks at the next-nearest — you'll see each bus pull out from and drive home to its own garage.",
      'Depot land gets pricier the more you own: $150k for the first, then $225k, $340k, $505k and $760k for the fifth.',
    ],
  },
  {
    version: '1.6',
    date: 'Aug 5, 2026',
    title: 'Under new scrutiny',
    items: [
      'Quarterly report cards: every 4 weeks the Transit Authority grades your network on coverage, connectability, passenger happiness, staff happiness, safety, reliability and environment. Good marks earn a grant, a failing network pays a non-compliance fee — see the new Report button in the dock.',
      'Buses wear out: every model group has a wear rating that climbs while buses are in service (faster without enough mechanics, slower with a workshop). Worn buses cost more per km, drag your safety grade and fetch less when sold — refurbish them in the Fleet panel.',
      'Bus upgrades: upgrade a model line to Mk II and Mk III for roughly 10–20% more seats and cheaper running costs, applied to every bus of that model you own or buy later.',
      'New Fleet setting: "Hire a driver with every bus" automatically staffs each purchase so new buses never sit idle waiting for a driver.',
    ],
  },
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
