import { Settings } from "luxon";
import { afterEach, describe, expect, it } from "vitest";

import { buildDeterministicBulkDeleteScope } from "../src/integrations/telegram/planning-commands.js";

describe("buildDeterministicBulkDeleteScope", () => {
  afterEach(() => {
    Settings.now = () => Date.now();
  });

  it("resolves next week bulk deletes to the following calendar week", () => {
    Settings.now = () => Date.parse("2026-07-12T12:19:00+03:00");

    const scope = buildDeterministicBulkDeleteScope("видали усі події на наступний тиждень", "Europe/Kiev");

    expect(scope).toMatchObject({
      startsAt: "2026-07-13 00:00",
      endsAt: "2026-07-20 00:00",
    });
  });

  it("keeps plain week bulk deletes on the current calendar week", () => {
    Settings.now = () => Date.parse("2026-07-12T12:19:00+03:00");

    const scope = buildDeterministicBulkDeleteScope("видали усі події цього тижня", "Europe/Kiev");

    expect(scope).toMatchObject({
      startsAt: "2026-07-06 00:00",
      endsAt: "2026-07-13 00:00",
    });
  });

  it("allows calendar wording for bulk deletes", () => {
    Settings.now = () => Date.parse("2026-07-12T12:19:00+03:00");

    const scope = buildDeterministicBulkDeleteScope("очисти весь календар на наступний тиждень", "Europe/Kiev");

    expect(scope).toMatchObject({
      startsAt: "2026-07-13 00:00",
      endsAt: "2026-07-20 00:00",
    });
  });
});
