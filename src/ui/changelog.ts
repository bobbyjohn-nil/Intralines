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
    version: '1.18',
    date: 'Aug 10, 2026',
    title: 'A proper bus, and updates that behave',
    items: [
      'The bus in the logo (and on the founding screen, the loading screen and every model in the Fleet list) is an actual bus now instead of a boxy tram car: raked windscreen, window band with pillars, a passenger door, headlight and wheels tucked into arches. Articulated models show their concertina joint and third axle, and the minibus is properly stubby.',
      'Traffic now runs on real numbers where they exist. While a city is built, the game pulls published AADT — the average number of vehicles a road carries per day, counted by highway agencies — and bakes it into the city. Congestion is weighted by what those corridors actually carry instead of a guess from road class and density. Because it is baked in, it works with the network unplugged, forever; Map options tells you whether the city you are in has measured counts or a modeled estimate.',
      'The loading screen wears the same bus as everything else now, and hands over to the menu properly: the bus sits in the middle with its engine turning over — a shake as it catches, a puff of exhaust, an idle — then pulls away slowly, gathering speed as it tows the loading screen off the side. While it waits, the line underneath reports from the depot: loading passengers, performing safety checks, setting the destination blinds. The tab icon is the same bus, drawn as a plain outline. Once per visit, and the whole thing sits out if your system asks for reduced motion.',
      'The bottom bar is down from thirteen buttons to seven. Every demand layer, the traffic forecast and the map options now live under one Map menu, and Depot, Finance, Report cards and Help sit under Company — the things you touch constantly (Select, New line, Lines, Fleet, Staff) stay one click away.',
      'Timetables come in two flavors. Normal: say how many buses go out at rush hour and off-peak, and the game tells you the frequency that buys. Advanced: promise a frequency across four windows of the day — AM rush, midday, PM rush, early and evening — tuned to the half minute between 10 and 15, and the game works out how many buses it takes and warns you if the line has not got them. Switching modes carries your timetable across rather than resetting it.',
      'Express lines. Build a route at least 5 km long whose stops average 1.2 km apart and it runs as an express: riders prefer the limited-stop trip by more than the minutes it saves, they mind a fare rise half as much, and the city pays 50% more subsidy on every rider. The line editor shows the badge — or tells you exactly how far off you are.',
      'Fares finally matter. $2.25 is what riders expect to pay; charge more and some of them drive instead, charge less and you pull people out of their cars. The default fare behaves exactly as it always did, so nothing you have already built changes underfoot.',
      'Buses on the map wear passenger doors — two on the Metro 40, the Goliath and the Volt-E, one behind the cab on the Sparrow, one on the lower deck of the Skyline. In the station viewer the door that slides open is now the door painted on the bus.',
      'The Sparrow looks like the cutaway van it is: the passenger box is now clearly wider than the cab and engine up front, with the box front standing proud of the cab roof. The old proportions were realistic but the map’s camera flattened them out, so it just read as one long slab.',
      'Updates no longer break your game. Every build is stamped, and a tab that has been open across a new release now notices, saves your company, and reloads onto the new version cleanly — automatically if you are sitting on the menu, or on your say-so from a small banner while you are playing.',
      'Updates are now handled by a service worker, which is the reliable version of everything below it: it keeps one release’s page and its files together as a set, so your browser can no longer assemble a half-and-half game out of the old page and the new code. That was the actual cause of the blank screens. A new release is picked up on your next visit, the old one is deleted, and — because the files are now genuinely on your machine — the game opens with no internet at all.',
      'If anything ever does go wrong at startup, the recovery screen’s “Clear caches & reload” now clears the service worker too, so a bad release can never trap you on it.',
      'The page itself no longer goes stale. It used to name the exact game files it needed, so a copy your browser had kept from an earlier release asked for files that release had deleted — the blank screen everyone kept hitting after an update. The page now looks up the current files when it opens, so a cached copy of any age still starts the version that is live. If that lookup fails (offline, or the desktop app) it falls back to the files it shipped with.',
      'If a reload still lands on a stale cached page, the game now forces a genuinely fresh copy from the server rather than reloading into the same broken state, and tidies the address bar afterwards.',
      'Your saves survive updates. Saves written by older versions load properly instead of quietly starting you over, and a save from a NEWER version is never overwritten by an older tab — the game tells you to reload and leaves it untouched. Anything unreadable is kept as a backup copy instead of being lost.',
      'City data left behind by an older version is now cleared out instead of sitting in browser storage forever, which is what used to fill up storage and make saving fail after a few updates. Checking which cities are downloaded is also much faster on the home screen.',
      'The 3D buses driving the map got the same makeover as the logo: window bays with pillars instead of one long glass strip, a raked windshield, an amber destination blind over the nose, a grille, bumpers and wing mirrors — and the double-decker grew pillared windows on both floors plus upper-deck front glass.',
      'Belt and braces for updates: the game files from the last several releases now stay hosted alongside the new ones, so even a page that dodges every other safeguard still finds the files it asks for.',
    ],
  },
  {
    version: '1.17',
    date: 'Aug 10, 2026',
    title: 'Sandbox keys to the city',
    items: [
      'Sandbox mode: tick the box when founding a company and the treasury reads ∞ forever — buy anything, run everything, and the bills never bite. Report cards still arrive, so the government still has opinions. Sandbox saves are marked in the save list.',
      'Entering a city now starts the game paused, so you can look around and plan before the clock (and the wages) start running. Press ▶ or Space when ready.',
      'Interchanges and Transfer Hubs are now real buildings in the station view: a terminal hall with a glass front, columns, a lit name board — and marked bays that buses actually swing into, load, and pull out of. Other lines calling there idle in the side bays, and the Transfer Hub gets a clock tower.',
      'Buses now always face the way they are driving — return-leg buses used to drive tail-first down the wrong side of the road. Station-view bus visits also run at their intended pace again instead of flashing past.',
      'All confirmations are the game’s own dialogs now — no more gray browser popups for deleting lines, saves, or resetting data. Esc cancels, Enter confirms.',
      'The line editor grew a ‹ back button to return to the full line list, Harbor Mutual’s window turned a trustworthy blue, and the runaway skyscraper in Des Moines has been brought back down to earth (building heights are now clamped to plausible).',
    ],
  },
  {
    version: '1.16',
    date: 'Aug 10, 2026',
    title: 'When things go wrong, you’ll know',
    items: [
      'A proper error message system: anything that breaks — the game, the map, the passenger simulation, saving, city downloads — now pops a readable red toast explaining what happened in plain language, with the technical details one click away. A small ⚠ badge keeps a session error log you can copy when reporting a problem.',
      'If the interface ever crashes outright, you get a recovery screen with Reload, Clear-cache and Copy-error buttons instead of a frozen or blank page. Your save is never touched.',
      '“Clear map cache” now actually clears the map cache. It used to fire the delete and reload before the browser finished (or even started) it — the cache survived every time. All clear buttons (recovery screen, Settings, the reset in the danger zone) now wait for the wipe to finish and are verified to leave zero cached data behind.',
      'Storage-full save failures are no longer silent: the game tells you saving stopped working and what to do about it.',
      'The bus emoji is gone from the browser tab — replaced with a proper little drawn bus icon (the loading screen matches).',
    ],
  },
  {
    version: '1.15',
    date: 'Aug 10, 2026',
    title: 'Good credit, mixed fleets',
    items: [
      'Your company now has a credit score (300–850) built from cash, profitability, report cards, fleet condition and your banking history. The Finance tab shows it — and Harbor Mutual, a reputable bank, offers smaller, cheaper loans sized to your score. Keep borrowing from Talon Capital and your score pays for it.',
      'Mixed fleets: a line can now run several bus models at once. The line editor lists every unlocked model with its own +/- stepper — mix a couple of Sparrows in with your Metros; the slowest model sets the timetable and the sim blends capacity, fuel and running costs per bus.',
      'New bus: the Skyline Double-Decker — 130 riders on two floors, unlocks at 40,000 daily riders. And the Sparrow got a proper Ford-style cutaway-van body: van cab, box on the back.',
      'Busy interchanges: a stop served by 3+ lines can now upgrade to a Tier 4 Interchange, and 5+ lines unlocks the Transfer Hub — the summit of bus infrastructure — with big capacity jumps and quick 2-minute transfers between lines.',
      'The waiting-passenger counter is now a slim ring wrapped around the stop dot itself — it fills and shifts green → amber → red as the crowd builds, instead of a bubble floating over the map.',
      'Station view polish: buses in the platform scene use the same clean liveried models as the map, and the waiting crowd stands naturally — scattered, turned every which way, all sizes.',
    ],
  },
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
