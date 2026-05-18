import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getFile,
  indexRepository,
  listDependencies,
  listExportBindings,
  listFiles,
  listKnowledgeMatches,
  listNamespaceSymbolEdges,
  listNamespaceSymbolNodes,
  listScopeBindings,
  listSymbolCalls,
  listSymbolRankings,
  listSymbolReferenceEdges,
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

  it("supports getFile, searchFiles, listKnowledgeMatches, listSymbols, listExportBindings, listScopeBindings, listSymbolReferenceEdges, and listDependencies queries", async () => {
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

    await expect(listExportBindings(repoRoot, "src/App.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/App.tsx",
          exportedName: "App",
          kind: "named"
        })
      ])
    );

    await expect(listNamespaceSymbolNodes(repoRoot, "src/App.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/App.tsx",
          path: "App",
          kind: "export",
          localName: "App"
        })
      ])
    );
    await expect(listNamespaceSymbolEdges(repoRoot, "src/App.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/App.tsx",
          fromPath: "App",
          toPath: "App",
          kind: "resolves-to",
          targetSymbolName: "App"
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

    await expect(listScopeBindings(repoRoot, "src/App.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "src/App.tsx",
          name: "App",
          kind: "symbol"
        })
      ])
    );

    await expect(listSymbolReferenceEdges(repoRoot, "src/App.tsx")).resolves.toEqual([]);

  });

  it("persists structured symbols, symbol references, and internal dependencies from structure analysis", async () => {
    const repoRoot = await copyFixture("structure-demo");
    const summary = await indexRepository(repoRoot);

    expect(summary.referenceCount).toBeGreaterThan(0);
    expect(summary.scopeBindingCount).toBeGreaterThan(0);
    expect(summary.symbolLinkCount).toBeGreaterThan(0);
    expect(summary.symbolCallCount).toBeGreaterThan(0);
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

    await expect(listDependencies(repoRoot, "ts/interop.ts")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "ts/interop.ts",
          specifier: "./legacy-cjs",
          resolution: "internal",
          resolved: true
        }),
        expect.objectContaining({
          sourcePath: "ts/interop.ts",
          specifier: "./legacy",
          resolution: "internal",
          resolved: true
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
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceReferenceName: "Panel",
          targetFilePath: "ts/ui/panel.tsx",
          targetSymbolName: "Panel",
          resolution: "internal"
        })
      ])
    );

    await expect(listExportBindings(repoRoot, "ts/ui/index.ts")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/ui/index.ts",
          exportedName: "Panel",
          localName: "Panel",
          sourceSpecifier: "./panel",
          kind: "named"
        })
      ])
    );

    await expect(listNamespaceSymbolNodes(repoRoot, "ts/object-cjs.js")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          path: "nested",
          kind: "namespace"
        }),
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          path: "nested.createNestedRunner",
          kind: "export",
          localName: "createObjectRunner"
        })
      ])
    );

    await expect(listNamespaceSymbolEdges(repoRoot, "ts/object-cjs.js")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          fromPath: "nested",
          toPath: "nested.createNestedRunner",
          kind: "contains"
        }),
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          fromPath: "nested.createNestedRunner",
          toPath: "createObjectRunner",
          kind: "resolves-to"
        })
      ])
    );

    await expect(listSymbolRankings(repoRoot, "ts/object-cjs.js")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/object-cjs.js",
          symbolName: "createObjectRunner",
          namespaceExportCount: expect.any(Number),
          score: expect.any(Number)
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

    await expect(listScopeBindings(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/app.tsx",
          name: "ReactDOM",
          kind: "import"
        }),
        expect.objectContaining({
          filePath: "ts/app.tsx",
          name: "engine",
          kind: "variable"
        })
      ])
    );

    await expect(listSymbolCalls(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callerFilePath: "ts/app.tsx",
          callerSymbolName: "bootstrap",
          calleeSymbolName: "createRoot",
          resolution: "external"
        }),
        expect.objectContaining({
          callerFilePath: "ts/app.tsx",
          callerSymbolName: "App",
          calleeFilePath: "ts/ui/panel.tsx",
          calleeSymbolName: "Panel",
          resolution: "internal"
        }),
        expect.objectContaining({
          callerFilePath: "ts/app.tsx",
          callerSymbolName: "App",
          calleeFilePath: "ts/tools/index.ts",
          calleeSymbolName: "createLabel",
          resolution: "internal"
        })
      ])
    );

    await expect(listSymbolReferenceEdges(repoRoot, "ts/app.tsx")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceSymbolName: "App",
          sourceReferenceName: "createLabel",
          sourceQualifier: "Toolset",
          targetFilePath: "ts/tools/index.ts",
          targetSymbolName: "createLabel",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/app.tsx",
          sourceSymbolName: "App",
          sourceReferenceName: "createBadge",
          sourceQualifier: "ToolModule",
          targetFilePath: "ts/tools/index.ts",
          targetSymbolName: "createBadge",
          resolution: "internal"
        })
      ])
    );

    await expect(listSymbolReferenceEdges(repoRoot, "ts/interop.ts")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/interop.ts",
          sourceSymbolName: "useLegacy",
          sourceReferenceName: "LegacyOptions",
          targetFilePath: "ts/legacy.ts",
          targetSymbolName: "LegacyOptions",
          targetSymbolKind: "type",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/interop.ts",
          sourceSymbolName: "useLegacy",
          sourceReferenceName: "CommonRunner",
          targetFilePath: "ts/legacy-cjs.js",
          targetSymbolName: "CommonRunner",
          resolution: "internal"
        })
      ])
    );

    await expect(listSymbolReferenceEdges(repoRoot, "ts/object-interop.ts")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "namedFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "inlineFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "inlineFactory",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "computedFactory",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
          resolution: "internal"
        }),
        expect.objectContaining({
          sourceFilePath: "ts/object-interop.ts",
          sourceSymbolName: "useObjectInterop",
          sourceReferenceName: "createNestedRunner",
          sourceQualifier: "ObjectModule.nested",
          targetFilePath: "ts/object-cjs.js",
          targetSymbolName: "createObjectRunner",
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
