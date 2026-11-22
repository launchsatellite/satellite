import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isFullyQualified } from "./paths.ts";

export function userHomeFolder(): string {
  return homedir();
}

export function satelliteHome(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const fromEnvironment = env["SATELLITE_HOME"];
  if (fromEnvironment === undefined || fromEnvironment === "") {
    return join(userHomeFolder(), ".satellite");
  }
  if (!isFullyQualified(fromEnvironment, platform)) {
    throw new Error(
      `SATELLITE_HOME must be a fully qualified path, with a drive letter or a share on Windows, got ${fromEnvironment}`,
    );
  }
  return fromEnvironment;
}

export function prepareSatelliteHome(home: string): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(home, 0o700);
  return home;
}
