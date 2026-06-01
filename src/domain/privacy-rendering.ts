import type { PlannedActivity, PrivacyLevel } from "./planned-activity.js";

export function renderCalendarTitle(activity: Pick<PlannedActivity, "title" | "participant" | "privacy">): string {
  if (activity.privacy !== "private") {
    return activity.title;
  }

  if (activity.participant === "both") {
    return "Зайнято";
  }

  return activity.participant === "nastia" ? "Настя зайнята" : "Ваня зайнятий";
}

export function toGoogleVisibility(privacy: PrivacyLevel): "default" | "private" {
  return privacy === "private" ? "private" : "default";
}

export function renderCalendarDescription(activity: PlannedActivity): string {
  if (activity.privacy === "private") {
    return [
      "Створено через Shared Life OS.",
      "Деталі приватні та доступні тільки в боті.",
    ].join("\n");
  }

  return [
    "Створено через Shared Life OS.",
    `Внутрішня назва: ${activity.title}`,
    `Учасник: ${formatParticipant(activity.participant)}`,
    `Категорія: ${formatCategory(activity.category)}`,
    `Приватність: ${formatPrivacy(activity.privacy)}`,
  ].join("\n");
}

function formatParticipant(participant: PlannedActivity["participant"]): string {
  const labels: Record<PlannedActivity["participant"], string> = {
    vania: "Ваня",
    nastia: "Настя",
    both: "Разом",
  };

  return labels[participant];
}

function formatCategory(category: PlannedActivity["category"]): string {
  const labels: Record<PlannedActivity["category"], string> = {
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

function formatPrivacy(privacy: PlannedActivity["privacy"]): string {
  const labels: Record<PlannedActivity["privacy"], string> = {
    private: "приватно",
    busy_only: "показувати тільки зайнятість",
    shared_details: "показувати деталі",
  };

  return labels[privacy];
}
