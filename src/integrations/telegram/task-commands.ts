import { type Bot, type Context } from "grammy";

import {
  getTaskAddUsage,
  getTaskMoveUsage,
  parseTaskAddCommand,
  parseTaskBasket,
  parseTaskMoveCommand,
} from "../../domain/task-command-parser.js";
import {
  formatBasketLabel,
  formatNextTask,
  formatProjectTaskList,
  formatTaskBlocked,
  formatTaskClosed,
  formatTaskList,
  formatTaskMoved,
  formatTaskSaved,
  formatTaskUnblocked,
  formatWorkDashboard,
  getProjectNames,
  sortTasksForWork,
} from "../../domain/task-formatting.js";
import { formatActiveTimeEntry, formatTimeStarted } from "../../domain/time-entry-formatting.js";
import type { WorkTaskRepository } from "../../domain/task.js";
import type { WorkProjectRepository } from "../../domain/work-project.js";
import type { AppConfig } from "../../config/config.js";
import type { TimeEntryRepository } from "../../domain/time-entry.js";
import { buildProjectKeyboard, buildTaskListKeyboard, buildWorkDashboardKeyboard } from "./task-keyboard.js";

type TaskCommandDeps = {
  bot: Bot;
  config: AppConfig;
  timeEntries: TimeEntryRepository;
  workProjects: WorkProjectRepository;
  workTasks: WorkTaskRepository;
};

export function createTaskCommands(deps: TaskCommandDeps): void {
  const { bot, config, timeEntries, workProjects, workTasks } = deps;
  const dashboardProjectsByChat = new Map<number, string[]>();

  bot.command("task_add", async (ctx) => {
    const input = getCommandInput(ctx);

    if (!input) {
      await ctx.reply(getTaskAddUsage());
      return;
    }

    const parsed = parseTaskAddCommand(input);

    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const task = await workTasks.create(parsed.value);

    await ctx.reply(formatTaskSaved(task));
  });

  bot.command("tasks", async (ctx) => {
    const input = getCommandInput(ctx);
    const basket = input ? parseTaskBasket(input) : undefined;

    if (input && !basket) {
      await ctx.reply(`Не знаю такого кошика: ${input}`);
      return;
    }

    const tasks = await workTasks.list({ basket, status: "open" });
    const title = basket ? `Відкриті задачі: ${formatBasketLabel(basket)}` : "Відкриті задачі";
    const keyboard = buildTaskListKeyboard(tasks);

    await ctx.reply(formatTaskList(title, tasks), keyboard ? { reply_markup: keyboard } : undefined);
  });

  bot.command("work_dashboard", async (ctx) => {
    const tasks = await workTasks.list();
    const storedProjects = await workProjects.list({ status: "active" });
    const projects = getProjectNames(tasks, storedProjects.map((project) => project.name));
    const chatId = ctx.chat?.id;

    if (chatId) {
      dashboardProjectsByChat.set(chatId, projects);
    }

    const keyboard = buildWorkDashboardKeyboard(projects);

    await ctx.reply(formatWorkDashboard(tasks, storedProjects.map((project) => project.name)), keyboard ? { reply_markup: keyboard } : undefined);
  });

  bot.command("projects", async (ctx) => {
    const projects = await workProjects.list({ status: "active" });

    if (projects.length === 0) {
      await ctx.reply("Проектів ще немає.\n\nСтвори перший:\n/project_add Хмельпиво");
      return;
    }

    await ctx.reply(["Проекти:", "", ...projects.map((project, index) => `${index + 1}. ${project.name}`)].join("\n"));
  });

  bot.command("project_add", async (ctx) => {
    const name = getCommandInput(ctx);

    if (!name) {
      await ctx.reply("Формат:\n/project_add Назва проекту\n\nПриклад:\n/project_add Хмельпиво");
      return;
    }

    const project = await workProjects.create({ name });

    await ctx.reply(`Проект створено: ${project.name}`);
  });

  bot.command("project_rename", async (ctx) => {
    const [oldName, newName] = splitPipeInput(getCommandInput(ctx));

    if (!oldName || !newName) {
      await ctx.reply("Формат:\n/project_rename Стара назва | Нова назва");
      return;
    }

    const project = await workProjects.findByName(oldName);

    if (!project || project.status !== "active") {
      await ctx.reply(`Не знайшов активний проект: ${oldName}`);
      return;
    }

    const updated = await workProjects.update({
      ...project,
      name: newName,
    });

    await ctx.reply(`Проект перейменовано: ${oldName} -> ${updated.name}`);
  });

  bot.command("project_delete", async (ctx) => {
    const name = getCommandInput(ctx);

    if (!name) {
      await ctx.reply("Формат:\n/project_delete Назва проекту");
      return;
    }

    const project = await workProjects.findByName(name);

    if (!project || project.status !== "active") {
      await ctx.reply(`Не знайшов активний проект: ${name}`);
      return;
    }

    const archived = await workProjects.update({
      ...project,
      status: "archived",
      archivedAt: new Date().toISOString(),
    });

    await ctx.reply(`Проект архівовано: ${archived.name}\nЗадачі не видалені.`);
  });

  bot.command("project", async (ctx) => {
    const project = getCommandInput(ctx);

    if (!project) {
      await ctx.reply("Формат:\n/project Назва проекту\n\nПриклад:\n/project Хмельпиво");
      return;
    }

    await replyWithProject(ctx, project);
  });

  bot.command("next_task", async (ctx) => {
    const project = getCommandInput(ctx) || undefined;
    const tasks = await workTasks.list({ project, status: "open" });
    const nextTask = sortTasksForWork(tasks)[0];

    await ctx.reply(formatNextTask(nextTask, project));
  });

  bot.command("task_move", async (ctx) => {
    const input = getCommandInput(ctx);

    if (!input) {
      await ctx.reply(getTaskMoveUsage());
      return;
    }

    const parsed = parseTaskMoveCommand(input);

    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const task = await workTasks.findByShortId(parsed.value.shortId);

    if (!task) {
      await ctx.reply(`Не знайшов задачу з id: ${parsed.value.shortId}`);
      return;
    }

    const updated = await workTasks.update({
      ...task,
      basket: parsed.value.basket,
    });

    await ctx.reply(formatTaskMoved(updated));
  });

  bot.command("task_close", async (ctx) => {
    const shortId = getCommandInput(ctx);

    if (!shortId) {
      await ctx.reply("Формат:\n/task_close short_id");
      return;
    }

    const task = await workTasks.findByShortId(shortId);

    if (!task) {
      await ctx.reply(`Не знайшов задачу з id: ${shortId}`);
      return;
    }

    const now = new Date().toISOString();
    const updated = await workTasks.update({
      ...task,
      status: "closed",
      closedAt: now,
    });

    await ctx.reply(formatTaskClosed(updated));
  });

  bot.callbackQuery(/^task:track:(.+)$/, async (ctx) => {
    const task = await workTasks.getById(ctx.match[1]);

    if (!task || task.status !== "open") {
      await ctx.answerCallbackQuery("Задачу вже закрито або не знайдено.");
      return;
    }

    const active = await timeEntries.getActive({ participant: task.participant });

    if (active) {
      await ctx.answerCallbackQuery("Уже є активний таймер.");
      await ctx.reply(["Уже є активний таймер.", "", formatActiveTimeEntry(active, config.timezone)].join("\n"));
      return;
    }

    const entry = await timeEntries.create({
      basket: task.basket,
      title: task.title,
      participant: task.participant,
      taskId: task.id,
      startedAt: new Date().toISOString(),
    });

    await ctx.answerCallbackQuery("Таймер запущено.");
    await ctx.reply(formatTimeStarted(entry, config.timezone));
  });

  bot.callbackQuery(/^task:close:(.+)$/, async (ctx) => {
    const task = await workTasks.getById(ctx.match[1]);

    if (!task || task.status !== "open") {
      await ctx.answerCallbackQuery("Задачу вже закрито або не знайдено.");
      return;
    }

    const updated = await workTasks.update({
      ...task,
      status: "closed",
      closedAt: new Date().toISOString(),
    });

    await ctx.answerCallbackQuery("Задачу закрито.");
    await ctx.reply(formatTaskClosed(updated));
  });

  bot.callbackQuery(/^task:block:(.+)$/, async (ctx) => {
    const task = await workTasks.getById(ctx.match[1]);

    if (!task || task.status === "closed") {
      await ctx.answerCallbackQuery("Задачу вже закрито або не знайдено.");
      return;
    }

    const updated = await workTasks.update({
      ...task,
      status: "blocked",
    });

    await ctx.answerCallbackQuery("Задачу заблоковано.");
    await ctx.reply(formatTaskBlocked(updated));
  });

  bot.callbackQuery(/^task:unblock:(.+)$/, async (ctx) => {
    const task = await workTasks.getById(ctx.match[1]);

    if (!task || task.status === "closed") {
      await ctx.answerCallbackQuery("Задачу вже закрито або не знайдено.");
      return;
    }

    const updated = await workTasks.update({
      ...task,
      status: "open",
    });

    await ctx.answerCallbackQuery("Задачу повернуто в роботу.");
    await ctx.reply(formatTaskUnblocked(updated));
  });

  bot.callbackQuery(/^work:project:(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    const projects = chatId ? dashboardProjectsByChat.get(chatId) : undefined;
    const project = projects?.[Number(ctx.match[1])];

    if (!project) {
      await ctx.answerCallbackQuery("Онови /work_dashboard і спробуй ще раз.");
      return;
    }

    await ctx.answerCallbackQuery(project);
    await replyWithProject(ctx, project);
  });

  async function replyWithProject(ctx: Context, project: string): Promise<void> {
    const tasks = sortTasksForWork(await workTasks.list({ project }));
    const keyboard = buildProjectKeyboard(tasks);

    await ctx.reply(formatProjectTaskList(project, tasks), keyboard ? { reply_markup: keyboard } : undefined);
  }
}

function getCommandInput(ctx: Context): string {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "";
  const [, ...rest] = text.split(" ");

  return rest.join(" ").trim();
}

function splitPipeInput(input: string): string[] {
  return input.split("|").map((part) => part.trim()).filter(Boolean);
}
