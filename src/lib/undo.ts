/**
 * Phase A undo groundwork.
 * Pure command stack storing before-snapshots of affected docs.
 * Server persistence lives in habit_extensions.undo_snapshots; later phases
 * will wire writes to insert records and show a 5-second Undo toast.
 */

export interface UndoSnapshot<T = unknown> {
  entityType: string;
  entityId: string;
  before: T | null;
  after: T | null;
  createdAt: number;
}

export interface UndoCommand<T = unknown> {
  id: string;
  snapshots: UndoSnapshot<T>[];
  createdAt: number;
}

export function createUndoCommand<T>(
  id: string,
  snapshots: Array<Omit<UndoSnapshot<T>, "createdAt">>,
  now = Date.now()
): UndoCommand<T> {
  return {
    id,
    snapshots: snapshots.map((s) => ({ ...s, createdAt: now })),
    createdAt: now,
  };
}

export function pushUndoCommand<T>(
  stack: UndoCommand<T>[],
  command: UndoCommand<T>,
  max = 50
): UndoCommand<T>[] {
  return [...stack, command].slice(-max);
}

export function popUndoCommand<T>(
  stack: UndoCommand<T>[]
): { stack: UndoCommand<T>[]; command?: UndoCommand<T> } {
  if (stack.length === 0) return { stack };
  return { stack: stack.slice(0, -1), command: stack.at(-1) };
}

export function pruneExpiredUndoCommands<T>(
  stack: UndoCommand<T>[],
  now = Date.now(),
  ttlMs = 5_000
): UndoCommand<T>[] {
  return stack.filter((command) => now - command.createdAt <= ttlMs);
}
