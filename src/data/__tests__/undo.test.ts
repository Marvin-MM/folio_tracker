import { describe, expect, it } from "vitest";
import {
  createUndoCommand,
  popUndoCommand,
  pruneExpiredUndoCommands,
  pushUndoCommand,
} from "../undo";

describe("undo command stack", () => {
  it("stores before snapshots with timestamps", () => {
    const cmd = createUndoCommand("u1", [
      { entityType: "habit_log", entityId: "l1", before: { status: null }, after: { status: "done" } },
    ], 1000);
    expect(cmd.snapshots[0]?.before).toEqual({ status: null });
    expect(cmd.snapshots[0]?.createdAt).toBe(1000);
  });

  it("pushes and pops in LIFO order", () => {
    const a = createUndoCommand("a", [], 1000);
    const b = createUndoCommand("b", [], 1001);
    const stack = pushUndoCommand(pushUndoCommand([], a), b);
    const popped = popUndoCommand(stack);
    expect(popped.command?.id).toBe("b");
    expect(popped.stack.map((c) => c.id)).toEqual(["a"]);
  });

  it("prunes expired commands", () => {
    const old = createUndoCommand("old", [], 1000);
    const fresh = createUndoCommand("fresh", [], 6000);
    expect(pruneExpiredUndoCommands([old, fresh], 7000, 5000).map((c) => c.id)).toEqual(["fresh"]);
  });
});
