import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: the MapLibre map + WebGL bus layer must not double-mount.
createRoot(document.getElementById('root')!).render(<App />);
