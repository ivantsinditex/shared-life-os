import { DateTime } from "luxon";
import { type Bot, type Context } from "grammy";

import type { AppConfig } from "../../config/config.js";
import { formatAnalyticsSummary, type AnalyticsTrendBucket } from "../../domain/analytics-summary.js";
import { parseParticipant } from "../../domain/task-command-parser.js";
import type { Participant, PlannedActivityRepository } from "../../domain/planned-activity.js";
import type { TimeEntryRepository } from "../../domain/time-entry.js";
import type { WorkTaskRepository } from "../../domain/task.js";
import type { AnalyticsInsightsGateway } from "../ai/openai-analytics-insights-gateway.js";

type AnalyticsCommandDeps = {
  bot: Bot;
  config: AppConfig;
  analyticsInsights: AnalyticsInsightsGateway;
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

    const { startsAt, endsAt, title, trendBuckets } = getPeriodRange(period, dependencies.config.timezone);
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

    const report = formatAnalyticsSummary({
      title,
      plannedActivities: planned,
      timeEntries: tracked,
      openTasks,
      activeTimeEntry: active,
      trendBuckets,
    });
    const insight = await generateInsightSafely(dependencies.analyticsInsights, report);

    await ctx.reply(insight ? [report, "", "AI insight:", insight].join("\n") : report);
  }
}

async function generateInsightSafely(
  analyticsInsights: AnalyticsInsightsGateway,
  report: string,
): Promise<string | undefined> {
  if (!analyticsInsights.isEnabled()) {
    return undefined;
  }

  try {
    return await analyticsInsights.generate({ report, languageHint: "uk" });
  } catch {
    return undefined;
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
): { startsAt: string; endsAt: string; title: string; trendBuckets: AnalyticsTrendBucket[] } {
  const now = DateTime.now().setZone(timezone);

  if (period === "today") {
    const startsAt = now.startOf("day");
    const endsAt = now.plus({ days: 1 }).startOf("day");

    return {
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
      title: "Analytics today",
      trendBuckets: buildHourlyBuckets(startsAt, endsAt),
    };
  }

  if (period === "week") {
    const startsAt = now.startOf("week");
    const endsAt = now.plus({ weeks: 1 }).startOf("week");

    return {
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
      title: "Analytics this week",
      trendBuckets: buildDailyBuckets(startsAt, endsAt),
    };
  }

  const startsAt = now.startOf("month");
  const endsAt = now.plus({ months: 1 }).startOf("month");

  return {
    startsAt: toIso(startsAt),
    endsAt: toIso(endsAt),
    title: "Analytics this month",
    trendBuckets: buildWeeklyBuckets(startsAt, endsAt),
  };
}

function buildHourlyBuckets(startsAt: DateTime, endsAt: DateTime): AnalyticsTrendBucket[] {
  const buckets: AnalyticsTrendBucket[] = [];
  let cursor = startsAt;

  while (cursor < endsAt) {
    const next = DateTime.min(cursor.plus({ hours: 6 }), endsAt);
    buckets.push({
      label: cursor.toFormat("HH:mm"),
      startsAt: toIso(cursor),
      endsAt: toIso(next),
    });
    cursor = next;
  }

  return buckets;
}

function buildDailyBuckets(startsAt: DateTime, endsAt: DateTime): AnalyticsTrendBucket[] {
  const buckets: AnalyticsTrendBucket[] = [];
  let cursor = startsAt;

  while (cursor < endsAt) {
    const next = DateTime.min(cursor.plus({ days: 1 }), endsAt);
    buckets.push({
      label: cursor.toFormat("ccc"),
      startsAt: toIso(cursor),
      endsAt: toIso(next),
    });
    cursor = next;
  }

  return buckets;
}

function buildWeeklyBuckets(startsAt: DateTime, endsAt: DateTime): AnalyticsTrendBucket[] {
  const buckets: AnalyticsTrendBucket[] = [];
  let cursor = startsAt;

  while (cursor < endsAt) {
    const next = DateTime.min(cursor.plus({ weeks: 1 }), endsAt);
    buckets.push({
      label: cursor.toFormat("dd LLL"),
      startsAt: toIso(cursor),
      endsAt: toIso(next),
    });
    cursor = next;
  }

  return buckets;
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
