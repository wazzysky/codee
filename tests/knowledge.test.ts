import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { matchKnowledge, scanRepository } from "../packages/core/src/index";

function fixturePath(name: string): string {
  return path.resolve("tests/fixtures", name);
}

async function analyzeFixture(name: string) {
  const scanResult = await scanRepository(fixturePath(name));
  return matchKnowledge(scanResult);
}

function getMatch(
  matches: Awaited<ReturnType<typeof analyzeFixture>>["matches"],
  filePath: string,
  knowledgeId: string
) {
  return matches.find((match) => match.filePath === filePath && match.knowledgeId === knowledgeId);
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    })
  );
});

describe("matchKnowledge", () => {
  it("matches control, estimation, planning, and tooling knowledge with evidence", async () => {
    const result = await analyzeFixture("knowledge-demo");

    expect(getMatch(result.matches, "src/pid_controller.cpp", "pid-control")).toEqual(
      expect.objectContaining({
        name: "PID Control",
        evidence: expect.arrayContaining(["keyword: kp", "keyword: ki", "keyword: kd"])
      })
    );
    expect(getMatch(result.matches, "src/lqr_solver.cpp", "lqr")).toEqual(
      expect.objectContaining({
        name: "LQR",
        evidence: expect.arrayContaining(["keyword: riccati"])
      })
    );
    expect(getMatch(result.matches, "src/mpc_planner.cpp", "mpc")).toEqual(
      expect.objectContaining({
        name: "MPC",
        evidence: expect.arrayContaining(["keyword: model predictive control"])
      })
    );
    expect(getMatch(result.matches, "src/ekf_fusion.py", "extended-kalman-filter")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["keyword: ekf", "keyword: jacobian"])
      })
    );
    expect(getMatch(result.matches, "src/ekf_fusion.py", "sensor-fusion")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["keyword: imu", "keyword: lidar", "keyword: sensor fusion"])
      })
    );
    expect(getMatch(result.matches, "src/slam_mapper.cpp", "slam")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["keyword: slam", "keyword: loop closure"])
      })
    );
    expect(getMatch(result.matches, "src/grid_astar.py", "astar-search")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["keyword: astar", "keyword: heuristic"])
      })
    );
    expect(getMatch(result.matches, "src/grid_astar.py", "occupancy-grid")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["import/include: from nav_msgs.msg import OccupancyGrid"])
      })
    );
    expect(getMatch(result.matches, "src/rrt_planner.py", "rrt")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["keyword: rrt"])
      })
    );
    expect(getMatch(result.matches, "src/rrt_planner.py", "trajectory-planning")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["keyword: trajectory", "keyword: waypoint"])
      })
    );
    expect(getMatch(result.matches, "CMakeLists.txt", "cmake")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["file name: CMakeLists.txt"])
      })
    );
    expect(getMatch(result.matches, "Dockerfile", "docker")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining(["file name: Dockerfile", "project build tool: Docker"])
      })
    );
  });

  it("uses project detection signals for ROS, frontend, and Python package knowledge", async () => {
    const result = await analyzeFixture("knowledge-demo");

    expect(getMatch(result.matches, "src/ros_node.py", "ros-node")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining([
          "import/include: from rclpy.node import Node",
          "project framework: ROS 2"
        ])
      })
    );
    expect(getMatch(result.matches, "launch/demo.launch.py", "ros-launch")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining([
          "path: launch/demo.launch.py",
          "keyword: generate_launch_description"
        ])
      })
    );
    expect(getMatch(result.matches, "src/main.tsx", "typescript-frontend")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining([
          "project framework: React",
          "project build tool: Vite"
        ])
      })
    );
    expect(getMatch(result.matches, "pyproject.toml", "python-package")).toEqual(
      expect.objectContaining({
        evidence: expect.arrayContaining([
          "file name: pyproject.toml",
          "project type: Python project"
        ])
      })
    );
  });

  it("skips large file content and records a diagnostic", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repolain-knowledge-"));
    tempDirs.push(root);
    const largeContent = "pid\n".repeat(200);
    await fs.writeFile(path.join(root, "large_controller.py"), largeContent, "utf8");

    const scanResult = await scanRepository(root);
    const result = await matchKnowledge(scanResult, { maxFileSizeBytes: 16 });

    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          path: "large_controller.py"
        })
      ])
    );
  });
});
