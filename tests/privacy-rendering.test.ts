import { describe, expect, it } from "vitest";

import {
  renderCalendarDescription,
  renderCalendarTitle,
  toGoogleVisibility,
} from "../src/domain/privacy-rendering.js";
import type { PlannedActivity } from "../src/domain/planned-activity.js";

describe("privacy rendering", () => {
  it("hides busy-only details", () => {
    expect(
      renderCalendarTitle({
        title: "Nastia care",
        participant: "nastia",
        privacy: "busy_only",
      }),
    ).toBe("Nastia busy");
  });

  it("keeps shared details visible", () => {
    expect(
      renderCalendarTitle({
        title: "Together dinner",
        participant: "both",
        privacy: "shared_details",
      }),
    ).toBe("Together dinner");
  });

  it("maps sensitive events to private Google visibility", () => {
    expect(toGoogleVisibility("private")).toBe("private");
    expect(toGoogleVisibility("busy_only")).toBe("private");
    expect(toGoogleVisibility("shared_details")).toBe("default");
  });

  it("does not leak internal details in busy-only descriptions", () => {
    const description = renderCalendarDescription(
      makeActivity({
        title: "Deep private focus",
        privacy: "busy_only",
      }),
    );

    expect(description).not.toContain("Deep private focus");
    expect(description).toContain("Details are private in the bot.");
  });

  it("keeps details in shared event descriptions", () => {
    const description = renderCalendarDescription(
      makeActivity({
        title: "Together dinner",
        privacy: "shared_details",
      }),
    );

    expect(description).toContain("Together dinner");
    expect(description).toContain("Category: work");
  });
});

function makeActivity(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: "activity-1",
    title: "Work",
    participant: "vania",
    category: "work",
    startsAt: "2026-06-01T09:00:00.000+03:00",
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
