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
  formatTaskClosed,
  formatTaskList,
  formatTaskMoved,
  formatTaskSaved,
} from "../../domain/task-formatting.js";
import { formatActiveTimeEntry, formatTimeStarted } from "../../domain/time-entry-formatting.js";
import type { WorkTaskRepository } from "../../domain/task.js";
import type { AppConfig } from "../../config/config.js";
import type { TimeEntryRepository } from "../../domain/time-entry.js";
import { buildTaskListKeyboard } from "./task-keyboard.js";

type TaskCommandDeps = {
  bot: Bot;
  config: AppConfig;
  timeEntries: TimeEntryRepository;
  workTasks: WorkTaskRepository;
};

export function createTaskCommands(deps: TaskCommandDeps): void {
  const { bot, config, timeEntries, workTasks } = deps;

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
}

function getCommandInput(ctx: Context): string {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "";
  const [, ...rest] = text.split(" ");

  return rest.join(" ").trim();
}
