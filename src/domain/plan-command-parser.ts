import { DateTime } from "luxon";

import {
  activityCategories,
  participants,
  privacyLevels,
  type ActivityCategory,
  type NewPlannedActivity,
  type Participant,
  type PrivacyLevel,
} from "./planned-activity.js";

export type ParsedPlanCommand =
  | {
      ok: true;
      activity: NewPlannedActivity;
    }
  | {
      ok: false;
      error: string;
    };

const usage = [
  "Use:",
  "/plan Title | participant | category | YYYY-MM-DD HH:mm | duration_minutes | privacy",
  "",
  "Example:",
  "/plan Workout | vania | sport | 2026-06-01 08:00 | 60 | busy_only",
  "",
  `participants: ${participants.join(", ")}`,
  `categories: ${activityCategories.join(", ")}`,
  `privacy: ${privacyLevels.join(", ")}`,
].join("\n");

export function getPlanCommandUsage(): string {
  return usage;
}

export function parsePlanCommand(input: string, timezone: string): ParsedPlanCommand {
  const parts = input
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 6) {
    return {
      ok: false,
      error: usage,
    };
  }

  const [title, participant, category, startText, durationText, privacy] = parts;

  if (!isParticipant(participant)) {
    return {
      ok: false,
      error: `Unknown participant "${participant}".\n\n${usage}`,
    };
  }

  if (!isActivityCategory(category)) {
    return {
      ok: false,
      error: `Unknown category "${category}".\n\n${usage}`,
    };
  }

  if (!isPrivacyLevel(privacy)) {
    return {
      ok: false,
      error: `Unknown privacy "${privacy}".\n\n${usage}`,
    };
  }

  const startsAt = DateTime.fromFormat(startText, "yyyy-MM-dd HH:mm", {
    zone: timezone,
  });

  if (!startsAt.isValid) {
    return {
      ok: false,
      error: `Could not understand start time "${startText}". Use YYYY-MM-DD HH:mm.`,
    };
  }

  const durationMinutes = Number(durationText);

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return {
      ok: false,
      error: `Duration must be a positive number of minutes. Received "${durationText}".`,
    };
  }

  const endsAt = startsAt.plus({ minutes: durationMinutes });

  return {
    ok: true,
    activity: {
      title,
      participant,
      category,
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
      timezone,
      privacy,
      isSharedActivity: participant === "both",
    },
  };
}

function isParticipant(value: string): value is Participant {
  return participants.includes(value as Participant);
}

function isActivityCategory(value: string): value is ActivityCategory {
  return activityCategories.includes(value as ActivityCategory);
}

function isPrivacyLevel(value: string): value is PrivacyLevel {
  return privacyLevels.includes(value as PrivacyLevel);
}

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
