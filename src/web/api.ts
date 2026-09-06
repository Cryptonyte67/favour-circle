import type { Chain, Circle, Id, ResolvedOwedBucket, Task, User } from '../shared/types.js';

const USER_KEY = 'chore-circle:user-id';

export interface CircleWithCount extends Circle {
  memberCount: number;
}

export interface TasksResponse {
  tasks: Task[];
  names: Record<Id, string>;
  owed: ResolvedOwedBucket[];
}

export function storedUserId(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function storeUserId(id: string): void {
  try {
    localStorage.setItem(USER_KEY, id);
  } catch {
    // Private mode, or storage disabled. The session still works for this load.
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const userId = storedUserId();
  if (userId) headers.set('x-user-id', userId);

  const res = await fetch('/api' + path, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
  return body as T;
}

export const api = {
  createSession: (displayName: string, address?: string) =>
    call<{ user: User }>('/session', {
      method: 'POST',
      body: JSON.stringify({ displayName, address }),
    }),

  me: () => call<{ user: User }>('/me'),

  setAddress: (address: string, chain: Chain = 'nimiq') =>
    call<{ user: User }>('/me/addresses', {
      method: 'PUT',
      body: JSON.stringify({ address, chain }),
    }),

  circles: () => call<{ circles: CircleWithCount[] }>('/circles'),

  createCircle: (name: string, kind: string) =>
    call<{ circle: Circle }>('/circles', {
      method: 'POST',
      body: JSON.stringify({ name, kind }),
    }),

  joinCircle: (code: string) =>
    call<{ circle: Circle }>('/circles/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  tasks: () => call<TasksResponse>('/tasks'),

  createTask: (input: {
    title: string;
    detail: string;
    amount: string;
    assetKey: string;
    circleIds: Id[];
  }) => call<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify(input) }),

  claim: (id: Id) => call<{ task: Task }>('/tasks/' + id + '/claim', { method: 'POST' }),

  markDone: (id: Id, signature: string | null) =>
    call<{ task: Task }>('/tasks/' + id + '/done', {
      method: 'POST',
      body: JSON.stringify({ signature }),
    }),

  approve: (id: Id) => call<{ task: Task }>('/tasks/' + id + '/approve', { method: 'POST' }),

  cancel: (id: Id, reason = '') =>
    call<{ task: Task }>('/tasks/' + id + '/cancel', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  settle: (taskIds: Id[], railId: string, txHash: string, paidTo: string) =>
    call<{ settled: Task[] }>('/settle', {
      method: 'POST',
      body: JSON.stringify({ taskIds, railId, txHash, paidTo }),
    }),
};
