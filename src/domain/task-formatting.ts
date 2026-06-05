import { DateTime } from "luxon";

import type { TaskBasket, TaskPriority, WorkTask } from "./task.js";

export function formatTaskSaved(task: WorkTask): string {
  return [
    "Задачу збережено.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskMoved(task: WorkTask): string {
  return [
    "Задачу перенесено.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskClosed(task: WorkTask): string {
  return [
    "Задачу закрито.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskBlocked(task: WorkTask): string {
  return [
    "Задачу заблоковано.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskUnblocked(task: WorkTask): string {
  return [
    "Задачу повернуто в роботу.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskList(title: string, tasks: WorkTask[]): string {
  if (tasks.length === 0) {
    return `${title}\n\nВідкритих задач немає.`;
  }

  return [
    title,
    "",
    ...tasks.map((task, index) => `${index + 1}. ${formatTaskLine(task)}`),
  ].join("\n");
}

export function formatWorkDashboard(tasks: WorkTask[], projectNames: string[] = []): string {
  const activeTasks = tasks.filter((task) => task.status !== "closed");

  if (activeTasks.length === 0 && projectNames.length === 0) {
    return "Робочий dashboard\n\nВідкритих задач немає.";
  }

  const projects = groupTasksByProject(activeTasks, projectNames);
  const lines = ["Робочий dashboard", ""];

  for (const [project, projectTasks] of projects) {
    const openTasks = projectTasks.filter((task) => task.status === "open");
    const blockedTasks = projectTasks.filter((task) => task.status === "blocked");
    const counts = countPriorities(projectTasks);
    const dueSoon = projectTasks.filter((task) => isDueWithin(task.deadline, 24)).length;

    lines.push(
      `${project}`,
      `Відкрито: ${openTasks.length} · заблоковано: ${blockedTasks.length} · дедлайн 24г: ${dueSoon}`,
      `P1: ${counts.P1} · P2: ${counts.P2} · P3: ${counts.P3} · P4: ${counts.P4}`,
      "",
    );
  }

  return lines.join("\n").trimEnd();
}

export function formatProjectTaskList(project: string, tasks: WorkTask[]): string {
  const sorted = sortTasksForWork(tasks.filter((task) => task.status !== "closed"));

  if (sorted.length === 0) {
    return `Проект: ${project}\n\nВідкритих задач немає.`;
  }

  return [
    `Проект: ${project}`,
    "",
    ...sorted.map((task, index) => `${index + 1}. ${formatTaskLine(task)}`),
  ].join("\n");
}

export function formatNextTask(task: WorkTask | undefined, project?: string): string {
  if (!task) {
    return project ? `У проекті ${project} немає відкритих задач.` : "Відкритих задач немає.";
  }

  return [
    "Наступна задача:",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function getProjectNames(tasks: WorkTask[], projectNames: string[] = []): string[] {
  return Array.from(groupTasksByProject(tasks.filter((task) => task.status !== "closed"), projectNames).keys());
}

export function sortTasksForWork(tasks: WorkTask[]): WorkTask[] {
  return [...tasks].sort((left, right) => {
    const statusDelta = statusRank(left.status) - statusRank(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const deadlineDelta = deadlineRank(left.deadline) - deadlineRank(right.deadline);
    if (deadlineDelta !== 0) {
      return deadlineDelta;
    }

    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

export function formatBasketLabel(basket: TaskBasket): string {
  const labels: Record<TaskBasket, string> = {
    "911": "911",
    operational: "операційка",
    deep_work: "deep work",
    random: "рандом",
    personal_brand: "особистий бренд",
    other: "інше",
  };

  return labels[basket];
}

export function formatTaskLine(task: WorkTask): string {
  const participant = task.participant ? ` | ${task.participant}` : "";
  const project = task.project ? ` | ${task.project}` : "";
  const priority = task.priority ? ` | ${task.priority}` : "";
  const deadline = task.deadline ? ` | дедлайн ${formatDeadline(task.deadline)}` : "";
  const status = task.status === "blocked" ? " | blocked" : "";

  return `${task.id.slice(0, 8)} | ${formatBasketLabel(task.basket)}${project}${priority}${deadline}${participant}${status} | ${task.title}`;
}

function groupTasksByProject(tasks: WorkTask[], projectNames: string[] = []): Map<string, WorkTask[]> {
  const groups = new Map<string, WorkTask[]>();

  for (const project of projectNames) {
    const trimmed = project.trim();

    if (trimmed) {
      groups.set(trimmed, []);
    }
  }

  for (const task of tasks) {
    const project = task.project?.trim() || "Без проекту";
    groups.set(project, [...(groups.get(project) ?? []), task]);
  }

  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "uk")));
}

function countPriorities(tasks: WorkTask[]): Record<TaskPriority, number> {
  return {
    P1: tasks.filter((task) => task.priority === "P1").length,
    P2: tasks.filter((task) => task.priority === "P2").length,
    P3: tasks.filter((task) => task.priority === "P3").length,
    P4: tasks.filter((task) => task.priority === "P4" || !task.priority).length,
  };
}

function priorityRank(priority: TaskPriority | undefined): number {
  return { P1: 1, P2: 2, P3: 3, P4: 4 }[priority ?? "P4"];
}

function statusRank(status: WorkTask["status"]): number {
  return status === "open" ? 0 : status === "blocked" ? 1 : 2;
}

function deadlineRank(deadline: string | undefined): number {
  if (!deadline) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = Date.parse(deadline);

  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function isDueWithin(deadline: string | undefined, hours: number): boolean {
  if (!deadline) {
    return false;
  }

  const parsed = DateTime.fromISO(deadline);

  return parsed.isValid && parsed.diffNow("hours").hours <= hours && parsed.diffNow("hours").hours >= 0;
}

function formatDeadline(deadline: string): string {
  const parsed = DateTime.fromISO(deadline);

  if (!parsed.isValid) {
    return deadline;
  }

  return parsed.toFormat("yyyy-MM-dd");
}
