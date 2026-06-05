import { describe, expect, it } from "vitest";

import {
  renderCalendarColorId,
  renderCalendarDescription,
  renderCalendarTitle,
  toGoogleVisibility,
} from "../src/domain/privacy-rendering.js";
import type { PlannedActivity } from "../src/domain/planned-activity.js";

describe("privacy rendering", () => {
  it("keeps busy-only details visible for shared calendar members", () => {
    expect(
      renderCalendarTitle({
        title: "Nastia care",
        participant: "nastia",
        category: "care",
        privacy: "busy_only",
      }),
    ).toBe("Настя · 🧴 Nastia care");
  });

  it("hides private details", () => {
    expect(
      renderCalendarTitle({
        title: "Nastia care",
        participant: "nastia",
        category: "care",
        privacy: "private",
      }),
    ).toBe("Настя · зайнята");
  });

  it("keeps shared details visible", () => {
    expect(
      renderCalendarTitle({
        title: "Together dinner",
        participant: "both",
        category: "together",
        privacy: "shared_details",
      }),
    ).toBe("Разом · ❤️ Together dinner");
  });

  it("adds participant labels and contextual icons to visible titles", () => {
    expect(
      renderCalendarTitle({
        title: "Воркаут",
        participant: "vania",
        category: "sport",
        privacy: "shared_details",
      }),
    ).toBe("Ваня · 🏋️ Воркаут");

    expect(
      renderCalendarTitle({
        title: "Прогулянка з драйвом",
        participant: "vania",
        category: "dogs",
        privacy: "shared_details",
      }),
    ).toBe("Ваня · 🚶 Прогулянка з драйвом");

    expect(
      renderCalendarTitle({
        title: "Прогулянка",
        participant: "both",
        category: "together",
        privacy: "shared_details",
      }),
    ).toBe("Разом · 🚶‍♂️🚶‍♀️ Прогулянка");
  });

  it("maps sensitive events to private Google visibility", () => {
    expect(toGoogleVisibility("private")).toBe("private");
    expect(toGoogleVisibility("busy_only")).toBe("default");
    expect(toGoogleVisibility("shared_details")).toBe("default");
  });

  it("keeps internal details in busy-only descriptions", () => {
    const description = renderCalendarDescription(
      makeActivity({
        title: "Deep private focus",
        privacy: "busy_only",
      }),
    );

    expect(description).toContain("Deep private focus");
    expect(description).toContain("Приватність: показувати тільки зайнятість");
  });

  it("does not leak internal details in private descriptions", () => {
    const description = renderCalendarDescription(
      makeActivity({
        title: "Deep private focus",
        privacy: "private",
      }),
    );

    expect(description).not.toContain("Deep private focus");
    expect(description).toContain("Деталі приватні та доступні тільки в боті.");
  });

  it("keeps details in shared event descriptions", () => {
    const description = renderCalendarDescription(
      makeActivity({
        title: "Together dinner",
        privacy: "shared_details",
      }),
    );

    expect(description).toContain("Together dinner");
    expect(description).toContain("Категорія: робота");
  });

  it("maps visible categories to distinct Google Calendar colors", () => {
    expect(renderCalendarColorId(makeActivity({ category: "sport" }))).toBe("10");
    expect(renderCalendarColorId(makeActivity({ category: "work" }))).toBe("9");
    expect(renderCalendarColorId(makeActivity({ category: "horse" }))).toBe("6");
    expect(renderCalendarColorId(makeActivity({ category: "together" }))).toBe("4");
  });

  it("uses a neutral color for private events", () => {
    expect(renderCalendarColorId(makeActivity({ category: "sport", privacy: "private" }))).toBe("8");
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
