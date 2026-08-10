import { useMemo } from 'react';
import { useGame } from '../game/store';
import { demandSpots, type DemandMode } from '../game/demand';
import { fmtInt } from './format';

const LABEL: Record<DemandMode, { title: string; unit: string }> = {
  pop: { title: 'Residents', unit: 'residents' },
  dest: { title: 'Destinations', unit: 'trips/day' },
};

/**
 * The map can only show shapes — the offline basemap has no fonts, so no
 * labels — and a ring on a map does not tell you how many people are inside
 * it. This is the other half: the same pockets, biggest first, with their
 * numbers and whether your stops already reach them.
 */
export function DemandKey() {
  const heatmap = useGame((s) => s.heatmap);
  const pack = useGame((s) => s.pack);
  const stops = useGame((s) => s.stops);

  const mode = heatmap === 'off' || heatmap === 'modes' ? null : (heatmap as DemandMode);
  const spots = useMemo(
    () => (pack && mode ? demandSpots(pack, mode, stops) : []),
    [pack, mode, stops],
  );

  if (!mode || !spots.length) return null;
  const missed = spots.filter((s) => !s.served).length;
  const { title, unit } = LABEL[mode];

  return (
    <div className="demand-key">
      <div className="dk-head">
        <b>{title}</b>
        <small>biggest pockets</small>
      </div>
      <p className="dk-lead">
        {missed === 0
          ? 'Every one of these is within a short walk of one of your stops.'
          : `${missed} of these ${spots.length} have no stop within a short walk.`}
      </p>
      <ol className="dk-list">
        {spots.map((s) => (
          <li key={s.rank} className={s.served ? 'served' : ''}>
            <span className="dk-dot" />
            <b>{fmtInt(Math.round(s.value))}</b>
            <small>{unit}</small>
            <span className="dk-state">{s.served ? 'served' : 'no stop'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
