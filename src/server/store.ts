/**
 * Persistence behind a narrow interface.
 *
 * JsonStore is deliberately boring: a file on disk, rewritten on change. It has
 * no native dependencies and deploys anywhere Node runs, which is what a
 * 12-day build needs. Swap in Postgres later by implementing Store.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Circle, Id, Membership, TaskEvent, User } from '../shared/types.js';

export interface Db {
  users: User[];
  circles: Circle[];
  memberships: Membership[];
  events: TaskEvent[];
}

const EMPTY: Db = { users: [], circles: [], memberships: [], events: [] };

export interface Store {
  read(): Db;
  mutate<T>(fn: (db: Db) => T): T;
}

export class JsonStore implements Store {
  private db: Db;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try {
        this.db = { ...EMPTY, ...JSON.parse(readFileSync(path, 'utf8')) };
      } catch {
        console.warn('[store] could not parse %s, starting empty', path);
        this.db = structuredClone(EMPTY);
      }
    } else {
      this.db = structuredClone(EMPTY);
    }
  }

  read(): Db {
    return this.db;
  }

  mutate<T>(fn: (db: Db) => T): T {
    const result = fn(this.db);
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
    return result;
  }
}

/* ----------------------------- lookups ----------------------------- */

export function userById(db: Db, id: Id): User | undefined {
  return db.users.find((u) => u.id === id);
}

export function circleById(db: Db, id: Id): Circle | undefined {
  return db.circles.find((c) => c.id === id);
}

export function circleByCode(db: Db, code: string): Circle | undefined {
  const wanted = code.trim().toUpperCase();
  return db.circles.find((c) => c.inviteCode === wanted);
}

export function isMember(db: Db, circleId: Id, userId: Id): boolean {
  return db.memberships.some((m) => m.circleId === circleId && m.userId === userId);
}

export function circlesFor(db: Db, userId: Id): Circle[] {
  const ids = new Set(
    db.memberships.filter((m) => m.userId === userId).map((m) => m.circleId),
  );
  return db.circles.filter((c) => ids.has(c.id));
}

export function eventsForTask(db: Db, taskId: Id): TaskEvent[] {
  return db.events.filter((e) => e.taskId === taskId).sort((a, b) => a.at - b.at);
}

export function allTaskIds(db: Db): Id[] {
  const seen = new Set<Id>();
  for (const e of db.events) seen.add(e.taskId);
  return [...seen];
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
