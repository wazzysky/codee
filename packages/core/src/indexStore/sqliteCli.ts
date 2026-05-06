import { spawn } from "node:child_process";

export interface SqliteRow {
  [key: string]: unknown;
}

export function toSqlLiteral(value: string | number | boolean | null): string {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${value.replace(/'/gu, "''")}'`;
}

async function runSqliteCommand(dbPath: string, sql: string, jsonMode: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = [...(jsonMode ? ["-json"] : []), dbPath];
    const child = spawn("sqlite3", args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`sqlite3 exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });

    child.stdin.write(`PRAGMA foreign_keys = ON;\n${sql}\n`);
    child.stdin.end();
  });
}

export async function executeSqlite(dbPath: string, sql: string): Promise<void> {
  await runSqliteCommand(dbPath, sql, false);
}

export async function querySqlite(dbPath: string, sql: string): Promise<SqliteRow[]> {
  const output = (await runSqliteCommand(dbPath, sql, true)).trim();
  if (output.length === 0) {
    return [];
  }

  return JSON.parse(output) as SqliteRow[];
}
