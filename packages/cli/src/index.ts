import {
  detectProject,
  explainFile,
  generateFileMap,
  indexRepository,
  matchKnowledge,
  scanRepository
} from "@repolain/core";
import { Command } from "commander";
import type {
  DirectorySummary,
  FileExplanation,
  FileMap,
  IndexSummary,
  KnowledgeResult
} from "@repolain/core";

export interface CliIo {
  stderr: (message: string) => void;
  stdout: (message: string) => void;
}

function createDefaultIo(): CliIo {
  return {
    stderr: (message: string) => {
      process.stderr.write(message);
    },
    stdout: (message: string) => {
      process.stdout.write(message);
    }
  };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/gu, "\\|");
}

function formatConfidence(value: number): string {
  return value.toFixed(2);
}

export function renderFileMapMarkdown(fileMap: FileMap): string {
  const lines: string[] = [
    "# File Map",
    "",
    `Root: \`${fileMap.root}\``,
    "",
    `Directories: ${fileMap.directories.length}`,
    `Files: ${fileMap.files.length}`,
    ""
  ];

  if (fileMap.uncertainties.length > 0) {
    lines.push("## Uncertainties", "");
    for (const uncertainty of fileMap.uncertainties) {
      lines.push(`- ${uncertainty}`);
    }
    lines.push("");
  }

  for (const directory of fileMap.directories) {
    appendDirectorySection(lines, directory);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderKnowledgeMarkdown(result: KnowledgeResult): string {
  const lines: string[] = [
    "# Knowledge Map",
    "",
    `Root: \`${result.root}\``,
    "",
    `Matches: ${result.matches.length}`,
    `Diagnostics: ${result.diagnostics.length}`,
    ""
  ];

  if (result.diagnostics.length > 0) {
    lines.push("## Diagnostics", "");
    for (const diagnostic of result.diagnostics) {
      const pathPrefix = diagnostic.path ? `${diagnostic.path}: ` : "";
      lines.push(`- [${diagnostic.level}] ${pathPrefix}${diagnostic.message}`);
    }
    lines.push("");
  }

  lines.push("## Matches", "");
  lines.push("| File | Knowledge | Domain | Confidence | Evidence |");
  lines.push("|---|---|---|---|---|");

  for (const match of result.matches) {
    lines.push(
      `| ${escapeMarkdownCell(match.filePath)} | ${escapeMarkdownCell(match.name)} | ${escapeMarkdownCell(match.domain)} | ${formatConfidence(match.confidence)} | ${escapeMarkdownCell(match.evidence.join("; "))} |`
    );
  }

  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderExplainMarkdown(result: FileExplanation): string {
  const lines: string[] = [
    "# File Explanation",
    "",
    `File: \`${result.filePath}\``,
    `Repository Root: \`${result.repoRoot}\``,
    `Mode: ${result.mode}`,
    `Role: ${result.role}`,
    `Confidence: ${formatConfidence(result.confidence)}`,
    "",
    "## Summary",
    "",
    result.summary,
    ""
  ];

  lines.push("## Key Evidence", "");
  for (const evidence of result.keyEvidence) {
    lines.push(`- ${evidence}`);
  }
  lines.push("");

  lines.push("## Possible Knowledge Points", "");
  if (result.possibleKnowledgePoints.length === 0) {
    lines.push("- none");
  } else {
    for (const point of result.possibleKnowledgePoints) {
      lines.push(`- ${point}`);
    }
  }
  lines.push("");

  lines.push("## Uncertainties", "");
  if (result.uncertainties.length === 0) {
    lines.push("- none");
  } else {
    for (const uncertainty of result.uncertainties) {
      lines.push(`- ${uncertainty}`);
    }
  }
  lines.push("");

  if (result.diagnostics.length > 0) {
    lines.push("## Diagnostics", "");
    for (const diagnostic of result.diagnostics) {
      const pathPrefix = diagnostic.path ? `${diagnostic.path}: ` : "";
      lines.push(`- [${diagnostic.level}] ${pathPrefix}${diagnostic.message}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderIndexSummaryMarkdown(result: IndexSummary): string {
  const lines: string[] = [
    "# Index Summary",
    "",
    `Root: \`${result.root}\``,
    `Database: \`${result.dbPath}\``,
    "",
    `Total Files: ${result.totalFiles}`,
    `Changed Files: ${result.changedFiles}`,
    `Removed Files: ${result.removedFiles}`,
    `Knowledge Matches: ${result.knowledgeMatchCount}`,
    `Diagnostics: ${result.diagnosticCount}`,
    ""
  ];

  lines.push("## Project Types", "");
  if (result.projectTypes.length === 0) {
    lines.push("- none");
  } else {
    for (const projectType of result.projectTypes) {
      lines.push(`- ${projectType}`);
    }
  }
  lines.push("");

  return `${lines.join("\n").trimEnd()}\n`;
}

function appendDirectorySection(lines: string[], directory: DirectorySummary): void {
  const roleSummary = Object.entries(directory.roles)
    .map(([role, count]) => `${role}=${count}`)
    .join(", ");

  lines.push(`## ${directory.path}`, "");
  lines.push(directory.description, "");
  lines.push(`Files: ${directory.fileCount}`);
  if (roleSummary.length > 0) {
    lines.push(`Roles: ${roleSummary}`);
  }
  lines.push("");
  lines.push("| File | Role | Explanation | Confidence |");
  lines.push("|---|---|---|---|");

  for (const file of directory.files) {
    lines.push(
      `| ${escapeMarkdownCell(file.path)} | ${file.role} | ${escapeMarkdownCell(file.explanation)} | ${formatConfidence(file.confidence)} |`
    );
  }

  lines.push("");
}

export function createProgram(io: CliIo = createDefaultIo()): Command {
  const program = new Command();

  program
    .name("repolain")
    .description("CLI-first repository understanding tool")
    .showHelpAfterError();

  program
    .command("scan")
    .argument("<path>", "repository root path")
    .description("Scan repository files and emit JSON")
    .action(async (targetPath: string) => {
      const result = await scanRepository(targetPath);
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command("summary")
    .argument("<path>", "repository root path")
    .description("Detect project type, frameworks, and toolchains, then emit JSON")
    .action(async (targetPath: string) => {
      const scanResult = await scanRepository(targetPath);
      const result = await detectProject(scanResult.root, scanResult.files);
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command("file-map")
    .argument("<path>", "repository root path")
    .option("--json", "emit the raw file map structure as JSON")
    .description("Generate a rule-based file map in Markdown or JSON")
    .action(async (targetPath: string, options: { json?: boolean }) => {
      const scanResult = await scanRepository(targetPath);
      const result = generateFileMap(scanResult);

      if (options.json) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      io.stdout(renderFileMapMarkdown(result));
    });

  program
    .command("knowledge")
    .argument("<path>", "repository root path")
    .option("--json", "emit the raw knowledge match structure as JSON")
    .description("Match built-in knowledge points against repository files")
    .action(async (targetPath: string, options: { json?: boolean }) => {
      const scanResult = await scanRepository(targetPath);
      const result = await matchKnowledge(scanResult);

      if (options.json) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      io.stdout(renderKnowledgeMarkdown(result));
    });

  program
    .command("explain")
    .argument("<file>", "file path to explain")
    .option("--ai", "use the configured LLM when available")
    .description("Explain a file using rule-based logic or an optional LLM")
    .action(async (targetFile: string, options: { ai?: boolean }) => {
      const result = await explainFile(targetFile, {
        useAi: options.ai ?? false
      });

      io.stdout(renderExplainMarkdown(result));
    });

  program
    .command("index")
    .argument("<path>", "repository root path")
    .description("Build or update the SQLite repository index")
    .action(async (targetPath: string) => {
      const result = await indexRepository(targetPath);
      io.stdout(renderIndexSummaryMarkdown(result));
    });

  return program;
}

export async function runCli(argv: string[], io: CliIo = createDefaultIo()): Promise<number> {
  const program = createProgram(io);

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
}
