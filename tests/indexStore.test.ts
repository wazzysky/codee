import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getFile,
  indexRepository,
  listDependencies,
  listFiles,
  listKnowledgeMatches,
  listSymbolLinks,
  listSymbolReferences,
  listSymbols,
  searchFiles
} from "../packages/core/src/index";

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const source = path.resolve("tests/fixtures", name);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repolain-index-"));
  const repoRoot = path.join(target, name);
  await fs.cp(source, repoRoot, { recursive: true });
  await fs.rm(path.join(repoRoot, ".repolain"), { recursive: true, force: true });
  tempDirs.push(target);
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

describe("SQLiteIndexStore", () => {
  it("creates .repolain/index.sqlite and indexes repository artifacts", async () => {
    const repoRoot = await copyFixture("knowledge-demo");

    const summary = await indexRepository(repoRoot);

    expect(summary.totalFiles).toBeGreaterThan(0);
    expect(summary.changedFiles).toBe(summary.totalFiles);
    expect(summary.dbPath).toBe(path.join(repoRoot, ".repolain", "index.sqlite"));
    await expect(fs.access(summary.dbPath)).resolves.toBeUndefined();

    const files = await listFiles(repoRoot);
    expect(files.some((file) => file.path.startsWith(".repolain/"))).toBe(false);
    expect(files.some((file) => file.path === "src/ros_node.py")).toBe(true);
  });

  it("supports getFile, searchFiles, listKnowledgeMatches, listSymbols, and listDependencies queries", async () => {
    const repoRoot = await copyFixture("knowledge-demo");
    await indexRepository(repoRoot);

    await expect(getFile(repoRoot, "src/ros_node.py")).resolves.toEqual(
      expect.objectContaining({
        path: "src/ros_node.py",
        language: "Python"
      })
    );

    await expect(searchFiles(repoRoot, "ros node")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/ros_node.py"
        })
      ])
    );

    await expect(listKnowledgeMatches(repoRoot, "src/ros_node.py")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/ros_node.py",
          knowledgeId: "ros-node"
        })
      ])
    );

    await expect(listSymbols(repoRoot, "src/App.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/App.tsx",
          name: "App"
        })
      ])
    );

    await expect(listDependencies(repoRoot, "src/main.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "src/main.tsx",
          specifier: "react-dom/client",
          confidence: expect.any(Number),
          evidence: expect.any(Array)
        })
      ])
    );
  });

  it("persists structured symbols, symbol references, and internal dependencies from structure analysis", async () => {
    const repoRoot = await copyFixture("structure-demo");
    const summary = await indexRepository(repoRoot);

    expect(summary.referenceCount).toBeGreaterThan(0);
    expect(summary.symbolLinkCount).toBeGreaterThan(0);
    await expect(listSymbols(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/app.tsx",
          name: "Bootstrapper"
        }),
        expect.objectContaining({
          filePath: "ts/app.tsx",
          name: "App"
        })
      ])
    );

    await expect(listSymbolReferences(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/app.tsx",
          name: "Panel",
          kind: "component"
        }),
        expect.objectContaining({
          filePath: "ts/app.tsx",
          name: "createRoot",
          kind: "call"
        })
      ])
    );

    await expect(listDependencies(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "ts/app.tsx",
          specifier: "./lib",
          targetPath: "ts/lib/index.ts",
          resolution: "internal",
          resolved: true
        }),
        expect.objectContaining({
          sourcePath: "ts/app.tsx",
          specifier: "react-dom/client",
          resolution: "external",
          resolved: false
        })
      ])
    );

    await expect(listSymbolLinks(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "createRoot",
          targetSpecifier: "react-dom/client",
          resolution: "external"
        })
      ])
    );

    await expect(listSymbolLinks(repoRoot, "cpp/main.cpp")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "cpp/main.cpp",
          sourceReferenceName: "compute_value",
          targetFilePath: "cpp/utils/math.cpp",
          targetSymbolName: "compute_value",
          resolution: "internal"
        })
      ])
    );
  });

  it("uses file hash for incremental updates and detects removals", async () => {
    const repoRoot = await copyFixture("knowledge-demo");
    const filePath = path.join(repoRoot, "src", "pid_controller.cpp");
    const removePath = path.join(repoRoot, "src", "lqr_solver.cpp");

    const first = await indexRepository(repoRoot);
    expect(first.changedFiles).toBeGreaterThan(0);

    const second = await indexRepository(repoRoot);
    expect(second.changedFiles).toBe(0);
    expect(second.removedFiles).toBe(0);

    await fs.writeFile(filePath, "// PID controller updated\nkp = 2.0;\nki = 0.2;\nkd = 0.02;\n", "utf8");
    await fs.rm(removePath);

    const third = await indexRepository(repoRoot);
    expect(third.changedFiles).toBe(1);
    expect(third.removedFiles).toBe(1);

    await expect(getFile(repoRoot, "src/lqr_solver.cpp")).resolves.toBeUndefined();
  });
});
