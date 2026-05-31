import { DateTime } from "luxon";

import type { NewPlannedActivity, PlannedActivity } from "./planned-activity.js";

export type ConflictCheck = {
  conflicts: PlannedActivity[];
  alternatives: TimeSlot[];
};

export type TimeSlot = {
  startsAt: string;
  endsAt: string;
};

export function findConflicts(
  requested: NewPlannedActivity,
  candidates: PlannedActivity[],
): ConflictCheck {
  const conflicts = candidates.filter((candidate) => activitiesConflict(requested, candidate));

  return {
    conflicts,
    alternatives: conflicts.length > 0 ? suggestAlternatives(requested, candidates) : [],
  };
}

export function activitiesConflict(
  requested: Pick<NewPlannedActivity, "startsAt" | "endsAt" | "participant">,
  existing: Pick<PlannedActivity, "startsAt" | "endsAt" | "participant" | "syncStatus">,
): boolean {
  if (existing.syncStatus === "deleted") {
    return false;
  }

  const participantsOverlap =
    requested.participant === "both" ||
    existing.participant === "both" ||
    requested.participant === existing.participant;

  if (!participantsOverlap) {
    return false;
  }

  return (
    Date.parse(requested.startsAt) < Date.parse(existing.endsAt) &&
    Date.parse(requested.endsAt) > Date.parse(existing.startsAt)
  );
}

function suggestAlternatives(
  requested: NewPlannedActivity,
  candidates: PlannedActivity[],
): TimeSlot[] {
  const durationMinutes = DateTime.fromISO(requested.endsAt)
    .diff(DateTime.fromISO(requested.startsAt), "minutes")
    .minutes;
  const alternatives: TimeSlot[] = [];
  let cursor = DateTime.fromISO(requested.startsAt).plus({ minutes: 30 });

  while (alternatives.length < 3) {
    const slot = {
      startsAt: toIso(cursor),
      endsAt: toIso(cursor.plus({ minutes: durationMinutes })),
    };

    const hasConflict = candidates.some((candidate) =>
      activitiesConflict(
        {
          ...requested,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        },
        candidate,
      ),
    );

    if (!hasConflict) {
      alternatives.push(slot);
    }

    cursor = cursor.plus({ minutes: 30 });
  }

  return alternatives;
}

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
