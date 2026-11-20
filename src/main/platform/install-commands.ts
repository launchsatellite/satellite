import type { Tool } from "./tools.ts";

const claudeScript = "curl -fsSL https://claude.ai/install.sh | bash";
const macos: Record<Tool, string> = {
  git: "xcode-select --install",
  gh: "brew install gh",
  claude: claudeScript,
};
const windows: Record<Tool, string> = {
  git: "winget install --id Git.Git -e --source winget",
  gh: "winget install --id GitHub.cli --source winget",
  claude: "winget install Anthropic.ClaudeCode",
};
const linux: Record<Tool, string> = {
  git: "sudo apt install git",
  gh: "sudo apt install gh",
  claude: claudeScript,
};

export function installCommand(tool: Tool): string {
  if (process.platform === "darwin") return macos[tool];
  if (process.platform === "win32") return windows[tool];
  return linux[tool];
}
