import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MockLlmClient,
  explainFile
} from "../packages/core/src/index";

function fixturePath(relativePath: string): string {
  return path.resolve("tests/fixtures", relativePath);
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

describe("explainFile", () => {
  it("returns a rule-based explanation by default", async () => {
    const result = await explainFile(fixturePath("knowledge-demo/src/ros_node.py"));

    expect(result.mode).toBe("rule-based");
    expect(result.filePath).toBe("src/ros_node.py");
    expect(result.role).toBe("source");
    expect(result.summary).toContain("src/ros_node.py");
    expect(result.possibleKnowledgePoints).toContain("ROS Node");
    expect(result.keyEvidence).toEqual(
      expect.arrayContaining([
        "language: Python",
        "path: src/ros_node.py"
      ])
    );
  });

  it("uses MockLlmClient when AI mode is enabled", async () => {
    const client = new MockLlmClient({
      jsonResponse: {
        summary: "AI summary",
        role: "source",
        keyEvidence: ["ai evidence"],
        possibleKnowledgePoints: ["ROS Node"],
        confidence: 0.88,
        uncertainties: ["ai uncertainty"]
      }
    });

    const result = await explainFile(fixturePath("knowledge-demo/src/ros_node.py"), {
      useAi: true,
      llmClient: client
    });

    expect(result.mode).toBe("ai");
    expect(result.summary).toBe("AI summary");
    expect(result.keyEvidence).toEqual(["ai evidence"]);
    expect(result.possibleKnowledgePoints).toEqual(["ROS Node"]);
    expect(client.jsonRequests).toHaveLength(1);
  });

  it("falls back to rule-based output when LLM env is missing", async () => {
    const result = await explainFile(fixturePath("knowledge-demo/src/main.tsx"), {
      useAi: true,
      env: {}
    });

    expect(result.mode).toBe("rule-based");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "LLM is not configured; fell back to the rule-based explanation.",
          path: "src/main.tsx"
        })
      ])
    );
  });

  it("does not send sensitive files to the LLM", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repolain-explain-"));
    tempDirs.push(root);
    await fs.writeFile(path.join(root, "package.json"), "{\n  \"name\": \"demo\"\n}\n", "utf8");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=secret\n", "utf8");

    const client = new MockLlmClient({
      jsonResponse: {
        summary: "should not be used",
        role: "config",
        keyEvidence: ["x"],
        possibleKnowledgePoints: [],
        confidence: 0.5,
        uncertainties: []
      }
    });

    const result = await explainFile(path.join(root, ".env"), {
      useAi: true,
      llmClient: client
    });

    expect(result.mode).toBe("rule-based");
    expect(client.jsonRequests).toHaveLength(0);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Sensitive files are not sent to the LLM; fell back to the rule-based explanation.",
          path: ".env"
        })
      ])
    );
  });
});
