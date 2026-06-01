import { DateTime } from "luxon";
import { type Bot, type Context } from "grammy";

import type { AppConfig } from "../../config/config.js";
import { formatAnalyticsSummary } from "../../domain/analytics-summary.js";
import { parseParticipant } from "../../domain/task-command-parser.js";
import type { Participant, PlannedActivityRepository } from "../../domain/planned-activity.js";
import type { TimeEntryRepository } from "../../domain/time-entry.js";
import type { WorkTaskRepository } from "../../domain/task.js";

type AnalyticsCommandDeps = {
  bot: Bot;
  config: AppConfig;
  plannedActivities: PlannedActivityRepository;
  timeEntries: TimeEntryRepository;
  workTasks: WorkTaskRepository;
};

export function createAnalyticsCommands(deps: AnalyticsCommandDeps): void {
  const { bot } = deps;

  bot.command("analytics_week", async (ctx) => {
    await replyWithAnalytics(ctx, "week", deps);
  });

  bot.command("analytics_month", async (ctx) => {
    await replyWithAnalytics(ctx, "month", deps);
  });

  bot.command("analytics_today", async (ctx) => {
    await replyWithAnalytics(ctx, "today", deps);
  });

  async function replyWithAnalytics(
    ctx: Context,
    period: "today" | "week" | "month",
    dependencies: AnalyticsCommandDeps,
  ): Promise<void> {
    const participant = parseParticipantInput(ctx);

    if (participant === "invalid") {
      await ctx.reply("Unknown participant. Use vania, nastia, or both.");
      return;
    }

    const { startsAt, endsAt, title } = getPeriodRange(period, dependencies.config.timezone);
    const planned = await dependencies.plannedActivities.listBetween({
      startsAt,
      endsAt,
      participant,
    });
    const tracked = await dependencies.timeEntries.listBetween({
      startsAt,
      endsAt,
      participant,
    });
    const active = await dependencies.timeEntries.getActive({ participant });
    const openTasks = await dependencies.workTasks.list({ status: "open" });

    await ctx.reply(
      formatAnalyticsSummary({
        title,
        plannedActivities: planned,
        timeEntries: tracked,
        openTasks,
        activeTimeEntry: active,
      }),
    );
  }
}

function parseParticipantInput(ctx: Context): Participant | "invalid" | undefined {
  const input = getCommandInput(ctx);

  if (!input) {
    return undefined;
  }

  return parseParticipant(input) ?? "invalid";
}

function getPeriodRange(
  period: "today" | "week" | "month",
  timezone: string,
): { startsAt: string; endsAt: string; title: string } {
  const now = DateTime.now().setZone(timezone);

  if (period === "today") {
    return {
      startsAt: toIso(now.startOf("day")),
      endsAt: toIso(now.plus({ days: 1 }).startOf("day")),
      title: "Analytics today",
    };
  }

  if (period === "week") {
    return {
      startsAt: toIso(now.startOf("week")),
      endsAt: toIso(now.plus({ weeks: 1 }).startOf("week")),
      title: "Analytics this week",
    };
  }

  return {
    startsAt: toIso(now.startOf("month")),
    endsAt: toIso(now.plus({ months: 1 }).startOf("month")),
    title: "Analytics this month",
  };
}

function getCommandInput(ctx: Context): string {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "";
  const [, ...rest] = text.split(" ");

  return rest.join(" ").trim();
}

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
