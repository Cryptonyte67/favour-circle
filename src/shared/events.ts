/**
 * Reducers over the append-only event ledger.
 *
 * The server stores events, not task rows. Task state is a projection. That
 * keeps disputes, reputation and audit history available later at no cost now.
 */

import type { OwedBucket, Task, TaskEvent, TaskStatus } from './types.js';
import { addUnits } from './money.js';

/** Legal status transitions. The server checks these before appending. */
const ALLOWED: Record<TaskEvent['type'], TaskStatus[]> = {
  'task.created': [],
  'task.claimed': ['open'],
  'task.submitted': ['claimed'],
  'task.approved': ['submitted'],
  'task.settled': ['approved'],
  'task.cancelled': ['open', 'claimed', 'submitted'],
};

export function canApply(type: TaskEvent['type'], status: TaskStatus): boolean {
  return ALLOWED[type].includes(status);
}

export function projectTask(events: TaskEvent[]): Task | null {
  let task: Task | null = null;

  for (const e of events) {
    if (e.type === 'task.created') {
      task = {
        id: e.taskId,
        title: e.title,
        detail: e.detail,
        reward: e.reward,
        posterId: e.actorId,
        doerId: null,
        circleIds: e.circleIds,
        status: 'open',
        createdAt: e.at,
        updatedAt: e.at,
        doneSignature: null,
        settlement: null,
      };
      continue;
    }
    if (!task) continue;
    task.updatedAt = e.at;

    switch (e.type) {
      case 'task.claimed':
        task.doerId = e.actorId;
        task.status = 'claimed';
        break;
      case 'task.submitted':
        task.doneSignature = e.signature;
        task.status = 'submitted';
        break;
      case 'task.approved':
        task.status = 'approved';
        break;
      case 'task.settled':
        task.settlement = { railId: e.railId, txHash: e.txHash, paidTo: e.paidTo, at: e.at };
        task.status = 'settled';
        break;
      case 'task.cancelled':
        task.status = 'cancelled';
        break;
    }
  }

  return task;
}

/**
 * Group approved-but-unsettled tasks into one bucket per (poster, doer, asset).
 *
 * This is the batching that stops Nimiq Pay raising a native confirmation
 * dialog per favour. Ten approved favours settle as one payment, one dialog.
 */
export function owedBuckets(tasks: Task[]): OwedBucket[] {
  const byKey = new Map<string, OwedBucket>();

  for (const t of tasks) {
    if (t.status !== 'approved' || !t.doerId) continue;
    const key = `${t.posterId}|${t.doerId}|${t.reward.assetKey}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.units = addUnits(existing.units, t.reward.units);
      existing.taskIds.push(t.id);
    } else {
      byKey.set(key, {
        posterId: t.posterId,
        doerId: t.doerId,
        assetKey: t.reward.assetKey,
        units: t.reward.units,
        taskIds: [t.id],
      });
    }
  }

  return [...byKey.values()];
}
