import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Participant } from "../domain/planned-activity.js";
import type { NewTimeEntry, TimeEntry, TimeEntryRepository } from "../domain/time-entry.js";

export class FileTimeEntryRepository implements TimeEntryRepository {
  private readonly filePath: string;
  private entries: TimeEntry[] = [];

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, "time-entries.json");
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.entries = JSON.parse(raw) as TimeEntry[];
    } catch (error) {
      if (isMissingFile(error)) {
        this.entries = [];
        await this.persist();
        return;
      }

      throw error;
    }
  }

  async create(entry: NewTimeEntry): Promise<TimeEntry> {
    const now = new Date().toISOString();
    const created: TimeEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.entries.push(created);
    await this.persist();
    return created;
  }

  async listAll(): Promise<TimeEntry[]> {
    return [...this.entries].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  }

  async listBetween(params: { startsAt: string; endsAt: string; participant?: Participant }): Promise<TimeEntry[]> {
    const startsAt = Date.parse(params.startsAt);
    const endsAt = Date.parse(params.endsAt);

    return this.entries
      .filter((entry) => {
        const entryStart = Date.parse(entry.startedAt);
        const entryEnd = Date.parse(entry.endedAt ?? new Date().toISOString());
        const overlaps = entryStart < endsAt && entryEnd > startsAt;
        const participantMatches = !params.participant || entry.participant === params.participant;

        return overlaps && participantMatches;
      })
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  }

  async getActive(params: { participant?: Participant } = {}): Promise<TimeEntry | undefined> {
    const activeEntries = this.entries
      .filter((entry) => !entry.endedAt)
      .filter((entry) => !params.participant || entry.participant === params.participant)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));

    return activeEntries[0];
  }

  async update(entry: TimeEntry): Promise<TimeEntry> {
    const index = this.entries.findIndex((candidate) => candidate.id === entry.id);

    if (index === -1) {
      throw new Error(`Time entry not found: ${entry.id}`);
    }

    const updated = {
      ...entry,
      updatedAt: new Date().toISOString(),
    };

    this.entries[index] = updated;
    await this.persist();
    return updated;
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.entries, null, 2));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
