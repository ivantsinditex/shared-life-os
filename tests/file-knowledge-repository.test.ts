import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileKnowledgeRepository } from "../src/storage/file-knowledge-repository.js";

describe("FileKnowledgeRepository", () => {
  it("searches private knowledge chunks by Ukrainian text", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "shared-life-knowledge-"));
    await mkdir(join(dataDir, "knowledge"));
    await writeFile(
      join(dataDir, "knowledge", "book.json"),
      JSON.stringify({
        id: "book",
        title: "Книга для менеджерів",
        kind: "book",
        chunks: [
          {
            id: "chunk-1",
            sectionTitle: "Про делегування",
            text: "Делегування допомагає менеджеру не тримати всі задачі на собі.",
          },
          {
            id: "chunk-2",
            sectionTitle: "Про фокус",
            text: "Фокус вимагає захищених блоків часу без зайвих зустрічей.",
          },
        ],
      }),
    );

    const repository = new FileKnowledgeRepository(dataDir);

    await expect(repository.search("як краще делегувати задачі", { limit: 1 })).resolves.toMatchObject([
      {
        id: "chunk-1",
        sourceId: "book",
        sourceTitle: "Книга для менеджерів",
        sectionTitle: "Про делегування",
      },
    ]);
  });

  it("returns no results when the knowledge directory does not exist yet", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "shared-life-knowledge-empty-"));
    const repository = new FileKnowledgeRepository(dataDir);

    await expect(repository.search("делегування")).resolves.toEqual([]);
  });
});
