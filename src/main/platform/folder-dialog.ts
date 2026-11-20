import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";

const options: OpenDialogOptions = {
  properties: ["openDirectory"],
  title: "Add a project",
  buttonLabel: "Add project",
};

async function verifyAnswer(file: string): Promise<string | undefined> {
  const answer = (await readFile(file, "utf8").catch(() => "")).trim();
  return answer === "" ? undefined : answer;
}

export async function chooseFolder(window: BrowserWindow | undefined): Promise<string | undefined> {
  const answerFile = process.env["SATELLITE_VERIFY_FOLDER_DIALOG"];
  if (answerFile !== undefined && isAbsolute(answerFile)) return verifyAnswer(answerFile);
  const result =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  return result.canceled ? undefined : result.filePaths[0];
}
