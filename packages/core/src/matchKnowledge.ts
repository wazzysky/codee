import { knowledgePoints, type KnowledgePoint } from "@repolain/knowledge-base";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { detectProject } from "./detectProject.js";
import type {
  Diagnostic,
  KnowledgeMatch,
  KnowledgeOptions,
  KnowledgeResult,
  ProjectDetection,
  RepoFile,
  ScanResult
} from "./types.js";

const DEFAULT_MAX_FILE_SIZE_BYTES = 256 * 1024;

const knowledgeMatchSchema = z.object({
  filePath: z.string(),
  knowledgeId: z.string(),
  name: z.string(),
  domain: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).min(1)
});

const knowledgeResultSchema = z.object({
  root: z.string(),
  matches: z.array(knowledgeMatchSchema),
  diagnostics: z.array(
    z.object({
      level: z.enum(["info", "warning", "error"]),
      message: z.string(),
      path: z.string().optional()
    })
  )
});

interface KnowledgeContext {
  file: RepoFile;
  projectDetection: ProjectDetection;
  content?: string;
  lowerContent: string;
  normalizedPath: string;
  basename: string;
  extension: string;
  importLines: string[];
}

interface MatchCandidate {
  confidence: number;
  evidence: string[];
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function safeReadTextFile(root: string, file: RepoFile): Promise<string | undefined> {
  const absPath = path.resolve(root, file.path);
  if (!isPathInsideRoot(root, absPath)) {
    return undefined;
  }

  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return undefined;
  }
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function extractImportLines(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      /^(import\s|from\s|#include\s|const\s.+\s=\srequire\(|require\(|find_package\(|add_executable\(|FROM\s|RUN\s)/iu.test(
        line
      )
    );
}

function collectKeywordEvidence(source: string, keywords: string[], prefix: string): string[] {
  const lowerSource = source.toLowerCase();
  return uniqSorted(
    keywords
      .filter((keyword) => lowerSource.includes(keyword.toLowerCase()))
      .map((keyword) => `${prefix}: ${keyword}`)
  );
}

function collectImportEvidence(importLines: string[], keywords: string[]): string[] {
  const evidences: string[] = [];

  for (const line of importLines) {
    const lowerLine = line.toLowerCase();
    for (const keyword of keywords) {
      if (lowerLine.includes(keyword.toLowerCase())) {
        evidences.push(`import/include: ${line}`);
        break;
      }
    }
  }

  return uniqSorted(evidences);
}

function hasProjectSignal(projectDetection: ProjectDetection, signal: string): boolean {
  return (
    projectDetection.projectTypes.includes(signal) ||
    projectDetection.frameworks.includes(signal) ||
    projectDetection.buildTools.includes(signal)
  );
}

function buildKnowledgeMatch(
  filePath: string,
  point: KnowledgePoint,
  confidence: number,
  evidence: string[]
): KnowledgeMatch {
  return {
    filePath,
    knowledgeId: point.id,
    name: point.name,
    domain: point.domain,
    confidence: Number(Math.max(0.05, Math.min(0.99, confidence)).toFixed(2)),
    evidence: uniqSorted(evidence)
  };
}

function scoreCandidate(pathEvidence: string[], importEvidence: string[], keywordEvidence: string[], base = 0.25): number {
  return base + pathEvidence.length * 0.15 + importEvidence.length * 0.18 + keywordEvidence.length * 0.12;
}

function matchPid(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["pid"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length < 2) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.35),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchLqr(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["lqr"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.38),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchMpc(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["mpc"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.38),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchKalman(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate([], [], keywordEvidence, 0.34),
    evidence: keywordEvidence
  };
}

function matchEkf(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["ekf"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.42),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchSensorFusion(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  const hasFusionSignal =
    keywordEvidence.some((evidence) => evidence.includes("sensor fusion")) ||
    keywordEvidence.some((evidence) => evidence.includes("fuse"));
  const sensorSignals = keywordEvidence.filter((evidence) =>
    ["imu", "lidar", "camera", "radar", "gps"].some((keyword) => evidence.includes(keyword))
  );

  if (!hasFusionSignal && sensorSignals.length < 2) {
    return undefined;
  }

  return {
    confidence: scoreCandidate([], [], keywordEvidence, hasFusionSignal ? 0.42 : 0.33),
    evidence: keywordEvidence
  };
}

function matchSlam(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate([], [], keywordEvidence, 0.4),
    evidence: keywordEvidence
  };
}

function matchRosNode(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["node"], "path");
  const importEvidence = collectImportEvidence(ctx.importLines, point.keywords);
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  const projectEvidence: string[] = [];

  if (hasProjectSignal(ctx.projectDetection, "ROS") || hasProjectSignal(ctx.projectDetection, "ROS 2")) {
    projectEvidence.push(
      hasProjectSignal(ctx.projectDetection, "ROS 2")
        ? "project framework: ROS 2"
        : "project framework: ROS"
    );
  }

  const hasDirectNodeSignal = pathEvidence.length > 0 || importEvidence.length > 0 || keywordEvidence.length > 0;
  if (!hasDirectNodeSignal) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, importEvidence, keywordEvidence, projectEvidence.length > 0 ? 0.34 : 0.28),
    evidence: [...projectEvidence, ...pathEvidence, ...importEvidence, ...keywordEvidence]
  };
}

function matchRosLaunch(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence: string[] = [];
  if (ctx.normalizedPath.startsWith("launch/")) {
    pathEvidence.push(`path: ${ctx.normalizedPath}`);
  }

  if (ctx.basename.endsWith(".launch") || ctx.basename.endsWith(".launch.py")) {
    pathEvidence.push(`file name: ${ctx.basename}`);
  }

  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.45),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchAStar(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["astar", "a_star"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length < 2) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.38),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchRrt(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["rrt"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.38),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchOccupancyGrid(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const importEvidence = collectImportEvidence(ctx.importLines, point.keywords);
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (importEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate([], importEvidence, keywordEvidence, 0.36),
    evidence: [...importEvidence, ...keywordEvidence]
  };
}

function matchTrajectoryPlanning(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["trajectory", "planner", "planning"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.33),
    evidence: [...pathEvidence, ...keywordEvidence]
  };
}

function matchCMake(ctx: KnowledgeContext): MatchCandidate | undefined {
  if (ctx.basename !== "CMakeLists.txt" && ctx.extension !== ".cmake") {
    return undefined;
  }

  return {
    confidence: 0.95,
    evidence: [`file name: ${ctx.basename}`]
  };
}

function matchDocker(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const pathEvidence: string[] = [];
  if (ctx.basename.startsWith("Dockerfile")) {
    pathEvidence.push(`file name: ${ctx.basename}`);
  }

  const keywordEvidence = collectKeywordEvidence(
    ctx.lowerContent,
    point.keywords.filter((keyword) => keyword !== "from "),
    "keyword"
  );
  const projectEvidence = hasProjectSignal(ctx.projectDetection, "Docker")
    ? ["project build tool: Docker"]
    : [];

  const hasDirectDockerSignal =
    pathEvidence.length > 0 ||
    keywordEvidence.length > 0 ||
    ctx.normalizedPath.toLowerCase().includes("docker");
  if (!hasDirectDockerSignal) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, 0.45),
    evidence: [...projectEvidence, ...pathEvidence, ...keywordEvidence]
  };
}

function matchTypeScriptFrontend(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  const isWebSource = [".ts", ".tsx", ".js", ".jsx", ".vue"].includes(ctx.extension);
  if (!isWebSource && ctx.basename !== "package.json") {
    return undefined;
  }

  const projectEvidence: string[] = [];
  for (const framework of ["React", "Vue", "Next.js"]) {
    if (ctx.projectDetection.frameworks.includes(framework)) {
      projectEvidence.push(`project framework: ${framework}`);
    }
  }

  if (ctx.projectDetection.buildTools.includes("Vite")) {
    projectEvidence.push("project build tool: Vite");
  }

  const pathEvidence = collectKeywordEvidence(ctx.normalizedPath, ["src/", "components", "frontend", "app/"], "path");
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");
  if (projectEvidence.length === 0 && pathEvidence.length === 0 && keywordEvidence.length === 0) {
    return undefined;
  }

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, projectEvidence.length > 0 ? 0.44 : 0.32),
    evidence: [...projectEvidence, ...pathEvidence, ...keywordEvidence]
  };
}

function matchPythonPackage(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  if (!["pyproject.toml", "requirements.txt", "setup.py"].includes(ctx.basename)) {
    return undefined;
  }

  const projectEvidence = hasProjectSignal(ctx.projectDetection, "Python project")
    ? ["project type: Python project"]
    : [];
  const pathEvidence = [`file name: ${ctx.basename}`];
  const keywordEvidence = collectKeywordEvidence(ctx.lowerContent, point.keywords, "keyword");

  return {
    confidence: scoreCandidate(pathEvidence, [], keywordEvidence, projectEvidence.length > 0 ? 0.48 : 0.36),
    evidence: [...projectEvidence, ...pathEvidence, ...keywordEvidence]
  };
}

function matchPoint(ctx: KnowledgeContext, point: KnowledgePoint): MatchCandidate | undefined {
  switch (point.id) {
    case "pid-control":
      return matchPid(ctx, point);
    case "lqr":
      return matchLqr(ctx, point);
    case "mpc":
      return matchMpc(ctx, point);
    case "kalman-filter":
      return matchKalman(ctx, point);
    case "extended-kalman-filter":
      return matchEkf(ctx, point);
    case "sensor-fusion":
      return matchSensorFusion(ctx, point);
    case "slam":
      return matchSlam(ctx, point);
    case "ros-node":
      return matchRosNode(ctx, point);
    case "ros-launch":
      return matchRosLaunch(ctx, point);
    case "astar-search":
      return matchAStar(ctx, point);
    case "rrt":
      return matchRrt(ctx, point);
    case "occupancy-grid":
      return matchOccupancyGrid(ctx, point);
    case "trajectory-planning":
      return matchTrajectoryPlanning(ctx, point);
    case "cmake":
      return matchCMake(ctx);
    case "docker":
      return matchDocker(ctx, point);
    case "typescript-frontend":
      return matchTypeScriptFrontend(ctx, point);
    case "python-package":
      return matchPythonPackage(ctx, point);
    default:
      return undefined;
  }
}

function sortMatches(matches: KnowledgeMatch[]): KnowledgeMatch[] {
  return [...matches].sort((left, right) => {
    const byPath = left.filePath.localeCompare(right.filePath);
    if (byPath !== 0) {
      return byPath;
    }

    const byKnowledge = left.knowledgeId.localeCompare(right.knowledgeId);
    if (byKnowledge !== 0) {
      return byKnowledge;
    }

    return right.confidence - left.confidence;
  });
}

export async function matchKnowledge(
  scanResult: ScanResult,
  options?: KnowledgeOptions
): Promise<KnowledgeResult> {
  const root = path.resolve(scanResult.root);
  const projectDetection = await detectProject(root, scanResult.files);
  const diagnostics: Diagnostic[] = [...scanResult.diagnostics];
  const matches: KnowledgeMatch[] = [];
  const maxFileSizeBytes = options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  for (const file of scanResult.files) {
    let content: string | undefined;

    if (file.size > maxFileSizeBytes) {
      diagnostics.push({
        level: "info",
        message: `Skipped file content larger than ${maxFileSizeBytes} bytes during knowledge matching.`,
        path: file.path
      });
    } else {
      content = await safeReadTextFile(root, file);
      if (content === undefined) {
        diagnostics.push({
          level: "warning",
          message: "Skipped unreadable file during knowledge matching.",
          path: file.path
        });
      }
    }

    const normalizedPath = normalizePath(file.path);
    const lowerContent = (content ?? "").toLowerCase();
    const ctx: KnowledgeContext = {
      file,
      projectDetection,
      content,
      lowerContent,
      normalizedPath,
      basename: path.posix.basename(normalizedPath),
      extension: path.posix.extname(normalizedPath).toLowerCase(),
      importLines: content ? extractImportLines(content) : []
    };

    for (const point of knowledgePoints) {
      const candidate = matchPoint(ctx, point);
      if (!candidate || candidate.evidence.length === 0) {
        continue;
      }

      matches.push(buildKnowledgeMatch(file.path, point, candidate.confidence, candidate.evidence));
    }
  }

  return knowledgeResultSchema.parse({
    root,
    matches: sortMatches(matches),
    diagnostics: diagnostics.sort((left, right) => {
      const leftPath = left.path ?? "";
      const rightPath = right.path ?? "";
      return leftPath.localeCompare(rightPath) || left.message.localeCompare(right.message);
    })
  }) as KnowledgeResult;
}
