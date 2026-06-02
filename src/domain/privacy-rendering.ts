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

export function renderCalendarColorId(activity: Pick<PlannedActivity, "category" | "privacy">): string {
  if (activity.privacy === "private") {
    return "8";
  }

  const colorIds: Record<PlannedActivity["category"], string> = {
    sport: "10",
    work: "9",
    learning: "5",
    reading: "7",
    dogs: "2",
    horse: "6",
    care: "3",
    together: "4",
    other: "1",
  };

  return colorIds[activity.category];
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
