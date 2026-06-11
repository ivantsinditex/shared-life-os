export type KnowledgeChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sectionTitle?: string;
  text: string;
  summary?: string;
  keywords?: string[];
};

export type KnowledgeSource = {
  id: string;
  title: string;
  kind?: string;
  chunks: KnowledgeChunk[];
};

export type KnowledgeSearchResult = KnowledgeChunk & {
  score: number;
};

export type KnowledgeSnippet = {
  sourceTitle: string;
  sectionTitle?: string;
  text: string;
};

export interface KnowledgeRepository {
  listSources(): Promise<KnowledgeSource[]>;
  search(query: string, options?: { limit?: number }): Promise<KnowledgeSearchResult[]>;
}

export function toKnowledgeSnippets(results: KnowledgeSearchResult[]): KnowledgeSnippet[] {
  return results.map((result) => ({
    sourceTitle: result.sourceTitle,
    sectionTitle: result.sectionTitle,
    text: result.summary ?? truncateKnowledgeText(result.text, 900),
  }));
}

export function formatKnowledgeSearchReply(query: string, results: KnowledgeSearchResult[]): string {
  if (results.length === 0) {
    return [
      "У базі знань поки не знайшов нічого релевантного.",
      "",
      `Запит: ${query}`,
    ].join("\n");
  }

  return [
    "Знайшов у базі знань:",
    "",
    ...results.map((result, index) => [
      `${index + 1}. ${result.sourceTitle}${result.sectionTitle ? ` · ${result.sectionTitle}` : ""}`,
      truncateKnowledgeText(result.summary ?? result.text, 420),
    ].join("\n")),
    "",
    "Можу зробити коротке самарі, детальні поради або застосувати ці ідеї до вашого тижня.",
  ].join("\n\n");
}

function truncateKnowledgeText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
