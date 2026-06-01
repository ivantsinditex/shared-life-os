import { DateTime } from "luxon";

import type { TimeSlot } from "./conflict-detection.js";
import { renderCalendarTitle } from "./privacy-rendering.js";
import type { ActivityCategory, NewPlannedActivity, Participant, PlannedActivity, PrivacyLevel } from "./planned-activity.js";

export function formatActivityConfirmation(activity: NewPlannedActivity): string {
  return [
    "Створити заплановану активність?",
    "",
    `Назва: ${activity.title}`,
    `Учасник: ${formatParticipant(activity.participant)}`,
    `Категорія: ${formatCategory(activity.category)}`,
    `Час: ${formatRange(activity.startsAt, activity.endsAt, activity.timezone)}`,
    `Приватність: ${formatPrivacy(activity.privacy)}`,
    `Назва в календарі: ${renderCalendarTitle(activity)}`,
  ].join("\n");
}

export function formatActivitySaved(activity: PlannedActivity): string {
  return [
    "Заплановану активність збережено.",
    "",
    `${activity.title}`,
    `${formatRange(activity.startsAt, activity.endsAt, activity.timezone)}`,
    `Учасник: ${formatParticipant(activity.participant)}`,
    `Категорія: ${formatCategory(activity.category)}`,
    `Синхронізація календаря: ${formatSyncStatus(activity.syncStatus)}`,
  ].join("\n");
}

export function formatActivityUpdated(activity: PlannedActivity): string {
  return [
    "Заплановану активність оновлено.",
    "",
    `${activity.title}`,
    `${formatRange(activity.startsAt, activity.endsAt, activity.timezone)}`,
    `Учасник: ${formatParticipant(activity.participant)}`,
    `Категорія: ${formatCategory(activity.category)}`,
    `Синхронізація календаря: ${formatSyncStatus(activity.syncStatus)}`,
  ].join("\n");
}

export function formatActivityDeleted(activity: PlannedActivity): string {
  return [
    "Заплановану активність видалено.",
    "",
    `${activity.title}`,
    `${formatRange(activity.startsAt, activity.endsAt, activity.timezone)}`,
  ].join("\n");
}

export function formatConflictWarning(params: {
  requested: NewPlannedActivity;
  conflicts: PlannedActivity[];
  alternatives: TimeSlot[];
}): string {
  const conflicts = params.conflicts.map((activity) =>
    `- ${formatRange(activity.startsAt, activity.endsAt, activity.timezone)} | ${formatParticipant(activity.participant)} | ${formatCategory(activity.category)} | ${renderCalendarTitle(activity)}`,
  );
  const alternatives = params.alternatives.map(
    (slot, index) => `${index + 1}. ${formatRange(slot.startsAt, slot.endsAt, params.requested.timezone)}`,
  );

  return [
    "Цей час конфліктує з уже запланованими активностями.",
    "",
    "Запит:",
    formatRange(params.requested.startsAt, params.requested.endsAt, params.requested.timezone),
    "",
    "Конфлікти:",
    ...conflicts,
    "",
    "Запропоновані альтернативи:",
    ...alternatives,
  ].join("\n");
}

export function formatRange(startsAt: string, endsAt: string, timezone: string): string {
  const start = DateTime.fromISO(startsAt).setZone(timezone);
  const end = DateTime.fromISO(endsAt).setZone(timezone);

  return `${start.setLocale("uk").toFormat("ccc yyyy-LL-dd HH:mm")} - ${end.toFormat("HH:mm")}`;
}

export function formatParticipant(participant: Participant): string {
  const labels: Record<Participant, string> = {
    vania: "Ваня",
    nastia: "Настя",
    both: "Разом",
  };

  return labels[participant];
}

export function formatCategory(category: ActivityCategory): string {
  const labels: Record<ActivityCategory, string> = {
    sport: "спорт",
    work: "робота",
    learning: "навчання",
    reading: "читання",
    dogs: "собаки",
    horse: "кінь",
    care: "догляд",
    together: "час разом",
    other: "інше",
  };

  return labels[category];
}

export function formatPrivacy(privacy: PrivacyLevel): string {
  const labels: Record<PrivacyLevel, string> = {
    private: "приватно",
    busy_only: "показувати тільки зайнятість",
    shared_details: "показувати деталі",
  };

  return labels[privacy];
}

export function formatSyncStatus(status: PlannedActivity["syncStatus"]): string {
  const labels: Record<PlannedActivity["syncStatus"], string> = {
    pending: "очікує",
    synced: "синхронізовано",
    sync_failed: "помилка синхронізації",
    externally_changed: "змінено зовні",
    deleted: "видалено",
  };

  return labels[status];
}
