import { useEffect, useRef } from 'react';
import type { BoardEvent } from '@owntrello/shared';

/**
 * Live-Kanal eines Boards (Server-Sent Events). Ruft onEvent bei jeder Änderung
 * auf – auch eigenen, damit andere Tabs desselben Benutzers mitziehen. Beim
 * Zurückkehren in den Tab wird zusätzlich ein „changed“ gemeldet, falls die
 * Verbindung zwischendurch weg war.
 */
export function useBoardEvents(boardId: number, onEvent: (event: BoardEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      source = new EventSource(`/api/boards/${boardId}/events`);
      source.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data) as BoardEvent);
        } catch {
          // ungültige Nachricht ignorieren
        }
      };
      source.onerror = () => {
        // EventSource verbindet sich selbst neu; ist sie endgültig zu, nach 10 s neu starten
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          retry = setTimeout(connect, 10_000);
        }
      };
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState === 'visible') handler.current({ type: 'changed', boardId, by: '' });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [boardId]);
}
