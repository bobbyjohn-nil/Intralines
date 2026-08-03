import { useEffect } from 'react';
import { useGame } from './game/store';
import { MapView } from './map/MapView';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { PanelHost } from './ui/Panels';
import { DraftBar } from './ui/DraftBar';
import { Notices } from './ui/Notices';
import { Menu } from './ui/Menu';
import { Loading } from './ui/Loading';

export default function App() {
  const phase = useGame((s) => s.phase);
  const pack = useGame((s) => s.pack);

  // game clock: tick 10x per second of real time
  useEffect(() => {
    let last = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.5);
      last = now;
      useGame.getState().tick(dt);
    }, 100);
    return () => clearInterval(iv);
  }, []);

  // save on tab close
  useEffect(() => {
    const h = () => useGame.getState().saveGame();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const st = useGame.getState();
      if (st.phase !== 'playing') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        st.togglePause();
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        st.setSpeed(+e.key - 1);
      } else if (e.key === 'Escape') {
        if (st.draft) st.cancelDraft();
        else if (st.tool !== 'select') st.setTool('select');
        else if (st.panel !== 'none') st.setPanel('none');
        else if (st.selectedLineId) st.selectLine(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (phase === 'loading') return <Loading />;
  if (phase !== 'playing' || !pack) return <Menu />;

  return (
    <div className="game-root">
      <MapView pack={pack} />
      <TopBar />
      <Toolbar />
      <PanelHost />
      <DraftBar />
      <Notices />
    </div>
  );
}
