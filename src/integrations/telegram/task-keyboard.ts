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

export function buildWorkDashboardKeyboard(projects: string[]): InlineKeyboard | undefined {
  if (projects.length === 0) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();

  projects.forEach((project, index) => {
    keyboard.text(project, `work:project:${index}`).row();
  });

  return keyboard;
}

export function buildProjectKeyboard(tasks: WorkTask[], projectIndex?: number): InlineKeyboard {
  const activeTasks = tasks.filter((task) => task.status !== "closed");
  const keyboard = new InlineKeyboard();

  activeTasks.slice(0, 5).forEach((task, index) => {
    const number = index + 1;

    if (task.status === "open") {
      keyboard.text(`▶️ Старт #${number}`, `task:track:${task.id}`).text(`✅ Готово #${number}`, `task:close:${task.id}`).row();
      keyboard.text(`⚠️ Блок #${number}`, `task:block:${task.id}`).row();
    } else {
      keyboard.text(`↩️ Розблокувати #${number}`, `task:unblock:${task.id}`).row();
    }
  });

  if (projectIndex !== undefined) {
    keyboard
      .text("➕ Додати задачу", `work:project-add:${projectIndex}`)
      .text("📋 Показати всі", `work:project-all:${projectIndex}`)
      .row()
      .text("⚠️ Заблоковані", `work:project-blocked:${projectIndex}`)
      .text("⬅️ Назад", "work:dashboard")
      .row();
  }

  return keyboard;
}
