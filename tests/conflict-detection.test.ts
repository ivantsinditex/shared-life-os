import { describe, expect, it } from "vitest";

import { activitiesConflict, findConflicts } from "../src/domain/conflict-detection.js";
import type { NewPlannedActivity, PlannedActivity } from "../src/domain/planned-activity.js";

describe("activitiesConflict", () => {
  it("detects overlap for the same participant", () => {
    expect(activitiesConflict(makeRequested({ participant: "vania" }), makeExisting())).toBe(true);
  });

  it("detects overlap when either activity is shared", () => {
    expect(activitiesConflict(makeRequested({ participant: "both" }), makeExisting())).toBe(true);
  });

  it("allows overlapping time for different solo participants", () => {
    expect(activitiesConflict(makeRequested({ participant: "nastia" }), makeExisting())).toBe(false);
  });

  it("ignores deleted activities", () => {
    expect(activitiesConflict(makeRequested(), makeExisting({ syncStatus: "deleted" }))).toBe(false);
  });
});

describe("findConflicts", () => {
  it("suggests nearby available alternatives", () => {
    const result = findConflicts(makeRequested(), [
      makeExisting({
        startsAt: "2026-06-01T08:00:00.000+03:00",
        endsAt: "2026-06-01T09:00:00.000+03:00",
      }),
      makeExisting({
        startsAt: "2026-06-01T09:00:00.000+03:00",
        endsAt: "2026-06-01T10:00:00.000+03:00",
      }),
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.alternatives[0]).toMatchObject({
      startsAt: "2026-06-01T10:00:00.000+03:00",
      endsAt: "2026-06-01T11:00:00.000+03:00",
    });
  });
});

function makeRequested(overrides: Partial<NewPlannedActivity> = {}): NewPlannedActivity {
  return {
    title: "Workout",
    participant: "vania",
    category: "sport",
    startsAt: "2026-06-01T08:00:00.000+03:00",
    endsAt: "2026-06-01T09:00:00.000+03:00",
    timezone: "Europe/Kiev",
    privacy: "busy_only",
    isSharedActivity: false,
    ...overrides,
  };
}

function makeExisting(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: "activity-1",
    title: "Deep work",
    participant: "vania",
    category: "work",
    startsAt: "2026-06-01T08:30:00.000+03:00",
    endsAt: "2026-06-01T09:30:00.000+03:00",
    timezone: "Europe/Kiev",
    privacy: "busy_only",
    isSharedActivity: false,
    syncStatus: "synced",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}
