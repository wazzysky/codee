import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  extractRepositorySymbols,
  scanRepository
} from "../packages/core/src/index";

describe("buildDependencyGraph", () => {
  it("connects Python, TypeScript, and C++ internal dependency edges", async () => {
    const scanResult = await scanRepository(path.resolve("tests/fixtures/structure-demo"));
    const symbolResult = await extractRepositorySymbols(scanResult);
    const graph = buildDependencyGraph(scanResult.root, symbolResult.files);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "python_pkg/main.py",
          targetPath: "python_pkg/utils.py",
          specifier: ".utils",
          resolution: "internal",
          resolved: true
        }),
        expect.objectContaining({
          sourcePath: "ts/app.tsx",
          targetPath: "ts/lib/index.ts",
          specifier: "./lib",
          resolution: "internal",
          resolved: true
        }),
        expect.objectContaining({
          sourcePath: "ts/ui/index.ts",
          targetPath: "ts/ui/panel.tsx",
          specifier: "./panel",
          resolution: "internal",
          resolved: true
        }),
        expect.objectContaining({
          sourcePath: "cpp/main.cpp",
          targetPath: "cpp/local.hpp",
          specifier: "local.hpp",
          resolution: "internal",
          resolved: true
        }),
        expect.objectContaining({
          sourcePath: "cpp/main.cpp",
          targetPath: "cpp/utils/math.h",
          specifier: "utils/math.h",
          resolution: "internal",
          resolved: true
        })
      ])
    );
  });

  it("keeps external dependencies external instead of resolving them as repository files", async () => {
    const scanResult = await scanRepository(path.resolve("tests/fixtures/structure-demo"));
    const symbolResult = await extractRepositorySymbols(scanResult);
    const graph = buildDependencyGraph(scanResult.root, symbolResult.files);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "python_pkg/main.py",
          specifier: "os",
          resolution: "external",
          resolved: false,
          targetPath: undefined
        }),
        expect.objectContaining({
          sourcePath: "ts/app.tsx",
          specifier: "react-dom/client",
          resolution: "external",
          resolved: false,
          targetPath: undefined
        }),
        expect.objectContaining({
          sourcePath: "cpp/main.cpp",
          specifier: "vector",
          resolution: "external",
          resolved: false,
          targetPath: undefined
        })
      ])
    );
  });
});
