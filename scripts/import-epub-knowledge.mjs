#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";

const [, , epubPath, ...args] = process.argv;

if (!epubPath) {
  console.error("Usage: npm run knowledge:import:epub -- /path/book.epub [--out data/knowledge]");
  process.exit(1);
}

const outDir = getArgValue(args, "--out") ?? "data/knowledge";
const explicitTitle = getArgValue(args, "--source-title");
const containerXml = unzipText(epubPath, "META-INF/container.xml");
const opfPath = matchOne(containerXml, /full-path=["']([^"']+)["']/u);

if (!opfPath) {
  throw new Error("Could not find EPUB package document in META-INF/container.xml");
}

const opfXml = unzipText(epubPath, opfPath);
const opfDir = dirname(opfPath);
const title = explicitTitle ?? decodeEntities(stripTags(matchOne(opfXml, /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/iu) ?? basename(epubPath, ".epub")));
const sourceId = slugify(title || basename(epubPath, ".epub"));
const manifest = parseManifest(opfXml);
const spineIds = Array.from(opfXml.matchAll(/<itemref[^>]+idref=["']([^"']+)["'][^>]*>/giu)).map((match) => match[1]);
const contentPaths = spineIds
  .map((id) => manifest.get(id))
  .filter((item) => item && /x?html?/iu.test(item.mediaType))
  .map((item) => normalizeZipPath(joinZipPath(opfDir, item.href)));

const chunks = contentPaths.flatMap((contentPath, fileIndex) => {
  const html = unzipText(epubPath, contentPath);
  const sectionTitle = extractSectionTitle(html) ?? `Розділ ${fileIndex + 1}`;
  const text = normalizeWhitespace(decodeEntities(stripTags(html)));

  return splitIntoChunks(text, 1800).map((chunk, chunkIndex) => ({
    id: `${sourceId}-${fileIndex + 1}-${chunkIndex + 1}`,
    sourceId,
    sourceTitle: title,
    sectionTitle,
    text: chunk,
  }));
});

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${sourceId}.json`);
writeFileSync(outPath, `${JSON.stringify({
  id: sourceId,
  title,
  kind: "book",
  importedAt: new Date().toISOString(),
  chunks,
}, null, 2)}\n`);

console.log(`Imported ${chunks.length} knowledge chunks to ${outPath}`);

function getArgValue(values, key) {
  const index = values.indexOf(key);
  return index >= 0 ? values[index + 1] : undefined;
}

function unzipText(zipPath, filePath) {
  return execFileSync("unzip", ["-p", zipPath, filePath], {
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
  });
}

function parseManifest(opf) {
  const items = new Map();

  for (const match of opf.matchAll(/<item\s+([^>]+)>/giu)) {
    const attrs = parseAttrs(match[1]);

    if (attrs.id && attrs.href && attrs["media-type"]) {
      items.set(attrs.id, {
        href: attrs.href,
        mediaType: attrs["media-type"],
      });
    }
  }

  return items;
}

function parseAttrs(value) {
  const attrs = {};

  for (const match of value.matchAll(/([a-z:-]+)=["']([^"']*)["']/giu)) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function extractSectionTitle(html) {
  return decodeEntities(stripTags(
    matchOne(html, /<h1[^>]*>([\s\S]*?)<\/h1>/iu) ??
    matchOne(html, /<h2[^>]*>([\s\S]*?)<\/h2>/iu) ??
    matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/iu) ??
    "",
  )).trim() || undefined;
}

function splitIntoChunks(text, maxChars) {
  const paragraphs = text.split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && `${current}\n\n${paragraph}`.length > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<\/(p|div|section|article|h1|h2|h3|li|br)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)));
}

function normalizeWhitespace(value) {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function joinZipPath(base, href) {
  if (!base || base === ".") {
    return href;
  }

  return posix.join(base.replaceAll("\\", "/"), href);
}

function normalizeZipPath(value) {
  return value.replaceAll("\\", "/");
}

function matchOne(value, regex) {
  return regex.exec(value)?.[1];
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "knowledge-source";
}
