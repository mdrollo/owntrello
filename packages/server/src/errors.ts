/** Fehler mit HTTP-Status; die App wandelt ihn in { error } mit diesem Status um. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Nicht gefunden') => new HttpError(404, what);
export const forbidden = (what = 'Keine Berechtigung') => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);
