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
