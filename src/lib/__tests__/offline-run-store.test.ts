import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeOfflineMutations,
  clearAllOfflineRunCaches,
  countPendingOfflineMutations,
  loadOfflineRunCache,
  queueOfflinePreflightMutation,
  queueOfflineStepMutation,
  saveOfflineRunSnapshot,
} from "@/lib/offline-run-store";
import {
  clearEphemeralRunSecrets,
  clearAllEphemeralRunSecrets,
  getEphemeralRunSecrets,
  setEphemeralRunSecrets,
} from "@/lib/ephemeral-run-secrets";
import type { OperationVariable } from "@/server/domain/operations";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();
  public quotaExceeded = false;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.quotaExceeded) {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    this.store.set(key, value);
  }
}

const VARIABLES_SCHEMA: OperationVariable[] = [
  {
    key: "env",
    label: "Environment",
    type: "text",
    required: true,
  },
  {
    key: "api_token",
    label: "API Token",
    type: "secret",
    required: true,
  },
];

describe("offline-run-store & ephemeral-run-secrets isolation + mid-flight ack safety", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    clearAllEphemeralRunSecrets();
  });

  it("strips secret variables before writing to localStorage and invokes onQuotaError on QuotaExceededError", () => {
    const onQuotaError = vi.fn();
    const saved = saveOfflineRunSnapshot({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "prod", api_token: "super-secret-value" },
      prerequisitesChecked: ["p1"],
      stepStates: {},
      onQuotaError,
    });

    expect(saved).not.toBeNull();
    expect(saved?.variablesValues).toEqual({ env: "prod" });
    expect(saved?.variablesValues).not.toHaveProperty("api_token");
    expect(storage.getItem("folio:offline-run:user-a:run-1")).not.toContain(
      "super-secret-value"
    );

    storage.quotaExceeded = true;
    const failed = saveOfflineRunSnapshot({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "staging" },
      prerequisitesChecked: [],
      stepStates: {},
      onQuotaError,
    });
    expect(failed).toBeNull();
    expect(onQuotaError).toHaveBeenCalledTimes(1);
  });

  it("acknowledgeOfflineMutations removes ONLY acknowledged mutationIds and preserves mid-flight queued edits", () => {
    // Queue step-1 and preflight before network sync starts
    const afterPreflight = queueOfflinePreflightMutation({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "prod", api_token: "never-stored" },
      prerequisitesChecked: ["p1"],
      stepStates: {},
    });
    const afterStep1 = queueOfflineStepMutation({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "prod" },
      prerequisitesChecked: ["p1"],
      stepStates: {},
      mutation: { stepKey: "step-1", status: "done", note: "first" },
    });

    const snapshotPfId = afterPreflight!.pendingPreflight!.mutationId;
    const snapshotStep1Id = afterStep1!.pendingStepMutations["step-1"]!.mutationId;
    expect(snapshotPfId).toBeTruthy();
    expect(snapshotStep1Id).toBeTruthy();

    // While network sync is in-flight, user edits step-1 AGAIN and checks step-2!
    const afterMidFlightStep1 = queueOfflineStepMutation({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "prod" },
      prerequisitesChecked: ["p1"],
      stepStates: {},
      mutation: { stepKey: "step-1", status: "done", note: "updated mid-flight" },
    });
    const afterMidFlightStep2 = queueOfflineStepMutation({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "prod" },
      prerequisitesChecked: ["p1"],
      stepStates: {},
      mutation: { stepKey: "step-2", status: "skipped", note: null },
    });

    expect(afterMidFlightStep1!.pendingStepMutations["step-1"]!.mutationId).not.toBe(
      snapshotStep1Id
    );
    expect(countPendingOfflineMutations(afterMidFlightStep2)).toBe(3);

    // Server acknowledges ONLY the original preflight + original step-1 mutationId
    const remaining = acknowledgeOfflineMutations(
      "user-a",
      "run-1",
      VARIABLES_SCHEMA,
      {
        preflightMutationId: snapshotPfId,
        stepMutationIds: { "step-1": snapshotStep1Id },
      }
    );

    expect(remaining?.pendingPreflight).toBeNull();
    // Newer mid-flight step-1 edit AND step-2 MUST survive intact!
    expect(remaining?.pendingStepMutations["step-1"]?.note).toBe(
      "updated mid-flight"
    );
    expect(remaining?.pendingStepMutations["step-2"]?.status).toBe("skipped");
    expect(countPendingOfflineMutations(remaining)).toBe(2);
  });

  it("clearAllOfflineRunCaches purges all tenants' offline run caches on sign-out", () => {
    saveOfflineRunSnapshot({
      userId: "user-a",
      runId: "run-1",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "prod" },
      prerequisitesChecked: [],
      stepStates: {},
    });
    saveOfflineRunSnapshot({
      userId: "user-b",
      runId: "run-2",
      variablesSchema: VARIABLES_SCHEMA,
      variablesValues: { env: "dev" },
      prerequisitesChecked: [],
      stepStates: {},
    });

    expect(loadOfflineRunCache("user-a", "run-1")).not.toBeNull();
    expect(loadOfflineRunCache("user-b", "run-2")).not.toBeNull();

    clearAllOfflineRunCaches();

    expect(loadOfflineRunCache("user-a", "run-1")).toBeNull();
    expect(loadOfflineRunCache("user-b", "run-2")).toBeNull();
  });

  it("namespaces ephemeral RAM secrets by (userId, runId) so cross-tenant reads never collide", () => {
    setEphemeralRunSecrets("user-a", "shared-run-id", { api_token: "secret-A" });
    setEphemeralRunSecrets("user-b", "shared-run-id", { api_token: "secret-B" });

    expect(getEphemeralRunSecrets("user-a", "shared-run-id")).toEqual({
      api_token: "secret-A",
    });
    expect(getEphemeralRunSecrets("user-b", "shared-run-id")).toEqual({
      api_token: "secret-B",
    });

    clearEphemeralRunSecrets("user-a", "shared-run-id");
    expect(getEphemeralRunSecrets("user-a", "shared-run-id")).toEqual({});
    expect(getEphemeralRunSecrets("user-b", "shared-run-id")).toEqual({
      api_token: "secret-B",
    });

    clearAllEphemeralRunSecrets();
    expect(getEphemeralRunSecrets("user-b", "shared-run-id")).toEqual({});
  });
});
