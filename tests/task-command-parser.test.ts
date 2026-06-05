import { describe, expect, it } from "vitest";

import {
  getTaskAddUsage,
  parseTaskAddCommand,
  parseTaskBasket,
  parseTaskMoveCommand,
} from "../src/domain/task-command-parser.js";

describe("task command parser", () => {
  it("parses task add commands", () => {
    const parsed = parseTaskAddCommand("Reply to client | 911 | vania | Хмельпиво | P1 | 2026-06-06");

    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Reply to client",
        basket: "911",
        participant: "vania",
        project: "Хмельпиво",
        priority: "P1",
        deadline: "2026-06-06",
      },
    });
  });

  it("supports basket aliases", () => {
    expect(parseTaskBasket("операційка")).toBe("operational");
    expect(parseTaskBasket("deep work")).toBe("deep_work");
    expect(parseTaskBasket("бренд")).toBe("personal_brand");
    expect(parseTaskBasket("особистий бренд")).toBe("personal_brand");
    expect(parseTaskBasket("інше")).toBe("other");
  });

  it("parses task add commands with Ukrainian labels", () => {
    const parsed = parseTaskAddCommand("Створити книгу | особистий бренд | Ваня | Re.emotional | P3 | 2026-06-12");

    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Створити книгу",
        basket: "personal_brand",
        participant: "vania",
        project: "Re.emotional",
        priority: "P3",
        deadline: "2026-06-12",
      },
    });
  });

  it("shows task add usage in Ukrainian", () => {
    const usage = getTaskAddUsage();

    expect(usage).toContain("/task_add Назва | кошик | учасник | проект | пріоритет | дедлайн");
    expect(usage).toContain("Кошики: 911, операційка, deep work, рандом, особистий бренд, інше");
    expect(usage).not.toContain("Title | basket");
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
