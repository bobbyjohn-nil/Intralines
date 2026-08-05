import { useGame } from '../game/store';
import { SPEEDS, trafficFactor } from '../game/constants';
import { fmtClock, fmtInt, fmtMoney } from './format';
import {
  IconBus, IconCar, IconCash, IconPause, IconPlay, IconRider, IconSignal, IconSmile,
} from './icons';

export function TopBar() {
  const pack = useGame((s) => s.pack);
  const cash = useGame((s) => s.cash);
  const clockMin = useGame((s) => s.clockMin);
  const speedIdx = useGame((s) => s.speedIdx);
  const paused = useGame((s) => s.paused);
  const stats = useGame((s) => s.stats);
  const riders = useGame((s) => s.totalRidersServed);
  const setSpeed = useGame((s) => s.setSpeed);
  const togglePause = useGame((s) => s.togglePause);
  const backToMenu = useGame((s) => s.backToMenu);

  const { year, quarter, day, time } = fmtClock(clockMin);
  // riders you've put on buses are cars you've taken off the road
  let relief = 1;
  if (stats?.bgModes) {
    let car = 0;
    let bus = 0;
    for (const m of stats.bgModes) {
      car += m.car;
      bus += m.bus;
    }
    const baseline = car + bus * 0.87;
    if (baseline > 0) relief = Math.max(0.6, Math.min(1, car / baseline));
  }
  const base = trafficFactor((clockMin / 60) % 24);
  const congestion = base > 1 ? 1 + (base - 1) * relief : base;

  return (
    <div className="topbar">
      <button className="chip ghost" onClick={backToMenu} title="Back to city select">
        ‹ {pack?.meta.name ?? ''}
      </button>
      <div className="chip clock" title={`Year ${year}, quarter ${quarter}, day ${day} of 16`}>
        <span className="dim">
          Y{year} Q{quarter}
        </span>{' '}
        D{day} <b>{time}</b>
        {congestion >= 1.3 && (
          <span className="traffic" title="Rush hour — heavy traffic, buses running slow">
            <IconCar size={15} />
          </span>
        )}
      </div>
      <div className="chip speed-group">
        <button className={paused ? 'on' : ''} onClick={togglePause} title="Pause (space)">
          <IconPause size={14} />
        </button>
        {SPEEDS.map((sp, i) => (
          <button
            key={sp.gameMinPerSec}
            className={!paused && speedIdx === i ? 'on' : ''}
            onClick={() => setSpeed(i)}
            title={`Speed ${i + 1} (key ${i + 1})`}
          >
            <IconPlay size={14} count={i + 1} />
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className={`chip stat ${cash < 0 ? 'bad' : ''}`} title="Company cash">
        <IconCash size={15} />
        {fmtMoney(cash)}
      </div>
      <div className="chip stat" title="Total riders served">
        <IconRider size={15} />
        {fmtInt(riders)}
      </div>
      <div className="chip stat" title="Daily riders">
        <IconBus size={15} />
        {fmtInt(stats?.totalDailyRiders ?? 0)}/day
      </div>
      <div className="chip stat" title="Rider satisfaction">
        <IconSmile size={15} />
        {Math.round(stats?.satisfaction ?? 0)}
      </div>
      <div className="chip stat" title="Residents within a short walk of a stop">
        <IconSignal size={15} />
        {Math.round(stats?.coveragePct ?? 0)}%
      </div>
    </div>
  );
}
