import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderExplainMarkdown,
  renderFileMapMarkdown,
  renderIndexSummaryMarkdown,
  renderKnowledgeMarkdown,
  runCli
} from "../packages/cli/src/index";
import { promises as fs } from "node:fs";
import os from "node:os";

function fixturePath(name: string): string {
  return path.resolve("tests/fixtures", name);
}

function createCaptureIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stderr: (message: string) => {
        stderr.push(message);
      },
      stdout: (message: string) => {
        stdout.push(message);
      }
    },
    readStderr: () => stderr.join(""),
    readStdout: () => stdout.join("")
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

async function copyFixture(name: string): Promise<string> {
  const source = fixturePath(name);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repolain-cli-"));
  const repoRoot = path.join(target, name);
  await fs.cp(source, repoRoot, { recursive: true });
  await fs.rm(path.join(repoRoot, ".repolain"), { recursive: true, force: true });
  tempDirs.push(target);
  return repoRoot;
}

describe("CLI", () => {
  it("emits JSON for scan", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(["node", "repolain", "scan", fixturePath("node-react-vite")], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(JSON.parse(capture.readStdout())).toEqual(
      expect.objectContaining({
        diagnostics: expect.any(Array),
        files: expect.any(Array),
        languageStats: expect.any(Object),
        root: fixturePath("node-react-vite")
      })
    );
  });

  it("emits JSON for summary", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(["node", "repolain", "summary", fixturePath("next-app")], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(JSON.parse(capture.readStdout())).toEqual(
      expect.objectContaining({
        buildTools: expect.any(Array),
        confidence: expect.any(Number),
        evidence: expect.any(Array),
        frameworks: expect.arrayContaining(["Next.js"]),
        projectTypes: expect.arrayContaining(["Node.js project"]),
        uncertainties: expect.any(Array)
      })
    );
  });

  it("emits Markdown for file-map by default", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(
      ["node", "repolain", "file-map", fixturePath("file-map-demo")],
      capture.io
    );

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(capture.readStdout()).toContain("# File Map");
    expect(capture.readStdout()).toContain("## src/");
    expect(capture.readStdout()).toContain("| src/main.tsx | entrypoint |");
  });

  it("emits JSON for file-map when requested", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(
      ["node", "repolain", "file-map", fixturePath("file-map-demo"), "--json"],
      capture.io
    );

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(JSON.parse(capture.readStdout())).toEqual(
      expect.objectContaining({
        directories: expect.any(Array),
        files: expect.any(Array),
        importantFiles: expect.any(Array),
        root: fixturePath("file-map-demo"),
        uncertainties: expect.any(Array)
      })
    );
  });

  it("renders Markdown deterministically from a raw file-map structure", () => {
    const markdown = renderFileMapMarkdown({
      root: "/tmp/repo",
      directories: [
        {
          path: "src/",
          description: "Primary source code directory.",
          fileCount: 1,
          roles: { entrypoint: 1 },
          files: [
            {
              path: "src/main.cpp",
              directory: "src/",
              role: "entrypoint",
              explanation: "C++ entry candidate inferred from the file name and directory.",
              confidence: 0.85,
              important: true,
              language: "C++"
            }
          ]
        }
      ],
      files: [
        {
          path: "src/main.cpp",
          directory: "src/",
          role: "entrypoint",
          explanation: "C++ entry candidate inferred from the file name and directory.",
          confidence: 0.85,
          important: true,
          language: "C++"
        }
      ],
      importantFiles: [
        {
          path: "src/main.cpp",
          directory: "src/",
          role: "entrypoint",
          explanation: "C++ entry candidate inferred from the file name and directory.",
          confidence: 0.85,
          important: true,
          language: "C++"
        }
      ],
      uncertainties: []
    });

    expect(markdown).toContain("# File Map");
    expect(markdown).toContain("Root: `/tmp/repo`");
    expect(markdown).toContain("| src/main.cpp | entrypoint |");
  });

  it("emits Markdown for knowledge by default", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(
      ["node", "repolain", "knowledge", fixturePath("knowledge-demo")],
      capture.io
    );

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(capture.readStdout()).toContain("# Knowledge Map");
    expect(capture.readStdout()).toContain("| src/pid_controller.cpp | PID Control |");
  });

  it("emits JSON for knowledge when requested", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(
      ["node", "repolain", "knowledge", fixturePath("knowledge-demo"), "--json"],
      capture.io
    );

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(JSON.parse(capture.readStdout())).toEqual(
      expect.objectContaining({
        diagnostics: expect.any(Array),
        matches: expect.any(Array),
        root: fixturePath("knowledge-demo")
      })
    );
  });

  it("renders Knowledge Markdown deterministically from raw match data", () => {
    const markdown = renderKnowledgeMarkdown({
      root: "/tmp/repo",
      matches: [
        {
          filePath: "src/pid_controller.cpp",
          knowledgeId: "pid-control",
          name: "PID Control",
          domain: "control",
          confidence: 0.88,
          evidence: ["keyword: pid", "keyword: kp"]
        }
      ],
      diagnostics: []
    });

    expect(markdown).toContain("# Knowledge Map");
    expect(markdown).toContain("Root: `/tmp/repo`");
    expect(markdown).toContain("| src/pid_controller.cpp | PID Control |");
  });

  it("emits Markdown for explain by default", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(
      ["node", "repolain", "explain", fixturePath("knowledge-demo/src/ros_node.py")],
      capture.io
    );

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(capture.readStdout()).toContain("# File Explanation");
    expect(capture.readStdout()).toContain("File: `src/ros_node.py`");
  });

  it("falls back cleanly when explain --ai is not configured", async () => {
    const capture = createCaptureIo();

    const exitCode = await runCli(
      ["node", "repolain", "explain", fixturePath("knowledge-demo/src/main.tsx"), "--ai"],
      capture.io
    );

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(capture.readStdout()).toContain("Mode: rule-based");
    expect(capture.readStdout()).toContain("LLM is not configured; fell back to the rule-based explanation.");
  });

  it("renders Explain Markdown deterministically from raw explanation data", () => {
    const markdown = renderExplainMarkdown({
      filePath: "src/main.tsx",
      repoRoot: "/tmp/repo",
      mode: "rule-based",
      summary: "This is an entrypoint.",
      role: "entrypoint",
      keyEvidence: ["path: src/main.tsx"],
      possibleKnowledgePoints: ["TypeScript Frontend"],
      confidence: 0.81,
      uncertainties: [],
      diagnostics: []
    });

    expect(markdown).toContain("# File Explanation");
    expect(markdown).toContain("Mode: rule-based");
    expect(markdown).toContain("This is an entrypoint.");
  });

  it("emits Markdown for index", async () => {
    const capture = createCaptureIo();
    const repoRoot = await copyFixture("knowledge-demo");

    const exitCode = await runCli(["node", "repolain", "index", repoRoot], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.readStderr()).toBe("");
    expect(capture.readStdout()).toContain("# Index Summary");
    expect(capture.readStdout()).toContain(`Root: \`${repoRoot}\``);
  });

  it("renders Index Markdown deterministically from raw summary data", () => {
    const markdown = renderIndexSummaryMarkdown({
      root: "/tmp/repo",
      dbPath: "/tmp/repo/.repolain/index.sqlite",
      totalFiles: 10,
      changedFiles: 2,
      removedFiles: 1,
      knowledgeMatchCount: 7,
      diagnosticCount: 0,
      projectTypes: ["Python project"]
    });

    expect(markdown).toContain("# Index Summary");
    expect(markdown).toContain("Database: `/tmp/repo/.repolain/index.sqlite`");
    expect(markdown).toContain("Changed Files: 2");
  });
});
