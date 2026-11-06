import { useEffect, useState } from 'react';

/**
 * Minimaler Router: wenige Seiten (/, /b/:id, /b/:id/c/:cardId) brauchen keine Bibliothek.
 * Der Server liefert für jeden Seitenpfad index.html aus (SPA-Fallback).
 */
const EVENT = 'owntrello:navigate';

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVENT));
}

export function useLocation(): { path: string; params: URLSearchParams } {
  const read = () => ({ path: window.location.pathname, params: new URLSearchParams(window.location.search) });
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return location;
}
