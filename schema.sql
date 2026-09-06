-- Favour Circle schema for Cloudflare D1.
--
-- The events table is the source of truth: task state is a projection over it,
-- never a stored row. Users, circles and memberships are ordinary records.

DROP TABLE IF EXISTS diagnostics;
DROP TABLE IF EXISTS task_circles;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS circles;
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

-- One payout address per (user, chain). A NIM favour resolves to their Nimiq
-- address, a USDT favour to their EVM one.
CREATE TABLE addresses (
  user_id TEXT NOT NULL REFERENCES users(id),
  chain   TEXT NOT NULL,
  address TEXT NOT NULL,
  PRIMARY KEY (user_id, chain)
);

CREATE TABLE circles (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

CREATE TABLE memberships (
  circle_id TEXT NOT NULL REFERENCES circles(id),
  user_id   TEXT NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);

-- Append-only. Nothing here is ever updated or deleted.
CREATE TABLE events (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  at       INTEGER NOT NULL,
  type     TEXT NOT NULL,
  payload  TEXT NOT NULL
);

-- Derived from task.created payloads at append time. Pure convenience: it lets
-- "which favours can this person see" be one indexed query instead of scanning
-- and parsing every event payload.
CREATE TABLE task_circles (
  task_id   TEXT NOT NULL,
  circle_id TEXT NOT NULL REFERENCES circles(id),
  PRIMARY KEY (task_id, circle_id)
);

CREATE INDEX idx_events_task ON events(task_id, at);
CREATE INDEX idx_events_actor ON events(actor_id);
CREATE INDEX idx_task_circles_circle ON task_circles(circle_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_circles_code ON circles(invite_code);

-- Development aid: lets a phone hand its capability report to a desktop browser.
-- Nothing depends on it. Drop the table and the two routes before production.
CREATE TABLE diagnostics (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX idx_diagnostics_at ON diagnostics(at);
