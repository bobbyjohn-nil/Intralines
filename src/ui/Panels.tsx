import { useRef } from 'react';
import {
  busModel, driversNeeded, fleetAssigned, fleetOwned, fleetTotal, useGame,
} from '../game/store';
import {
  BUSES_PER_MECHANIC, BUS_MODELS, CHARGERS_COST, DEPOT_CAPACITY, DEPOT_UPGRADE_COST,
  DRIVER_WAGE_PER_HOUR, HEADWAY_CHOICES, LOAN_AMOUNT, LOAN_WEEKLY_INTEREST,
  MECHANIC_WAGE_PER_DAY, SUBSIDY_PER_RIDER, WASH_BAY_COST, WORKSHOP_COST,
} from '../game/constants';
import { fmtInt, fmtMoney } from './format';
import type { LineStats } from '../game/types';
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
      {panel === 'help' && <HelpPanel />}
    </div>
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
  const updateLine = useGame((s) => s.updateLine);
  const deleteLine = useGame((s) => s.deleteLine);
  const setPanel = useGame((s) => s.setPanel);

  if (draft) return <DraftPanel />;
  const line = lines.find((l) => l.id === id);
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
          {st ? `${Math.round(st.cycleMin)} min round trip` : ''}
        </b>
      </div>

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
        <label>Frequency: every {line.headwayMin} min</label>
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
            <small>Peak load</small>
            <b className={st.peakLoadFactor > 1 ? 'bad' : ''}>
              {Math.round(st.peakLoadFactor * 100)}%
            </b>
          </div>
        </div>
      )}
      {st && line.vehicles < st.vehiclesNeeded && line.active && (
        <p className="warn">
          Only {st.vehiclesUsed} bus{st.vehiclesUsed === 1 ? '' : 'es'} running — headway
          stretches to ~{Math.round(st.headwayEffMin)} min. Assign {st.vehiclesNeeded} for the
          full timetable.
        </p>
      )}
      {st && st.peakLoadFactor > 1 && (
        <p className="warn">Overcrowded at rush hour — riders are being left behind.</p>
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

function DraftPanel() {
  const draft = useGame((s) => s.draft)!;
  const undo = useGame((s) => s.undoDraftStop);
  const cancel = useGame((s) => s.cancelDraft);
  const finish = useGame((s) => s.finishDraft);
  const km = draft.legs.reduce((s, l) => s + l.lenM, 0) / 1000;
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
  const depot = useGame((s) => s.depot);
  const riders = useGame((s) => s.totalRidersServed);
  const buyBus = useGame((s) => s.buyBus);
  const sellBus = useGame((s) => s.sellBus);

  const cap = depot ? DEPOT_CAPACITY[depot.level] : 0;
  return (
    <>
      <PanelTitle title="Fleet" />
      <div className="kv">
        <span>Depot space</span>
        <b>
          {fleetTotal(fleet)} / {cap || '—'}
        </b>
      </div>
      {!depot && <p className="warn">Build a depot first — use “Place depot” in the bottom bar.</p>}
      <div className="list">
        {BUS_MODELS.map((m) => {
          const owned = fleetOwned(fleet, m.id);
          const assigned = fleetAssigned(lines, m.id);
          const locked = riders < m.unlockRiders;
          const chargerBlock = m.needsCharger && !depot?.chargers;
          return (
            <div key={m.id} className={`card ${locked ? 'locked' : ''}`}>
              <div className="card-head">
                <span className="bus-side"><BusSide length={m.lengthFactor} /></span>
                <div>
                  <b>{m.name}</b>
                  <small>
                    {m.capacity} riders · ${m.costPerKm.toFixed(2)}/km · {fmtMoney(m.price)}
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
                <div className="btn-row">
                  <button
                    className="btn primary"
                    disabled={cash < m.price || !depot || !!chargerBlock}
                    title={chargerBlock ? 'Needs depot chargers' : ''}
                    onClick={() => buyBus(m.id)}
                  >
                    Buy
                  </button>
                  <button
                    className="btn"
                    disabled={owned - assigned <= 0}
                    onClick={() => sellBus(m.id)}
                  >
                    Sell ({fmtMoney(m.price * 0.5)})
                  </button>
                  <span className="dim">
                    {owned} owned · {assigned} on lines
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
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

function DepotPanel() {
  const depot = useGame((s) => s.depot);
  const cash = useGame((s) => s.cash);
  const setTool = useGame((s) => s.setTool);
  const upgradeDepot = useGame((s) => s.upgradeDepot);
  const buyDepotAddon = useGame((s) => s.buyDepotAddon);

  if (!depot) {
    return (
      <>
        <PanelTitle title="Depot" />
        <p className="hint">
          Your company needs a home base. Pick a spot with good street access — every bus
          starts and ends its day here.
        </p>
        <button className="btn primary with-icon" onClick={() => setTool('depot-place')}>
          <IconDepot size={15} /> Place depot ({fmtMoney(150000)})
        </button>
      </>
    );
  }
  const nextCost = DEPOT_UPGRADE_COST[depot.level + 1];
  return (
    <>
      <PanelTitle title={`Depot — level ${depot.level}`} />
      <div className="kv">
        <span>Bus capacity</span>
        <b>{DEPOT_CAPACITY[depot.level]}</b>
      </div>
      {depot.level < 3 && (
        <button className="btn primary" disabled={cash < nextCost} onClick={upgradeDepot}>
          Upgrade to level {depot.level + 1} ({fmtMoney(nextCost)}) →{' '}
          {DEPOT_CAPACITY[depot.level + 1]} buses
        </button>
      )}
      <div className="card">
        <b>Workshop</b>
        <small>−25% running costs</small>
        {depot.workshop ? (
          <p className="good">✓ Built</p>
        ) : (
          <button
            className="btn" disabled={cash < WORKSHOP_COST}
            onClick={() => buyDepotAddon('workshop')}
          >
            Build ({fmtMoney(WORKSHOP_COST)})
          </button>
        )}
      </div>
      <div className="card">
        <b>Wash bay</b>
        <small>Shiny buses, happier riders (+satisfaction)</small>
        {depot.washBay ? (
          <p className="good">✓ Built</p>
        ) : (
          <button
            className="btn" disabled={cash < WASH_BAY_COST}
            onClick={() => buyDepotAddon('washBay')}
          >
            Build ({fmtMoney(WASH_BAY_COST)})
          </button>
        )}
      </div>
      <div className="card">
        <b>Chargers</b>
        <small>Required for electric buses</small>
        {depot.chargers ? (
          <p className="good">✓ Built</p>
        ) : (
          <button
            className="btn" disabled={cash < CHARGERS_COST}
            onClick={() => buyDepotAddon('chargers')}
          >
            Build ({fmtMoney(CHARGERS_COST)})
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function FinancePanel() {
  const cash = useGame((s) => s.cash);
  const stats = useGame((s) => s.stats);
  const loanTaken = useGame((s) => s.loanTaken);
  const takeLoan = useGame((s) => s.takeLoan);
  const exportSave = useGame((s) => s.exportSave);
  const importSave = useGame((s) => s.importSave);
  const notify = useGame((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);

  const rev = stats?.perLine.reduce((s, p) => s + p.dailyRevenue, 0) ?? 0;
  const cost = stats?.perLine.reduce((s, p) => s + p.dailyCost, 0) ?? 0;

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
          <small>Line profit</small>
          <b className={rev - cost >= 0 ? 'good' : 'bad'}>{fmtMoney(rev - cost)}/day</b>
        </div>
      </div>
      <p className="hint">
        Fixed costs (depot upkeep, mechanics, office, loan interest) are charged on top,
        spread over the day.
      </p>
      {!loanTaken && (
        <button className="btn with-icon" onClick={takeLoan}>
          <IconBank size={15} /> Take loan: +{fmtMoney(LOAN_AMOUNT)} ({fmtMoney(LOAN_WEEKLY_INTEREST)}/week interest)
        </button>
      )}
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
          <b> Place depot</b> button in the bottom bar, then click a spot near a road.
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
