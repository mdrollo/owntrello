import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** Anhänge als Dateien unter DATA_DIR/attachments, Name = zufälliger Schlüssel */
export class AttachmentFiles {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(key: string): string {
    if (!/^[a-f0-9]{32}$/.test(key)) throw new Error('Ungültiger Speicherschlüssel');
    return path.join(this.dir, key);
  }

  /** Datenstrom speichern; liefert Schlüssel und Größe. Bei Fehler wird die Datei entfernt. */
  async save(stream: Readable): Promise<{ key: string; size: number }> {
    const key = crypto.randomBytes(16).toString('hex');
    const target = this.file(key);
    try {
      await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' }));
      return { key, size: fs.statSync(target).size };
    } catch (err) {
      fs.rmSync(target, { force: true });
      throw err;
    }
  }

  open(key: string): fs.ReadStream {
    return fs.createReadStream(this.file(key));
  }

  remove(keys: string[]): void {
    for (const key of keys) fs.rmSync(this.file(key), { force: true });
  }
}
