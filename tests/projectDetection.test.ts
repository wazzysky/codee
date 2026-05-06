import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectProject, scanRepository } from "../packages/core/src/index";

function fixturePath(name: string): string {
  return path.resolve("tests/fixtures", name);
}

async function detectFixture(name: string) {
  const root = fixturePath(name);
  const scanResult = await scanRepository(root);

  return detectProject(scanResult.root, scanResult.files);
}

describe("detectProject", () => {
  it("detects a Node.js React Vite project with Docker and GitHub Actions", async () => {
    const result = await detectFixture("node-react-vite");

    expect(result.projectTypes).toContain("Node.js project");
    expect(result.frameworks).toContain("React");
    expect(result.buildTools).toEqual(
      expect.arrayContaining(["Docker", "GitHub Actions", "Vite"])
    );
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        ".github/workflows/ci.yml",
        "Dockerfile",
        "package.json: react dependency",
        "vite.config.ts"
      ])
    );
  });

  it("detects Next.js from package metadata and entry files", async () => {
    const result = await detectFixture("next-app");

    expect(result.projectTypes).toContain("Node.js project");
    expect(result.frameworks).toEqual(expect.arrayContaining(["Next.js", "React"]));
    expect(result.entryCandidates).toContain("app/page.tsx");
    expect(result.evidence).toEqual(
      expect.arrayContaining(["app/page.tsx", "package.json: next dependency"])
    );
  });

  it("detects Vue and Electron in the same Node.js project", async () => {
    const result = await detectFixture("electron-vue");

    expect(result.projectTypes).toContain("Node.js project");
    expect(result.frameworks).toEqual(expect.arrayContaining(["Electron", "Vue"]));
    expect(result.entryCandidates).toContain("src/main.ts");
  });

  it("detects Poetry-based Python projects", async () => {
    const result = await detectFixture("python-poetry");

    expect(result.projectTypes).toContain("Python project");
    expect(result.buildTools).toContain("Poetry");
    expect(result.evidence).toContain("pyproject.toml: [tool.poetry]");
  });

  it("detects uv and pip style Python projects", async () => {
    const result = await detectFixture("python-uv-pip");

    expect(result.projectTypes).toContain("Python project");
    expect(result.buildTools).toEqual(expect.arrayContaining(["pip", "uv"]));
    expect(result.evidence).toEqual(
      expect.arrayContaining(["pyproject.toml: [tool.uv]", "requirements.txt"])
    );
  });

  it("detects CMake-based C++ projects", async () => {
    const result = await detectFixture("cpp-cmake");

    expect(result.projectTypes).toContain("C++ project");
    expect(result.buildTools).toContain("CMake");
    expect(result.entryCandidates).toContain("src/main.cpp");
  });

  it("detects catkin ROS packages", async () => {
    const result = await detectFixture("ros1-catkin");

    expect(result.projectTypes).toContain("ROS package");
    expect(result.frameworks).toContain("ROS");
    expect(result.buildTools).toEqual(expect.arrayContaining(["CMake", "catkin"]));
    expect(result.evidence).toContain("package.xml: catkin");
  });

  it("detects ROS 2 ament_cmake packages", async () => {
    const result = await detectFixture("ros2-ament-cmake");

    expect(result.projectTypes).toContain("ROS 2 package");
    expect(result.frameworks).toContain("ROS 2");
    expect(result.buildTools).toEqual(expect.arrayContaining(["CMake", "ament_cmake"]));
    expect(result.evidence).toContain("package.xml: ament_cmake");
  });

  it("detects ROS 2 ament_python packages", async () => {
    const result = await detectFixture("ros2-ament-python");

    expect(result.projectTypes).toContain("ROS 2 package");
    expect(result.frameworks).toContain("ROS 2");
    expect(result.buildTools).toContain("ament_python");
  });

  it("reports uncertainty for ambiguous ROS packages", async () => {
    const result = await detectFixture("ros-ambiguous");

    expect(result.projectTypes).toContain("ROS package");
    expect(result.uncertainties).toContain(
      "package.xml was found, but the package does not clearly indicate catkin, ament_cmake, or ament_python."
    );
  });

  it("detects Rust, Go, Maven, and Gradle toolchains in a polyglot repository", async () => {
    const result = await detectFixture("polyglot-toolchain");

    expect(result.languages).toEqual(
      expect.arrayContaining(["Go", "Java", "Rust"])
    );
    expect(result.projectTypes).toEqual(
      expect.arrayContaining(["Go project", "Java project", "Rust project"])
    );
    expect(result.buildTools).toEqual(
      expect.arrayContaining(["Cargo", "Go Modules", "Gradle", "Maven"])
    );
    expect(result.evidence).toEqual(
      expect.arrayContaining(["Cargo.toml", "build.gradle", "go.mod", "pom.xml"])
    );
  });
});
