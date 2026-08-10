import { useEffect } from 'react';
import { useGame, type GameState } from './game/store';
import { MapView } from './map/MapView';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { PanelHost } from './ui/Panels';
import { DraftBar } from './ui/DraftBar';
import { Notices } from './ui/Notices';
import { Menu } from './ui/Menu';
import { Loading } from './ui/Loading';
import { Founding } from './ui/Founding';
import { UpdateBanner } from './ui/UpdateBanner';
import { BusWipe } from './ui/BusWipe';

export default function App() {
  const phase = useGame((s) => s.phase);
  const pack = useGame((s) => s.pack);
  const companyName = useGame((s) => s.companyName);

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

  // the update watcher rides along with every screen, so a deploy that lands
  // mid-session is caught on the menu as well as in game
  return (
    <>
      <Screen phase={phase} pack={pack} companyName={companyName} />
      <UpdateBanner />
      <BusWipe />
    </>
  );
}

function Screen({
  phase,
  pack,
  companyName,
}: {
  phase: GameState['phase'];
  pack: GameState['pack'];
  companyName: string;
}) {
  if (phase === 'loading') return <Loading />;
  if (phase !== 'playing' || !pack) return <Menu />;
  // new company in this city: name it before the map appears
  if (!companyName) return <Founding />;

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
