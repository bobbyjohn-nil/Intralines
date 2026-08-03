import { useGame } from '../game/store';
import { SPEEDS, trafficFactor } from '../game/constants';
import { fmtClock, fmtInt, fmtMoney } from './format';

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

  const { day, time, week } = fmtClock(clockMin);
  const congestion = trafficFactor((clockMin / 60) % 24);

  return (
    <div className="topbar">
      <button className="chip ghost" onClick={backToMenu} title="Back to city select">
        ‹ {pack?.meta.name ?? ''}
      </button>
      <div className="chip clock">
        <span className="dim">W{week}</span> {day} <b>{time}</b>
        {congestion >= 1.3 && (
          <span title="Rush hour — heavy traffic, buses running slow"> 🚗🚗</span>
        )}
      </div>
      <div className="chip speed-group">
        <button className={paused ? 'on' : ''} onClick={togglePause} title="Pause (space)">
          ⏸
        </button>
        {SPEEDS.map((sp, i) => (
          <button
            key={sp.label}
            className={!paused && speedIdx === i ? 'on' : ''}
            onClick={() => setSpeed(i)}
            title={`Speed ${i + 1}`}
          >
            {sp.label}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className={`chip stat ${cash < 0 ? 'bad' : ''}`} title="Cash">
        💰 {fmtMoney(cash)}
      </div>
      <div className="chip stat" title="Total riders served">
        👥 {fmtInt(riders)}
      </div>
      <div className="chip stat" title="Daily riders / satisfaction / coverage">
        🚌 {fmtInt(stats?.totalDailyRiders ?? 0)}/day
        <span className="dim"> · </span>😊 {Math.round(stats?.satisfaction ?? 0)}
        <span className="dim"> · </span>📶 {Math.round(stats?.coveragePct ?? 0)}%
      </div>
    </div>
  );
}
