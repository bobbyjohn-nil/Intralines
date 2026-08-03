import { useGame } from '../game/store';

export function Notices() {
  const notices = useGame((s) => s.notices);
  const dismiss = useGame((s) => s.dismissNotice);
  if (!notices.length) return null;
  return (
    <div className="notices">
      {notices.map((n) => (
        <button key={n.id} className={`notice ${n.kind}`} onClick={() => dismiss(n.id)}>
          {n.text}
        </button>
      ))}
    </div>
  );
}
