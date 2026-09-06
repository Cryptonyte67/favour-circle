/**
 * D1-backed repository.
 *
 * Replaces the file-based JsonStore. The domain logic did not change: events
 * remain the source of truth and task state is still a projection over them.
 * Only persistence moved, which is what the Store interface existed to allow.
 *
 * Every method here is async, because D1 is. That is the one real cost of the
 * move, and it is paid in the handlers rather than hidden behind a cache.
 */

import type {
  Chain,
  Circle,
  CircleKind,
  Id,
  Task,
  TaskEvent,
  User,
  WalletAddress,
} from '../shared/types.js';
import { projectTask } from '../shared/events.js';

export interface CircleWithCount extends Circle {
  memberCount: number;
}

interface UserRow {
  id: string;
  display_name: string;
  created_at: number;
}

interface AddressRow {
  user_id: string;
  chain: string;
  address: string;
}

interface CircleRow {
  id: string;
  kind: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: number;
  member_count?: number;
}

interface EventRow {
  id: string;
  task_id: string;
  actor_id: string;
  at: number;
  type: string;
  payload: string;
}

function toCircle(row: CircleRow): Circle {
  return {
    id: row.id,
    kind: row.kind as CircleKind,
    name: row.name,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Rebuild a typed event from its row.
 *
 * The discriminating fields live in columns so they can be queried; everything
 * else rides in the JSON payload. Reassembling here keeps the union type intact
 * for the reducers, which know nothing about storage.
 */
function toEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    at: row.at,
    type: row.type,
    ...(JSON.parse(row.payload) as Record<string, unknown>),
  } as TaskEvent;
}

function payloadOf(event: TaskEvent): string {
  const { id, taskId, actorId, at, type, ...rest } = event as TaskEvent &
    Record<string, unknown>;
  void id;
  void taskId;
  void actorId;
  void at;
  void type;
  return JSON.stringify(rest);
}

export class Repo {
  constructor(private readonly db: D1Database) {}

  /* ----------------------------- users ----------------------------- */

  async createUser(user: User): Promise<void> {
    const statements = [
      this.db
        .prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)')
        .bind(user.id, user.displayName, user.createdAt),
    ];
    for (const address of user.addresses) {
      statements.push(
        this.db
          .prepare('INSERT INTO addresses (user_id, chain, address) VALUES (?, ?, ?)')
          .bind(user.id, address.chain, address.address),
      );
    }
    await this.db.batch(statements);
  }

  async userById(id: Id): Promise<User | null> {
    const row = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>();
    if (!row) return null;

    const addresses = await this.db
      .prepare('SELECT * FROM addresses WHERE user_id = ?')
      .bind(id)
      .all<AddressRow>();

    return {
      id: row.id,
      displayName: row.display_name,
      createdAt: row.created_at,
      addresses: addresses.results.map((a) => ({ chain: a.chain as Chain, address: a.address })),
    };
  }

  /** Upsert, because someone can connect a wallet long after signing up. */
  async setAddress(userId: Id, chain: Chain, address: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO addresses (user_id, chain, address) VALUES (?, ?, ?)
         ON CONFLICT (user_id, chain) DO UPDATE SET address = excluded.address`,
      )
      .bind(userId, chain, address)
      .run();
  }

  async payoutAddress(userId: Id, chain: Chain): Promise<WalletAddress | null> {
    const row = await this.db
      .prepare('SELECT * FROM addresses WHERE user_id = ? AND chain = ?')
      .bind(userId, chain)
      .first<AddressRow>();
    return row ? { chain: row.chain as Chain, address: row.address } : null;
  }

  async displayNames(): Promise<Record<Id, string>> {
    const rows = await this.db.prepare('SELECT id, display_name FROM users').all<UserRow>();
    const names: Record<Id, string> = {};
    for (const row of rows.results) names[row.id] = row.display_name;
    return names;
  }

  /* ---------------------------- circles ---------------------------- */

  async createCircle(circle: Circle): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO circles (id, kind, name, invite_code, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          circle.id,
          circle.kind,
          circle.name,
          circle.inviteCode,
          circle.createdBy,
          circle.createdAt,
        ),
      this.db
        .prepare('INSERT INTO memberships (circle_id, user_id, joined_at) VALUES (?, ?, ?)')
        .bind(circle.id, circle.createdBy, circle.createdAt),
    ]);
  }

  async circleByCode(code: string): Promise<Circle | null> {
    const row = await this.db
      .prepare('SELECT * FROM circles WHERE invite_code = ?')
      .bind(code.trim().toUpperCase())
      .first<CircleRow>();
    return row ? toCircle(row) : null;
  }

  async circlesFor(userId: Id): Promise<CircleWithCount[]> {
    const rows = await this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM memberships m2 WHERE m2.circle_id = c.id) AS member_count
         FROM circles c
         JOIN memberships m ON m.circle_id = c.id
         WHERE m.user_id = ?
         ORDER BY c.created_at`,
      )
      .bind(userId)
      .all<CircleRow>();
    return rows.results.map((row) => ({ ...toCircle(row), memberCount: row.member_count ?? 0 }));
  }

  async addMembership(circleId: Id, userId: Id): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO memberships (circle_id, user_id, joined_at) VALUES (?, ?, ?)
         ON CONFLICT (circle_id, user_id) DO NOTHING`,
      )
      .bind(circleId, userId, Date.now())
      .run();
  }

  async isMember(circleId: Id, userId: Id): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT 1 AS ok FROM memberships WHERE circle_id = ? AND user_id = ?')
      .bind(circleId, userId)
      .first<{ ok: number }>();
    return !!row;
  }

  /* ----------------------------- events ---------------------------- */

  async appendEvent(event: TaskEvent): Promise<void> {
    const statements = [
      this.db
        .prepare(
          'INSERT INTO events (id, task_id, actor_id, at, type, payload) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(event.id, event.taskId, event.actorId, event.at, event.type, payloadOf(event)),
    ];

    if (event.type === 'task.created') {
      for (const circleId of event.circleIds) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO task_circles (task_id, circle_id) VALUES (?, ?)
               ON CONFLICT (task_id, circle_id) DO NOTHING`,
            )
            .bind(event.taskId, circleId),
        );
      }
    }

    await this.db.batch(statements);
  }

  async eventsForTask(taskId: Id): Promise<TaskEvent[]> {
    const rows = await this.db
      .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY at, rowid')
      .bind(taskId)
      .all<EventRow>();
    return rows.results.map(toEvent);
  }

  async taskById(taskId: Id): Promise<Task | null> {
    return projectTask(await this.eventsForTask(taskId));
  }

  /**
   * Every favour this person may see: posted to one of their circles, or one
   * they acted on themselves (actor covers both poster and doer).
   */
  async tasksVisibleTo(userId: Id): Promise<Task[]> {
    const rows = await this.db
      .prepare(
        `SELECT e.* FROM events e
         WHERE e.task_id IN (
           SELECT tc.task_id FROM task_circles tc
           JOIN memberships m ON m.circle_id = tc.circle_id
           WHERE m.user_id = ?1
           UNION
           SELECT e2.task_id FROM events e2 WHERE e2.actor_id = ?1
         )
         ORDER BY e.task_id, e.at, e.rowid`,
      )
      .bind(userId)
      .all<EventRow>();

    const byTask = new Map<Id, TaskEvent[]>();
    for (const row of rows.results) {
      const list = byTask.get(row.task_id);
      if (list) list.push(toEvent(row));
      else byTask.set(row.task_id, [toEvent(row)]);
    }

    const tasks: Task[] = [];
    for (const events of byTask.values()) {
      const task = projectTask(events);
      if (task) tasks.push(task);
    }
    return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

/** Six characters, no vowels and no look-alikes, so codes can be read aloud. */
export function makeInviteCode(): string {
  const alphabet = '23456789BCDFGHJKLMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
