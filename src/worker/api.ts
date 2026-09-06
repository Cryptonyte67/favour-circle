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
import type {
  Chain,
  Circle,
  Id,
  Money,
  ResolvedOwedBucket,
  Task,
  TaskEvent,
  User,
} from '../shared/types.js';
import { CIRCLE_KINDS, DEFAULT_ASSET_KEY } from '../shared/types.js';
import { canApply, owedBuckets, projectTask } from '../shared/events.js';
import { assetOf, isPositive, parseDecimal } from '../shared/money.js';
import { makeInviteCode, Repo } from './repo.js';

export interface Env {
  DB: D1Database;
  APP_URL?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

function bad(message: string, status = 400) {
  return Object.assign(new Error(message), { httpStatus: status });
}

const uuid = () => crypto.randomUUID();

export function createApi() {
  const api = new Hono<{ Bindings: Env }>();

  /* ---------------------------- identity ---------------------------- */

  api.post('/session', async (c) => {
    const repo = new Repo(c.env.DB);
    const body = await c.req.json<{ displayName?: string; address?: string; chain?: Chain }>();
    const displayName = (body.displayName || '').trim() || 'Someone';
    const user: User = {
      id: uuid(),
      displayName,
      addresses: body.address ? [{ chain: body.chain || 'nimiq', address: body.address }] : [],
      createdAt: Date.now(),
    };
    await repo.createUser(user);
    return c.json({ user });
  });

  /** Every authenticated route resolves the caller the same way. */
  const requireUser = async (c: { env: Env; req: { header(n: string): string | undefined } }) => {
    const id = c.req.header('x-user-id');
    const user = id ? await new Repo(c.env.DB).userById(id) : null;
    if (!user) throw bad('Not signed in', 401);
    return user;
  };

  api.get('/me', async (c) => c.json({ user: await requireUser(c) }));

  /**
   * Register the address this person gets paid at, per chain.
   *
   * Someone can onboard with no wallet connected, so this has to be settable
   * afterwards. Without it they can do chores and be approved but cannot be
   * paid, which the Owed tab surfaces explicitly rather than guessing.
   */
  api.put('/me/addresses', async (c) => {
    const user = await requireUser(c);
    const repo = new Repo(c.env.DB);
    const body = await c.req.json<{ chain?: Chain; address?: string }>();
    const address = (body.address || '').trim();
    if (!address) throw bad('An address is required');
    await repo.setAddress(user.id, body.chain || 'nimiq', address);
    return c.json({ user: await repo.userById(user.id) });
  });

  /* ----------------------------- circles ---------------------------- */

  api.get('/circles', async (c) => {
    const user = await requireUser(c);
    return c.json({ circles: await new Repo(c.env.DB).circlesFor(user.id) });
  });

  api.post('/circles', async (c) => {
    const user = await requireUser(c);
    const repo = new Repo(c.env.DB);
    const body = await c.req.json<{ name?: string; kind?: string }>();
    const name = (body.name || '').trim();
    if (!name) throw bad('Give the circle a name');
    const kind = CIRCLE_KINDS.find((k) => k === body.kind);
    if (!kind) throw bad('Pick family, friends or community');

    const circle: Circle = {
      id: uuid(),
      kind,
      name,
      inviteCode: makeInviteCode(),
      createdBy: user.id,
      createdAt: Date.now(),
    };
    await repo.createCircle(circle);
    return c.json({ circle });
  });

  api.post('/circles/join', async (c) => {
    const user = await requireUser(c);
    const repo = new Repo(c.env.DB);
    const body = await c.req.json<{ code?: string }>();
    const circle = await repo.circleByCode(body.code || '');
    if (!circle) throw bad('That invite code does not match a circle', 404);
    await repo.addMembership(circle.id, user.id);
    return c.json({ circle });
  });

  /* ------------------------------ chores ---------------------------- */

  api.get('/tasks', async (c) => {
    const user = await requireUser(c);
    const repo = new Repo(c.env.DB);
    const [tasks, names] = await Promise.all([repo.tasksVisibleTo(user.id), repo.displayNames()]);

    const owed: ResolvedOwedBucket[] = [];
    for (const bucket of owedBuckets(tasks)) {
      const { chain } = assetOf(bucket.assetKey);
      owed.push({ ...bucket, payTo: await repo.payoutAddress(bucket.doerId, chain) });
    }

    return c.json({ tasks, names, owed });
  });

  api.post('/tasks', async (c) => {
    const user = await requireUser(c);
    const repo = new Repo(c.env.DB);
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

    const circleIds: Id[] = [];
    for (const id of body.circleIds || []) {
      if (await repo.isMember(id, user.id)) circleIds.push(id);
    }
    if (circleIds.length === 0) throw bad('Choose at least one circle to post to');

    const reward: Money = { assetKey, units };
    const taskId = uuid();
    await repo.appendEvent({
      id: uuid(),
      taskId,
      actorId: user.id,
      at: Date.now(),
      type: 'task.created',
      title,
      detail: (body.detail || '').trim(),
      reward,
      circleIds,
    });
    return c.json({ task: await repo.taskById(taskId) });
  });

  const base = (user: User, task: Task) => ({
    id: uuid(),
    taskId: task.id,
    actorId: user.id,
    at: Date.now(),
  });

  /** One handler shape for every state transition; the ledger enforces legality. */
  const transition = (
    action: string,
    build: (args: { user: User; task: Task; body: Record<string, unknown> }) => TaskEvent,
    guard: (args: {
      user: User;
      task: Task;
      repo: Repo;
    }) => string | null | Promise<string | null>,
  ) => {
    api.post(`/tasks/:id/${action}`, async (c) => {
      const user = await requireUser(c);
      const repo = new Repo(c.env.DB);
      const task = await repo.taskById(c.req.param('id'));
      if (!task) throw bad('No such chore', 404);
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

      const problem = await guard({ user, task, repo });
      if (problem) throw bad(problem, 403);

      const event = build({ user, task, body });
      if (!canApply(event.type, task.status)) {
        throw bad(`Cannot ${action} a chore that is ${task.status}`, 409);
      }
      await repo.appendEvent(event);
      return c.json({ task: await repo.taskById(task.id) });
    });
  };

  transition(
    'claim',
    ({ user, task }) => ({ ...base(user, task), type: 'task.claimed' }),
    async ({ user, task, repo }) => {
      if (task.posterId === user.id) return 'You cannot claim your own chore';
      for (const id of task.circleIds) {
        if (await repo.isMember(id, user.id)) return null;
      }
      return 'That chore is not posted to any of your circles';
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
    const user = await requireUser(c);
    const repo = new Repo(c.env.DB);
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
      const task = await repo.taskById(taskId);
      if (!task) throw bad('No such chore', 404);
      if (task.posterId !== user.id) throw bad('You can only settle chores you posted', 403);
      if (!canApply('task.settled', task.status)) continue;

      // The client chose the address, so re-derive it here and refuse to record
      // a settlement against anything else. Without this a bug or a tampered
      // client could mark chores paid while the money went elsewhere.
      if (!task.doerId) throw bad('That chore has nobody to pay', 409);
      const { chain } = assetOf(task.reward.assetKey);
      const expected = await repo.payoutAddress(task.doerId, chain);
      if (!expected) {
        const doer = await repo.userById(task.doerId);
        throw bad((doer?.displayName ?? 'That person') + ' has not added a wallet address yet', 409);
      }
      if (expected.address !== paidTo) {
        throw bad('That payment did not go to the address on record for this chore', 409);
      }

      await repo.appendEvent({ ...base(user, task), type: 'task.settled', railId, txHash, paidTo });
      const updated = await repo.taskById(taskId);
      if (updated) settled.push(updated);
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

export { projectTask };
