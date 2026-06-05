import { describe, expect, it } from "vitest";

import {
  formatNextTask,
  formatProjectTaskList,
  formatTaskList,
  formatTaskSaved,
  formatWorkDashboard,
  sortTasksForWork,
} from "../src/domain/task-formatting.js";
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

  it("formats project dashboard and sorts next work task", () => {
    const tasks = [
      makeTask({ title: "P4 old", priority: "P4", project: "Хмельпиво", deadline: "2026-06-10" }),
      makeTask({ title: "P1 later", priority: "P1", project: "Хмельпиво", deadline: "2026-06-09" }),
      makeTask({ title: "P1 soon", priority: "P1", project: "Хмельпиво", deadline: "2026-06-06" }),
    ];

    expect(formatWorkDashboard(tasks)).toContain("Хмельпиво");
    expect(formatWorkDashboard(tasks)).toContain("P1: 2");
    expect(formatProjectTaskList("Хмельпиво", tasks)).toContain("дедлайн 2026-06-06");
    expect(sortTasksForWork(tasks)[0]?.title).toBe("P1 soon");
    expect(formatNextTask(sortTasksForWork(tasks)[0], "Хмельпиво")).toContain("P1 soon");
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
