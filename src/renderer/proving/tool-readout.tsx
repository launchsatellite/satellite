import { useEffect, useState } from "react";
import type { BridgeResponse, BridgeResult } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";

type Versions = BridgeResponse<"tools.versions">;

const tools: readonly (keyof Versions)[] = ["git", "gh", "claude"];

function readout(tool: keyof Versions, version: string | null): string {
  if (version === null) return `${tool} not found`;
  const bare = version.replace(new RegExp(`^${tool} version `, "i"), "");
  return `${tool} ${bare}`;
}

export function ToolReadout() {
  const [versions, setVersions] = useState<BridgeResult<Versions>>();
  useEffect(() => {
    void invoke("tools.versions", {}).then(setVersions);
  }, []);
  if (versions === undefined) return null;
  if (!versions.ok) return <p className="text-[13px] text-dim">{versions.error.message}</p>;
  return (
    <ul className="flex flex-col gap-1 font-pixel text-[12px] text-dim uppercase">
      {tools.map((tool) => (
        <li key={tool} data-testid={`tool-${tool}`}>
          {readout(tool, versions.value[tool])}
        </li>
      ))}
    </ul>
  );
}
