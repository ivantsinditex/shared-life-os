import type { ActivityCategory, Participant, PlannedActivity, PrivacyLevel } from "./planned-activity.js";

export function renderCalendarTitle(
  activity: Pick<PlannedActivity, "title" | "participant" | "category" | "privacy">,
): string {
  const participantLabel = formatParticipantShort(activity.participant);

  if (activity.privacy !== "private") {
    return `${participantLabel} · ${formatActivityIcon(activity)} ${activity.title}`;
  }

  if (activity.participant === "both") {
    return "Разом · зайнято";
  }

  return activity.participant === "nastia" ? "Настя · зайнята" : "Ваня · зайнятий";
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
  const labels: Record<Participant, string> = {
    vania: "Ваня",
    nastia: "Настя",
    both: "Разом",
  };

  return labels[participant];
}

function formatParticipantShort(participant: Participant): string {
  return formatParticipant(participant);
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

function formatActivityIcon(activity: Pick<PlannedActivity, "title" | "participant" | "category">): string {
  const title = normalizeText(activity.title);

  if (activity.participant === "both" && includesAny(title, ["прогулян", "гуляти", "walk", "пасиб"])) {
    return "🚶‍♂️🚶‍♀️";
  }

  if (includesAny(title, ["йога", "yoga"])) {
    return "🧘";
  }

  if (includesAny(title, ["воркаут", "workout", "спортзал", "зал", "тренуван", "аджиліті", "agility"])) {
    return "🏋️";
  }

  if (includesAny(title, ["бар", "bar", "випити", "пити в бар", "коктейл", "drink"])) {
    return "🍸";
  }

  if (includesAny(title, ["прогулян", "гуляти", "walk", "пасиб"])) {
    return "🚶";
  }

  if (includesAny(title, ["драйв", "федр", "собак", "пес", "dog"])) {
    return "🐕";
  }

  if (includesAny(title, ["подарунок", "кінь", "конюш", "horse"])) {
    return "🐴";
  }

  if (includesAny(title, ["читан", "reading", "книга"])) {
    return "📚";
  }

  if (includesAny(title, ["навчан", "learning", "француз", "матем", "курс"])) {
    return "🎓";
  }

  if (includesAny(title, ["догляд", "care"])) {
    return "🧴";
  }

  if (includesAny(title, ["побач", "разом", "вечер", "date"])) {
    return "❤️";
  }

  const categoryIcons: Record<ActivityCategory, string> = {
    sport: "🏋️",
    work: "💼",
    learning: "🎓",
    reading: "📚",
    dogs: "🐕",
    horse: "🐴",
    care: "🧴",
    together: "❤️",
    other: "📌",
  };

  return categoryIcons[activity.category];
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase("uk-UA");
}

function includesAny(value: string, fragments: string[]): boolean {
  return fragments.some((fragment) => value.includes(fragment));
}
