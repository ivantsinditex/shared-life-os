import { describe, expect, it } from "vitest";

import { formatTaskList, formatTaskSaved } from "../src/domain/task-formatting.js";
import { formatTimeStarted, formatTimeStopped, formatTimeSummary } from "../src/domain/time-entry-formatting.js";
import type { WorkTask } from "../src/domain/task.js";
import type { TimeEntry } from "../src/domain/time-entry.js";

describe("task formatting", () => {
  it("formats task messages in Ukrainian", () => {
    const task = makeTask();

    expect(formatTaskSaved(task)).toContain("Задачу збережено.");
    expect(formatTaskList("Відкриті задачі", [])).toContain("Відкритих задач немає.");
    expect(formatTaskList("Відкриті задачі", [task])).toContain("операційка");
  });
});

describe("time entry formatting", () => {
  it("formats timer messages in Ukrainian", () => {
    const active = makeEntry({ endedAt: undefined });
    const finished = makeEntry({ endedAt: "2026-06-03T10:30:00.000Z" });

    expect(formatTimeStarted(active, "Europe/Kiev")).toContain("Таймер запущено.");
    expect(formatTimeStopped(finished, "Europe/Kiev")).toContain("Тривалість: 30 хв");
    expect(formatTimeSummary("Затреканий час", [finished], "Europe/Kiev")).toContain("Разом: 30 хв");
  });
});

function makeTask(overrides: Partial<WorkTask> = {}): WorkTask {
  return {
    id: "task-12345678",
    title: "Перевірити матеріали",
    basket: "operational",
    participant: "nastia",
    status: "open",
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:00:00.000Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-12345678",
    basket: "operational",
    title: "Операційка",
    participant: "nastia",
    startedAt: "2026-06-03T10:00:00.000Z",
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:00:00.000Z",
    ...overrides,
  };
}
