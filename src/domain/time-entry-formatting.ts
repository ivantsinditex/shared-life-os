import { DateTime } from "luxon";

import type { TimeEntry } from "./time-entry.js";
import type { TaskBasket } from "./task.js";
import { formatBasketLabel } from "./task-formatting.js";

export function formatTimeStarted(entry: TimeEntry, timezone: string): string {
  return [
    "Таймер запущено.",
    "",
    formatTimeEntryLine(entry, timezone),
  ].join("\n");
}

export function formatTimeStopped(entry: TimeEntry, timezone: string): string {
  return [
    "Таймер зупинено.",
    "",
    formatTimeEntryLine(entry, timezone),
    `Тривалість: ${formatDuration(getEntryDurationMinutes(entry))}`,
  ].join("\n");
}

export function formatActiveTimeEntry(entry: TimeEntry | undefined, timezone: string): string {
  if (!entry) {
    return "Активного таймера немає.";
  }

  return [
    "Активний таймер:",
    "",
    formatTimeEntryLine(entry, timezone),
    `Триває: ${formatDuration(getEntryDurationMinutes(entry, new Date().toISOString()))}`,
  ].join("\n");
}

export function formatTimeSummary(title: string, entries: TimeEntry[], timezone: string): string {
  if (entries.length === 0) {
    return `${title}\n\nПоки немає затреканого часу.`;
  }

  const totals = new Map<TaskBasket, number>();
  let totalMinutes = 0;

  for (const entry of entries) {
    const minutes = getEntryDurationMinutes(entry, new Date().toISOString());
    totals.set(entry.basket, (totals.get(entry.basket) ?? 0) + minutes);
    totalMinutes += minutes;
  }

  return [
    title,
    "",
    `Разом: ${formatDuration(totalMinutes)}`,
    "",
    ...Array.from(totals.entries()).map(
      ([basket, minutes]) => `${formatBasketLabel(basket)}: ${formatDuration(minutes)}`,
    ),
    "",
    "Записи:",
    ...entries.map((entry, index) => `${index + 1}. ${formatTimeEntryLine(entry, timezone)}`),
  ].join("\n");
}

function formatTimeEntryLine(entry: TimeEntry, timezone: string): string {
  const start = DateTime.fromISO(entry.startedAt).setZone(timezone).toFormat("ccc HH:mm");
  const end = entry.endedAt ? DateTime.fromISO(entry.endedAt).setZone(timezone).toFormat("HH:mm") : "зараз";
  const participant = entry.participant ? ` | ${entry.participant}` : "";

  return `${start} - ${end} | ${formatBasketLabel(entry.basket)}${participant} | ${entry.title}`;
}

function getEntryDurationMinutes(entry: TimeEntry, fallbackEnd?: string): number {
  const end = entry.endedAt ?? fallbackEnd;

  if (!end) {
    return 0;
  }

  return Math.max(0, Math.round((Date.parse(end) - Date.parse(entry.startedAt)) / 60000));
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
