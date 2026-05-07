import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepository } from "../packages/core/src/index";

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "repolain-"));
}

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

describe("scanRepository", () => {
  it("scans regular files and returns metadata", async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFile(root, "src/index.ts", "export const answer = 42;\n");
    await writeFile(root, "README.md", "# Demo\n");

    const result = await scanRepository(root);

    expect(result.root).toBe(root);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);
    expect(result.languageStats).toEqual({
      Markdown: 1,
      TypeScript: 1
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores default directories", async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFile(root, "src/app.py", "print('ok')\n");
    await writeFile(root, "node_modules/pkg/index.js", "console.log('skip');\n");
    await writeFile(root, ".git/config", "[core]\n");
    await writeFile(root, "dist/output.js", "console.log('skip');\n");
    await writeFile(root, ".repo-lens/index.sqlite", "skip\n");
    await writeFile(root, ".repolain/index.sqlite", "skip\n");

    const result = await scanRepository(root);

    expect(result.files.map((file) => file.path)).toEqual(["src/app.py"]);
  });

  it("detects supported languages", async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFile(root, "a.ts", "");
    await writeFile(root, "b.js", "");
    await writeFile(root, "c.py", "");
    await writeFile(root, "d.c", "");
    await writeFile(root, "e.cpp", "");
    await writeFile(root, "CMakeLists.txt", "cmake_minimum_required(VERSION 3.10)\n");
    await writeFile(root, "f.yaml", "name: demo\n");
    await writeFile(root, "g.json", "{\n  \"name\": \"demo\"\n}\n");
    await writeFile(root, "h.md", "# demo\n");

    const result = await scanRepository(root);

    expect(
      Object.fromEntries(result.files.map((file) => [file.path, file.language]))
    ).toEqual({
      "CMakeLists.txt": "CMake",
      "a.ts": "TypeScript",
      "b.js": "JavaScript",
      "c.py": "Python",
      "d.c": "C",
      "e.cpp": "C++",
      "f.yaml": "YAML",
      "g.json": "JSON",
      "h.md": "Markdown"
    });
  });

  it("counts lines deterministically", async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFile(root, "main.py", "line1\nline2\nline3");
    await writeFile(root, "empty.py", "");

    const result = await scanRepository(root);
    const fileMap = Object.fromEntries(result.files.map((file) => [file.path, file]));

    expect(fileMap["empty.py"]?.lineCount).toBe(0);
    expect(fileMap["main.py"]?.lineCount).toBe(3);
  });

  it("produces stable hashes", async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    const content = "print('repolain')\n";
    await writeFile(root, "main.py", content);

    const result = await scanRepository(root);

    expect(result.files[0]?.hash).toBe(createHash("sha256").update(content).digest("hex"));
  });

  it("handles empty directories", async () => {
    const root = await createTempDir();
    tempDirs.push(root);

    const result = await scanRepository(root);

    expect(result.files).toEqual([]);
    expect(result.languageStats).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });

  it("returns a clear error for missing paths", async () => {
    const root = path.join(os.tmpdir(), `repolain-missing-${Date.now()}`);

    await expect(scanRepository(root)).rejects.toThrow(`Repository path does not exist: ${root}`);
  });

  it("returns a clear error when the path is not a directory", async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    const filePath = path.join(root, "single-file.txt");
    await fs.writeFile(filePath, "demo", "utf8");

    await expect(scanRepository(filePath)).rejects.toThrow(`Repository path is not a directory: ${filePath}`);
  });
});
