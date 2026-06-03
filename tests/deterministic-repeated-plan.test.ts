import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { buildDeterministicRepeatedPlan } from "../src/integrations/telegram/planning-commands.js";

describe("buildDeterministicRepeatedPlan", () => {
  it("expands daily workout requests through the end of the current week", () => {
    const activities = buildDeterministicRepeatedPlan(
      "Додай, будь ласка, до кінця тижня на кожний день одне тренування воркаут з другої по третю дня.",
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

  it("expands flexible daily reading and learning requests through the end of the current week", () => {
    const activities = buildDeterministicRepeatedPlan(
      "Додай на кожен день до кінця тижня по дві години читання і дві години навчання у вільні години.",
      {
        currentParticipant: "vania",
        timezone: "Europe/Kiev",
      },
    );

    const now = DateTime.now().setZone("Europe/Kiev");
    const expectedDays = Math.floor(now.endOf("week").startOf("day").diff(now.startOf("day"), "days").days) + 1;

    expect(activities).toHaveLength(expectedDays * 2);
    expect(activities?.[0]).toMatchObject({
      title: "Читання",
      participant: "vania",
      category: "reading",
    });
    expect(activities?.[1]).toMatchObject({
      title: "Навчання",
      participant: "vania",
      category: "learning",
    });
    expect(DateTime.fromISO(activities?.[0]?.startsAt ?? "").setZone("Europe/Kiev").toFormat("HH:mm")).toBe("09:00");
    expect(DateTime.fromISO(activities?.[0]?.endsAt ?? "").setZone("Europe/Kiev").toFormat("HH:mm")).toBe("11:00");
  });
});
