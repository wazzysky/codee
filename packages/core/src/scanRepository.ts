import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { detectLanguage } from "./language.js";
import type { Diagnostic, RepoFile, ScanOptions, ScanResult } from "./types.js";

const DEFAULT_IGNORES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".venv",
  ".repolain"
] as const;

const scanOptionsSchema = z
  .object({
    ignore: z.array(z.string().min(1)).optional()
  })
  .optional();

function createIgnorePatterns(ignore: readonly string[]): string[] {
  return ignore.flatMap((entry) => [entry, `${entry}/**`, `**/${entry}`, `**/${entry}/**`]);
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isLikelyBinary(content: Buffer): boolean {
  return content.includes(0);
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  let lineCount = 1;
  for (const character of content) {
    if (character === "\n") {
      lineCount += 1;
    }
  }

  return lineCount;
}

function calculateHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function buildLanguageStats(files: RepoFile[]): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const file of files) {
    stats[file.language] = (stats[file.language] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(stats).sort(([left], [right]) => left.localeCompare(right)));
}

export async function scanRepository(rootPath: string, options?: ScanOptions): Promise<ScanResult> {
  const parsedOptions = scanOptionsSchema.parse(options);
  const ignore = [...DEFAULT_IGNORES, ...(parsedOptions?.ignore ?? [])];
  const resolvedRoot = path.resolve(rootPath);

  let rootStat;
  try {
    rootStat = await fs.stat(resolvedRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Repository path does not exist: ${resolvedRoot}. ${message}`);
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${resolvedRoot}`);
  }

  const diagnostics: Diagnostic[] = [];
  const entries = await fg(["**/*"], {
    cwd: resolvedRoot,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: createIgnorePatterns(ignore)
  });

  entries.sort((left, right) => left.localeCompare(right));

  const files: RepoFile[] = [];
  for (const relativePath of entries) {
    const absPath = path.resolve(resolvedRoot, relativePath);
    if (!isPathInsideRoot(resolvedRoot, absPath)) {
      diagnostics.push({
        level: "warning",
        message: "Skipped file outside repository root.",
        path: relativePath
      });
      continue;
    }

    try {
      const buffer = await fs.readFile(absPath);
      if (isLikelyBinary(buffer)) {
        diagnostics.push({
          level: "info",
          message: "Skipped likely binary file.",
          path: relativePath
        });
        continue;
      }

      const stat = await fs.stat(absPath);
      const text = buffer.toString("utf8");
      files.push({
        path: path.posix.normalize(relativePath.split(path.sep).join(path.posix.sep)),
        absPath,
        language: detectLanguage(relativePath),
        size: stat.size,
        lineCount: countLines(text),
        hash: calculateHash(buffer)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        level: "warning",
        message: `Failed to scan file: ${message}`,
        path: relativePath
      });
    }
  }

  return {
    root: resolvedRoot,
    files,
    languageStats: buildLanguageStats(files),
    diagnostics
  };
}
