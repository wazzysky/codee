import path from "node:path";

const extensionMap: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cxx": "C++",
  ".hpp": "C++",
  ".hh": "C++",
  ".hxx": "C++",
  ".cmake": "CMake",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".json": "JSON",
  ".md": "Markdown",
  ".markdown": "Markdown",
  ".go": "Go",
  ".java": "Java",
  ".rs": "Rust",
  ".toml": "TOML",
  ".xml": "XML"
};

const basenameMap: Record<string, string> = {
  "CMakeLists.txt": "CMake"
};

export function detectLanguage(filePath: string): string {
  const basename = path.basename(filePath);
  const byBasename = basenameMap[basename];
  if (byBasename) {
    return byBasename;
  }

  const extension = path.extname(filePath).toLowerCase();
  return extensionMap[extension] ?? "Unknown";
}
