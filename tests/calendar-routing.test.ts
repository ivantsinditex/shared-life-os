import { describe, expect, it } from "vitest";

import { getCalendarId } from "../src/integrations/calendar/google-calendar-gateway.js";
import type { AppConfig } from "../src/config/config.js";

describe("calendar routing", () => {
  it("routes solo and shared participants to different calendars", () => {
    const config = makeConfig();

    expect(getCalendarId(config, "vania")).toBe("vania-calendar");
    expect(getCalendarId(config, "nastia")).toBe("nastia-calendar");
    expect(getCalendarId(config, "both")).toBe("shared-calendar");
  });

  it("fails when the target participant calendar is not configured", () => {
    const config = makeConfig({
      googleCalendars: {
        vania: "vania-calendar",
      },
    });

    expect(() => getCalendarId(config, "nastia")).toThrow(
      'Google Calendar ID is not configured for participant "nastia"',
    );
  });
});

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramBotToken: "token",
    timezone: "Europe/Kiev",
    dataDir: "./data",
    googleCalendars: {
      vania: "vania-calendar",
      nastia: "nastia-calendar",
      shared: "shared-calendar",
    },
    googleClientEmail: "bot@example.com",
    googlePrivateKey: "private-key",
    users: [],
    ...overrides,
  };
}
