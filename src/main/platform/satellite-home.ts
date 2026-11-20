import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function userHomeFolder(): string {
  return homedir();
}

export function satelliteHome(): string {
  const fromEnvironment = process.env["SATELLITE_HOME"];
  if (fromEnvironment === undefined || fromEnvironment === "") {
    return join(userHomeFolder(), ".satellite");
  }
  if (!isAbsolute(fromEnvironment)) {
    throw new Error(`SATELLITE_HOME must be an absolute path, got ${fromEnvironment}`);
  }
  return fromEnvironment;
}

export function prepareSatelliteHome(): string {
  const home = satelliteHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}
