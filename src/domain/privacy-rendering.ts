import type { PlannedActivity, PrivacyLevel } from "./planned-activity.js";

export function renderCalendarTitle(activity: Pick<PlannedActivity, "title" | "participant" | "privacy">): string {
  if (activity.privacy === "shared_details") {
    return activity.title;
  }

  return activity.participant === "both" ? "Busy" : `${capitalize(activity.participant)} busy`;
}

export function toGoogleVisibility(privacy: PrivacyLevel): "default" | "private" {
  return privacy === "shared_details" ? "default" : "private";
}

export function renderCalendarDescription(activity: PlannedActivity): string {
  if (activity.privacy !== "shared_details") {
    return [
      "Created by Shared Life OS.",
      "Details are private in the bot.",
    ].join("\n");
  }

  return [
    "Created by Shared Life OS.",
    `Internal title: ${activity.title}`,
    `Participant: ${activity.participant}`,
    `Category: ${activity.category}`,
    `Privacy: ${activity.privacy}`,
  ].join("\n");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
