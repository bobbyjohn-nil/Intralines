import { useGame } from '../game/store';

export function Loading() {
  const msg = useGame((s) => s.loadingMsg);
  const detail = useGame((s) => s.loadingDetail);
  return (
    <div className="menu">
      <div className="loading-box">
        <div className="bus-anim">🚌</div>
        <h2>{msg}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}
