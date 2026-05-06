import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ProjectDetection, RepoFile } from "./types.js";

const packageJsonSchema = z
  .object({
    main: z.string().optional(),
    bin: z.union([z.string(), z.record(z.string())]).optional(),
    scripts: z.record(z.string()).optional(),
    dependencies: z.record(z.string()).optional(),
    devDependencies: z.record(z.string()).optional(),
    peerDependencies: z.record(z.string()).optional(),
    optionalDependencies: z.record(z.string()).optional()
  })
  .passthrough();

const projectDetectionSchema = z.object({
  projectTypes: z.array(z.string()),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  buildTools: z.array(z.string()),
  generatedBy: z.array(z.string()),
  entryCandidates: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  uncertainties: z.array(z.string())
});

type ProjectSetKey =
  | "projectTypes"
  | "frameworks"
  | "buildTools"
  | "generatedBy"
  | "entryCandidates";

interface DetectionAccumulator {
  projectTypes: Set<string>;
  frameworks: Set<string>;
  buildTools: Set<string>;
  generatedBy: Set<string>;
  entryCandidates: Set<string>;
  evidence: Set<string>;
  uncertainties: Set<string>;
  confidenceScore: number;
}

const DIRECT_ENTRY_CANDIDATES = [
  "app.py",
  "main.py",
  "src/index.js",
  "src/index.ts",
  "src/index.tsx",
  "src/main.c",
  "src/main.cpp",
  "src/main.go",
  "src/main.js",
  "src/main.py",
  "src/main.rs",
  "src/main.ts",
  "src/main.tsx",
  "pages/index.tsx",
  "app/page.tsx",
  "main.go",
  "main.cpp"
] as const;

function normalizeRepoPath(filePath: string): string {
  return path.posix.normalize(filePath.split(path.sep).join(path.posix.sep));
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function readRepoTextFile(rootPath: string, relativePath: string): Promise<string | undefined> {
  const absPath = path.resolve(rootPath, relativePath);
  if (!isPathInsideRoot(rootPath, absPath)) {
    return undefined;
  }

  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return undefined;
  }
}

function createAccumulator(): DetectionAccumulator {
  return {
    projectTypes: new Set<string>(),
    frameworks: new Set<string>(),
    buildTools: new Set<string>(),
    generatedBy: new Set<string>(),
    entryCandidates: new Set<string>(),
    evidence: new Set<string>(),
    uncertainties: new Set<string>(),
    confidenceScore: 0
  };
}

function addDetection(
  accumulator: DetectionAccumulator,
  key: ProjectSetKey,
  value: string,
  evidence: string[],
  score: number
): void {
  const target = accumulator[key];
  if (target.has(value)) {
    evidence.forEach((item) => accumulator.evidence.add(item));
    return;
  }

  target.add(value);
  evidence.forEach((item) => accumulator.evidence.add(item));
  accumulator.confidenceScore += score;
}

function addUncertainty(accumulator: DetectionAccumulator, message: string): void {
  accumulator.uncertainties.add(message);
}

function addEntryCandidate(
  accumulator: DetectionAccumulator,
  fileSet: Set<string>,
  candidate: string,
  evidence: string[]
): void {
  if (!fileSet.has(candidate)) {
    return;
  }

  addDetection(accumulator, "entryCandidates", candidate, evidence, 0.25);
}

function getUniqueLanguages(files: RepoFile[]): string[] {
  return [...new Set(files.map((file) => file.language).filter((language) => language !== "Unknown"))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function hasDependency(
  packageJson: z.infer<typeof packageJsonSchema>,
  dependencyName: string
): boolean {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies
  ].some((dependencyGroup) => dependencyGroup?.[dependencyName] !== undefined);
}

function collectPackageJsonEntries(packageJson: z.infer<typeof packageJsonSchema>): string[] {
  const entries: string[] = [];

  if (packageJson.main) {
    entries.push(normalizeRepoPath(packageJson.main));
  }

  if (typeof packageJson.bin === "string") {
    entries.push(normalizeRepoPath(packageJson.bin));
  } else if (packageJson.bin) {
    entries.push(...Object.values(packageJson.bin).map((entry) => normalizeRepoPath(entry)));
  }

  return [...new Set(entries)].sort((left, right) => left.localeCompare(right));
}

function hasAnyFile(fileSet: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => fileSet.has(candidate));
}

function hasAnyPathPrefix(fileSet: Set<string>, prefix: string): boolean {
  for (const filePath of fileSet) {
    if (filePath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function hasDockerfile(fileSet: Set<string>): boolean {
  for (const filePath of fileSet) {
    if (path.posix.basename(filePath).startsWith("Dockerfile")) {
      return true;
    }
  }

  return false;
}

function calculateConfidence(accumulator: DetectionAccumulator): number {
  const evidenceBoost = Math.min(0.2, accumulator.evidence.size * 0.015);
  const scoreBoost = Math.min(0.55, accumulator.confidenceScore * 0.05);
  const uncertaintyPenalty = Math.min(0.2, accumulator.uncertainties.size * 0.05);
  const value = 0.2 + evidenceBoost + scoreBoost - uncertaintyPenalty;

  return Number(Math.max(0.05, Math.min(0.99, value)).toFixed(2));
}

export async function detectProject(rootPath: string, files: RepoFile[]): Promise<ProjectDetection> {
  const resolvedRoot = path.resolve(rootPath);
  const fileSet = new Set(files.map((file) => normalizeRepoPath(file.path)));
  const accumulator = createAccumulator();

  for (const candidate of DIRECT_ENTRY_CANDIDATES) {
    addEntryCandidate(accumulator, fileSet, candidate, [candidate]);
  }

  if (fileSet.has("package.json")) {
    addDetection(accumulator, "projectTypes", "Node.js project", ["package.json"], 3);
    const packageJsonText = await readRepoTextFile(resolvedRoot, "package.json");
    if (packageJsonText) {
      try {
        const packageJson = packageJsonSchema.parse(JSON.parse(packageJsonText));

        if (hasDependency(packageJson, "react") || hasDependency(packageJson, "react-dom")) {
          addDetection(
            accumulator,
            "frameworks",
            "React",
            ["package.json: react dependency"],
            2
          );
        }

        if (hasDependency(packageJson, "vue")) {
          addDetection(accumulator, "frameworks", "Vue", ["package.json: vue dependency"], 2);
        }

        if (hasDependency(packageJson, "next")) {
          addDetection(accumulator, "frameworks", "Next.js", ["package.json: next dependency"], 3);
        }

        if (hasDependency(packageJson, "electron")) {
          addDetection(accumulator, "frameworks", "Electron", ["package.json: electron dependency"], 2);
        }

        if (
          hasDependency(packageJson, "vite") ||
          fileSet.has("vite.config.ts") ||
          fileSet.has("vite.config.js") ||
          fileSet.has("vite.config.mjs") ||
          fileSet.has("vite.config.cjs")
        ) {
          addDetection(
            accumulator,
            "buildTools",
            "Vite",
            fileSet.has("vite.config.ts") || fileSet.has("vite.config.js") || fileSet.has("vite.config.mjs") || fileSet.has("vite.config.cjs")
              ? ["package.json", "vite.config.ts"]
              : ["package.json: vite dependency"],
            2
          );
        }

        for (const entry of collectPackageJsonEntries(packageJson)) {
          if (fileSet.has(entry)) {
            addDetection(accumulator, "entryCandidates", entry, ["package.json"], 0.5);
          } else {
            addUncertainty(
              accumulator,
              `package.json declares entry candidate "${entry}" but the file was not found.`
            );
          }
        }
      } catch {
        addUncertainty(accumulator, "package.json exists but could not be parsed as valid JSON.");
      }
    } else {
      addUncertainty(accumulator, "package.json exists but could not be read.");
    }

    if (
      hasAnyFile(fileSet, ["next.config.js", "next.config.mjs", "next.config.ts", "app/page.tsx", "pages/index.tsx"])
    ) {
      addDetection(
        accumulator,
        "frameworks",
        "Next.js",
        [...["next.config.js", "next.config.mjs", "next.config.ts", "app/page.tsx", "pages/index.tsx"].filter((candidate) =>
          fileSet.has(candidate)
        )],
        2.5
      );
    }
  }

  if (fileSet.has("pyproject.toml") || fileSet.has("requirements.txt")) {
    addDetection(
      accumulator,
      "projectTypes",
      "Python project",
      [...["pyproject.toml", "requirements.txt"].filter((candidate) => fileSet.has(candidate))],
      3
    );

    if (fileSet.has("requirements.txt")) {
      addDetection(accumulator, "buildTools", "pip", ["requirements.txt"], 1.5);
    }

    if (fileSet.has("pyproject.toml")) {
      const pyprojectText = await readRepoTextFile(resolvedRoot, "pyproject.toml");
      if (pyprojectText) {
        if (/\[tool\.poetry(?:\.[^\]]+)?\]/m.test(pyprojectText)) {
          addDetection(accumulator, "buildTools", "Poetry", ["pyproject.toml: [tool.poetry]"], 2);
        }

        if (/\[tool\.uv(?:\.[^\]]+)?\]/m.test(pyprojectText) || fileSet.has("uv.lock")) {
          addDetection(
            accumulator,
            "buildTools",
            "uv",
            fileSet.has("uv.lock") ? ["pyproject.toml", "uv.lock"] : ["pyproject.toml: [tool.uv]"],
            2
          );
        }

        if (
          !/\[tool\.poetry(?:\.[^\]]+)?\]/m.test(pyprojectText) &&
          !/\[tool\.uv(?:\.[^\]]+)?\]/m.test(pyprojectText) &&
          !fileSet.has("requirements.txt")
        ) {
          addUncertainty(
            accumulator,
            "pyproject.toml was found, but the Python package manager style is unclear."
          );
        }
      } else {
        addUncertainty(accumulator, "pyproject.toml exists but could not be read.");
      }
    }
  }

  if (fileSet.has("CMakeLists.txt")) {
    addDetection(accumulator, "buildTools", "CMake", ["CMakeLists.txt"], 2);
    const cmakeText = await readRepoTextFile(resolvedRoot, "CMakeLists.txt");
    const hasCppSources = files.some((file) => file.language === "C++");
    const hasCSources = files.some((file) => file.language === "C");

    if (hasCppSources || (cmakeText !== undefined && /\bCXX\b/.test(cmakeText))) {
      addDetection(accumulator, "projectTypes", "C++ project", ["CMakeLists.txt"], 2.5);
    } else if (hasCSources || (cmakeText !== undefined && /\bC\b/.test(cmakeText))) {
      addDetection(accumulator, "projectTypes", "C project", ["CMakeLists.txt"], 2);
    } else {
      addUncertainty(accumulator, "CMakeLists.txt was found, but no C or C++ source files were detected.");
    }
  }

  if (fileSet.has("package.xml")) {
    const packageXmlText = await readRepoTextFile(resolvedRoot, "package.xml");
    const packageEvidence = [...["package.xml", "CMakeLists.txt", "setup.py"].filter((candidate) => fileSet.has(candidate))];

    if (packageXmlText) {
      const hasCatkin = /<buildtool_depend>\s*catkin\s*<\/buildtool_depend>/m.test(packageXmlText);
      const hasAmentCmake =
        /<buildtool_depend>\s*ament_cmake\s*<\/buildtool_depend>/m.test(packageXmlText) ||
        /<build_type>\s*ament_cmake\s*<\/build_type>/m.test(packageXmlText);
      const hasAmentPython =
        /<buildtool_depend>\s*ament_python\s*<\/buildtool_depend>/m.test(packageXmlText) ||
        /<build_type>\s*ament_python\s*<\/build_type>/m.test(packageXmlText);

      if (hasCatkin) {
        addDetection(accumulator, "projectTypes", "ROS package", packageEvidence, 3);
        addDetection(accumulator, "frameworks", "ROS", ["package.xml: catkin"], 2.5);
        addDetection(accumulator, "buildTools", "catkin", ["package.xml: catkin"], 2);
      } else if (hasAmentCmake) {
        addDetection(accumulator, "projectTypes", "ROS 2 package", packageEvidence, 3);
        addDetection(accumulator, "frameworks", "ROS 2", ["package.xml: ament_cmake"], 2.5);
        addDetection(accumulator, "buildTools", "ament_cmake", ["package.xml: ament_cmake"], 2);
      } else if (hasAmentPython || fileSet.has("setup.py")) {
        addDetection(accumulator, "projectTypes", "ROS 2 package", packageEvidence, 3);
        addDetection(accumulator, "frameworks", "ROS 2", ["package.xml: ament_python"], 2.5);
        addDetection(
          accumulator,
          "buildTools",
          "ament_python",
          hasAmentPython ? ["package.xml: ament_python"] : ["package.xml", "setup.py"],
          2
        );
      } else {
        addDetection(accumulator, "projectTypes", "ROS package", ["package.xml"], 1.5);
        addUncertainty(
          accumulator,
          "package.xml was found, but the package does not clearly indicate catkin, ament_cmake, or ament_python."
        );
      }
    } else {
      addUncertainty(accumulator, "package.xml exists but could not be read.");
    }
  }

  if (hasDockerfile(fileSet)) {
    addDetection(
      accumulator,
      "buildTools",
      "Docker",
      [...fileSet].filter((filePath) => path.posix.basename(filePath).startsWith("Dockerfile")),
      1.5
    );
  }

  if (hasAnyPathPrefix(fileSet, ".github/workflows/")) {
    addDetection(
      accumulator,
      "buildTools",
      "GitHub Actions",
      [...fileSet].filter((filePath) => filePath.startsWith(".github/workflows/")),
      1.5
    );
  }

  if (fileSet.has("Cargo.toml")) {
    addDetection(accumulator, "projectTypes", "Rust project", ["Cargo.toml"], 3);
    addDetection(accumulator, "buildTools", "Cargo", ["Cargo.toml"], 2);
    addEntryCandidate(accumulator, fileSet, "src/main.rs", ["Cargo.toml", "src/main.rs"]);
  }

  if (fileSet.has("go.mod")) {
    addDetection(accumulator, "projectTypes", "Go project", ["go.mod"], 3);
    addDetection(accumulator, "buildTools", "Go Modules", ["go.mod"], 2);
    addEntryCandidate(accumulator, fileSet, "main.go", ["go.mod", "main.go"]);
  }

  if (fileSet.has("pom.xml")) {
    addDetection(accumulator, "projectTypes", "Java project", ["pom.xml"], 3);
    addDetection(accumulator, "buildTools", "Maven", ["pom.xml"], 2);
  }

  if (fileSet.has("build.gradle") || fileSet.has("build.gradle.kts")) {
    addDetection(
      accumulator,
      "projectTypes",
      "Java project",
      [...["build.gradle", "build.gradle.kts"].filter((candidate) => fileSet.has(candidate))],
      3
    );
    addDetection(
      accumulator,
      "buildTools",
      "Gradle",
      [...["build.gradle", "build.gradle.kts"].filter((candidate) => fileSet.has(candidate))],
      2
    );
  }

  const result: ProjectDetection = {
    projectTypes: [...accumulator.projectTypes].sort((left, right) => left.localeCompare(right)),
    languages: getUniqueLanguages(files),
    frameworks: [...accumulator.frameworks].sort((left, right) => left.localeCompare(right)),
    buildTools: [...accumulator.buildTools].sort((left, right) => left.localeCompare(right)),
    generatedBy: [...accumulator.generatedBy].sort((left, right) => left.localeCompare(right)),
    entryCandidates: [...accumulator.entryCandidates].sort((left, right) => left.localeCompare(right)),
    confidence: calculateConfidence(accumulator),
    evidence: [...accumulator.evidence].sort((left, right) => left.localeCompare(right)),
    uncertainties: [...accumulator.uncertainties].sort((left, right) => left.localeCompare(right))
  };

  return projectDetectionSchema.parse(result);
}
