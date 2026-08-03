import { useGame } from '../game/store';
import { BusSide } from './icons';

export function Loading() {
  const msg = useGame((s) => s.loadingMsg);
  const detail = useGame((s) => s.loadingDetail);
  return (
    <div className="menu">
      <div className="loading-box">
        <div className="bus-anim"><BusSide length={1} size={64} /></div>
        <h2>{msg}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}
