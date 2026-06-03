import type { ActivityCategory, PlannedActivity } from "./planned-activity.js";
import type { TaskBasket, WorkTask } from "./task.js";
import { formatBasketLabel } from "./task-formatting.js";
import type { TimeEntry } from "./time-entry.js";

export type AnalyticsSummaryInput = {
  title: string;
  plannedActivities: PlannedActivity[];
  timeEntries: TimeEntry[];
  openTasks: WorkTask[];
  activeTimeEntry?: TimeEntry;
  trendBuckets?: AnalyticsTrendBucket[];
  now?: string;
};

export type AnalyticsTrendBucket = {
  label: string;
  startsAt: string;
  endsAt: string;
};

export function formatAnalyticsSummary(input: AnalyticsSummaryInput): string {
  const now = input.now ?? new Date().toISOString();
  const plannedMinutes = sumPlannedMinutes(input.plannedActivities);
  const trackedMinutes = sumTrackedMinutes(input.timeEntries, now);
  const plannedByCategory = sumPlannedByCategory(input.plannedActivities);
  const trackedByBasket = sumTrackedByBasket(input.timeEntries, now);
  const openTasksByBasket = countOpenTasksByBasket(input.openTasks);
  const deltaMinutes = trackedMinutes - plannedMinutes;

  return [
    input.title,
    "",
    `Заплановано: ${formatDuration(plannedMinutes)}`,
    `Затрекано: ${formatDuration(trackedMinutes)}`,
    `Різниця: ${formatSignedDuration(deltaMinutes)}`,
    input.activeTimeEntry ? `Активний таймер: ${formatBasketLabel(input.activeTimeEntry.basket)} | ${input.activeTimeEntry.title}` : "Активний таймер: немає",
    "",
    "Динаміка:",
    ...formatTrend(input.trendBuckets ?? [], input.plannedActivities, input.timeEntries, now),
    "",
    "Затрекано по кошиках:",
    ...formatBasketBreakdown(trackedByBasket),
    "",
    "Заплановано по категоріях:",
    ...formatCategoryBreakdown(plannedByCategory),
    "",
    "Відкриті задачі:",
    ...formatTaskBreakdown(openTasksByBasket),
  ].join("\n");
}

function formatTrend(
  buckets: AnalyticsTrendBucket[],
  activities: PlannedActivity[],
  entries: TimeEntry[],
  fallbackEnd: string,
): string[] {
  if (buckets.length === 0) {
    return ["- немає"];
  }

  const rows = buckets.map((bucket) => {
    const planned = sumPlannedMinutes(filterActivitiesByBucket(activities, bucket));
    const tracked = sumTrackedMinutes(filterEntriesByBucket(entries, bucket), fallbackEnd);

    return {
      label: bucket.label,
      planned,
      tracked,
    };
  });
  const maxMinutes = Math.max(...rows.flatMap((row) => [row.planned, row.tracked]), 1);

  return rows.map((row) => [
    `- ${row.label}`,
    `P ${formatBar(row.planned, maxMinutes)} ${formatDuration(row.planned)}`,
    `T ${formatBar(row.tracked, maxMinutes)} ${formatDuration(row.tracked)}`,
  ].join(" | "));
}

function filterActivitiesByBucket(activities: PlannedActivity[], bucket: AnalyticsTrendBucket): PlannedActivity[] {
  const startsAt = Date.parse(bucket.startsAt);
  const endsAt = Date.parse(bucket.endsAt);

  return activities.filter((activity) => Date.parse(activity.startsAt) < endsAt && Date.parse(activity.endsAt) > startsAt);
}

function filterEntriesByBucket(entries: TimeEntry[], bucket: AnalyticsTrendBucket): TimeEntry[] {
  const startsAt = Date.parse(bucket.startsAt);
  const endsAt = Date.parse(bucket.endsAt);

  return entries.filter((entry) => Date.parse(entry.startedAt) < endsAt && Date.parse(entry.endedAt ?? new Date().toISOString()) > startsAt);
}

function sumPlannedMinutes(activities: PlannedActivity[]): number {
  return activities.reduce((total, activity) => {
    const minutes = Math.max(0, Math.round((Date.parse(activity.endsAt) - Date.parse(activity.startsAt)) / 60000));

    return total + minutes;
  }, 0);
}

function sumTrackedMinutes(entries: TimeEntry[], fallbackEnd: string): number {
  return entries.reduce((total, entry) => total + getTrackedMinutes(entry, fallbackEnd), 0);
}

function sumPlannedByCategory(activities: PlannedActivity[]): Map<ActivityCategory, number> {
  const totals = new Map<ActivityCategory, number>();

  for (const activity of activities) {
    const minutes = Math.max(0, Math.round((Date.parse(activity.endsAt) - Date.parse(activity.startsAt)) / 60000));
    totals.set(activity.category, (totals.get(activity.category) ?? 0) + minutes);
  }

  return totals;
}

function sumTrackedByBasket(entries: TimeEntry[], fallbackEnd: string): Map<TaskBasket, number> {
  const totals = new Map<TaskBasket, number>();

  for (const entry of entries) {
    const minutes = getTrackedMinutes(entry, fallbackEnd);
    totals.set(entry.basket, (totals.get(entry.basket) ?? 0) + minutes);
  }

  return totals;
}

function countOpenTasksByBasket(tasks: WorkTask[]): Map<TaskBasket, number> {
  const totals = new Map<TaskBasket, number>();

  for (const task of tasks.filter((candidate) => candidate.status === "open")) {
    totals.set(task.basket, (totals.get(task.basket) ?? 0) + 1);
  }

  return totals;
}

function getTrackedMinutes(entry: TimeEntry, fallbackEnd: string): number {
  const end = entry.endedAt ?? fallbackEnd;

  return Math.max(0, Math.round((Date.parse(end) - Date.parse(entry.startedAt)) / 60000));
}

function formatBasketBreakdown(totals: Map<TaskBasket, number>): string[] {
  if (totals.size === 0) {
    return ["- немає"];
  }

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([basket, minutes]) => `- ${formatBasketLabel(basket)}: ${formatDuration(minutes)}`);
}

function formatCategoryBreakdown(totals: Map<ActivityCategory, number>): string[] {
  if (totals.size === 0) {
    return ["- немає"];
  }

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([category, minutes]) => `- ${category}: ${formatDuration(minutes)}`);
}

function formatTaskBreakdown(totals: Map<TaskBasket, number>): string[] {
  if (totals.size === 0) {
    return ["- немає"];
  }

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([basket, count]) => `- ${formatBasketLabel(basket)}: ${count}`);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder} хв`;
  }

  if (remainder === 0) {
    return `${hours} год`;
  }

  return `${hours} год ${remainder} хв`;
}

function formatSignedDuration(minutes: number): string {
  if (minutes === 0) {
    return "0 хв";
  }

  const sign = minutes > 0 ? "+" : "-";

  return `${sign}${formatDuration(Math.abs(minutes))}`;
}

function formatBar(minutes: number, maxMinutes: number): string {
  const width = 8;
  const filled = Math.round((minutes / maxMinutes) * width);

  return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
}
