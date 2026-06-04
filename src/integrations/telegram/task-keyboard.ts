import { InlineKeyboard } from "grammy";

import type { WorkTask } from "../../domain/task.js";

export function buildTaskListKeyboard(tasks: WorkTask[]): InlineKeyboard | undefined {
  const openTasks = tasks.filter((task) => task.status === "open");

  if (openTasks.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();

  openTasks.forEach((task, index) => {
    const number = index + 1;

    keyboard
      .text(`▶ ${number}`, `task:track:${task.id}`)
      .text(`✓ ${number}`, `task:close:${task.id}`)
      .row();
  });

  return keyboard;
}

export function buildCloseTaskKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard().text("✓ Закрити задачу", `task:close:${taskId}`);
}
