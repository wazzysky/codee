import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateFileMap, scanRepository } from "../packages/core/src/index";

function fixturePath(name: string): string {
  return path.resolve("tests/fixtures", name);
}

async function generateFixtureFileMap(name: string) {
  const scanResult = await scanRepository(fixturePath(name));
  return generateFileMap(scanResult);
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

describe("generateFileMap", () => {
  it("groups files into stable directory sections", async () => {
    const result = await generateFixtureFileMap("file-map-demo");

    expect(result.directories.map((directory) => directory.path)).toEqual([
      "./",
      "assets/",
      "config/",
      "docs/",
      "generated/",
      "launch/",
      "misc/",
      "scripts/",
      "src/",
      "src/components/",
      "src/utils/",
      "tests/"
    ]);
  });

  it("infers file roles and explanations from paths and file names", async () => {
    const result = await generateFixtureFileMap("file-map-demo");
    const fileMap = Object.fromEntries(result.files.map((file) => [file.path, file]));

    expect(fileMap["src/main.tsx"]).toEqual(
      expect.objectContaining({
        role: "entrypoint",
        confidence: 0.9
      })
    );
    expect(fileMap["README.md"]).toEqual(
      expect.objectContaining({
        role: "documentation",
        important: true
      })
    );
    expect(fileMap["package.json"]).toEqual(
      expect.objectContaining({
        role: "config",
        explanation: "Node.js package manifest defining dependencies and scripts."
      })
    );
    expect(fileMap["CMakeLists.txt"]).toEqual(
      expect.objectContaining({
        role: "build"
      })
    );
    expect(fileMap["package.xml"]).toEqual(
      expect.objectContaining({
        role: "config"
      })
    );
    expect(fileMap["launch/demo.launch.py"]).toEqual(
      expect.objectContaining({
        role: "entrypoint"
      })
    );
    expect(fileMap["config/app.yaml"]).toEqual(
      expect.objectContaining({
        role: "config"
      })
    );
    expect(fileMap["tests/app.test.ts"]).toEqual(
      expect.objectContaining({
        role: "test"
      })
    );
    expect(fileMap["src/components/App.tsx"]).toEqual(
      expect.objectContaining({
        role: "component"
      })
    );
    expect(fileMap["src/utils/math.ts"]).toEqual(
      expect.objectContaining({
        role: "utility"
      })
    );
    expect(fileMap["scripts/build.sh"]).toEqual(
      expect.objectContaining({
        role: "script"
      })
    );
    expect(fileMap["assets/logo.svg"]).toEqual(
      expect.objectContaining({
        role: "asset"
      })
    );
    expect(fileMap["generated/client.generated.ts"]).toEqual(
      expect.objectContaining({
        role: "generated"
      })
    );
  });

  it("marks uncertain files as unknown with low confidence", async () => {
    const result = await generateFixtureFileMap("file-map-demo");
    const unknownFile = result.files.find((file) => file.path === "misc/notes.txt");

    expect(unknownFile).toEqual(
      expect.objectContaining({
        role: "unknown",
        confidence: 0.3
      })
    );
    expect(result.uncertainties).toContain(
      "misc/notes.txt: File role is unclear from the path and filename alone."
    );
  });

  it("handles empty repositories without errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repolain-file-map-"));
    tempDirs.push(root);
    const scanResult = await scanRepository(root);
    const result = generateFileMap(scanResult);

    expect(result.files).toEqual([]);
    expect(result.directories).toEqual([]);
    expect(result.importantFiles).toEqual([]);
    expect(result.uncertainties).toEqual([]);
  });
});
