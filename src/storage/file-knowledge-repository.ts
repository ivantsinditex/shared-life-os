import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { KnowledgeRepository, KnowledgeSearchResult, KnowledgeSource } from "../domain/knowledge.js";

type StoredKnowledgeSource = {
  id: string;
  title: string;
  kind?: string;
  chunks: Array<{
    id: string;
    sourceId?: string;
    sourceTitle?: string;
    sectionTitle?: string;
    text: string;
    summary?: string;
    keywords?: string[];
  }>;
};

export class FileKnowledgeRepository implements KnowledgeRepository {
  private readonly knowledgeDir: string;

  constructor(dataDir: string) {
    this.knowledgeDir = join(dataDir, "knowledge");
  }

  async listSources(): Promise<KnowledgeSource[]> {
    const files = await this.listKnowledgeFiles();
    const sources = await Promise.all(files.map((file) => this.readSource(file)));

    return sources
      .filter((source): source is KnowledgeSource => Boolean(source))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  async search(query: string, options: { limit?: number } = {}): Promise<KnowledgeSearchResult[]> {
    const tokens = tokenize(query);

    if (tokens.length === 0) {
      return [];
    }

    const sources = await this.listSources();
    const results = sources
      .flatMap((source) => source.chunks)
      .map((chunk) => ({
        ...chunk,
        score: scoreChunk(chunk, tokens),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, options.limit ?? 5);

    return results;
  }

  private async listKnowledgeFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.knowledgeDir);
      return entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => join(this.knowledgeDir, entry));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async readSource(filePath: string): Promise<KnowledgeSource | undefined> {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoredKnowledgeSource;

    if (!parsed.id || !parsed.title || !Array.isArray(parsed.chunks)) {
      return undefined;
    }

    return {
      id: parsed.id,
      title: parsed.title,
      kind: parsed.kind,
      chunks: parsed.chunks
        .filter((chunk) => chunk.id && chunk.text)
        .map((chunk) => ({
          id: chunk.id,
          sourceId: chunk.sourceId ?? parsed.id,
          sourceTitle: chunk.sourceTitle ?? parsed.title,
          sectionTitle: chunk.sectionTitle,
          text: chunk.text,
          summary: chunk.summary,
          keywords: chunk.keywords,
        })),
    };
  }
}

function scoreChunk(chunk: KnowledgeSource["chunks"][number], tokens: string[]): number {
  const haystack = normalizeText([
    chunk.sourceTitle,
    chunk.sectionTitle ?? "",
    chunk.summary ?? "",
    chunk.keywords?.join(" ") ?? "",
    chunk.text,
  ].join(" "));

  return tokens.reduce((score, token) => {
    if (!haystack.includes(token)) {
      return score;
    }

    const titleBoost = normalizeText(`${chunk.sourceTitle} ${chunk.sectionTitle ?? ""}`).includes(token) ? 3 : 0;
    return score + 1 + titleBoost;
  }, 0);
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    normalizeText(value)
      .split(/[^a-zа-яіїєґ0-9]+/iu)
      .filter((token) => token.length >= 3),
  ));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/і/g, "и")
    .replace(/ї/g, "и")
    .replace(/є/g, "е")
    .replace(/ґ/g, "г");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
