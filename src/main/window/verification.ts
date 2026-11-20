import { app } from "electron";

const driverCheckMs = 1000;

function underVerification(): boolean {
  return process.env["SATELLITE_VERIFY_FOLDER_DIALOG"] !== undefined;
}

function driverGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "EPERM");
  }
}

export function runsQuietly(): boolean {
  return (
    process.platform === "darwin" &&
    underVerification() &&
    process.env["SATELLITE_VERIFY_FOREGROUND"] !== "1"
  );
}

export function prepareVerification(): void {
  if (runsQuietly()) app.setActivationPolicy("accessory");
  const driver = Number(process.env["SATELLITE_VERIFY_DRIVER_PID"]);
  if (!underVerification() || !Number.isInteger(driver) || driver <= 0) return;
  setInterval(() => {
    if (driverGone(driver)) app.quit();
  }, driverCheckMs).unref();
}
