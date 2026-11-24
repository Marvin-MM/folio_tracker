import { describe, expect, it } from "vitest";
import {
  CORE_HABIT_ANCHORS,
  defaultHabitMetadata,
  deriveIsCore,
  deriveTimeBlock,
  isEnergyNeed,
  isLogSource,
  isMissReason,
  isPlace,
  normalizeTags,
  parseTagsJson,
  resolveMissReasonForLog,
  serializeTags,
} from "@/server/domain/habit-metadata";

describe("habit metadata guards", () => {
  it("accepts only declared enum values", () => {
    expect(isEnergyNeed("low")).toBe(true);
    expect(isEnergyNeed("high")).toBe(true);
    expect(isEnergyNeed("urgent")).toBe(false);
    expect(isEnergyNeed(null)).toBe(false);

    expect(isPlace("commute")).toBe(true);
    expect(isPlace("gym")).toBe(false);

    expect(isMissReason("low_motivation")).toBe(true);
    expect(isMissReason("busy")).toBe(false);

    expect(isLogSource("button")).toBe(true);
    expect(isLogSource("api")).toBe(false);
  });
});

describe("resolveMissReasonForLog", () => {
  it("keeps a reason only for missed logs", () => {
    expect(resolveMissReasonForLog("missed", "tired")).toBe("tired");
    expect(resolveMissReasonForLog("missed", "bogus" as "tired")).toBeNull();
    expect(resolveMissReasonForLog("missed", null)).toBeNull();
    expect(resolveMissReasonForLog("done", "tired")).toBeNull();
    expect(resolveMissReasonForLog("skipped", "work")).toBeNull();
    expect(resolveMissReasonForLog(null, "sick")).toBeNull();
  });
});

describe("tag normalization", () => {
  it("normalizes, deduplicates, and sorts tags", () => {
    expect(
      normalizeTags([" #Core ", "core", "Morning Focus", "", "deep-work"])
    ).toEqual(["core", "deep-work", "morning-focus"]);
  });

  it("caps tags at 12 and each tag at 32 characters", () => {
    const tags = Array.from({ length: 15 }, (_, index) => `tag-${index}`);
    expect(normalizeTags(tags)).toHaveLength(12);
    expect(normalizeTags(["x".repeat(50)])[0]).toHaveLength(32);
    expect(normalizeTags(null)).toEqual([]);
  });

  it("round-trips serialized tags and tolerates malformed JSON", () => {
    const json = serializeTags(["#Morning", "morning", "core"]);
    expect(json).toBe('["core","morning"]');
    expect(parseTagsJson(json)).toEqual(["core", "morning"]);
    expect(parseTagsJson("not json")).toEqual([]);
    expect(parseTagsJson('{"tags":[]}')).toEqual([]);
  });
});

describe("defaultHabitMetadata", () => {
  it("infers high-energy habits", () => {
    expect(defaultHabitMetadata("100 push-ups")).toEqual({
      energyNeed: "high",
      place: "home",
      tags: [],
    });
    expect(defaultHabitMetadata("Study block").energyNeed).toBe("high");
    expect(defaultHabitMetadata("Evening run").energyNeed).toBe("high");
    expect(defaultHabitMetadata("Gym").energyNeed).toBe("high");
  });

  it("infers low-energy habits", () => {
    expect(defaultHabitMetadata("Journal before bed")).toEqual({
      energyNeed: "low",
      place: "home",
      tags: [],
    });
    expect(defaultHabitMetadata("Gratitude").energyNeed).toBe("low");
    expect(defaultHabitMetadata("Hydrate").place).toBe("home");
  });

  it("infers place with commute precedence and falls back safely", () => {
    expect(defaultHabitMetadata("Commute study").place).toBe("commute");
    expect(defaultHabitMetadata("Office work").place).toBe("work");
    expect(defaultHabitMetadata("Read").place).toBe("anywhere");
    expect(defaultHabitMetadata("   ")).toEqual({
      energyNeed: "medium",
      place: "anywhere",
      tags: [],
    });
  });
});

describe("deriveTimeBlock", () => {
  it("maps valid times to morning/afternoon/evening", () => {
    expect(deriveTimeBlock("08:30")).toBe("morning");
    expect(deriveTimeBlock("13:05")).toBe("afternoon");
    expect(deriveTimeBlock("22:15")).toBe("evening");
  });

  it("uses anytime for missing or invalid times", () => {
    expect(deriveTimeBlock(null)).toBe("anytime");
    expect(deriveTimeBlock("25:00")).toBe("anytime");
    expect(deriveTimeBlock("7:00")).toBe("anytime");
  });
});

describe("deriveIsCore", () => {
  it("recognizes canonical anchors and core category", () => {
    for (const anchor of CORE_HABIT_ANCHORS) {
      expect(deriveIsCore(anchor)).toBe(true);
    }
    expect(deriveIsCore("Hydrate!", "Core")).toBe(true);
    expect(deriveIsCore("Pray · Meditate · Gratitude")).toBe(true);
  });

  it("rejects non-anchors", () => {
    expect(deriveIsCore("Random chore", "Home")).toBe(false);
    expect(deriveIsCore("Hydration reminder")).toBe(false);
  });
});
