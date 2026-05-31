import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  NewPlannedActivity,
  PlannedActivity,
  PlannedActivityRepository,
  Participant,
} from "../domain/planned-activity.js";

export class FilePlannedActivityRepository implements PlannedActivityRepository {
  private readonly filePath: string;
  private activities: PlannedActivity[] = [];

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, "planned-activities.json");
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.activities = JSON.parse(raw) as PlannedActivity[];
    } catch (error) {
      if (isMissingFile(error)) {
        this.activities = [];
        await this.persist();
        return;
      }

      throw error;
    }
  }

  async create(activity: NewPlannedActivity): Promise<PlannedActivity> {
    const now = new Date().toISOString();
    const created: PlannedActivity = {
      ...activity,
      id: randomUUID(),
      syncStatus: activity.syncStatus ?? "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.activities.push(created);
    await this.persist();
    return created;
  }

  async listBetween(params: {
    startsAt: string;
    endsAt: string;
    participant?: Participant;
  }): Promise<PlannedActivity[]> {
    const startsAt = Date.parse(params.startsAt);
    const endsAt = Date.parse(params.endsAt);

    return this.activities
      .filter((activity) => {
        const activityStart = Date.parse(activity.startsAt);
        const activityEnd = Date.parse(activity.endsAt);
        const overlaps = activityStart < endsAt && activityEnd > startsAt;
        const participantMatches =
          !params.participant ||
          activity.participant === params.participant ||
          activity.participant === "both";

        return overlaps && participantMatches && activity.syncStatus !== "deleted";
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }

  async getById(id: string): Promise<PlannedActivity | undefined> {
    return this.activities.find((activity) => activity.id === id);
  }

  async update(activity: PlannedActivity): Promise<PlannedActivity> {
    const index = this.activities.findIndex((candidate) => candidate.id === activity.id);

    if (index === -1) {
      throw new Error(`Planned activity not found: ${activity.id}`);
    }

    const updated = {
      ...activity,
      updatedAt: new Date().toISOString(),
    };

    this.activities[index] = updated;
    await this.persist();
    return updated;
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.activities, null, 2));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
