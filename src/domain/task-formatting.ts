import type { TaskBasket, WorkTask } from "./task.js";

export function formatTaskSaved(task: WorkTask): string {
  return [
    "Task saved.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskMoved(task: WorkTask): string {
  return [
    "Task moved.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskClosed(task: WorkTask): string {
  return [
    "Task closed.",
    "",
    formatTaskLine(task),
  ].join("\n");
}

export function formatTaskList(title: string, tasks: WorkTask[]): string {
  if (tasks.length === 0) {
    return `${title}\n\nNo open tasks.`;
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
    operational: "operational",
    deep_work: "deep work",
    random: "random",
    personal_brand: "personal brand",
    other: "other",
  };

  return labels[basket];
}

function formatTaskLine(task: WorkTask): string {
  const participant = task.participant ? ` | ${task.participant}` : "";

  return `${task.id.slice(0, 8)} | ${formatBasketLabel(task.basket)}${participant} | ${task.title}`;
}
