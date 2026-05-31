import { DateTime } from "luxon";

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

export function formatRange(startsAt: string, endsAt: string, timezone: string): string {
  const start = DateTime.fromISO(startsAt).setZone(timezone);
  const end = DateTime.fromISO(endsAt).setZone(timezone);

  return `${start.toFormat("ccc yyyy-LL-dd HH:mm")} - ${end.toFormat("HH:mm")}`;
}
