import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { detectLanguage } from "./language.js";
import { detectProject } from "./detectProject.js";
import { generateFileMap } from "./generateFileMap.js";
import { createOpenAICompatibleLlmClientFromEnv } from "./llm.js";
import { matchKnowledge } from "./matchKnowledge.js";
import { scanRepository } from "./scanRepository.js";
import type {
  Diagnostic,
  ExplainFileOptions,
  FileExplanation,
  FileMapFile,
  FileRole,
  KnowledgeMatch,
  LlmClient,
  RepoFile,
  ScanResult
} from "./types.js";

const DEFAULT_MAX_LLM_FILE_SIZE_BYTES = 64 * 1024;
const REPOSITORY_ROOT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "CMakeLists.txt",
  "package.xml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pnpm-workspace.yaml",
  "AGENTS.md"
] as const;

const sensitiveFilePatterns = [
  /^\.env(?:\..+)?$/u,
  /\.pem$/iu,
  /\.key$/iu,
  /\.crt$/iu,
  /^id_rsa$/u,
  /^id_ed25519$/u,
  /^credentials\..+$/u,
  /^secrets\..+$/u
] as const;

const fileExplanationSchema = z.object({
  summary: z.string().min(1),
  role: z.enum([
    "entrypoint",
    "config",
    "test",
    "source",
    "component",
    "utility",
    "documentation",
    "build",
    "script",
    "asset",
    "generated",
    "unknown"
  ]),
  keyEvidence: z.array(z.string()).min(1),
  possibleKnowledgePoints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string())
});

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return sensitiveFilePatterns.some((pattern) => pattern.test(basename));
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

function isLikelyBinary(content: Buffer): boolean {
  return content.includes(0);
}

function calculateHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function findRepositoryRoot(filePath: string): Promise<string> {
  let current = path.resolve(path.dirname(filePath));

  while (true) {
    for (const marker of REPOSITORY_ROOT_MARKERS) {
      try {
        await fs.access(path.join(current, marker));
        return current;
      } catch {
        continue;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(path.dirname(filePath));
    }

    current = parent;
  }
}

async function createRepoFile(filePath: string, repoRoot: string): Promise<{ file: RepoFile; content?: string; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const absPath = path.resolve(filePath);
  const relativePath = normalizePath(path.relative(repoRoot, absPath));
  const buffer = await fs.readFile(absPath);
  const stat = await fs.stat(absPath);

  if (isLikelyBinary(buffer)) {
    diagnostics.push({
      level: "warning",
      message: "Target file looks binary; explanation is path-based only.",
      path: relativePath
    });
  }

  const content = isLikelyBinary(buffer) ? undefined : buffer.toString("utf8");

  return {
    file: {
      path: relativePath,
      absPath,
      language: detectLanguage(relativePath),
      size: stat.size,
      lineCount: content ? countLines(content) : 0,
      hash: calculateHash(buffer)
    },
    content,
    diagnostics
  };
}

function buildFileMapEntry(scanResult: ScanResult, targetFile: RepoFile): FileMapFile {
  const augmentedScanResult: ScanResult = scanResult.files.some((file) => file.path === targetFile.path)
    ? scanResult
    : {
        ...scanResult,
        files: [...scanResult.files, targetFile].sort((left, right) => left.path.localeCompare(right.path))
      };

  const fileMap = generateFileMap(augmentedScanResult);
  const fileEntry = fileMap.files.find((file) => file.path === targetFile.path);
  if (!fileEntry) {
    throw new Error(`Failed to generate a file map entry for ${targetFile.path}`);
  }

  return fileEntry;
}

function buildRuleBasedSummary(
  fileEntry: FileMapFile,
  repoFile: RepoFile,
  knowledgeMatches: KnowledgeMatch[]
): string {
  const knowledgeSummary =
    knowledgeMatches.length > 0
      ? ` It also shows signals related to ${knowledgeMatches.map((match) => match.name).join(", ")}.`
      : "";

  return `${repoFile.path} is a ${repoFile.language} ${fileEntry.role} file. ${fileEntry.explanation}${knowledgeSummary}`;
}

function collectRuleBasedEvidence(
  fileEntry: FileMapFile,
  repoFile: RepoFile,
  knowledgeMatches: KnowledgeMatch[]
): string[] {
  const evidence = [
    `role inference: ${fileEntry.explanation}`,
    `language: ${repoFile.language}`,
    `path: ${repoFile.path}`
  ];

  for (const match of knowledgeMatches.slice(0, 3)) {
    if (match.evidence[0]) {
      evidence.push(`${match.name}: ${match.evidence[0]}`);
    }
  }

  return evidence;
}

function buildRuleBasedUncertainties(fileEntry: FileMapFile, knowledgeMatches: KnowledgeMatch[]): string[] {
  const uncertainties: string[] = [];

  if (fileEntry.role === "unknown" || fileEntry.confidence < 0.5) {
    uncertainties.push("File role is uncertain because the path and filename provide weak signals.");
  }

  if (knowledgeMatches.length === 0) {
    uncertainties.push("No strong built-in knowledge point match was found for this file.");
  }

  return uncertainties;
}

function buildRuleBasedExplanation(
  repoRoot: string,
  repoFile: RepoFile,
  fileEntry: FileMapFile,
  knowledgeMatches: KnowledgeMatch[],
  diagnostics: Diagnostic[]
): FileExplanation {
  const possibleKnowledgePoints = [...new Set(knowledgeMatches.map((match) => match.name))].sort((left, right) =>
    left.localeCompare(right)
  );
  const uncertainties = buildRuleBasedUncertainties(fileEntry, knowledgeMatches);

  return {
    filePath: repoFile.path,
    repoRoot,
    mode: "rule-based",
    summary: buildRuleBasedSummary(fileEntry, repoFile, knowledgeMatches),
    role: fileEntry.role,
    keyEvidence: collectRuleBasedEvidence(fileEntry, repoFile, knowledgeMatches),
    possibleKnowledgePoints,
    confidence: Number(
      Math.max(
        0.2,
        Math.min(
          0.95,
          fileEntry.confidence * 0.6 + (knowledgeMatches[0]?.confidence ?? 0) * 0.25 + (possibleKnowledgePoints.length > 0 ? 0.1 : 0)
        )
      ).toFixed(2)
    ),
    uncertainties,
    diagnostics
  };
}

function createAiPrompt(
  repoFile: RepoFile,
  fileEntry: FileMapFile,
  knowledgeMatches: KnowledgeMatch[],
  projectSummary: string,
  content: string
): string {
  const knowledgeSummary =
    knowledgeMatches.length > 0
      ? knowledgeMatches
          .map((match) => `- ${match.name} (${match.domain}): ${match.evidence.join("; ")}`)
          .join("\n")
      : "- none";

  return [
    `Explain the repository file "${repoFile.path}".`,
    "",
    "Return JSON with these fields only:",
    '- "summary": string',
    '- "role": one of entrypoint, config, test, source, component, utility, documentation, build, script, asset, generated, unknown',
    '- "keyEvidence": string[]',
    '- "possibleKnowledgePoints": string[]',
    '- "confidence": number between 0 and 1',
    '- "uncertainties": string[]',
    "",
    `Detected role: ${fileEntry.role}`,
    `Role explanation: ${fileEntry.explanation}`,
    `Project context: ${projectSummary}`,
    "Knowledge hints:",
    knowledgeSummary,
    "",
    "File content:",
    content
  ].join("\n");
}

export async function explainFile(filePath: string, options: ExplainFileOptions = {}): Promise<FileExplanation> {
  const absolutePath = path.resolve(filePath);
  const fileStat = await fs.stat(absolutePath).catch(() => undefined);
  if (!fileStat) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${absolutePath}`);
  }

  const repoRoot = await findRepositoryRoot(absolutePath);
  const scanResult = await scanRepository(repoRoot);
  const { file: repoFile, content, diagnostics: localDiagnostics } = await createRepoFile(absolutePath, repoRoot);
  const fileEntry = buildFileMapEntry(scanResult, repoFile);
  const knowledgeResult = await matchKnowledge(
    scanResult.files.some((file) => file.path === repoFile.path)
      ? scanResult
      : {
          ...scanResult,
          files: [...scanResult.files, repoFile].sort((left, right) => left.path.localeCompare(right.path))
        }
  );
  const knowledgeMatches = knowledgeResult.matches.filter((match) => match.filePath === repoFile.path);
  const ruleBased = buildRuleBasedExplanation(
    repoRoot,
    repoFile,
    fileEntry,
    knowledgeMatches,
    [...scanResult.diagnostics, ...knowledgeResult.diagnostics, ...localDiagnostics]
  );

  if (!options.useAi) {
    return ruleBased;
  }

  const llmClient: LlmClient | undefined =
    options.llmClient ?? createOpenAICompatibleLlmClientFromEnv(options.env);
  if (!llmClient) {
    return {
      ...ruleBased,
      diagnostics: [
        ...ruleBased.diagnostics,
        {
          level: "info",
          message: "LLM is not configured; fell back to the rule-based explanation.",
          path: repoFile.path
        }
      ]
    };
  }

  if (isSensitiveFile(repoFile.path)) {
    return {
      ...ruleBased,
      diagnostics: [
        ...ruleBased.diagnostics,
        {
          level: "warning",
          message: "Sensitive files are not sent to the LLM; fell back to the rule-based explanation.",
          path: repoFile.path
        }
      ]
    };
  }

  const maxLlmFileSizeBytes = options.maxLlmFileSizeBytes ?? DEFAULT_MAX_LLM_FILE_SIZE_BYTES;
  if (repoFile.size > maxLlmFileSizeBytes) {
    return {
      ...ruleBased,
      diagnostics: [
        ...ruleBased.diagnostics,
        {
          level: "info",
          message: `File exceeds the LLM size limit of ${maxLlmFileSizeBytes} bytes; fell back to the rule-based explanation.`,
          path: repoFile.path
        }
      ]
    };
  }

  if (!content) {
    return {
      ...ruleBased,
      diagnostics: [
        ...ruleBased.diagnostics,
        {
          level: "warning",
          message: "Unreadable or binary file content was not sent to the LLM; fell back to the rule-based explanation.",
          path: repoFile.path
        }
      ]
    };
  }

  const projectDetection = await detectProject(repoRoot, scanResult.files);
  const aiResponse = await llmClient.completeJson({
    systemPrompt:
      "You are Repolain. Explain repository files conservatively. Do not invent facts. Return valid JSON only.",
    prompt: createAiPrompt(
      repoFile,
      fileEntry,
      knowledgeMatches,
      `types=${projectDetection.projectTypes.join(", ") || "unknown"}; frameworks=${projectDetection.frameworks.join(", ") || "none"}; buildTools=${projectDetection.buildTools.join(", ") || "none"}`,
      content
    ),
    schema: fileExplanationSchema,
    temperature: 0.1,
    maxTokens: 900
  });

  return {
    filePath: repoFile.path,
    repoRoot,
    mode: "ai",
    summary: aiResponse.summary,
    role: aiResponse.role as FileRole,
    keyEvidence: aiResponse.keyEvidence,
    possibleKnowledgePoints: [...new Set(aiResponse.possibleKnowledgePoints)].sort((left, right) =>
      left.localeCompare(right)
    ),
    confidence: Number(aiResponse.confidence.toFixed(2)),
    uncertainties: aiResponse.uncertainties,
    diagnostics: ruleBased.diagnostics
  };
}
