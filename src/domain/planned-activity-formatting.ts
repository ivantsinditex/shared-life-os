import { DateTime } from "luxon";

import type { TimeSlot } from "./conflict-detection.js";
import { renderCalendarTitle } from "./privacy-rendering.js";
import type { NewPlannedActivity, PlannedActivity } from "./planned-activity.js";

export function formatActivityConfirmation(activity: NewPlannedActivity): string {
  return [
    "Create planned activity?",
    "",
    `Title: ${activity.title}`,
    `Participant: ${activity.participant}`,
    `Category: ${activity.category}`,
    `Time: ${formatRange(activity.startsAt, activity.endsAt, activity.timezone)}`,
    `Privacy: ${activity.privacy}`,
    `Calendar title: ${renderCalendarTitle(activity)}`,
  ].join("\n");
}

export function formatActivitySaved(activity: PlannedActivity): string {
  return [
    "Planned activity saved.",
    "",
    `${activity.title}`,
    `${formatRange(activity.startsAt, activity.endsAt, activity.timezone)}`,
    `Participant: ${activity.participant}`,
    `Category: ${activity.category}`,
    `Calendar sync: ${activity.syncStatus}`,
  ].join("\n");
}

export function formatConflictWarning(params: {
  requested: NewPlannedActivity;
  conflicts: PlannedActivity[];
  alternatives: TimeSlot[];
}): string {
  const conflicts = params.conflicts.map((activity) =>
    `- ${formatRange(activity.startsAt, activity.endsAt, activity.timezone)} | ${activity.participant} | ${activity.category} | ${renderCalendarTitle(activity)}`,
  );
  const alternatives = params.alternatives.map(
    (slot, index) => `${index + 1}. ${formatRange(slot.startsAt, slot.endsAt, params.requested.timezone)}`,
  );

  return [
    "This time conflicts with existing plans.",
    "",
    "Requested:",
    formatRange(params.requested.startsAt, params.requested.endsAt, params.requested.timezone),
    "",
    "Conflicts:",
    ...conflicts,
    "",
    "Suggested alternatives:",
    ...alternatives,
  ].join("\n");
}

export function formatRange(startsAt: string, endsAt: string, timezone: string): string {
  const start = DateTime.fromISO(startsAt).setZone(timezone);
  const end = DateTime.fromISO(endsAt).setZone(timezone);

  return `${start.toFormat("ccc yyyy-LL-dd HH:mm")} - ${end.toFormat("HH:mm")}`;
}
