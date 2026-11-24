import { resolve } from "node:path";
import {
  buildApp,
  errorReason,
  launchApp,
  withTimeout,
  type AppSession,
  type AppTarget,
} from "./driver.ts";
import { boundaryJourney } from "./journeys/boundary.ts";
import { changesJourney } from "./journeys/changes.ts";
import { claudeSettingsJourney } from "./journeys/claude-settings.ts";
import { conflictsJourney } from "./journeys/conflicts.ts";
import { filesJourney } from "./journeys/files.ts";
import { guideJourney } from "./journeys/guide.ts";
import { inboxJourney } from "./journeys/inbox.ts";
import { launchJourney } from "./journeys/launch.ts";
import { missingJourney } from "./journeys/missing.ts";
import { processesJourney } from "./journeys/processes.ts";
import { projectsJourney } from "./journeys/projects.ts";
import { pullRequestJourney } from "./journeys/pull-request.ts";
import { quitJourney } from "./journeys/quit.ts";
import { sessionsJourney } from "./journeys/sessions.ts";
import { settingsJourney } from "./journeys/settings.ts";
import { titleBarJourney } from "./journeys/title-bar.ts";
import { workspacesJourney } from "./journeys/workspaces.ts";

export interface Journey {
  name: string;
  scenario: string;
  run(session: AppSession): Promise<void>;
  then?: readonly Journey[];
  skip?: string;
}
interface Outcome {
  failure?: string;
  screenshots: string[];
  skipped?: string[];
}

const journeys: Journey[] = [
  launchJourney,
  boundaryJourney,
  projectsJourney,
  titleBarJourney,
  settingsJourney,
  guideJourney,
  workspacesJourney,
  changesJourney,
  filesJourney,
  conflictsJourney,
  sessionsJourney,
  processesJourney,
  inboxJourney,
  pullRequestJourney,
  missingJourney,
  claudeSettingsJourney,
  quitJourney,
];
const journeyTimeoutMs = 180_000;
const stepTimeoutMs = 15_000;

function parseTarget(argv: string[]): AppTarget {
  if (argv.length === 0) return { kind: "built" };
  const [flag, executable, ...rest] = argv;
  if (flag !== "--app" || executable === undefined || rest.length > 0) {
    throw new Error("run npm run journeys, or npm run journeys -- --app <executable>");
  }
  return { kind: "packaged", executable: resolve(executable) };
}

async function runJourney(journey: Journey, target: AppTarget): Promise<Outcome> {
  let session: AppSession;
  try {
    session = await launchApp({ scenario: journey.scenario, target });
  } catch (error) {
    return { failure: `the app did not launch. ${errorReason(error)}`, screenshots: [] };
  }
  const screenshots: string[] = [];
  const recorded: AppSession = {
    get page() {
      return session.page;
    },
    home: session.home,
    repo: session.repo,
    userHome: session.userHome,
    gitEnv: session.gitEnv,
    folder: (name) => session.folder(name),
    answerFolderDialog: (path) => session.answerFolderDialog(path),
    dropFolder: (path) => session.dropFolder(path),
    dropFiles: (testId, paths) => session.dropFiles(testId, paths),
    selectDiffLines: (side, start, end) => session.selectDiffLines(side, start, end),
    selectFileLines: (start, end) => session.selectFileLines(start, end),
    openedLinks: () => session.openedLinks(),
    mark: (name) => session.mark(name),
    notices: () => session.notices(),
    consoleErrors: session.consoleErrors,
    standInEvents: () => session.standInEvents(),
    relaunch: (whileClosed) => session.relaunch(whileClosed),
    quit: () => session.quit(),
    close: () => session.close(),
    async screenshot(name) {
      const path = await session.screenshot(name);
      screenshots.push(path);
      return path;
    },
  };
  session.page.setDefaultTimeout(stepTimeoutMs);
  let failure: string | undefined;
  try {
    await withTimeout(journey.run(recorded), journeyTimeoutMs, `journey ${journey.name}`);
  } catch (error) {
    failure = errorReason(error);
    if (!session.page.isClosed()) {
      await recorded.screenshot(`${journey.name}-failure`).catch(() => undefined);
    }
  }
  const { leftover } = await session.close();
  if (failure === undefined && leftover !== undefined) {
    failure = `the temp folder ${leftover} was left behind`;
  }
  return failure === undefined ? { screenshots } : { failure, screenshots };
}

async function runWithParts(journey: Journey, target: AppTarget): Promise<Outcome> {
  const screenshots: string[] = [];
  const skipped: string[] = [];
  let failure: string | undefined;
  for (const [index, part] of [journey, ...(journey.then ?? [])].entries()) {
    if (failure !== undefined) break;
    if (part.skip !== undefined) {
      skipped.push(`${part.scenario}, ${part.skip}`);
      continue;
    }
    const outcome = await runJourney(part, target);
    screenshots.push(...outcome.screenshots);
    if (outcome.failure !== undefined) {
      failure = index === 0 ? outcome.failure : `${part.scenario}, ${outcome.failure}`;
    }
  }
  return failure === undefined ? { screenshots, skipped } : { failure, screenshots, skipped };
}

function report(name: string, { failure, screenshots, skipped = [] }: Outcome): void {
  const verdict =
    failure === undefined ? `pass ${name}` : `fail ${name} ${failure.replaceAll("\n", "\n    ")}`;
  const lines = [
    verdict,
    ...skipped.map((reason) => `  skipped ${reason}`),
    ...screenshots.map((path) => `  ${path}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<boolean> {
  let target: AppTarget;
  try {
    target = parseTarget(process.argv.slice(2));
    if (target.kind === "built") await buildApp();
  } catch (error) {
    report("setup", { failure: errorReason(error), screenshots: [] });
    return false;
  }
  let passed = true;
  for (const journey of journeys) {
    const outcome = await runWithParts(journey, target);
    report(journey.name, outcome);
    if (outcome.failure !== undefined) passed = false;
  }
  return passed;
}

process.exitCode = (await main()) ? 0 : 1;
