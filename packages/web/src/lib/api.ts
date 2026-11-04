import type {
  Activity,
  ArchiveResponse,
  Attachment,
  BoardDetail,
  BoardSummary,
  CardDetail,
  CardSummary,
  Label,
  List,
  Me,
  Permission,
  User,
} from '@owntrello/shared';
import { authFetch, goToLogin } from './auth';

/** Fehlermeldung des Backends ({ error }) für die Anzeige */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  // Sitzung abgelaufen: Azure antwortet mit 401/403 (dank X-Requested-With) oder leitet um
  // (403 ohne JSON); ein 403 mit JSON ist ein fehlendes Recht am Board
  const json = (res.headers.get('content-type') ?? '').includes('json');
  if (res.status === 401 || res.type === 'opaqueredirect' || (res.status === 403 && !json)) goToLogin();
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.error ?? data.message ?? message;
    } catch {
      // keine JSON-Antwort
    }
    throw new ApiError(message, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await authFetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

const enc = encodeURIComponent;

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  users: () => request<{ users: User[] }>('GET', '/api/users'),

  boards: {
    list: () => request<{ boards: BoardSummary[] }>('GET', '/api/boards'),
    create: (input: { title: string; color: string }) => request<{ id: number }>('POST', '/api/boards', input),
    get: (id: number) => request<BoardDetail>('GET', `/api/boards/${id}`),
    update: (id: number, patch: { title?: string; color?: string; archived?: boolean }) =>
      request('PATCH', `/api/boards/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/api/boards/${id}`),
    star: (id: number, starred: boolean) => request('PUT', `/api/boards/${id}/star`, { starred }),
    activity: (id: number, before?: number) =>
      request<{ activity: Activity[] }>('GET', `/api/boards/${id}/activity${before ? `?before=${before}` : ''}`),
    archive: (id: number) => request<ArchiveResponse>('GET', `/api/boards/${id}/archive`),
    addMember: (id: number, email: string, perm: Partial<Permission>) =>
      request<{ result: 'member' | 'invite' }>('POST', `/api/boards/${id}/members`, { email, ...perm }),
    setMember: (id: number, userId: string, perm: Partial<Permission>) =>
      request('PUT', `/api/boards/${id}/members/${enc(userId)}`, perm),
    removeMember: (id: number, userId: string) => request<void>('DELETE', `/api/boards/${id}/members/${enc(userId)}`),
    removeInvite: (id: number, email: string) => request<void>('DELETE', `/api/boards/${id}/invites/${enc(email)}`),
    createLabel: (id: number, input: { name: string; color: string }) =>
      request<Label>('POST', `/api/boards/${id}/labels`, input),
    createList: (id: number, title: string) => request<List>('POST', `/api/boards/${id}/lists`, { title }),
  },

  labels: {
    update: (id: number, patch: { name?: string; color?: string }) => request<Label>('PATCH', `/api/labels/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/api/labels/${id}`),
  },

  lists: {
    update: (id: number, patch: { title?: string; archived?: boolean }) => request('PATCH', `/api/lists/${id}`, patch),
    move: (id: number, index: number) => request('POST', `/api/lists/${id}/move`, { index }),
    remove: (id: number) => request<void>('DELETE', `/api/lists/${id}`),
    createCard: (id: number, title: string, position: 'top' | 'bottom' = 'bottom') =>
      request<CardSummary>('POST', `/api/lists/${id}/cards`, { title, position }),
  },

  cards: {
    get: (id: number) => request<CardDetail>('GET', `/api/cards/${id}`),
    update: (
      id: number,
      patch: Partial<{
        title: string;
        description: string;
        due: string | null;
        dueDone: boolean;
        archived: boolean;
        coverAttachmentId: number | null;
      }>,
    ) => request<CardSummary>('PATCH', `/api/cards/${id}`, patch),
    move: (id: number, listId: number, index: number) => request('POST', `/api/cards/${id}/move`, { listId, index }),
    remove: (id: number) => request<void>('DELETE', `/api/cards/${id}`),
    setLabel: (id: number, labelId: number, on: boolean) =>
      request(on ? 'PUT' : 'DELETE', `/api/cards/${id}/labels/${labelId}`),
    setMember: (id: number, userId: string, on: boolean) =>
      request(on ? 'PUT' : 'DELETE', `/api/cards/${id}/members/${enc(userId)}`),
    addChecklist: (id: number, title: string) => request<{ id: number }>('POST', `/api/cards/${id}/checklists`, { title }),
    addComment: (id: number, text: string) => request<{ id: number }>('POST', `/api/cards/${id}/comments`, { text }),
    upload: async (id: number, file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return handle<Attachment>(await authFetch(`/api/cards/${id}/attachments`, { method: 'POST', body: form }));
    },
  },

  checklists: {
    rename: (id: number, title: string) => request('PATCH', `/api/checklists/${id}`, { title }),
    remove: (id: number) => request<void>('DELETE', `/api/checklists/${id}`),
    addItem: (id: number, text: string) => request<{ id: number }>('POST', `/api/checklists/${id}/items`, { text }),
  },

  checkItems: {
    update: (id: number, patch: { text?: string; done?: boolean }) => request('PATCH', `/api/checkitems/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/api/checkitems/${id}`),
  },

  comments: {
    update: (id: number, text: string) => request('PATCH', `/api/comments/${id}`, { text }),
    remove: (id: number) => request<void>('DELETE', `/api/comments/${id}`),
  },

  attachments: {
    url: (id: number, download = false) => `/api/attachments/${id}${download ? '?download' : ''}`,
    remove: (id: number) => request<void>('DELETE', `/api/attachments/${id}`),
  },
};
