import path from "node:path";
import type {
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  DependencyResolution,
  FileAnalysis
} from "./types.js";

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const PYTHON_EXTENSIONS = [".py"];
const CPP_EXTENSIONS = [".h", ".hpp", ".hh", ".hxx", ".c", ".cc", ".cpp", ".cxx"];

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function resolveScriptImport(sourcePath: string, specifier: string, fileSet: Set<string>): string | undefined {
  if (!(specifier.startsWith(".") || specifier.startsWith("/"))) {
    return undefined;
  }

  const sourceDirectory = path.posix.dirname(sourcePath);
  const basePath = normalizePath(
    specifier.startsWith("/")
      ? specifier.slice(1)
      : path.posix.join(sourceDirectory, specifier)
  );
  const candidates = new Set<string>([basePath]);

  for (const extension of SCRIPT_EXTENSIONS) {
    candidates.add(`${basePath}${extension}`);
    candidates.add(path.posix.join(basePath, `index${extension}`));
  }

  return [...candidates].find((candidate) => fileSet.has(candidate));
}

function resolvePythonImport(sourcePath: string, specifier: string, fileSet: Set<string>): string | undefined {
  const sourceDirectory = path.posix.dirname(sourcePath);

  if (specifier.startsWith(".")) {
    const match = /^(\.+)(.*)$/u.exec(specifier);
    if (!match) {
      return undefined;
    }

    const dotPrefix = match[1];
    const moduleSuffix = match[2];
    const parentLevels = Math.max(dotPrefix.length - 1, 0);
    let baseDirectory = sourceDirectory;
    for (let index = 0; index < parentLevels; index += 1) {
      baseDirectory = path.posix.dirname(baseDirectory);
    }

    const suffixPath = moduleSuffix.replace(/\./gu, "/");
    const basePath = suffixPath.length > 0 ? path.posix.join(baseDirectory, suffixPath) : baseDirectory;
    const candidates = [`${basePath}.py`, path.posix.join(basePath, "__init__.py")];
    return candidates.find((candidate) => fileSet.has(candidate));
  }

  const modulePath = specifier.replace(/\./gu, "/");
  const candidates = [`${modulePath}.py`, path.posix.join(modulePath, "__init__.py")];
  return candidates.find((candidate) => fileSet.has(candidate));
}

function resolveCppInclude(sourcePath: string, specifier: string, fileSet: Set<string>): string | undefined {
  const sourceDirectory = path.posix.dirname(sourcePath);
  const candidates = new Set<string>([
    normalizePath(path.posix.join(sourceDirectory, specifier)),
    normalizePath(specifier)
  ]);

  if (!path.posix.extname(specifier)) {
    for (const extension of CPP_EXTENSIONS) {
      candidates.add(normalizePath(path.posix.join(sourceDirectory, `${specifier}${extension}`)));
      candidates.add(normalizePath(`${specifier}${extension}`));
    }
  }

  const directMatch = [...candidates].find((candidate) => fileSet.has(candidate));
  if (directMatch) {
    return directMatch;
  }

  // Some projects include headers from an include root, e.g. "utils/math.h".
  const suffixMatches = [...fileSet].filter(
    (candidate) => candidate === normalizePath(specifier) || candidate.endsWith(`/${normalizePath(specifier)}`)
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function resolveDependency(
  analysis: FileAnalysis,
  specifier: string,
  fileSet: Set<string>
): { targetPath?: string; resolution: DependencyResolution; isInternal: boolean; confidence: number; evidence: string[] } {
  if (analysis.language === "TypeScript" || analysis.language === "JavaScript") {
    const targetPath = resolveScriptImport(analysis.filePath, specifier, fileSet);
    if (targetPath) {
      return {
        targetPath,
        resolution: "internal",
        isInternal: true,
        confidence: 0.93,
        evidence: [`Resolved relative script import "${specifier}" against known repository files.`]
      };
    }

    const isInternal = specifier.startsWith(".") || specifier.startsWith("/");
    return {
      resolution: isInternal ? "unresolved" : "external",
      isInternal,
      confidence: isInternal ? 0.45 : 0.95,
      evidence: [
        isInternal
          ? `Relative script import "${specifier}" did not match a repository file.`
          : `Non-relative script import "${specifier}" treated as external dependency.`
      ]
    };
  }

  if (analysis.language === "Python") {
    const targetPath = resolvePythonImport(analysis.filePath, specifier, fileSet);
    if (targetPath) {
      return {
        targetPath,
        resolution: "internal",
        isInternal: true,
        confidence: 0.92,
        evidence: [`Resolved Python import "${specifier}" to a repository module.`]
      };
    }

    const isInternal = specifier.startsWith(".");
    return {
      resolution: isInternal ? "unresolved" : "external",
      isInternal,
      confidence: isInternal ? 0.45 : 0.92,
      evidence: [
        isInternal
          ? `Relative Python import "${specifier}" did not match a repository module.`
          : `Absolute Python import "${specifier}" treated as external dependency.`
      ]
    };
  }

  if (analysis.language === "C" || analysis.language === "C++") {
    const targetPath = resolveCppInclude(analysis.filePath, specifier, fileSet);
    if (targetPath) {
      return {
        targetPath,
        resolution: "internal",
        isInternal: true,
        confidence: 0.9,
        evidence: [`Resolved local include "${specifier}" to a repository header/source file.`]
      };
    }

    const isInternal = !specifier.includes("/") && !/[.](?:h|hpp|hh|hxx|c|cc|cpp|cxx)$/u.test(specifier)
      ? false
      : !specifier.includes("/") || specifier.includes(".");
    return {
      resolution: isInternal ? "unresolved" : "external",
      isInternal,
      confidence: isInternal ? 0.4 : 0.95,
      evidence: [
        isInternal
          ? `Local include "${specifier}" did not match a repository file.`
          : `System include "${specifier}" treated as external dependency.`
      ]
    };
  }

  return {
    resolution: "external",
    isInternal: false,
    confidence: 0.9,
    evidence: ["Unsupported language import treated as external."]
  };
}

export function buildDependencyGraph(root: string, analyses: FileAnalysis[]): DependencyGraph {
  const sortedAnalyses = analyses.slice().sort((left, right) => left.filePath.localeCompare(right.filePath));
  const fileSet = new Set(sortedAnalyses.map((analysis) => normalizePath(analysis.filePath)));

  const nodes: DependencyGraphNode[] = sortedAnalyses.map((analysis) => ({
    path: normalizePath(analysis.filePath),
    language: analysis.language
  }));

  const edges: DependencyGraphEdge[] = [];
  for (const analysis of sortedAnalyses) {
    for (const reference of analysis.imports) {
      const resolved = resolveDependency(analysis, reference.specifier, fileSet);
      edges.push({
        sourcePath: normalizePath(analysis.filePath),
        targetPath: resolved.targetPath,
        specifier: reference.specifier,
        kind: reference.kind,
        line: reference.line,
        resolution: resolved.resolution,
        from: normalizePath(analysis.filePath),
        to: resolved.targetPath,
        type: reference.kind,
        resolved: resolved.resolution === "internal",
        confidence: resolved.confidence,
        evidence: resolved.evidence
      });
    }
  }

  edges.sort((left, right) => {
    const leftKey = `${left.sourcePath}\u0000${left.targetPath ?? ""}\u0000${left.specifier}\u0000${left.line}`;
    const rightKey = `${right.sourcePath}\u0000${right.targetPath ?? ""}\u0000${right.specifier}\u0000${right.line}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    root,
    nodes,
    edges,
    diagnostics: sortedAnalyses.flatMap((analysis) => analysis.diagnostics).sort((left, right) => {
      const leftKey = `${left.path ?? ""}\u0000${left.level}\u0000${left.message}`;
      const rightKey = `${right.path ?? ""}\u0000${right.level}\u0000${right.message}`;
      return leftKey.localeCompare(rightKey);
    })
  };
}
