import type { InstallFix } from "../../shared/bridge-contract.ts";
import type { Tool } from "./tools.ts";

const claudeScript: InstallFix = {
  kind: "command",
  text: "curl -fsSL https://claude.ai/install.sh | bash",
};
const macos: Record<Tool, InstallFix> = {
  git: { kind: "command", text: "xcode-select --install" },
  gh: { kind: "command", text: "brew install gh" },
  claude: claudeScript,
};
const windows: Record<Tool, InstallFix> = {
  git: { kind: "command", text: "winget install --id Git.Git -e --source winget" },
  gh: { kind: "command", text: "winget install --id GitHub.cli --source winget" },
  claude: { kind: "command", text: "winget install Anthropic.ClaudeCode" },
};
const linux: Record<Tool, InstallFix> = {
  git: { kind: "address", text: "https://git-scm.com/install/linux" },
  gh: { kind: "address", text: "https://github.com/cli/cli/blob/trunk/docs/install_linux.md" },
  claude: claudeScript,
};

export function installCommand(tool: Tool): InstallFix {
  if (process.platform === "darwin") return macos[tool];
  if (process.platform === "win32") return windows[tool];
  return linux[tool];
}
