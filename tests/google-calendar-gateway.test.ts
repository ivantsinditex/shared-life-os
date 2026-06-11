import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOOGLE_EVENT_REMINDER_MINUTES,
  toGoogleEvent,
  type CalendarEventDraft,
} from "../src/integrations/calendar/google-calendar-gateway.js";

describe("toGoogleEvent", () => {
  it("adds a default popup reminder when no reminder is provided", () => {
    expect(toGoogleEvent(makeDraft()).reminders).toEqual({
      useDefault: false,
      overrides: [
        {
          method: "popup",
          minutes: DEFAULT_GOOGLE_EVENT_REMINDER_MINUTES,
        },
      ],
    });
  });

  it("uses an explicit popup reminder when provided", () => {
    expect(toGoogleEvent(makeDraft({ reminderMinutes: 10 })).reminders).toEqual({
      useDefault: false,
      overrides: [
        {
          method: "popup",
          minutes: 10,
        },
      ],
    });
  });
});

function makeDraft(overrides: Partial<CalendarEventDraft> = {}): CalendarEventDraft {
  return {
    title: "Воркаут",
    startsAt: "2026-06-12T14:00:00.000+03:00",
    endsAt: "2026-06-12T15:00:00.000+03:00",
    timezone: "Europe/Kiev",
    ...overrides,
  };
}
