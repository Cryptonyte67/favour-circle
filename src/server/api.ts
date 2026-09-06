/**
 * JSON API.
 *
 * SECURITY NOTE, read before putting real money through this:
 * identity is a bearer user id issued on first connect and trusted thereafter.
 * The wallet signature captured on "mark done" is stored but NOT verified
 * server-side. That is fine for a circle of people who know each other, and it
 * is not fine for strangers. Verifying signatures is the first thing to add.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type {
  Chain,
  Circle,
  Id,
  Money,
  ResolvedOwedBucket,
  Task,
  TaskEvent,
  User,
  WalletAddress,
} from '../shared/types.js';
import { CIRCLE_KINDS, DEFAULT_ASSET_KEY } from '../shared/types.js';
import { canApply, owedBuckets, projectTask } from '../shared/events.js';
import { assetOf, isPositive, parseDecimal } from '../shared/money.js';
import {
  allTaskIds,
  circleByCode,
  circlesFor,
  eventsForTask,
  isMember,
  makeInviteCode,
  userById,
  type Store,
} from './store.js';

function bad(message: string, status = 400) {
  return Object.assign(new Error(message), { httpStatus: status });
}

interface HeaderCarrier {
  req: { header(name: string): string | undefined };
}

export function createApi(store: Store) {
  const api = new Hono();

  /** Resolve the caller from the X-User-Id header. */
  const requireUser = (c: HeaderCarrier): User => {
    const id = c.req.header('x-user-id');
    const user = id ? userById(store.read(), id) : undefined;
    if (!user) throw bad('Not signed in', 401);
    return user;
  };

  const tasksVisibleTo = (userId: Id): Task[] => {
    const db = store.read();
    const myCircles = new Set(circlesFor(db, userId).map((c) => c.id));
    const out: Task[] = [];
    for (const taskId of allTaskIds(db)) {
      const task = projectTask(eventsForTask(db, taskId));
      if (!task) continue;
      const visible =
        task.posterId === userId ||
        task.doerId === userId ||
        task.circleIds.some((id) => myCircles.has(id));
      if (visible) out.push(task);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const append = (event: TaskEvent) => {
    store.mutate((db) => db.events.push(event));
  };

  const loadTask = (taskId: Id): Task => {
    const task = projectTask(eventsForTask(store.read(), taskId));
    if (!task) throw bad('No such chore', 404);
    return task;
  };

  /* ---------------------------- identity ---------------------------- */

  api.post('/session', async (c) => {
    const body = await c.req.json<{ displayName?: string; address?: string; chain?: Chain }>();
    const displayName = (body.displayName || '').trim() || 'Someone';
    const user: User = {
      id: randomUUID(),
      displayName,
      addresses: body.address
        ? [{ chain: body.chain || 'nimiq', address: body.address }]
        : [],
      createdAt: Date.now(),
    };
    store.mutate((db) => db.users.push(user));
    return c.json({ user });
  });

  api.get('/me', (c) => c.json({ user: requireUser(c) }));

  /**
   * Register the address this person gets paid at, per chain.
   *
   * Someone can onboard with no wallet connected, so this has to be settable
   * afterwards. Without it they can do chores and be approved but cannot be
   * paid, which the Owed tab surfaces explicitly rather than guessing.
   */
  api.put('/me/addresses', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{ chain?: Chain; address?: string }>();
    const address = (body.address || '').trim();
    const chain = body.chain || 'nimiq';
    if (!address) throw bad('An address is required');

    store.mutate((db) => {
      const record = userById(db, user.id);
      if (!record) return;
      const existing = record.addresses.find((a) => a.chain === chain);
      if (existing) existing.address = address;
      else record.addresses.push({ chain, address });
    });

    return c.json({ user: userById(store.read(), user.id) });
  });

  const nameFor = (userId: Id): string => userById(store.read(), userId)?.displayName ?? 'That person';

  /** The address a user can receive `assetKey` at, or null if they have none. */
  const payoutAddressFor = (userId: Id, assetKey: string): WalletAddress | null => {
    const user = userById(store.read(), userId);
    if (!user) return null;
    const { chain } = assetOf(assetKey);
    return user.addresses.find((a) => a.chain === chain) ?? null;
  };

  /* ----------------------------- circles ---------------------------- */

  api.get('/circles', (c) => {
    const user = requireUser(c);
    const db = store.read();
    const circles = circlesFor(db, user.id).map((circle) => ({
      ...circle,
      memberCount: db.memberships.filter((m) => m.circleId === circle.id).length,
    }));
    return c.json({ circles });
  });

  api.post('/circles', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{ name?: string; kind?: string }>();
    const name = (body.name || '').trim();
    if (!name) throw bad('Give the circle a name');
    const kind = CIRCLE_KINDS.find((k) => k === body.kind);
    if (!kind) throw bad('Pick family, friends or community');

    const circle: Circle = {
      id: randomUUID(),
      kind,
      name,
      inviteCode: makeInviteCode(),
      createdBy: user.id,
      createdAt: Date.now(),
    };
    store.mutate((db) => {
      db.circles.push(circle);
      db.memberships.push({ circleId: circle.id, userId: user.id, joinedAt: Date.now() });
    });
    return c.json({ circle });
  });

  api.post('/circles/join', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{ code?: string }>();
    const circle = circleByCode(store.read(), body.code || '');
    if (!circle) throw bad('That invite code does not match a circle', 404);
    if (!isMember(store.read(), circle.id, user.id)) {
      store.mutate((db) =>
        db.memberships.push({ circleId: circle.id, userId: user.id, joinedAt: Date.now() }),
      );
    }
    return c.json({ circle });
  });

  /* ------------------------------ chores ---------------------------- */

  api.get('/tasks', (c) => {
    const user = requireUser(c);
    const db = store.read();
    const tasks = tasksVisibleTo(user.id);
    const names: Record<Id, string> = {};
    for (const u of db.users) names[u.id] = u.displayName;

    const owed: ResolvedOwedBucket[] = owedBuckets(tasks).map((bucket) => ({
      ...bucket,
      payTo: payoutAddressFor(bucket.doerId, bucket.assetKey),
    }));

    return c.json({ tasks, names, owed });
  });

  api.post('/tasks', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{
      title?: string;
      detail?: string;
      amount?: string;
      assetKey?: string;
      circleIds?: Id[];
    }>();

    const title = (body.title || '').trim();
    if (!title) throw bad('What needs doing?');

    const assetKey = body.assetKey || DEFAULT_ASSET_KEY;
    // parseDecimal throws plain Errors for bad input. Left unwrapped they reach
    // the error handler as 500s and get logged as server faults, when they are
    // ordinary validation failures the caller should see as 400s.
    let units: string;
    try {
      units = parseDecimal(assetKey, body.amount || '0');
    } catch (err) {
      throw bad((err as Error).message);
    }
    if (!isPositive(units)) throw bad('The reward has to be more than zero');

    const circleIds = (body.circleIds || []).filter((id) => isMember(store.read(), id, user.id));
    if (circleIds.length === 0) throw bad('Choose at least one circle to post to');

    const reward: Money = { assetKey, units };
    const taskId = randomUUID();
    append({
      id: randomUUID(),
      taskId,
      actorId: user.id,
      at: Date.now(),
      type: 'task.created',
      title,
      detail: (body.detail || '').trim(),
      reward,
      circleIds,
    });
    return c.json({ task: loadTask(taskId) });
  });

  const base = (user: User, task: Task) => ({
    id: randomUUID(),
    taskId: task.id,
    actorId: user.id,
    at: Date.now(),
  });

  /** One handler shape for every state transition; the ledger enforces legality. */
  const transition = (
    action: string,
    build: (args: { user: User; task: Task; body: Record<string, unknown> }) => TaskEvent,
    guard: (args: { user: User; task: Task }) => string | null,
  ) => {
    api.post(`/tasks/:id/${action}`, async (c) => {
      const user = requireUser(c);
      const task = loadTask(c.req.param('id'));
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

      const problem = guard({ user, task });
      if (problem) throw bad(problem, 403);

      const event = build({ user, task, body });
      if (!canApply(event.type, task.status)) {
        throw bad(`Cannot ${action} a chore that is ${task.status}`, 409);
      }
      append(event);
      return c.json({ task: loadTask(task.id) });
    });
  };

  transition(
    'claim',
    ({ user, task }) => ({ ...base(user, task), type: 'task.claimed' }),
    ({ user, task }) => {
      if (task.posterId === user.id) return 'You cannot claim your own chore';
      const db = store.read();
      const shared = task.circleIds.some((id) => isMember(db, id, user.id));
      return shared ? null : 'That chore is not posted to any of your circles';
    },
  );

  transition(
    'done',
    ({ user, task, body }) => ({
      ...base(user, task),
      type: 'task.submitted',
      signature: typeof body.signature === 'string' ? body.signature : null,
    }),
    ({ user, task }) =>
      task.doerId === user.id ? null : 'Only the person doing it can mark it done',
  );

  transition(
    'approve',
    ({ user, task }) => ({ ...base(user, task), type: 'task.approved' }),
    ({ user, task }) => (task.posterId === user.id ? null : 'Only the poster can approve'),
  );

  transition(
    'cancel',
    ({ user, task, body }) => ({
      ...base(user, task),
      type: 'task.cancelled',
      reason: typeof body.reason === 'string' ? body.reason : '',
    }),
    ({ user, task }) => (task.posterId === user.id ? null : 'Only the poster can cancel'),
  );

  /**
   * Record settlement of a whole bucket of approved chores.
   *
   * The payment itself happens client-side through the wallet, because only
   * Nimiq Pay can raise the native confirmation dialog. The client sends the
   * txHash back and every task in the batch is marked settled against it.
   */
  api.post('/settle', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{
      taskIds?: Id[];
      railId?: string;
      txHash?: string;
      paidTo?: string;
    }>();
    const txHash = (body.txHash || '').trim();
    const railId = (body.railId || '').trim();
    const paidTo = (body.paidTo || '').trim();
    if (!txHash || !railId) throw bad('A settlement needs a rail and a transaction hash');
    if (!paidTo) throw bad('A settlement must record the address that was paid');

    const settled: Task[] = [];
    for (const taskId of body.taskIds || []) {
      const task = loadTask(taskId);
      if (task.posterId !== user.id) throw bad('You can only settle chores you posted', 403);
      if (!canApply('task.settled', task.status)) continue;

      // The client chose the address, so re-derive it here and refuse to record
      // a settlement against anything else. Without this a bug or a tampered
      // client could mark chores paid while the money went elsewhere.
      if (!task.doerId) throw bad('That chore has nobody to pay', 409);
      const expected = payoutAddressFor(task.doerId, task.reward.assetKey);
      if (!expected) {
        throw bad(nameFor(task.doerId) + ' has not added a wallet address yet', 409);
      }
      if (expected.address !== paidTo) {
        throw bad('That payment did not go to the address on record for this chore', 409);
      }

      append({ ...base(user, task), type: 'task.settled', railId, txHash, paidTo });
      settled.push(loadTask(taskId));
    }
    return c.json({ settled });
  });

  api.onError((err, c) => {
    const status = (err as { httpStatus?: number }).httpStatus ?? 500;
    if (status >= 500) console.error(err);
    return c.json({ error: err.message }, status as 400);
  });

  return api;
}
