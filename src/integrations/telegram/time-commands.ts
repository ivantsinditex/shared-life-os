import { DateTime } from "luxon";
import { type Bot, type Context } from "grammy";

import type { AppConfig } from "../../config/config.js";
import { parseParticipant, parseTaskBasket } from "../../domain/task-command-parser.js";
import {
  formatActiveTimeEntry,
  formatTimeStarted,
  formatTimeStopped,
  formatTimeSummary,
} from "../../domain/time-entry-formatting.js";
import type { TimeEntryRepository } from "../../domain/time-entry.js";
import type { WorkTaskRepository } from "../../domain/task.js";

type TimeCommandDeps = {
  bot: Bot;
  config: AppConfig;
  timeEntries: TimeEntryRepository;
  workTasks: WorkTaskRepository;
};

export function createTimeCommands(deps: TimeCommandDeps): void {
  const { bot, config, timeEntries, workTasks } = deps;

  bot.command("time_start", async (ctx) => {
    const input = getCommandInput(ctx);

    if (!input) {
      await ctx.reply(getTimeStartUsage());
      return;
    }

    const parts = splitCommand(input);
    const target = parts[0];
    const titleInput = parts[1];
    const participant = parts[2] ? parseParticipant(parts[2]) : undefined;

    if (parts[2] && !participant) {
      await ctx.reply(`Не знаю такого учасника: ${parts[2]}`);
      return;
    }

    const active = await timeEntries.getActive({ participant });

    if (active) {
      await ctx.reply(["Уже є активний таймер.", "", formatActiveTimeEntry(active, config.timezone)].join("\n"));
      return;
    }

    const task = await workTasks.findByShortId(target);
    const basket = task ? task.basket : parseTaskBasket(target);

    if (!basket) {
      await ctx.reply(`Не знаю такого кошика або id задачі: ${target}\n\n${getTimeStartUsage()}`);
      return;
    }

    const entry = await timeEntries.create({
      basket,
      title: titleInput || task?.title || basket,
      participant: participant ?? task?.participant,
      taskId: task?.id,
      startedAt: new Date().toISOString(),
    });

    await ctx.reply(formatTimeStarted(entry, config.timezone));
  });

  bot.command("time_stop", async (ctx) => {
    const input = getCommandInput(ctx);
    const participant = input ? parseParticipant(input) : undefined;

    if (input && !participant) {
      await ctx.reply(`Не знаю такого учасника: ${input}`);
      return;
    }

    const active = await timeEntries.getActive({ participant });

    if (!active) {
      await ctx.reply("Активного таймера немає.");
      return;
    }

    const updated = await timeEntries.update({
      ...active,
      endedAt: new Date().toISOString(),
    });

    await ctx.reply(formatTimeStopped(updated, config.timezone));
  });

  bot.command("time_status", async (ctx) => {
    const input = getCommandInput(ctx);
    const participant = input ? parseParticipant(input) : undefined;

    if (input && !participant) {
      await ctx.reply(`Не знаю такого учасника: ${input}`);
      return;
    }

    const active = await timeEntries.getActive({ participant });

    await ctx.reply(formatActiveTimeEntry(active, config.timezone));
  });

  bot.command("time_today", async (ctx) => {
    const input = getCommandInput(ctx);
    const participant = input ? parseParticipant(input) : undefined;

    if (input && !participant) {
      await ctx.reply(`Не знаю такого учасника: ${input}`);
      return;
    }

    const now = DateTime.now().setZone(config.timezone);
    const entries = await timeEntries.listBetween({
      startsAt: toIso(now.startOf("day")),
      endsAt: toIso(now.plus({ days: 1 }).startOf("day")),
      participant,
    });

    await ctx.reply(formatTimeSummary("Затреканий час сьогодні", entries, config.timezone));
  });

  bot.command("time_week", async (ctx) => {
    const input = getCommandInput(ctx);
    const participant = input ? parseParticipant(input) : undefined;

    if (input && !participant) {
      await ctx.reply(`Не знаю такого учасника: ${input}`);
      return;
    }

    const now = DateTime.now().setZone(config.timezone);
    const entries = await timeEntries.listBetween({
      startsAt: toIso(now.startOf("week")),
      endsAt: toIso(now.plus({ weeks: 1 }).startOf("week")),
      participant,
    });

    await ctx.reply(formatTimeSummary("Затреканий час цього тижня", entries, config.timezone));
  });
}

function getTimeStartUsage(): string {
  return [
    "Формат:",
    "/time_start basket_or_task_id | title | participant",
    "",
    "Приклади:",
    "/time_start deep_work | Architecture planning | vania",
    "/time_start ab12cd34",
  ].join("\n");
}

function getCommandInput(ctx: Context): string {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "";
  const [, ...rest] = text.split(" ");

  return rest.join(" ").trim();
}

function splitCommand(input: string): string[] {
  return input.split("|").map((part) => part.trim()).filter(Boolean);
}

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
