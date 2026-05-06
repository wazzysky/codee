import path from "node:path";
import { z } from "zod";
import type {
  DirectorySummary,
  FileMap,
  FileMapFile,
  FileRole,
  RepoFile,
  ScanResult
} from "./types.js";

const fileRoleSchema = z.enum([
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
]);

const fileMapFileSchema = z.object({
  path: z.string(),
  directory: z.string(),
  role: fileRoleSchema,
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  important: z.boolean(),
  language: z.string()
});

const directorySummarySchema = z.object({
  path: z.string(),
  description: z.string(),
  fileCount: z.number().int().min(0),
  roles: z.record(z.string(), z.number().int().min(0)),
  files: z.array(fileMapFileSchema)
});

const fileMapSchema = z.object({
  root: z.string(),
  directories: z.array(directorySummarySchema),
  files: z.array(fileMapFileSchema),
  importantFiles: z.array(fileMapFileSchema),
  uncertainties: z.array(z.string())
});

const roleOrder: FileRole[] = [
  "entrypoint",
  "config",
  "build",
  "component",
  "source",
  "utility",
  "test",
  "documentation",
  "script",
  "asset",
  "generated",
  "unknown"
];

const assetExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
  ".css",
  ".scss",
  ".sass",
  ".less"
]);

const generatedExtensions = new Set([".lock"]);
const sourceLanguages = new Set(["TypeScript", "JavaScript", "Python", "C", "C++", "Go", "Java", "Rust"]);

interface RoleMatch {
  role: FileRole;
  explanation: string;
  confidence: number;
  important: boolean;
}

function getDirectoryPath(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "./" : `${directory}/`;
}

function hasDirectorySegment(filePath: string, segment: string): boolean {
  const normalized = path.posix.normalize(filePath);
  return normalized === segment || normalized.startsWith(`${segment}/`) || normalized.includes(`/${segment}/`);
}

function hasAnyDirectorySegment(filePath: string, segments: readonly string[]): boolean {
  return segments.some((segment) => hasDirectorySegment(filePath, segment));
}

function isExactEntrypoint(filePath: string): boolean {
  const normalized = path.posix.normalize(filePath);
  const basename = path.posix.basename(normalized);

  return (
    [
      "main.py",
      "main.cpp",
      "main.c",
      "main.go",
      "main.rs",
      "index.ts",
      "index.js",
      "index.tsx",
      "index.jsx",
      "app/page.tsx",
      "pages/index.tsx",
      "src/main.ts",
      "src/main.tsx",
      "src/main.js",
      "src/main.jsx",
      "src/main.py",
      "src/main.cpp",
      "src/main.c",
      "src/main.go",
      "src/main.rs"
    ].includes(normalized) ||
    (basename.startsWith("main.") && hasAnyDirectorySegment(normalized, ["src", "app"])) ||
    (basename.startsWith("index.") && hasAnyDirectorySegment(normalized, ["src", "app", "pages"]))
  );
}

function isConfigFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  const extension = path.posix.extname(filePath).toLowerCase();

  return (
    [
      "package.json",
      "package.xml",
      "pyproject.toml",
      "requirements.txt",
      "tsconfig.json",
      "Cargo.toml",
      "go.mod",
      "pom.xml"
    ].includes(basename) ||
    (hasDirectorySegment(filePath, "config") && [".yaml", ".yml", ".json", ".toml", ".ini"].includes(extension))
  );
}

function isTestFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  return (
    hasAnyDirectorySegment(filePath, ["test", "tests", "__tests__"]) ||
    /\.test\.[^.]+$/u.test(basename) ||
    /\.spec\.[^.]+$/u.test(basename) ||
    /^test_.+/u.test(basename)
  );
}

function isDocumentationFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath).toLowerCase();
  const extension = path.posix.extname(filePath).toLowerCase();
  return basename === "readme.md" || hasDirectorySegment(filePath, "docs") || [".md", ".markdown"].includes(extension);
}

function isBuildFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  return (
    basename === "CMakeLists.txt" ||
    basename === "Dockerfile" ||
    basename.startsWith("Dockerfile.") ||
    basename === "build.gradle" ||
    basename === "build.gradle.kts" ||
    basename === "vite.config.ts" ||
    basename === "vite.config.js" ||
    basename === "vite.config.mjs" ||
    basename === "vite.config.cjs" ||
    basename === "next.config.ts" ||
    basename === "next.config.js" ||
    basename === "next.config.mjs" ||
    basename === "next.config.cjs" ||
    hasDirectorySegment(filePath, ".github/workflows")
  );
}

function isScriptFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  const extension = path.posix.extname(filePath).toLowerCase();
  return hasAnyDirectorySegment(filePath, ["scripts", "bin"]) || [".sh", ".bash"].includes(extension) || basename === "setup.py";
}

function isAssetFile(filePath: string): boolean {
  const extension = path.posix.extname(filePath).toLowerCase();
  return hasAnyDirectorySegment(filePath, ["assets", "asset", "public", "static", "images", "img"]) || assetExtensions.has(extension);
}

function isGeneratedFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  const extension = path.posix.extname(filePath).toLowerCase();
  return (
    hasAnyDirectorySegment(filePath, ["generated", "gen"]) ||
    basename.includes(".generated.") ||
    basename.endsWith(".pb.cc") ||
    basename.endsWith(".pb.h") ||
    generatedExtensions.has(extension)
  );
}

function isComponentFile(filePath: string): boolean {
  const extension = path.posix.extname(filePath).toLowerCase();
  return (
    hasAnyDirectorySegment(filePath, ["components", "component"]) &&
    [".tsx", ".jsx", ".vue", ".svelte", ".ts", ".js"].includes(extension)
  );
}

function isUtilityFile(filePath: string): boolean {
  return hasAnyDirectorySegment(filePath, ["utils", "util", "helpers", "helper", "lib"]);
}

function isRosLaunchFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  return (
    hasDirectorySegment(filePath, "launch") &&
    (basename.endsWith(".launch") || basename.endsWith(".launch.py") || basename.endsWith(".py"))
  );
}

function isSourceFile(file: RepoFile): boolean {
  return (
    sourceLanguages.has(file.language) ||
    [".ts", ".tsx", ".js", ".jsx", ".py", ".c", ".cc", ".cpp", ".go", ".rs", ".java"].includes(
      path.posix.extname(file.path).toLowerCase()
    )
  );
}

function createEntrypointExplanation(file: RepoFile): string {
  const language = file.language === "Unknown" ? "Program" : file.language;
  if (isRosLaunchFile(file.path)) {
    return "ROS launch entry candidate that starts one or more runtime nodes.";
  }

  return `${language} entry candidate inferred from the file name and directory.`;
}

function classifyFile(file: RepoFile): RoleMatch {
  const normalizedPath = path.posix.normalize(file.path);
  const basename = path.posix.basename(normalizedPath);

  if (basename === "README.md") {
    return {
      role: "documentation",
      explanation: "Project overview and usage documentation.",
      confidence: 0.99,
      important: true
    };
  }

  if (basename === "package.json") {
    return {
      role: "config",
      explanation: "Node.js package manifest defining dependencies and scripts.",
      confidence: 0.98,
      important: true
    };
  }

  if (basename === "CMakeLists.txt") {
    return {
      role: "build",
      explanation: "CMake build configuration for native targets.",
      confidence: 0.98,
      important: true
    };
  }

  if (basename === "package.xml") {
    return {
      role: "config",
      explanation: "ROS package manifest describing metadata and dependencies.",
      confidence: 0.98,
      important: true
    };
  }

  if (isRosLaunchFile(normalizedPath)) {
    return {
      role: "entrypoint",
      explanation: createEntrypointExplanation(file),
      confidence: 0.93,
      important: true
    };
  }

  if (isExactEntrypoint(normalizedPath)) {
    return {
      role: "entrypoint",
      explanation: createEntrypointExplanation(file),
      confidence: 0.9,
      important: true
    };
  }

  if (isBuildFile(normalizedPath)) {
    return {
      role: "build",
      explanation: "Build or CI configuration file used to package, compile, or validate the project.",
      confidence: 0.92,
      important: true
    };
  }

  if (isConfigFile(normalizedPath)) {
    return {
      role: "config",
      explanation: "Configuration file controlling project behavior or tooling.",
      confidence: 0.88,
      important: true
    };
  }

  if (isTestFile(normalizedPath)) {
    return {
      role: "test",
      explanation: "Automated test file covering expected project behavior.",
      confidence: 0.9,
      important: true
    };
  }

  if (isComponentFile(normalizedPath)) {
    return {
      role: "component",
      explanation: "Reusable UI component or presentation module.",
      confidence: 0.84,
      important: false
    };
  }

  if (isUtilityFile(normalizedPath)) {
    return {
      role: "utility",
      explanation: "Shared helper or utility module reused across the codebase.",
      confidence: 0.8,
      important: false
    };
  }

  if (isDocumentationFile(normalizedPath)) {
    return {
      role: "documentation",
      explanation: "Project documentation or reference material.",
      confidence: 0.82,
      important: true
    };
  }

  if (isScriptFile(normalizedPath)) {
    return {
      role: "script",
      explanation: "Automation script for development, setup, or operations.",
      confidence: 0.8,
      important: false
    };
  }

  if (isAssetFile(normalizedPath)) {
    return {
      role: "asset",
      explanation: "Static asset consumed by the application or documentation.",
      confidence: 0.85,
      important: false
    };
  }

  if (isGeneratedFile(normalizedPath)) {
    return {
      role: "generated",
      explanation: "Generated file checked into the repository.",
      confidence: 0.89,
      important: false
    };
  }

  if (isSourceFile(file)) {
    return {
      role: "source",
      explanation: "Source file implementing project logic.",
      confidence: 0.65,
      important: false
    };
  }

  return {
    role: "unknown",
    explanation: "File role is unclear from the path and filename alone.",
    confidence: 0.3,
    important: false
  };
}

function createDirectoryDescription(directoryPath: string, files: FileMapFile[]): string {
  if (directoryPath === "./") {
    return "Repository root directory containing top-level project files.";
  }

  if (directoryPath === ".github/workflows/") {
    return "GitHub Actions workflow definitions for CI and automation.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["components", "component"])) {
    return "Reusable UI or application components.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["utils", "util", "helpers", "helper", "lib"])) {
    return "Shared utility helpers and support modules.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["src"])) {
    return "Primary source code directory.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["config"])) {
    return "Configuration files for runtime behavior and tooling.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["docs"])) {
    return "Project documentation and reference notes.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["test", "tests", "__tests__"])) {
    return "Automated tests and validation files.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["scripts", "bin"])) {
    return "Automation and maintenance scripts.";
  }

  if (hasDirectorySegment(directoryPath, "launch")) {
    return "ROS launch files and runtime orchestration.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["assets", "asset", "public", "static", "images", "img"])) {
    return "Static assets and non-code resources.";
  }

  if (hasAnyDirectorySegment(directoryPath, ["generated", "gen"])) {
    return "Generated files stored in the repository.";
  }

  const primaryRole = [...roleOrder].find((role) => files.some((file) => file.role === role));
  if (primaryRole === "source") {
    return "Source files grouped under a feature or module directory.";
  }

  if (primaryRole === "documentation") {
    return "Documentation-focused directory.";
  }

  if (primaryRole === "config") {
    return "Configuration-focused directory.";
  }

  return "Mixed-purpose directory with files that need further interpretation.";
}

function buildRoleCounts(files: FileMapFile[]): Partial<Record<FileRole, number>> {
  const counts = new Map<FileRole, number>();

  for (const file of files) {
    counts.set(file.role, (counts.get(file.role) ?? 0) + 1);
  }

  return Object.fromEntries(
    roleOrder
      .filter((role) => counts.has(role))
      .map((role) => [role, counts.get(role) ?? 0])
  ) as Partial<Record<FileRole, number>>;
}

function sortByPath<T extends { path: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.path.localeCompare(right.path));
}

export function generateFileMap(scanResult: ScanResult): FileMap {
  const files: FileMapFile[] = sortByPath(scanResult.files).map((file) => {
    const roleMatch = classifyFile(file);

    return {
      path: file.path,
      directory: getDirectoryPath(file.path),
      role: roleMatch.role,
      explanation: roleMatch.explanation,
      confidence: Number(roleMatch.confidence.toFixed(2)),
      important: roleMatch.important,
      language: file.language
    };
  });

  const directoryMap = new Map<string, FileMapFile[]>();
  for (const file of files) {
    const bucket = directoryMap.get(file.directory) ?? [];
    bucket.push(file);
    directoryMap.set(file.directory, bucket);
  }

  const directories: DirectorySummary[] = [...directoryMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directoryPath, directoryFiles]) => {
      const sortedFiles = sortByPath(directoryFiles);
      return {
        path: directoryPath,
        description: createDirectoryDescription(directoryPath, sortedFiles),
        fileCount: sortedFiles.length,
        roles: buildRoleCounts(sortedFiles),
        files: sortedFiles
      };
    });

  const importantFiles = files
    .filter((file) => file.important)
    .sort((left, right) => left.path.localeCompare(right.path));

  const uncertainties = files
    .filter((file) => file.role === "unknown" || file.confidence < 0.5)
    .map((file) => `${file.path}: ${file.explanation}`)
    .sort((left, right) => left.localeCompare(right));

  const parsed = fileMapSchema.parse({
    root: scanResult.root,
    directories,
    files,
    importantFiles,
    uncertainties
  });

  return parsed as FileMap;
}
