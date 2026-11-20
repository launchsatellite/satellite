import { appendFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { shell } from "electron";
import { drivenByVerify } from "../window/verification.ts";

export async function openInBrowser(href: string): Promise<void> {
  const verifyFile = process.env["SATELLITE_VERIFY_LINKS"];
  if (verifyFile !== undefined && isAbsolute(verifyFile) && drivenByVerify()) {
    await appendFile(verifyFile, `${href}\n`);
    return;
  }
  await shell.openExternal(href);
}
