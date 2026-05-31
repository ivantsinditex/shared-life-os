import { describe, expect, it } from "vitest";

import { parsePlanCommand, parseUpdateCommand } from "../src/domain/plan-command-parser.js";

describe("parsePlanCommand", () => {
  it("parses a valid plan command", () => {
    const result = parsePlanCommand(
      "Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only",
      "Europe/Kiev",
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.activity).toMatchObject({
      title: "Workout",
      participant: "vania",
      category: "sport",
      privacy: "busy_only",
      isSharedActivity: false,
    });
    expect(result.activity.startsAt).toContain("2026-06-01T08:00:00.000+03:00");
    expect(result.activity.endsAt).toContain("2026-06-01T09:00:00.000+03:00");
  });

  it("rejects unknown categories", () => {
    const result = parsePlanCommand(
      "Workout | vania | unknown | 2026-06-01 08:00 | 60 | busy_only",
      "Europe/Kiev",
    );

    expect(result.ok).toBe(false);
  });
});

describe("parseUpdateCommand", () => {
  it("parses an update command with a short id", () => {
    const result = parseUpdateCommand(
      "ab12cd34 | Yoga | vania | sport | 2026-06-01 19:00 | 60 | busy_only",
      "Europe/Kiev",
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.shortId).toBe("ab12cd34");
    expect(result.activity.title).toBe("Yoga");
  });
});
