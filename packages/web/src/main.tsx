import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Service Worker: Bei einer neuen Version lädt die Seite automatisch neu
 * (registerType "autoUpdate"). Geprüft wird beim Start, stündlich und beim
 * Zurückkehren in die App.
 */
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    // Hängt ein fertiger neuer Service Worker im Wartezustand, ihn jetzt aktivieren
    const activateWaiting = () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    activateWaiting();
    registration.addEventListener('updatefound', () => {
      const sw = registration.installing;
      sw?.addEventListener('statechange', () => sw.state === 'installed' && activateWaiting());
    });
    const check = () => {
      if (navigator.onLine) void registration.update().then(activateWaiting).catch(() => undefined);
    };
    setInterval(check, 60 * 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
