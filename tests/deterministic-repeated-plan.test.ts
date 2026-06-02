import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { buildDeterministicRepeatedPlan } from "../src/integrations/telegram/planning-commands.js";

describe("buildDeterministicRepeatedPlan", () => {
  it("expands daily workout requests through the end of the current week", () => {
    const activities = buildDeterministicRepeatedPlan(
      "Додай, будь ласка, на кожен день до кінця тижня цього по одному тренуванню воркаут для мене з другої по третю годину.",
      {
        currentParticipant: "vania",
        timezone: "Europe/Kiev",
      },
    );

    const now = DateTime.now().setZone("Europe/Kiev");
    const expectedCount = Math.floor(now.endOf("week").startOf("day").diff(now.startOf("day"), "days").days) + 1;

    expect(activities).toHaveLength(expectedCount);
    expect(activities?.[0]).toMatchObject({
      title: "Воркаут",
      participant: "vania",
      category: "sport",
      timezone: "Europe/Kiev",
      privacy: "busy_only",
      isSharedActivity: false,
    });
    expect(DateTime.fromISO(activities?.[0]?.startsAt ?? "").setZone("Europe/Kiev").toFormat("HH:mm")).toBe("14:00");
    expect(DateTime.fromISO(activities?.[0]?.endsAt ?? "").setZone("Europe/Kiev").toFormat("HH:mm")).toBe("15:00");
  });
});
