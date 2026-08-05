import { createRoot } from 'react-dom/client';
import App from './App';
import { migrateLocalStorage } from './game/migrate';
import './styles.css';

migrateLocalStorage();

// the app booted, so the stale-deploy reload guard can re-arm
try {
  sessionStorage.removeItem('il-reloaded');
} catch {
  // storage unavailable — fine
}

// No StrictMode: the MapLibre map + WebGL bus layer must not double-mount.
createRoot(document.getElementById('root')!).render(<App />);

// the CSS sibling rule hides the boot splash once #root has content; remove
// it outright as well (after the first real render) so no stacking-context
// quirk can leave it around
const clearSplash = (): void => {
  const el = document.getElementById('boot-splash');
  if (!el) return;
  if (document.getElementById('root')?.childElementCount) el.remove();
  else requestAnimationFrame(clearSplash);
};
requestAnimationFrame(clearSplash);
