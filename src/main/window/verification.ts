import { app } from "electron";

const driverCheckMs = 1000;

let driverAtStart: number | undefined;

export function underVerification(): boolean {
  return process.env["SATELLITE_VERIFY_FOLDER_DIALOG"] !== undefined;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function liveDriver(): number | undefined {
  const pid = Number(process.env["SATELLITE_VERIFY_DRIVER_PID"]);
  if (!underVerification() || !Number.isInteger(pid) || pid <= 0) return undefined;
  return isAlive(pid) ? pid : undefined;
}

export function drivenByVerify(): boolean {
  return liveDriver() !== undefined;
}

export function startedByDriver(): boolean {
  return driverAtStart !== undefined;
}

export function runsQuietly(): boolean {
  return (
    process.platform === "darwin" &&
    process.env["SATELLITE_VERIFY_FOREGROUND"] !== "1" &&
    liveDriver() !== undefined
  );
}

export function prepareVerification(): void {
  if (runsQuietly()) app.setActivationPolicy("accessory");
  const driver = liveDriver();
  driverAtStart = driver;
  if (driver === undefined) return;
  setInterval(() => {
    if (!isAlive(driver)) app.quit();
  }, driverCheckMs).unref();
}
