import { describe, expect, it } from "vitest";

import { renderCalendarTitle, toGoogleVisibility } from "../src/domain/privacy-rendering.js";

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
});
