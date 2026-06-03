import type { TaskBasket, WorkTask } from "./task.js";

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

function formatTaskLine(task: WorkTask): string {
  const participant = task.participant ? ` | ${task.participant}` : "";

  return `${task.id.slice(0, 8)} | ${formatBasketLabel(task.basket)}${participant} | ${task.title}`;
}
