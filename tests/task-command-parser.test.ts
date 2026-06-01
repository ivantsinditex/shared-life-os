import { describe, expect, it } from "vitest";

import {
  parseTaskAddCommand,
  parseTaskBasket,
  parseTaskMoveCommand,
} from "../src/domain/task-command-parser.js";

describe("task command parser", () => {
  it("parses task add commands", () => {
    const parsed = parseTaskAddCommand("Reply to client | 911 | vania");

    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Reply to client",
        basket: "911",
        participant: "vania",
      },
    });
  });

  it("supports basket aliases", () => {
    expect(parseTaskBasket("операційка")).toBe("operational");
    expect(parseTaskBasket("deep work")).toBe("deep_work");
    expect(parseTaskBasket("бренд")).toBe("personal_brand");
  });

  it("parses task move commands", () => {
    const parsed = parseTaskMoveCommand("ab12cd34 | deep_work");

    expect(parsed).toEqual({
      ok: true,
      value: {
        shortId: "ab12cd34",
        basket: "deep_work",
      },
    });
  });
});
