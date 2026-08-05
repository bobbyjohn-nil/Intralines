import { useMemo, useRef } from 'react';
import {
  busModel, depotCapacity, driversNeeded, fleetAssigned, fleetOwned, fleetTotal,
  gradeOf, useGame,
} from '../game/store';
import {
  BUSES_PER_MECHANIC, BUS_MODELS, CHARGERS_COST, DEPOT_CAPACITY,
  DEPOT_UPGRADE_COST, DWELL_SEC, FLEET_TIER_NAMES, FLEET_UPGRADE_COST_SHARE,
  LAYOVER_MIN, MAX_DEPOTS, MAX_WALK_M,
  DRIVER_WAGE_PER_HOUR, HEADWAY_CHOICES, LOAN_AMOUNT, LOAN_FEE, LOAN_PAYOFF,
  DAYS_PER_QUARTER, LOAN_INTEREST_PER_DAY, MECHANIC_WAGE_PER_DAY, nextDepotCost,
  quarterLabel, REFUEL_MIN, REFURB_COST_SHARE,
  STOP_COST, STOP_TIER_CAPACITY, STOP_TIER_NAMES,
  STOP_UPGRADE_COST, SUBSIDY_PER_RIDER, WASH_BAY_COST, WORKSHOP_COST, wearLabel,
} from '../game/constants';
import { fmtInt, fmtMoney } from './format';
import type { CityPack, FleetEntry, LineStats, LngLat } from '../game/types';
import { fastDistM } from '../game/geo';
import { StationScene } from './StationScene';

/** residents within a short walk of any of these points (centroid approx) */
export function reachPop(pack: CityPack | null, pts: LngLat[]): number {
  if (!pack || !pts.length) return 0;
  const cosLat = Math.cos((pack.meta.center[1] * Math.PI) / 180);
  let pop = 0;
  for (const bg of pack.blockGroups) {
    for (const pt of pts) {
      if (fastDistM(bg.centroid, pt, cosLat) <= MAX_WALK_M) {
        pop += bg.pop;
        break;
      }
    }
  }
  return pop;
}

/** round-trip schedule preview mirroring the sim's timetable math */
export function cyclePreview(
  pathLenM: number,
  stopCount: number,
  model: { kmh: number; tankKm: number },
): { cycleMin: number; cycleKm: number } {
  const rideMin =
    (pathLenM / 1000 / model.kmh) * 60 + Math.max(0, stopCount - 2) * (DWELL_SEC / 60);
  const cycleKm = (2 * pathLenM) / 1000;
  const refuelMin = model.tankKm > 0 ? (cycleKm / model.tankKm) * REFUEL_MIN : 0;
  return {
    cycleMin: 2 * rideMin + 2 * LAYOVER_MIN + 2 * (DWELL_SEC / 60) + refuelMin,
    cycleKm,
  };
}
import {
  BusSide, IconBank, IconClose, IconDepot, IconDownload, IconIdBadge, IconLock,
  IconPlus, IconUpload, IconWrench,
} from './icons';

export function PanelHost() {
  const panel = useGame((s) => s.panel);
  if (panel === 'none') return null;
  return (
    <div className="panel">
      {panel === 'lines' && <LinesPanel />}
      {panel === 'line-edit' && <LineEditPanel />}
      {panel === 'fleet' && <FleetPanel />}
      {panel === 'staff' && <StaffPanel />}
      {panel === 'depot' && <DepotPanel />}
      {panel === 'finance' && <FinancePanel />}
      {panel === 'report' && <ReportPanel />}
      {panel === 'station' && <StationPanel />}
      {panel === 'help' && <HelpPanel />}
      {panel === 'map-options' && <MapOptionsPanel />}
    </div>
  );
}

function MapOptionsPanel() {
  const stopLabels = useGame((s) => s.stopLabels);
  const setStopLabels = useGame((s) => s.setStopLabels);
  const basemapPref = useGame((s) => s.basemapPref);
  const basemapActive = useGame((s) => s.basemapActive);
  const toggleBasemap = useGame((s) => s.toggleBasemap);
  const trafficView = useGame((s) => s.trafficView);
  const trafficHour = useGame((s) => s.trafficHour);
  const setTrafficView = useGame((s) => s.setTrafficView);
  const setTrafficHour = useGame((s) => s.setTrafficHour);
  const pack = useGame((s) => s.pack);

  return (
    <>
      <PanelTitle title="Map options" />
      <div className="field">
        <label>
          Station names{' '}
          <small className="dim">(stops are named after their streets)</small>
        </label>
        <div className="seg">
          <button
            className={stopLabels === 'zoom' ? 'on' : ''}
            onClick={() => setStopLabels('zoom')}
            title="Show names only when zoomed right in"
          >
            Zoomed in
          </button>
          <button
            className={stopLabels === 'always' ? 'on' : ''}
            onClick={() => setStopLabels('always')}
            title="Show names whenever stops are visible"
          >
            Always
          </button>
        </div>
      </div>
      <div className="field">
        <label>
          Traffic forecast{' '}
          <small className="dim">
            {trafficView
              ? `showing ${String(trafficHour).padStart(2, '0')}:00`
              : '(color roads by congestion)'}
          </small>
        </label>
        <div className="seg">
          <button
            className={!trafficView ? 'on' : ''}
            onClick={() => setTrafficView(false)}
          >
            Off
          </button>
          <button
            className={trafficView ? 'on' : ''}
            onClick={() => setTrafficView(true)}
            title="Tint main roads by how jammed they get"
          >
            On
          </button>
        </div>
        {trafficView && (
          <>
            <input
              type="range"
              min={0}
              max={23}
              step={1}
              value={trafficHour}
              onChange={(e) => setTrafficHour(+e.target.value)}
            />
            <small className="dim">
              Slide to preview any hour — green flows, red crawls. Rush peaks around
              07–09 and 16–18; busy downtown corridors jam hardest, and strong bus
              ridership eases it.
            </small>
          </>
        )}
      </div>
      {pack?.meta.kind === 'real' && (
        <div className="field">
          <label>
            Basemap{' '}
            <small className="dim">(currently {basemapActive})</small>
          </label>
          <div className="seg">
            <button
              className={basemapPref === 'auto' ? 'on' : ''}
              onClick={() => basemapPref !== 'auto' && toggleBasemap()}
              title="Online map tiles when reachable"
            >
              Auto
            </button>
            <button
              className={basemapPref === 'offline' ? 'on' : ''}
              onClick={() => basemapPref !== 'offline' && toggleBasemap()}
              title="Built-in offline map — never phones home"
            >
              Offline
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PanelTitle({ title }: { title: string }) {
  const setPanel = useGame((s) => s.setPanel);
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <button className="icon-btn" onClick={() => setPanel('none')} title="Close">
        <IconClose size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LinesPanel() {
  const lines = useGame((s) => s.lines);
  const stats = useGame((s) => s.stats);
  const selectLine = useGame((s) => s.selectLine);
  const setTool = useGame((s) => s.setTool);
  return (
    <>
      <PanelTitle title="Bus lines" />
      {lines.length === 0 && (
        <p className="hint">
          No lines yet. Hit <b>New line</b> in the bottom bar, then click stops along
          streets to draw one.
        </p>
      )}
      <div className="list">
        {lines.map((l) => {
          const st = stats?.perLine.find((p) => p.lineId === l.id);
          return (
            <button key={l.id} className="row" onClick={() => selectLine(l.id)}>
              <span className="line-dot" style={{ background: l.color }} />
              <span className="row-main">
                <b>{l.name}</b>
                <small>
                  {l.stopIds.length} stops · {(l.pathLenM / 1000).toFixed(1)} km ·{' '}
                  {l.vehicles} {l.vehicles === 1 ? 'bus' : 'buses'}
                </small>
              </span>
              <span className="row-side">
                {st ? `${fmtInt(st.dailyBoardings)}/day` : '—'}
                <small className={st && st.dailyRevenue - st.dailyCost >= 0 ? 'good' : 'bad'}>
                  {st ? fmtMoney(st.dailyRevenue - st.dailyCost) + '/day' : ''}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <button className="btn primary with-icon" onClick={() => setTool('line-new')}>
        <IconPlus size={15} /> New line
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function LineEditPanel() {
  const id = useGame((s) => s.selectedLineId);
  const lines = useGame((s) => s.lines);
  const stats = useGame((s) => s.stats);
  const fleet = useGame((s) => s.fleet);
  const draft = useGame((s) => s.draft);
  const pack = useGame((s) => s.pack);
  const allStops = useGame((s) => s.stops);
  const updateLine = useGame((s) => s.updateLine);
  const deleteLine = useGame((s) => s.deleteLine);
  const setPanel = useGame((s) => s.setPanel);

  const line = lines.find((l) => l.id === id);
  const lineReach = useMemo(
    () =>
      reachPop(
        pack,
        (line?.stopIds ?? [])
          .map((sid) => allStops.find((x) => x.id === sid)?.pt)
          .filter((p): p is LngLat => !!p),
      ),
    [pack, line?.stopIds, allStops],
  );

  if (draft) return <DraftPanel />;
  if (!line) {
    return (
      <>
        <PanelTitle title="Line" />
        <p className="hint">Select a line on the map or in the Lines panel.</p>
      </>
    );
  }
  const st: LineStats | undefined = stats?.perLine.find((p) => p.lineId === line.id);
  const model = busModel(line.modelId);
  const freeOfModel =
    fleetOwned(fleet, line.modelId) - fleetAssigned(lines, line.modelId);
  const preview = cyclePreview(line.pathLenM, line.stopIds.length, model);
  const cycleShown = st ? st.cycleMin : preview.cycleMin;
  const refuels = st?.refuelsPerDay ?? 0;

  return (
    <>
      <PanelTitle title={line.name} />
      <div className="field-row">
        <input
          className="text-input"
          value={line.name}
          onChange={(e) => updateLine(line.id, { name: e.target.value })}
        />
        <label className="switch">
          <input
            type="checkbox"
            checked={line.active}
            onChange={(e) => updateLine(line.id, { active: e.target.checked })}
          />
          <span>{line.active ? 'Running' : 'Suspended'}</span>
        </label>
      </div>

      <div className="kv">
        <span>Route</span>
        <b>
          {line.stopIds.length} stops · {(line.pathLenM / 1000).toFixed(1)} km ·{' '}
          {Math.round(cycleShown)} min round trip
        </b>
      </div>
      <div className="kv">
        <span>Within a short walk</span>
        <b>{fmtInt(lineReach)} residents</b>
      </div>
      {refuels > 0 && (
        <p className="hint">
          Each bus burns through its {model.tankKm} km{' '}
          {model.needsCharger ? 'charge' : 'tank'} {refuels}×/day — schedules already
          include the top-up time back at the depot.
        </p>
      )}

      <div className="field">
        <label>Bus model</label>
        <div className="seg">
          {BUS_MODELS.map((m) => (
            <button
              key={m.id}
              className={line.modelId === m.id ? 'on' : ''}
              disabled={fleetOwned(fleet, m.id) === 0 && line.modelId !== m.id}
              title={`${m.name} — ${m.capacity} riders`}
              onClick={() => updateLine(line.id, { modelId: m.id, vehicles: 0 })}
            >
              {m.short}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>
          Buses on line {st && st.vehiclesNeeded > 0 && (
            <small className="dim">(need {st.vehiclesNeeded} for the timetable)</small>
          )}
        </label>
        <div className="stepper">
          <button
            onClick={() => updateLine(line.id, { vehicles: Math.max(0, line.vehicles - 1) })}
          >
            −
          </button>
          <b>{line.vehicles}</b>
          <button
            disabled={freeOfModel <= 0}
            title={freeOfModel <= 0 ? 'No unassigned buses of this model — buy more in Fleet' : ''}
            onClick={() => updateLine(line.id, { vehicles: line.vehicles + 1 })}
          >
            +
          </button>
          <span className="dim">{freeOfModel} spare {model.short.toLowerCase()}</span>
        </div>
      </div>

      <div className="field">
        <label>
          Rush-hour frequency: every {line.peakHeadwayMin ?? line.headwayMin} min{' '}
          <small className="dim">(07–09 &amp; 16–18)</small>
        </label>
        <div className="seg wrap">
          {HEADWAY_CHOICES.map((h) => (
            <button
              key={h}
              className={(line.peakHeadwayMin ?? line.headwayMin) === h ? 'on' : ''}
              onClick={() => updateLine(line.id, { peakHeadwayMin: h })}
            >
              {h}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>
          Off-peak frequency: every {line.headwayMin} min{' '}
          <small className="dim">(rest of the day)</small>
        </label>
        <div className="seg wrap">
          {HEADWAY_CHOICES.map((h) => (
            <button
              key={h}
              className={line.headwayMin === h ? 'on' : ''}
              onClick={() => updateLine(line.id, { headwayMin: h })}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>
          Service {String(line.firstHour).padStart(2, '0')}:00 –{' '}
          {String(line.lastHour).padStart(2, '0')}:00
        </label>
        <div className="range-pair">
          <input
            type="range" min={0} max={12} value={line.firstHour}
            onChange={(e) =>
              updateLine(line.id, { firstHour: Math.min(+e.target.value, line.lastHour - 1) })
            }
          />
          <input
            type="range" min={12} max={24} value={line.lastHour}
            onChange={(e) =>
              updateLine(line.id, { lastHour: Math.max(+e.target.value, line.firstHour + 1) })
            }
          />
        </div>
      </div>

      <div className="field">
        <label>
          Fare ${line.fare.toFixed(2)}{' '}
          <small className="dim">(+${SUBSIDY_PER_RIDER.toFixed(2)} city subsidy per rider)</small>
        </label>
        <input
          type="range" min={100} max={500} step={25} value={Math.round(line.fare * 100)}
          onChange={(e) => updateLine(line.id, { fare: +e.target.value / 100 })}
        />
      </div>

      <StopList lineId={line.id} stopIds={line.stopIds} />

      {st && (
        <div className="stat-grid">
          <div>
            <small>Riders</small>
            <b>{fmtInt(st.dailyBoardings)}/day</b>
          </div>
          <div>
            <small>Revenue</small>
            <b className="good">{fmtMoney(st.dailyRevenue)}</b>
          </div>
          <div>
            <small>Cost</small>
            <b className="bad">{fmtMoney(st.dailyCost)}</b>
          </div>
          <div>
            <small>· of which fuel</small>
            <b className="bad">{fmtMoney(st.dailyFuelCost ?? 0)}</b>
          </div>
          <div>
            <small>Peak load</small>
            <b className={st.peakLoadFactor > 1 ? 'bad' : ''}>
              {Math.round(st.peakLoadFactor * 100)}%
            </b>
          </div>
          <div>
            <small>Round trip</small>
            <b>{Math.round(st.cycleMin)} min</b>
          </div>
        </div>
      )}
      {st && line.vehicles < st.vehiclesNeeded && line.active && (
        <p className="warn">
          Only {st.vehiclesUsed} bus{st.vehiclesUsed === 1 ? '' : 'es'} running —
          rush-hour headway stretches to ~
          {Math.round(st.headwayEffPeakMin ?? st.headwayEffMin)} min. Assign{' '}
          {st.vehiclesNeeded} for the full timetable.
        </p>
      )}
      {st && st.peakLoadFactor > 1 && (
        <p className="warn">
          Buses run at {Math.round(st.peakLoadFactor * 100)}% of capacity at rush
          hour — riders are left at the curb and the ones aboard are miserable.
          Add buses, tighten the rush-hour headway or run bigger models.
        </p>
      )}
      {st && (st.avgDelayMin ?? 0) >= 1.5 && (
        <p className="warn">
          Running ≈{st.avgDelayMin.toFixed(1)} min behind timetable in traffic —
          riders time their arrival to the schedule, so every late minute is
          spent fuming at the stop.
        </p>
      )}

      <div className="btn-row">
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Delete ${line.name}?`)) deleteLine(line.id);
          }}
        >
          Delete line
        </button>
        <button className="btn" onClick={() => setPanel('lines')}>
          All lines
        </button>
      </div>
    </>
  );
}

/**
 * The route editor: every stop by street name, in order, with upgrade,
 * move and remove controls. Editing mode adds stops from map clicks.
 */
function StopList({ lineId, stopIds }: { lineId: string; stopIds: string[] }) {
  const stops = useGame((s) => s.stops);
  const cash = useGame((s) => s.cash);
  const tool = useGame((s) => s.tool);
  const moveStopId = useGame((s) => s.moveStopId);
  const crowdedStops = useGame((s) => s.stats?.crowdedStops);
  const upgradeStop = useGame((s) => s.upgradeStop);
  const removeStopFromLine = useGame((s) => s.removeStopFromLine);
  const requestMoveStop = useGame((s) => s.requestMoveStop);
  const setTool = useGame((s) => s.setTool);
  const editing = tool === 'route-edit';
  const crowdedById = new Map((crowdedStops ?? []).map((c) => [c.stopId, c]));
  const crowdedHere = stopIds.filter((sid) => crowdedById.has(sid)).length;

  return (
    <div className="field">
      <label>
        Route <small className="dim">(upgrades pull riders from further out)</small>
      </label>
      {crowdedHere > 0 && (
        <p className="warn">
          {crowdedHere} stop{crowdedHere === 1 ? ' is' : 's are'} overcrowded —
          riders queue past the curb, some walk away. Upgrades add capacity
          (sign {STOP_TIER_CAPACITY[1]}, shelter {STOP_TIER_CAPACITY[2]}, station{' '}
          {STOP_TIER_CAPACITY[3]} boardings/day).
        </p>
      )}
      <div className="stop-list">
        {stopIds.map((sid, i) => {
          const st = stops.find((x) => x.id === sid);
          if (!st) return null;
          const tier = st.tier ?? 1;
          const next = tier + 1;
          const cost = STOP_UPGRADE_COST[next];
          const movingThis = moveStopId === sid;
          const crowd = crowdedById.get(sid);
          return (
            <div key={sid} className={`stop-row ${movingThis ? 'moving' : ''}`}>
              <span className="stop-row-idx">{i + 1}</span>
              <span className="stop-row-name" title={st.name}>{st.name}</span>
              {crowd ? (
                <span
                  className="crowd-badge"
                  title={`≈${fmtInt(crowd.load)} boardings/day — a ${
                    STOP_TIER_NAMES[tier]?.toLowerCase() ?? 'stop'
                  } comfortably handles ${fmtInt(crowd.cap)}`}
                >
                  Crowded
                </span>
              ) : (
                <span className="dim">{STOP_TIER_NAMES[tier]}</span>
              )}
              {cost ? (
                <button
                  className="btn tiny"
                  disabled={cash < cost}
                  title={
                    cash < cost
                      ? `Need ${fmtMoney(cost)}`
                      : `Upgrade to ${STOP_TIER_NAMES[next]?.toLowerCase()}`
                  }
                  onClick={() => upgradeStop(sid)}
                >
                  {STOP_TIER_NAMES[next]} · {fmtMoney(cost)}
                </button>
              ) : (
                <span className="dim">Max</span>
              )}
              <button
                className={`btn tiny ${movingThis ? 'primary' : ''}`}
                title={
                  movingThis
                    ? 'Now click the map where this stop should go'
                    : 'Move this stop: click the map to place it'
                }
                onClick={() => requestMoveStop(movingThis ? null : sid)}
              >
                {movingThis ? 'Click map…' : 'Move'}
              </button>
              <button
                className="btn tiny danger"
                disabled={stopIds.length <= 2}
                title={
                  stopIds.length <= 2
                    ? 'A line needs at least 2 stops'
                    : 'Remove this stop from the line'
                }
                onClick={() => removeStopFromLine(lineId, sid)}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button
        className={`btn with-icon ${editing ? 'primary' : ''}`}
        onClick={() => setTool(editing ? 'select' : 'route-edit')}
      >
        <IconPlus size={14} />
        {editing ? 'Done editing route' : 'Edit route — click map to add stops'}
      </button>
    </div>
  );
}

function DraftPanel() {
  const draft = useGame((s) => s.draft)!;
  const undo = useGame((s) => s.undoDraftStop);
  const cancel = useGame((s) => s.cancelDraft);
  const finish = useGame((s) => s.finishDraft);
  const existing = useGame((s) => s.stops);
  const pack = useGame((s) => s.pack);
  const lenM = draft.legs.reduce((s, l) => s + l.lenM, 0);
  const km = lenM / 1000;
  const existingIds = new Set(existing.map((s) => s.id));
  const newCount = draft.stops.filter((s) => !existingIds.has(s.id)).length;
  const buildCost = newCount * STOP_COST;
  // schedule + reach preview while building (Sparrow as the baseline bus)
  const mini = busModel('minibus');
  const prev = cyclePreview(lenM, draft.stops.length, mini);
  const rush = Math.round(prev.cycleMin * 1.45);
  const reach = reachPop(pack, draft.stops.map((s) => s.pt));
  return (
    <>
      <PanelTitle title="Drawing new line" />
      <p className="hint">
        Click along streets to place stops. The route follows real roads between stops.
        Aim for the purple (residents) and teal (jobs) hotspots on the heatmap.
      </p>
      <div className="kv">
        <span>Stops</span>
        <b>{draft.stops.length}</b>
      </div>
      <div className="kv">
        <span>Length</span>
        <b>{km.toFixed(1)} km</b>
      </div>
      {draft.stops.length >= 2 && (
        <>
          <div className="kv">
            <span>Round trip ({mini.short})</span>
            <b>
              ~{Math.round(prev.cycleMin)} min · rush ~{rush}
            </b>
          </div>
          <div className="kv">
            <span>Within a short walk</span>
            <b>{fmtInt(reach)} residents</b>
          </div>
        </>
      )}
      <div className="kv">
        <span>Build cost</span>
        <b>{fmtMoney(buildCost)}</b>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={undo} disabled={!draft.stops.length}>
          Undo stop
        </button>
        <button className="btn danger" onClick={cancel}>
          Cancel
        </button>
      </div>
      <button className="btn primary" onClick={finish} disabled={draft.stops.length < 2}>
        Create line
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function FleetPanel() {
  const fleet = useGame((s) => s.fleet);
  const lines = useGame((s) => s.lines);
  const cash = useGame((s) => s.cash);
  const depots = useGame((s) => s.depots);
  const riders = useGame((s) => s.totalRidersServed);
  const buyBus = useGame((s) => s.buyBus);
  const sellBus = useGame((s) => s.sellBus);
  const refurbishFleet = useGame((s) => s.refurbishFleet);
  const upgradeFleetModel = useGame((s) => s.upgradeFleetModel);
  const autoHireDriver = useGame((s) => s.autoHireDriver);
  const setAutoHireDriver = useGame((s) => s.setAutoHireDriver);

  const cap = depotCapacity(depots);
  return (
    <>
      <PanelTitle title="Fleet" />
      <div className="kv">
        <span>Depot space</span>
        <b>
          {fleetTotal(fleet)} / {cap || '—'}
        </b>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={autoHireDriver}
          onChange={(e) => setAutoHireDriver(e.target.checked)}
        />
        <span>
          Hire a driver with every bus{' '}
          <small className="dim">(${DRIVER_WAGE_PER_HOUR}/h while driving)</small>
        </span>
      </label>
      {!depots.length && (
        <p className="warn">Build a depot first — use “Place depot” in the bottom bar.</p>
      )}
      <div className="list">
        {BUS_MODELS.map((m) => {
          const owned = fleetOwned(fleet, m.id);
          const assigned = fleetAssigned(lines, m.id);
          const entry = fleet.find((f) => f.modelId === m.id);
          const locked = riders < m.unlockRiders;
          const chargerBlock = m.needsCharger && !depots.some((d) => d.chargers);
          const depotFull = depots.length > 0 && fleetTotal(fleet) >= cap;
          const shortBy = m.price - cash;
          // exactly one reason shows, in the order a player can fix them
          const blocker = !depots.length
            ? 'Build a depot first.'
            : depotFull
              ? 'Depots are full — upgrade one or build another.'
              : chargerBlock
                ? 'Needs chargers — add them in the Depot panel.'
                : shortBy > 0
                  ? `Need ${fmtMoney(m.price)} — you're ${fmtMoney(shortBy)} short.`
                  : null;
          return (
            <div key={m.id} className={`card ${locked ? 'locked' : ''}`}>
              <div className="card-head">
                <span className="bus-side"><BusSide length={m.lengthFactor} /></span>
                <div>
                  <b>{m.name}</b>
                  <small>
                    {m.capacity} riders · ${m.costPerKm.toFixed(2)}/km (
                    {m.needsCharger ? 'charge' : 'gas'} ${m.fuelPerKm.toFixed(2)}) ·{' '}
                    {m.tankKm} km {m.needsCharger ? 'battery' : 'tank'} · {fmtMoney(m.price)}
                  </small>
                </div>
              </div>
              <p className="blurb">{m.blurb}</p>
              {locked ? (
                <p className="warn with-icon">
                  <IconLock size={14} /> Unlocks at {fmtInt(m.unlockRiders)} riders served
                  ({fmtInt(riders)} so far)
                </p>
              ) : (
                <>
                  <div className="btn-row">
                    <button
                      className="btn primary"
                      disabled={blocker !== null}
                      title={blocker ?? `Buy for ${fmtMoney(m.price)}`}
                      onClick={() => buyBus(m.id)}
                    >
                      Buy
                    </button>
                    <button
                      className="btn"
                      disabled={owned - assigned <= 0}
                      onClick={() => sellBus(m.id)}
                    >
                      Sell ({fmtMoney(m.price * 0.5 * (1 - (entry?.wear ?? 0) / 250))})
                    </button>
                    <span className="dim">
                      {owned} owned · {assigned} on lines
                    </span>
                  </div>
                  {blocker && <p className="blocker">{blocker}</p>}
                  {entry && <FleetCondition entry={entry} />}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** wear gauge + refurbish / mark upgrade controls for one owned model */
function FleetCondition({ entry }: { entry: FleetEntry }) {
  const cash = useGame((s) => s.cash);
  const refurbishFleet = useGame((s) => s.refurbishFleet);
  const upgradeFleetModel = useGame((s) => s.upgradeFleetModel);
  const m = busModel(entry.modelId);
  const wear = Math.round(entry.wear);
  const refurbCost = Math.max(
    1000,
    Math.round(entry.count * m.price * REFURB_COST_SHARE * (entry.wear / 100)),
  );
  const upShare = FLEET_UPGRADE_COST_SHARE[entry.tier + 1];
  const upCost = upShare ? Math.round(entry.count * m.price * upShare) : 0;
  const band = wear < 25 ? 'good' : wear < 60 ? 'mid' : 'bad';
  return (
    <div className="fleet-cond">
      <div className="wear-row">
        <span className="dim">{FLEET_TIER_NAMES[entry.tier]} · Wear</span>
        <span className="wear-bar">
          <i className={band} style={{ width: `${Math.max(wear, 2)}%` }} />
        </span>
        <b>
          {wear}% · {wearLabel(entry.wear)}
        </b>
      </div>
      <div className="btn-row">
        <button
          className="btn"
          disabled={entry.wear < 5 || cash < refurbCost}
          title={
            entry.wear < 5
              ? 'These buses are basically new.'
              : `Reset wear to 0% across all ${entry.count} ${m.short}s`
          }
          onClick={() => refurbishFleet(entry.modelId)}
        >
          <IconWrench size={13} /> Refurbish ({fmtMoney(refurbCost)})
        </button>
        {entry.tier < 3 && (
          <button
            className="btn"
            disabled={cash < upCost}
            title={`+10% seats and cheaper running costs for every ${m.short}, current and future`}
            onClick={() => upgradeFleetModel(entry.modelId)}
          >
            Upgrade to {FLEET_TIER_NAMES[entry.tier + 1]} ({fmtMoney(upCost)})
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StationPanel() {
  const stopId = useGame((s) => s.selectedStopId);
  const stops = useGame((s) => s.stops);
  const lines = useGame((s) => s.lines);
  const stats = useGame((s) => s.stats);
  const cash = useGame((s) => s.cash);
  const upgradeStop = useGame((s) => s.upgradeStop);

  const stop = stops.find((x) => x.id === stopId);
  if (!stop) {
    return (
      <>
        <PanelTitle title="Station" />
        <p className="hint">Click a stop on the map to step inside.</p>
      </>
    );
  }
  const tier = stop.tier ?? 1;
  const nextCost = STOP_UPGRADE_COST[tier + 1];
  const served = lines.filter((l) => l.stopIds.includes(stop.id));
  const crowd = stats?.crowdedStops?.find((c) => c.stopId === stop.id);
  return (
    <>
      <PanelTitle title={stop.name} />
      <StationScene key={stop.id + tier} stopId={stop.id} tier={tier} />
      <div className="kv">
        <span>Amenity</span>
        <b>{STOP_TIER_NAMES[tier]} · handles {fmtInt(STOP_TIER_CAPACITY[tier])}/day</b>
      </div>
      <div className="kv">
        <span>Lines calling here</span>
        <b>{served.length ? served.map((l) => l.name).join(', ') : 'none yet'}</b>
      </div>
      {crowd && (
        <p className="warn">
          Overcrowded — ≈{fmtInt(crowd.load)} boardings/day against a comfortable{' '}
          {fmtInt(crowd.cap)}. Upgrade it or spread the load.
        </p>
      )}
      <p className="hint">
        Riders check the timetable and reach the platform just before the bus is
        due — when traffic runs buses late, they're stuck waiting and satisfaction
        slips. Stick around: buses that call here pull up right in this view.
      </p>
      {nextCost ? (
        <button
          className="btn primary"
          disabled={cash < nextCost}
          title={cash < nextCost ? `Need ${fmtMoney(nextCost)}` : ''}
          onClick={() => upgradeStop(stop.id)}
        >
          Upgrade to {STOP_TIER_NAMES[tier + 1]} ({fmtMoney(nextCost)})
        </button>
      ) : (
        <p className="good">✓ Full station — top of the line.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ReportPanel() {
  const reports = useGame((s) => s.reports);

  if (!reports.length) {
    return (
      <>
        <PanelTitle title="Report card" />
        <p className="hint">
          The Transit Authority inspects your network at the end of every{' '}
          {DAYS_PER_QUARTER}-day quarter (4 quarters to a year) and grades network
          coverage, connectability, passenger happiness, staff happiness, safety,
          reliability and environment.
        </p>
        <p className="hint">
          Good marks earn a government grant; a failing network draws a
          non-compliance fee. Your first card arrives at the end of the quarter.
        </p>
      </>
    );
  }
  const latest = reports[reports.length - 1];
  const band = (v: number) => (v >= 70 ? 'good' : v >= 55 ? 'mid' : 'bad');
  return (
    <>
      <PanelTitle title={`${quarterLabel(latest.quarter)} report card`} />
      <div className="report-overall">
        <span className={`grade-chip ${band(latest.overall)}`}>{gradeOf(latest.overall)}</span>
        <div>
          <b>Overall — {Math.round(latest.overall)}/100</b>
          <small className="dim">
            {latest.payout > 0
              ? `Transit Authority grant: ${fmtMoney(latest.payout)}`
              : latest.payout < 0
                ? `Non-compliance fee: ${fmtMoney(-latest.payout)}`
                : 'No grant this quarter — reach a C overall for funding.'}
          </small>
        </div>
      </div>
      <div className="list">
        {latest.scores.map((sc) => (
          <div key={sc.key} className="report-row">
            <span className="report-label">{sc.label}</span>
            <span className="score-bar">
              <i className={band(sc.score)} style={{ width: `${Math.max(sc.score, 2)}%` }} />
            </span>
            <b className={`grade-sm ${band(sc.score)}`}>{gradeOf(sc.score)}</b>
          </div>
        ))}
      </div>
      {reports.length > 1 && (
        <>
          <p className="dim report-history-title">Past quarters</p>
          {[...reports.slice(0, -1)].reverse().map((r) => (
            <div key={r.quarter} className="kv">
              <span>
                {quarterLabel(r.quarter)} — {gradeOf(r.overall)} ({Math.round(r.overall)}/100)
              </span>
              <b className={r.payout < 0 ? 'bad' : r.payout > 0 ? 'good' : ''}>
                {r.payout > 0
                  ? `+${fmtMoney(r.payout)}`
                  : r.payout < 0
                    ? `−${fmtMoney(-r.payout)}`
                    : '—'}
              </b>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function StaffPanel() {
  const staff = useGame((s) => s.staff);
  const lines = useGame((s) => s.lines);
  const fleet = useGame((s) => s.fleet);
  const hire = useGame((s) => s.hire);
  const fire = useGame((s) => s.fire);

  const needDrivers = driversNeeded(lines);
  const needMech = Math.ceil(fleetTotal(fleet) / BUSES_PER_MECHANIC);

  return (
    <>
      <PanelTitle title="Staff" />
      <div className="card">
        <div className="card-head">
          <span className="bus-side"><IconIdBadge size={30} /></span>
          <div>
            <b>Drivers</b>
            <small>${DRIVER_WAGE_PER_HOUR}/h while their bus is in service</small>
          </div>
        </div>
        <div className="stepper">
          <button onClick={() => fire('drivers')}>−</button>
          <b>{staff.drivers}</b>
          <button onClick={() => hire('drivers')}>+</button>
          <span className={staff.drivers < needDrivers ? 'bad' : 'dim'}>
            need {needDrivers}
          </span>
        </div>
        {staff.drivers < needDrivers && (
          <p className="warn">Not enough drivers — some buses stay parked.</p>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <span className="bus-side"><IconWrench size={28} /></span>
          <div>
            <b>Mechanics</b>
            <small>
              ${MECHANIC_WAGE_PER_DAY}/day · one keeps {BUSES_PER_MECHANIC} buses healthy
            </small>
          </div>
        </div>
        <div className="stepper">
          <button onClick={() => fire('mechanics')}>−</button>
          <b>{staff.mechanics}</b>
          <button onClick={() => hire('mechanics')}>+</button>
          <span className={staff.mechanics < needMech ? 'bad' : 'dim'}>need {needMech}</span>
        </div>
        {staff.mechanics < needMech && (
          <p className="warn">Short on mechanics — running costs +40%.</p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const DEPOT_ADDONS: {
  key: 'workshop' | 'washBay' | 'chargers';
  label: string;
  desc: string;
  cost: number;
}[] = [
  { key: 'workshop', label: 'Workshop', desc: '−25% running costs', cost: WORKSHOP_COST },
  { key: 'washBay', label: 'Wash bay', desc: '+satisfaction', cost: WASH_BAY_COST },
  { key: 'chargers', label: 'Chargers', desc: 'enables electric buses', cost: CHARGERS_COST },
];

function DepotPanel() {
  const depots = useGame((s) => s.depots);
  const fleet = useGame((s) => s.fleet);
  const cash = useGame((s) => s.cash);
  const tool = useGame((s) => s.tool);
  const setTool = useGame((s) => s.setTool);
  const upgradeDepot = useGame((s) => s.upgradeDepot);
  const renameDepot = useGame((s) => s.renameDepot);
  const buyDepotAddon = useGame((s) => s.buyDepotAddon);
  const saveGame = useGame((s) => s.saveGame);

  if (!depots.length) {
    return (
      <>
        <PanelTitle title="Depot" />
        <p className="hint">
          Your company needs a home base. Zoning only allows depots on industrial
          land — workplace-heavy, low-density areas like the industrial park or out
          by the airport. Every bus starts and ends its day here.
        </p>
        <button className="btn primary with-icon" onClick={() => setTool('depot-place')}>
          <IconDepot size={15} /> Place depot ({fmtMoney(nextDepotCost(0))})
        </button>
      </>
    );
  }
  return (
    <>
      <PanelTitle title={depots.length === 1 ? 'Depot' : 'Depots'} />
      <div className="kv">
        <span>Bus capacity</span>
        <b>
          {fleetTotal(fleet)} / {depotCapacity(depots)}
        </b>
      </div>
      {depots.length > 1 && (
        <p className="hint">
          Each bus is garaged at the closest depot to its line that still has room —
          when one fills up, the overflow parks at the next-nearest.
        </p>
      )}
      <div className="list">
        {depots.map((d) => {
          const nextCost = DEPOT_UPGRADE_COST[d.level + 1];
          return (
            <div key={d.id} className="card">
              <input
                className="depot-name-input"
                value={d.name}
                maxLength={28}
                aria-label="Depot name"
                onChange={(e) => renameDepot(d.id, e.target.value)}
                onBlur={() => saveGame()}
              />
              <small>
                Level {d.level} · {DEPOT_CAPACITY[d.level]} bus spaces
              </small>
              {d.level < 3 && (
                <button
                  className="btn primary"
                  disabled={cash < nextCost}
                  title={
                    cash < nextCost
                      ? `Need ${fmtMoney(nextCost)} — you're ${fmtMoney(nextCost - cash)} short.`
                      : ''
                  }
                  onClick={() => upgradeDepot(d.id)}
                >
                  Upgrade to level {d.level + 1} ({fmtMoney(nextCost)}) →{' '}
                  {DEPOT_CAPACITY[d.level + 1]} buses
                </button>
              )}
              {DEPOT_ADDONS.map((a) => (
                <div key={a.key} className="addon-row">
                  <span>
                    <b>{a.label}</b> <small className="dim">{a.desc}</small>
                  </span>
                  {d[a.key] ? (
                    <span className="good">✓ Built</span>
                  ) : (
                    <button
                      className="btn"
                      disabled={cash < a.cost}
                      onClick={() => buyDepotAddon(d.id, a.key)}
                    >
                      Build ({fmtMoney(a.cost)})
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {depots.length >= MAX_DEPOTS ? (
        <p className="hint">
          City planning caps you at {MAX_DEPOTS} depots — upgrade one for more parking.
        </p>
      ) : (
        (() => {
          const cost = nextDepotCost(depots.length);
          return (
            <button
              className={`btn with-icon ${tool === 'depot-place' ? 'primary' : ''}`}
              disabled={cash < cost}
              title={
                cash < cost
                  ? `Need ${fmtMoney(cost)} — you're ${fmtMoney(cost - cash)} short.`
                  : 'Land gets pricier with every depot. Click the map where it should go.'
              }
              onClick={() => setTool('depot-place')}
            >
              <IconDepot size={15} />{' '}
              {tool === 'depot-place'
                ? 'Click the map to place it…'
                : `Build another depot (${fmtMoney(cost)})`}
            </button>
          );
        })()
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function FinancePanel() {
  const cash = useGame((s) => s.cash);
  const stats = useGame((s) => s.stats);
  const loanTaken = useGame((s) => s.loanTaken);
  const takeLoan = useGame((s) => s.takeLoan);
  const repayLoan = useGame((s) => s.repayLoan);
  const exportSave = useGame((s) => s.exportSave);
  const importSave = useGame((s) => s.importSave);
  const notify = useGame((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);

  const rev = stats?.perLine.reduce((s, p) => s + p.dailyRevenue, 0) ?? 0;
  const cost = stats?.perLine.reduce((s, p) => s + p.dailyCost, 0) ?? 0;
  const fuel = stats?.perLine.reduce((s, p) => s + (p.dailyFuelCost ?? 0), 0) ?? 0;

  return (
    <>
      <PanelTitle title="Finances" />
      <div className="stat-grid">
        <div>
          <small>Cash</small>
          <b className={cash < 0 ? 'bad' : ''}>{fmtMoney(cash)}</b>
        </div>
        <div>
          <small>Fares + subsidy</small>
          <b className="good">{fmtMoney(rev)}/day</b>
        </div>
        <div>
          <small>Line costs</small>
          <b className="bad">{fmtMoney(cost)}/day</b>
        </div>
        <div>
          <small>· of which fuel</small>
          <b className="bad">{fmtMoney(fuel)}/day</b>
        </div>
        <div>
          <small>Line profit</small>
          <b className={rev - cost >= 0 ? 'good' : 'bad'}>{fmtMoney(rev - cost)}/day</b>
        </div>
      </div>
      <p className="hint">
        Fuel is pumped at your depots — every kilometre a bus drives burns gas
        (or charge) paid from company cash.
      </p>
      <p className="hint">
        Fixed costs (depot upkeep, mechanics, office, loan interest) are charged on top,
        spread over the day.
      </p>
      <div className="loan-box">
        <b>Talon &amp; Grasp Savings</b>
        {!loanTaken ? (
          <>
            <p className="hint">
              The only bank that returns your calls. {fmtMoney(LOAN_AMOUNT)} minus a{' '}
              {fmtMoney(LOAN_FEE)} &ldquo;arrangement fee&rdquo;, at{' '}
              {fmtMoney(LOAN_INTEREST_PER_DAY)} a day — forever. The debt never
              shrinks; they'll release you for {fmtMoney(LOAN_PAYOFF)}.
            </p>
            <button className="btn danger with-icon" onClick={takeLoan}>
              <IconBank size={15} /> Sign with Talon &amp; Grasp (+{fmtMoney(LOAN_AMOUNT - LOAN_FEE)})
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              You owe them {fmtMoney(LOAN_INTEREST_PER_DAY)} every day, in perpetuity.
              They send a fruit basket each quarter. It is always slightly rotten.
            </p>
            <button
              className="btn with-icon"
              disabled={cash < LOAN_PAYOFF}
              title={cash < LOAN_PAYOFF ? `Need ${fmtMoney(LOAN_PAYOFF)}` : ''}
              onClick={repayLoan}
            >
              <IconBank size={15} /> Buy your freedom ({fmtMoney(LOAN_PAYOFF)})
            </button>
          </>
        )}
      </div>
      <div className="btn-row">
        <button
          className="btn with-icon"
          onClick={() => {
            const blob = new Blob([exportSave()], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'intralines-save.json';
            a.click();
          }}
        >
          <IconDownload size={15} /> Export save
        </button>
        <button className="btn with-icon" onClick={() => fileRef.current?.click()}>
          <IconUpload size={15} /> Import save
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const ok = importSave(await f.text());
            notify(
              ok
                ? 'Save imported — reopen the city from the menu to load it.'
                : 'That file is not a valid save.',
              ok ? 'good' : 'bad',
            );
          }}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function HelpPanel() {
  return (
    <>
      <PanelTitle title="How to play" />
      <ol className="help-list">
        <li>
          <b>Place your depot.</b> It's home base for every bus — hit the pulsing
          <b> Place depot</b> button in the bottom bar, then click industrial land
          near a road (zoning bars depots from residential and dense downtown areas).
        </li>
        <li>
          <b>Buy buses</b> in the Fleet panel and <b>hire drivers</b> in Staff (one per bus).
        </li>
        <li>
          <b>Draw a line</b> with <b>New line</b>: click stops along streets — the route snaps
          to roads. Use the <b>Heatmap</b>: purple shows where people live, teal where they
          work. Connect the two!
        </li>
        <li>
          <b>Assign buses</b> to the line and tune frequency, hours and fare.
        </li>
        <li>
          <b>Watch the money.</b> Riders appear from real commuting patterns; profitable lines
          fund expansion. Unlock bigger buses as total ridership grows.
        </li>
      </ol>
      <p className="hint">
        Tilt the map (right-drag or two fingers) to see 3D buildings and your buses driving.
        Space pauses; 1/2/3 set game speed. Watch for rush-hour traffic slowing your fleet
        around 8:00 and 17:00.
      </p>
    </>
  );
}
