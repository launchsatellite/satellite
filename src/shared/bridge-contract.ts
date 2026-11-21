import { z } from "zod";
import {
  isBranchName,
  isStartRef,
  workspaceNameLimit,
  workspaceNameProblem,
} from "./workspace-name.ts";

export type BridgeChannel = keyof typeof bridgeRequests;
export type BridgeRequest<C extends BridgeChannel> = z.output<
  (typeof bridgeRequests)[C]["request"]
>;
export type BridgeResponse<C extends BridgeChannel> = z.output<
  (typeof bridgeRequests)[C]["response"]
>;
export type BridgeEventName = keyof typeof bridgeEvents;
export type BridgeEventPayload<E extends BridgeEventName> = z.output<(typeof bridgeEvents)[E]>;
export type BridgeErrorCode = z.output<typeof bridgeErrorCode>;
export type ThemeChoice = z.output<typeof themeChoice>;
export type SessionStatus = z.output<typeof sessionStatus>;
export type SessionEnding = z.output<typeof sessionEnding>;
export type WorkspaceKey = z.output<typeof workspaceKey>;
export type WorkspaceRef = z.output<typeof workspaceRef>;
export type InterfaceState = z.output<typeof interfaceState>;
export type WorkspaceView = z.output<typeof workspaceView>;
export type ProjectView = z.output<typeof projectView>;
export type StartView = z.output<typeof startView>;
export type StartChoice = z.output<typeof startChoice>;
export type CreationStep = z.output<typeof creationStep>;
export type LossView = z.output<typeof lossView>;
export type ToolState = z.output<typeof toolState>;
export type GhState = z.output<typeof ghState>;
export type ToolCheck = z.output<typeof toolCheck>;
export type GhTokenVariable = z.output<typeof ghTokenVariable>;
export type InstallFix = z.output<typeof installFix>;
export type ChangeLetter = z.output<typeof changeLetter>;
export type ChangesView = z.output<typeof changesView>;
export type ChangedFile = z.output<typeof changedFile>;
export type ChangesList = BridgeResponse<"changes.list">;
export type FilesList = BridgeResponse<"files.list">;
export type FolderListing = z.output<typeof folderListing>;
export type FileEntry = z.output<typeof fileEntry>;
export type FileRead = BridgeResponse<"files.read">;
export type FilesFind = BridgeResponse<"files.find">;
export type FileTabs = z.output<typeof fileTabs>;
export type ImageType = z.output<typeof imageType>;
export type FileSides = BridgeResponse<"changes.file">;
export type BridgeResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: BridgeErrorCode; message: string } };

export const linkRefusal =
  "Satellite opens only plain web addresses, http or https with a real host and no sign-in or hidden characters.";
export const bridgeLimits = {
  terminalWriteChars: 65536,
  terminalOutputChars: 65536,
  terminals: 16,
  workspacesPerProject: 20,
  messageChars: 1000,
  linkChars: 2048,
  cols: { min: 2, max: 500 },
  rows: { min: 1, max: 300 },
};

export const changesLimits = {
  files: 1000,
  parsed: 5000,
  sideBytes: 1_048_576,
  sideLines: 20_000,
  countedFiles: 200,
  countedBytes: 8_388_608,
  binaryProbe: 8000,
  pathChars: 4096,
  linkChars: 4096,
  stampChars: 200,
  conflictNames: 5,
};

export const filesLimits = {
  folders: 16,
  folderScan: 5000,
  folderEntries: 1000,
  nameChars: 255,
  imageBytes: 5_242_880,
  imagePixels: 50_000_000,
  imageBase64Chars: 6_990_508,
  findNames: 200_000,
  findResults: 50,
  queryChars: 200,
  tabsPerWorkspace: 12,
  tabbedWorkspaces: 50,
  tabPathChars: 1024,
};

export const interfaceLimits = {
  left: { min: 200, max: 360, initial: 248 },
  right: { min: 360, max: 640, initial: 440 },
  centreMin: 400,
};

export const themeChoice = z.enum(["system", "light", "dark"]);
export const sessionStatus = z.enum(["idle", "working", "needs-you", "done", "stopped"]);
export const sessionEnding = z.enum(["ended", "unexpected", "resume-failed"]);
export const workspaceKey = z.union([z.literal("main"), z.uuid()]);
export const changeLetter = z.enum(["A", "M", "D", "R", "C", "T", "U"]);
export const workspaceRef = z.strictObject({ projectId: z.uuid(), workspace: workspaceKey });
export const workspaceName = z
  .string()
  .min(1)
  .max(workspaceNameLimit)
  .refine((name) => workspaceNameProblem(name) === null);
export const refName = z.string().min(6).max(300).refine(isStartRef);
const count = z.int().min(0).max(1_000_000);
export const changesView = z.enum(["branch", "uncommitted"]);
const baseName = z.string().min(1).max(255).refine(isBranchName);
const changePath = z.string().min(1).max(changesLimits.pathChars);
const shortOid = z.string().regex(/^[0-9a-f]{7}$/);
const sideText = z.string().max(changesLimits.sideBytes);
export const changedFile = z.strictObject({
  path: changePath,
  from: changePath.nullable(),
  letter: changeLetter,
  tracked: z.boolean(),
  kind: z.enum(["text", "binary", "submodule", "repository"]),
  added: count.nullable(),
  removed: count.nullable(),
  stamp: z.string().min(1).max(changesLimits.stampChars),
});
const filePath = z.string().min(1).max(changesLimits.pathChars);
const folderPath = z.string().max(changesLimits.pathChars);
const fileStamp = z.string().min(1).max(changesLimits.stampChars);
export const fileEntry = z.strictObject({
  name: z.string().min(1).max(filesLimits.nameChars),
  kind: z.enum(["file", "folder", "repository", "link"]),
  ignored: z.boolean(),
});
export const folderListing = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("listed"),
    entries: z.array(fileEntry).max(filesLimits.folderEntries),
    more: count,
  }),
  z.strictObject({ state: z.enum(["missing", "unreadable", "too-many", "hung", "failed"]) }),
]);
export const imageType = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const fileTabs = z
  .strictObject({
    projectId: z.uuid(),
    workspace: workspaceKey,
    paths: z.array(filePath).min(1).max(filesLimits.tabsPerWorkspace),
    active: z
      .int()
      .min(0)
      .max(filesLimits.tabsPerWorkspace - 1),
  })
  .refine(({ paths, active }) => active < paths.length && new Set(paths).size === paths.length);
export const interfaceState = z.strictObject({
  selected: workspaceRef.nullable(),
  columns: z.strictObject({
    left: z.int().min(interfaceLimits.left.min).max(interfaceLimits.left.max),
    right: z.int().min(interfaceLimits.right.min).max(interfaceLimits.right.max),
  }),
  theme: themeChoice,
  notifications: z.boolean(),
  files: z
    .array(fileTabs)
    .max(filesLimits.tabbedWorkspaces)
    .refine(
      (tabs) =>
        new Set(tabs.map(({ projectId, workspace }) => `${projectId}/${workspace}`)).size ===
        tabs.length,
    ),
});
export const workspaceView = z.strictObject({
  key: workspaceKey,
  name: workspaceName.nullable(),
  branch: z.string().min(1).max(255).nullable(),
  ahead: count.nullable(),
  behind: count.nullable(),
  changed: count.nullable(),
});
export const projectView = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  parent: z.string().max(255),
  missing: z.enum(["folder", "repository"]).nullable(),
  workspaces: z
    .array(workspaceView)
    .min(1)
    .max(bridgeLimits.workspacesPerProject + 1),
});
export const startView = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("remote"),
    remote: z.string().min(1).max(100),
    branch: z.string().min(1).max(255).nullable(),
  }),
  z.strictObject({ kind: z.literal("local"), branch: z.string().min(1).max(255).nullable() }),
  z.strictObject({ kind: z.literal("empty") }),
]);
export const startChoice = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("default") }),
  z.strictObject({ kind: z.literal("ref"), ref: refName }),
]);
export const creationStep = z.enum(["start", "branch", "worktree", "files", "save"]);
const subjects = z.array(z.string().max(200)).max(5);
export const lossView = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unpushed"), count, subjects }),
  z.strictObject({ kind: z.literal("lost"), count, subjects }),
  z.strictObject({ kind: z.literal("no-remote") }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
export const ghLogin = /^[A-Za-z0-9-]{1,39}$/;
export const ghHost =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::\d{1,5})?$/;
export const ghTokenVariable = z.enum([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
]);
const toolReady = z.strictObject({
  state: z.literal("ready"),
  version: z.string().min(1).max(200),
});
const windowsPty = z.strictObject({
  backend: z.enum(["conpty", "winpty"]),
  buildNumber: z.number().int().positive(),
});
export type WindowsPty = z.output<typeof windowsPty>;
export const processesLimits = { rows: 200, ports: 4, commandChars: 200 };
export const pullRequestLimits = {
  titleChars: 256,
  bodyChars: 20_000,
  detailChars: 400_000,
  nameChars: 255,
  urlChars: 2048,
  checks: 100,
  commits: 100,
  reviews: 50,
  comments: 50,
  threads: 100,
  threadComments: 20,
  logLines: 40,
  logLineChars: 400,
} as const;
const pullRequestAddress = z
  .string()
  .max(pullRequestLimits.urlChars)
  .regex(/^https:\/\//);
const shortName = z.string().max(pullRequestLimits.nameChars);
const moment = z.string().max(40).nullable();
const pullRequestBody = z.string().max(pullRequestLimits.bodyChars);
const digits = z.string().regex(/^[0-9]{1,20}$/);
export const checkResult = z.enum([
  "failed",
  "pending",
  "passed",
  "skipped",
  "cancelled",
  "unknown",
]);
export const pullRequestNeed = z.enum(["checks", "review", "conflicts"]);
export const pullRequestTrouble = z.enum([
  "signed-out",
  "gh-missing",
  "gh-old",
  "offline",
  "other-host",
  "rate-limited",
  "hung",
  "failed",
]);
const pullRequestCheck = z.strictObject({
  name: shortName,
  workflow: shortName.nullable(),
  result: checkResult,
  url: pullRequestAddress.nullable(),
  run: digits.nullable(),
  job: digits.nullable(),
});
export const hiddenReason = z.enum([
  "abuse",
  "duplicate",
  "off-topic",
  "outdated",
  "resolved",
  "spam",
]);
const pullRequestComment = z.strictObject({
  author: shortName.nullable(),
  at: moment,
  body: pullRequestBody,
  bodyCut: z.boolean(),
  hidden: z.boolean(),
  hiddenReason: hiddenReason.nullable(),
  url: pullRequestAddress.nullable(),
});
const pullRequestReview = pullRequestComment.extend({
  state: z.enum(["approved", "changes-requested", "commented", "dismissed", "pending"]),
});
const pullRequestThread = z.strictObject({
  resolved: z.boolean(),
  outdated: z.boolean(),
  path: changePath.nullable(),
  line: z.int().min(1).max(1_000_000).nullable(),
  side: z.enum(["left", "right"]).nullable(),
  url: pullRequestAddress.nullable(),
  comments: z.array(pullRequestComment).max(pullRequestLimits.threadComments),
  moreComments: count,
});
const pullRequestDetail = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("read"),
      reviews: z.array(pullRequestReview).max(pullRequestLimits.reviews),
      moreReviews: count,
      comments: z.array(pullRequestComment).max(pullRequestLimits.comments),
      moreComments: count,
      threads: z.array(pullRequestThread).max(pullRequestLimits.threads),
      moreThreads: count,
    })
    .refine(
      ({ reviews, comments, threads }) =>
        [...reviews, ...comments, ...threads.flatMap((thread) => thread.comments)].reduce(
          (total, { body }) => total + body.length,
          0,
        ) <= pullRequestLimits.detailChars,
      { message: "The conversation holds more text than Satellite shows" },
    ),
  z.strictObject({ kind: z.literal("unavailable"), reason: pullRequestTrouble }),
]);
export const pullRequestAnswer = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("found"),
    number: z.int().min(1).max(9_999_999_999),
    url: pullRequestAddress,
    host: z.string().regex(ghHost),
    title: z.string().max(pullRequestLimits.titleChars),
    state: z.enum(["open", "draft", "merged", "closed"]),
    base: shortName.nullable(),
    head: shortName.nullable(),
    crossRepository: z.boolean(),
    mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
    mergeState: z.enum([
      "behind",
      "blocked",
      "clean",
      "dirty",
      "draft",
      "has-hooks",
      "unstable",
      "unknown",
    ]),
    review: z.enum(["approved", "changes-requested", "review-required", "none"]),
    counts: z.strictObject({ failed: count, pending: count, passed: count, total: count }),
    needs: z.array(pullRequestNeed).max(3),
    atHead: z.boolean().nullable(),
    body: pullRequestBody,
    bodyCut: z.boolean(),
    changedFiles: count.nullable(),
    commits: z
      .array(
        z.strictObject({ oid: z.string().regex(/^[0-9a-f]{7}$/), headline: z.string().max(256) }),
      )
      .max(pullRequestLimits.commits),
    moreCommits: count,
    checks: z.array(pullRequestCheck).max(pullRequestLimits.checks),
    moreChecks: count,
    detail: pullRequestDetail.nullable(),
  }),
  z.strictObject({ kind: z.literal("absent"), reason: z.enum(["none", "not-pushed", "target"]) }),
  z.strictObject({ kind: z.literal("unavailable"), reason: pullRequestTrouble }),
]);
export type CheckResult = z.output<typeof checkResult>;
export type PullRequestNeed = z.output<typeof pullRequestNeed>;
export type PullRequestTrouble = z.output<typeof pullRequestTrouble>;
export type PullRequestCheck = z.output<typeof pullRequestCheck>;
export type PullRequestThread = z.output<typeof pullRequestThread>;
export type PullRequestDetail = z.output<typeof pullRequestDetail>;
export type PullRequestAnswer = z.output<typeof pullRequestAnswer>;
export type PullRequestFound = Extract<PullRequestAnswer, { kind: "found" }>;
export const installFix = z.strictObject({
  kind: z.enum(["command", "address"]),
  text: z.string().min(1).max(200),
});
const toolMissing = z.strictObject({ state: z.literal("missing"), fix: installFix });
const toolBroken = z.strictObject({ state: z.literal("broken") });
export const toolState = z.discriminatedUnion("state", [toolReady, toolMissing, toolBroken]);
export const ghState = z.discriminatedUnion("state", [
  toolReady.extend({
    account: z.string().regex(ghLogin).nullable(),
    host: z.string().regex(ghHost).nullable(),
  }),
  toolMissing,
  toolBroken,
  z.strictObject({ state: z.literal("signed-out"), reason: z.enum(["none", "failed"]) }),
  z.strictObject({ state: z.literal("token-refused"), variable: ghTokenVariable }),
]);
export const toolCheck = z.strictObject({ git: toolState, gh: ghState, claude: toolState });
export const defaultInterfaceState: InterfaceState = {
  selected: null,
  columns: { left: interfaceLimits.left.initial, right: interfaceLimits.right.initial },
  theme: "system",
  notifications: true,
  files: [],
};

const terminalId = z.uuid();
const cols = z.int().min(bridgeLimits.cols.min).max(bridgeLimits.cols.max);
const rows = z.int().min(bridgeLimits.rows.min).max(bridgeLimits.rows.max);
const empty = z.strictObject({});
const processId = z.int().min(2).max(4_294_967_295);
const processStart = z.int().min(1).max(8_640_000_000_000_000);
const loopbackAddress = z
  .string()
  .regex(/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?\/$/);
export const processRow = z.strictObject({
  workspace: workspaceRef,
  session: terminalId,
  pid: processId,
  started: processStart,
  command: z.string().max(processesLimits.commandChars),
  cut: z.boolean(),
  ports: z
    .array(z.strictObject({ port: z.int().min(1).max(65535), url: loopbackAddress.nullable() }))
    .max(processesLimits.ports),
});
export type ProcessRow = z.output<typeof processRow>;
export type ProcessesList = BridgeResponse<"processes.list">;
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const startBranch = z.strictObject({ ref: refName, label: z.string().min(1).max(255) });

export const bridgeRequests = {
  "tools.check": { request: empty, response: toolCheck },
  "interface.load": {
    request: empty,
    response: z.strictObject({ state: interfaceState, notice: z.string().max(300).nullable() }),
  },
  "interface.save": {
    request: z.strictObject({ state: interfaceState }),
    response: empty,
  },
  "projects.list": {
    request: empty,
    response: z.strictObject({
      projects: z.array(projectView).max(200),
      notice: z.string().max(300).nullable(),
      dropped: z.array(z.string().min(1).max(300)).max(20),
    }),
  },
  "projects.choose": {
    request: empty,
    response: z.discriminatedUnion("outcome", [
      z.strictObject({ outcome: z.literal("added"), project: projectView }),
      z.strictObject({ outcome: z.literal("canceled") }),
    ]),
  },
  "projects.drop": {
    request: z.strictObject({ path: z.string().min(1).max(4096) }),
    response: z.strictObject({ project: projectView }),
  },
  "projects.remove": {
    request: z.strictObject({ projectId: z.uuid() }),
    response: z.strictObject({
      forgotWorkspaces: z.int().min(0).max(bridgeLimits.workspacesPerProject),
    }),
  },
  "workspaces.prepare": {
    request: z.strictObject({ projectId: z.uuid() }),
    response: z.strictObject({
      name: workspaceName,
      start: startView,
      branches: z.array(startBranch).max(200),
    }),
  },
  "workspaces.create": {
    request: z.strictObject({
      operationId: z.uuid(),
      projectId: z.uuid(),
      name: workspaceName,
      start: startChoice,
    }),
    response: z.strictObject({ workspace: workspaceView }),
  },
  "workspaces.cancel": {
    request: z.strictObject({ operationId: z.uuid(), projectId: z.uuid() }),
    response: z.strictObject({ canceled: z.boolean() }),
  },
  "workspaces.inspect": {
    request: z.strictObject({ projectId: z.uuid(), workspaceId: z.uuid() }),
    response: z.strictObject({
      branch: z.string().min(1).max(255).nullable(),
      files: z
        .array(z.strictObject({ code: z.string().length(2), path: z.string().min(1).max(4096) }))
        .max(50),
      moreFiles: count,
      repositories: count,
      hidden: count.nullable(),
      submodules: z.enum(["none", "checked-out", "unknown"]),
      boundary: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("clear") }),
        z.strictObject({ kind: z.literal("mount"), at: z.string().min(1).max(300) }),
        z.strictObject({
          kind: z.literal("unchecked"),
          why: z.enum(["unreadable", "limits", "late"]),
        }),
      ]),
      commits: lossView,
      sessions: z.int().min(0).max(bridgeLimits.terminals),
      locked: z.boolean(),
      fingerprint,
    }),
  },
  "workspaces.archive": {
    request: z.strictObject({ projectId: z.uuid(), workspaceId: z.uuid(), fingerprint }),
    response: z.strictObject({ leftover: z.string().min(1).max(200).nullable() }),
  },
  "sessions.resumable": {
    request: z.strictObject({ workspace: workspaceRef }),
    response: z.strictObject({ resumable: z.boolean() }),
  },
  "changes.list": {
    request: z.strictObject({
      workspace: workspaceRef,
      view: changesView,
      base: baseName.optional(),
    }),
    response: z.strictObject({
      branch: z.string().min(1).max(255).nullable(),
      base: z.string().min(1).max(255).nullable(),
      ahead: count.nullable(),
      behind: count.nullable(),
      conflict: z
        .discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("files"),
            files: z.int().min(1).max(1_000_000),
            names: z.array(changePath).max(changesLimits.conflictNames),
          }),
          z.strictObject({ kind: z.literal("old-git") }),
          z.strictObject({ kind: z.literal("slow") }),
          z.strictObject({ kind: z.literal("unchecked") }),
        ])
        .nullable(),
      changes: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("files"),
          files: z.array(changedFile).max(changesLimits.files),
          more: count,
          longPaths: count,
        }),
        z.strictObject({
          kind: z.literal("unavailable"),
          reason: z.enum([
            "no-commits",
            "no-base",
            "unrelated",
            "not-local",
            "too-many",
            "hung",
            "failed",
          ]),
        }),
      ]),
    }),
  },
  "changes.file": {
    request: z.strictObject({
      workspace: workspaceRef,
      view: changesView,
      path: changePath,
      base: baseName.optional(),
    }),
    response: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("text"), original: sideText, modified: sideText }),
      z.strictObject({ kind: z.literal("binary") }),
      z.strictObject({ kind: z.literal("large") }),
      z.strictObject({
        kind: z.literal("submodule"),
        from: shortOid.nullable(),
        to: shortOid.nullable(),
      }),
      z.strictObject({ kind: z.literal("repository") }),
      z.strictObject({ kind: z.literal("link") }),
      z.strictObject({ kind: z.literal("mode") }),
      z.strictObject({ kind: z.literal("unmerged") }),
      z.strictObject({ kind: z.literal("changing") }),
      z.strictObject({ kind: z.literal("hung") }),
      z.strictObject({ kind: z.literal("not-local") }),
      z.strictObject({ kind: z.literal("unreadable") }),
      z.strictObject({ kind: z.literal("not-utf8") }),
    ]),
  },
  "files.list": {
    request: z.strictObject({
      workspace: workspaceRef,
      folders: z.array(folderPath).min(1).max(filesLimits.folders),
    }),
    response: z.strictObject({
      folders: z
        .array(z.strictObject({ path: folderPath, listing: folderListing }))
        .max(filesLimits.folders),
    }),
  },
  "files.read": {
    request: z.strictObject({
      workspace: workspaceRef,
      path: filePath,
      known: fileStamp.nullable(),
    }),
    response: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("text"),
        text: z.string().max(changesLimits.sideBytes),
        stamp: fileStamp,
      }),
      z.strictObject({
        kind: z.literal("link"),
        text: z.string().max(changesLimits.linkChars),
        stamp: fileStamp,
      }),
      z.strictObject({
        kind: z.literal("image"),
        type: imageType,
        data: z
          .string()
          .regex(/^[A-Za-z0-9+/]*={0,2}$/)
          .max(filesLimits.imageBase64Chars),
        stamp: fileStamp,
      }),
      z.strictObject({ kind: z.enum(["binary", "large", "not-utf8"]), stamp: fileStamp }),
      z.strictObject({ kind: z.literal("same") }),
      z.strictObject({ kind: z.enum(["gone", "changing", "hung", "unreadable"]) }),
    ]),
  },
  "files.find": {
    request: z.strictObject({
      workspace: workspaceRef,
      query: z.string().min(1).max(filesLimits.queryChars),
    }),
    response: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("found"),
        paths: z.array(filePath).max(filesLimits.findResults),
      }),
      z.strictObject({ kind: z.enum(["too-many", "hung", "failed"]) }),
    ]),
  },
  "pullRequest.read": {
    request: z.strictObject({
      workspace: workspaceRef,
      detail: z.boolean(),
      fresh: z.boolean().optional(),
    }),
    response: pullRequestAnswer,
  },
  "pullRequest.log": {
    request: z.strictObject({ workspace: workspaceRef, job: digits }),
    response: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("lines"),
        lines: z
          .array(z.string().max(pullRequestLimits.logLineChars))
          .max(pullRequestLimits.logLines),
        more: z.boolean(),
      }),
      z.strictObject({ kind: z.literal("empty") }),
      z.strictObject({ kind: z.literal("too-large") }),
      z.strictObject({ kind: z.literal("unavailable"), reason: pullRequestTrouble }),
    ]),
  },
  "processes.list": {
    request: empty,
    response: z.strictObject({
      at: processStart,
      rows: z.array(processRow).max(processesLimits.rows),
      more: count,
    }),
  },
  "processes.stop": {
    request: z.strictObject({ pid: processId, started: processStart }),
    response: empty,
  },
  "links.open": {
    request: z.strictObject({ url: z.string().min(1).max(bridgeLimits.linkChars) }),
    response: empty,
  },
  "terminal.start": {
    request: z.strictObject({
      id: terminalId,
      program: z.literal("claude"),
      workspace: workspaceRef,
      resume: z.boolean(),
      cols,
      rows,
    }),
    response: z.strictObject({ windowsPty: windowsPty.nullable() }),
  },
  "terminal.write": {
    request: z.strictObject({
      id: terminalId,
      data: z.string().min(1).max(bridgeLimits.terminalWriteChars),
    }),
    response: empty,
  },
  "terminal.resize": {
    request: z.strictObject({ id: terminalId, cols, rows }),
    response: empty,
  },
  "terminal.close": {
    request: z.strictObject({ id: terminalId }),
    response: empty,
  },
  "terminal.ack": {
    request: z.strictObject({
      id: terminalId,
      chars: z.int().min(1).max(bridgeLimits.terminalOutputChars),
    }),
    response: empty,
  },
};

export const bridgeEvents = {
  "workspaces.step": z.strictObject({
    operationId: z.uuid(),
    step: creationStep,
    state: z.enum(["running", "done", "failed", "undone"]),
    detail: z.string().min(1).max(300).nullable(),
  }),
  "terminal.data": z.strictObject({
    id: terminalId,
    data: z.string().min(1).max(bridgeLimits.terminalOutputChars),
  }),
  "terminal.exit": z.strictObject({
    id: terminalId,
    exitCode: z
      .int()
      .min(-(2 ** 31))
      .max(2 ** 32 - 1),
    ending: sessionEnding,
  }),
  "sessions.status": z.strictObject({ id: terminalId, status: sessionStatus, ready: z.boolean() }),
  "notices.open": z.strictObject({ workspace: workspaceRef }),
};

const bridgeErrorCode = z.enum([
  "unknown-channel",
  "invalid-request",
  "refused-sender",
  "not-found",
  "tool-missing",
  "limit",
  "refused",
  "failed",
]);

export function bridgeResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({
        code: bridgeErrorCode,
        message: z.string().max(bridgeLimits.messageChars),
      }),
    }),
  ]);
}
