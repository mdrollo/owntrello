import { EventEmitter } from 'node:events';
import type { BoardEvent } from '@owntrello/shared';

/**
 * Änderungen an Boards für den Live-Kanal (Server-Sent Events). Läuft im
 * Prozess – reicht für eine Instanz; bei mehreren Instanzen bräuchte es einen
 * gemeinsamen Bus (z. B. Redis), die Clients laden dann spätestens beim
 * Zurückkehren in den Tab neu.
 */
export class BoardEvents {
  private emitter = new EventEmitter();
  /** offene Live-Verbindungen, damit sie beim Herunterfahren beendet werden können */
  private streams = new Set<() => void>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: BoardEvent): void {
    this.emitter.emit(`board:${event.boardId}`, event);
  }

  /** Live-Verbindung registrieren; liefert die Abmeldung */
  track(close: () => void): () => void {
    this.streams.add(close);
    return () => this.streams.delete(close);
  }

  /** Alle Live-Verbindungen schließen (sonst wartet app.close() ewig) */
  closeAll(): void {
    for (const close of [...this.streams]) close();
  }

  subscribe(boardId: number, listener: (event: BoardEvent) => void): () => void {
    const name = `board:${boardId}`;
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }
}
