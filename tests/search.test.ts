import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepository, scanRepository, searchRepository } from "../packages/core/src/index";

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const source = path.resolve("tests/fixtures", name);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repolain-search-"));
  const repoRoot = path.join(target, name);
  await fs.cp(source, repoRoot, { recursive: true });
  await fs.rm(path.join(repoRoot, ".repolain"), { recursive: true, force: true });
  tempDirs.push(target);
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("searchRepository", () => {
  it("finds files by symbol, knowledge, and path", async () => {
    const repoRoot = await copyFixture("knowledge-demo");
    await indexRepository(repoRoot);

    await expect(searchRepository(repoRoot, "main")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/main.tsx"
        })
      ])
    );

    await expect(searchRepository(repoRoot, "EKF")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/ekf_fusion.py"
        })
      ])
    );

    await expect(searchRepository(repoRoot, "trajectory planning")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/mpc_planner.cpp"
        })
      ])
    );
  });

  it("finds files by symbol and dependency graph hints in structure analysis", async () => {
    const repoRoot = await copyFixture("structure-demo");
    await indexRepository(repoRoot);

    await expect(searchRepository(repoRoot, "Bootstrapper")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/app.tsx",
          matchedSymbols: expect.arrayContaining(["Bootstrapper"])
        })
      ])
    );

    await expect(searchRepository(repoRoot, "local.hpp")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "cpp/main.cpp",
          matchedImports: expect.arrayContaining(["local.hpp"])
        })
      ])
    );

    await expect(searchRepository(repoRoot, "createRoot")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/app.tsx",
          matchedReferences: expect.arrayContaining(["createRoot"])
        })
      ])
    );

    await expect(searchRepository(repoRoot, "math.cpp")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "cpp/main.cpp",
          matchedLinks: expect.arrayContaining(["cpp/utils/math.cpp"])
        })
      ])
    );

    await expect(searchRepository(repoRoot, "React component")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "ts/ui/panel.tsx"
        })
      ])
    );
  });

  it("falls back to temporary analysis when no SQLite index exists", async () => {
    const scanResult = await scanRepository(path.resolve("tests/fixtures/knowledge-demo"));
    expect(scanResult.files.length).toBeGreaterThan(0);

    await expect(searchRepository(path.resolve("tests/fixtures/knowledge-demo"), "EKF")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/ekf_fusion.py"
        })
      ])
    );
  });

  it("falls back to temporary analysis and still resolves dependency matches", async () => {
    const repoRoot = path.resolve("tests/fixtures/structure-demo");

    await expect(searchRepository(repoRoot, "math.h")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "cpp/main.cpp",
          matchedImports: expect.arrayContaining(["utils/math.h"])
        })
      ])
    );
  });
});
