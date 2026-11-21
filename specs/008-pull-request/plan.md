# Pull Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The centre column gets a third tab, Pull request. It shows the pull request of the workspace's branch, read through the user's own `gh`, with Overview, Checks, Conversation and Files. The tab finds a new pull request by itself, and without one it offers a prepared request that asks Claude Code to open it. Failed checks, requested changes and conflicts put the workspace in the inbox and raise one notification. The sidebar row and the header show the number, the state and a checks summary. Everything a pull request says is hostile text, so descriptions and comments are drawn as Markdown with no script, no raw HTML and no remote image, and every address opens only through the confirmed open.

**Architecture:** The background process does every read in a new folder `src/main/pull-request/`. Two bridge channels, `pullRequest.read` (the pull request of one workspace, with the conversation only when asked) and `pullRequest.log` (the failing lines of one check the user opened). A read is at most two `gh` runs, one after the other, from the workspace folder with a hardened environment. The first is one constant `gh pr view --json ... --jq ...`, the second is one constant `gh api graphql` that runs only while the tab shows. Nothing from a repository, a pull request or the page enters an argument except a host, an owner, a repository name, a number and a job id that each passed a pattern. The page asks and the background process paces, so a serial queue, a two second gap, a ten second reuse, a per workspace backoff and one pause on a rate limit bound every `gh` run in one place. The background process keeps the last answer per workspace in memory only, derives which workspaces need the user and feeds the existing notices beside the sessions. The page keeps one hook, `usePullRequests`, that holds every listed workspace's answer and derives the inbox rows, the row readout and the header from it. Files reuses the Branch diff of spec 006 against the pull request's base branch, computed locally by git, with review threads marked on their lines. Markdown is `react-markdown` with `remark-gfm`, with overrides that never create an image, a link element or raw HTML.

**Tech Stack:** Electron 45.3.4, React 19.3.1, TypeScript 6.0.3, zod 4.6.7, Tailwind 4.3.5, Vitest 5.1.0, playwright-core 1.65.1, vite 8.3.8, `monaco-editor` 0.57.0, Node 24 (`.nvmrc`), all read from `package.json`. git 2.31 or newer (2.50.1 here), `gh` 2.18.0 or newer (2.80.0 here). Two new dev dependencies, pinned exactly, `react-markdown` 10.1.0 and `remark-gfm` 4.0.1, both MIT and both the latest on the npm registry when this was written.

**Spec:** `specs/008-pull-request/spec.md`

## What this writes and where

- Nothing about a pull request on disk, anywhere. Answers live in memory, in the background process per workspace and in the page for one page load.
- Nothing in any repository, working file, index or ref. Every new git run is a read through `gitArgs`. Every `gh` run is a read. Satellite never comments, reviews, merges, re-runs a check or fetches.
- `package.json` and `package-lock.json` gain the two dev dependencies (Task 4). The licence notices file built by `scripts/third-party-licenses.ts` gains their sections by itself, because vite lists every bundled package.

## Rulings checked

Each was checked while planning, against `gh` 2.80.0 and git 2.50.1 here, the `cli/cli` source and release notes read through `gh api`, and read-only runs against public pull requests of `cli/cli`. Throwaway folders came from `mktemp -d` and were left behind.

- **One projected read.** `gh pr view --json <fields> --jq <projection>` with no selector reads the pull request of the current branch, open, merged or closed. The run against a public pull request with 11 checks and 10 reviews answered one line of 12 KB. The projection exists to drop what Satellite must not hold, commit author names and emails above all, and to make one flat shape for the parser.
- **Which review field.** `latestReviews[].commit.oid` came back as an empty string on every pull request tried, while `reviews[].commit.oid` held the reviewed commit. The plan reads `reviews`.
- **The floor.** `api/query_builder.go` at tags v1.9.0, v2.0.0, v2.17.0 and v2.18.0 shows every field in the list from 2.0.0 except `headRefOid`, which the 2.18.0 release notes add. `workflowName` is missing from the roll-up before later versions, and the projection turns a missing key into `null`. An older `gh` answers `Unknown JSON field: "headRefOid"` with exit 1, which maps to one sentence. `baseRefOid` (2.63.0) is not used at all.
- **Exit codes and stderr.** Seen here, `no pull requests found for branch "<name>"` with exit 1, `none of the git remotes configured for this repository point to a known GitHub host` with exit 1 and no request sent, `no git remotes found` with exit 1, `Unknown JSON field: "nope"` with exit 1. `gh help exit-codes` gives 4 for a command that needs sign in. Not seen here and therefore matched loosely, the rate limit line and the offline lines.
- **Which host a run talks to.** `gh pr view` takes the host from the remote and refuses a host `gh` has no login for before any request, so `evil.example.invalid`, a look-alike subdomain and a user-info trick all answered the unknown host line. `gh api` takes its host from `--hostname`, else from the default host (`pkg/cmd/api/api.go`, `host = opts.Hostname`), never from the repository, so the plan always passes `--hostname`. `-f` sends a raw string with no file or placeholder magic, and `-F` is used only for the number, which is digits.
- **No program a repository chose.** A repository was built with a marker program on `core.fsmonitor`, `core.pager`, `core.editor`, `core.sshCommand`, `core.gitProxy`, `credential.helper`, `diff.external`, `core.askPass`, `sequence.editor`, `gpg.program`, `pager.remote`, `pager.config`, `remote.origin.uploadpack` and aliases named `remote`, `config`, `rev-parse` and `symbolic-ref`. `gh pr view` in it wrote no marker, while a plain `git status` control run did. A shim on `PATH` showed that `gh pr view` runs only `git remote -v`, `git config --get-regexp`, `git symbolic-ref --quiet HEAD`, `git rev-parse --symbolic-full-name <branch>@{push}`, `git config push.default` and `git config remote.pushDefault`. As a second layer the `gh` environment now carries `GIT_CONFIG_COUNT=1` with `core.fsmonitor` set to empty and `GIT_OPTIONAL_LOCKS=0`, and with those the `git status` control wrote no marker either.
- **The one program `gh` starts beside git.** For an ssh remote `gh` runs `ssh -G <host>` to resolve a host alias, with the host taken from the remote address. A host that starts with a dash reached ssh as an option, ssh printed its usage and started nothing. Remote addresses live in `.git/config`, which no clone, fetch or pull writes, so only something already running as the user can set one. This is recorded in the threat list and in `ARCHITECTURE.md`, and Satellite adds no rule of its own for it.
- **The conversation query.** The constant query in Exact values ran against a public pull request with `--hostname github.com`, cost 1 point, and answered 13 KB for 10 reviews and 6 threads. An outdated thread answers `line: null` with `originalLine` set, so a thread with no `line` is listed and never placed.
- **Duplicate checks.** `pkg/cmd/pr/checks/aggregate.go` in `cli/cli` keeps only the newest by `startedAt` among checks that share a name, a workflow and an event, and one public pull request here listed the same job twice. The JSON output has no event, so the plan keeps the newest per workflow and name, and per `context` for a status.
- **Pushed, not upstream.** `git for-each-ref --format=%(refname) refs/remotes/*/<branch>` answered the remote ref for a branch pushed without `-u`, and for a branch with a slash. A branch with no such ref and no upstream has nothing on GitHub, so no `gh` runs for it.
- **Markdown.** `react-markdown` 10.1.0 (peer `react >=18`) never uses `dangerouslySetInnerHTML`, drops raw HTML with `skipHtml`, and its default `urlTransform` empties `javascript:` and `data:` addresses. It does create `<img>` for images, so the plan overrides `img`. The production policy already has `img-src 'self' data:` and `default-src 'none'` (`src/shared/content-security-policy.ts`), which is the second layer.
- **The thread mark.** Monaco 0.57.0 has the `glyphMarginClassName` decoration option and reports a click there as `MouseTargetType.GUTTER_GLYPH_MARGIN`. The diff editor draws a glyph margin on the original side only side by side, so only threads on the new side get a mark.
- **The key.** `j` is free in `command-registry.ts`, in `app-menu.ts` roles and in the dev shortcuts, as Cmd+J on macOS and Ctrl+Shift+J elsewhere.

## Open calls decided here

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| Markdown with `react-markdown` and `remark-gfm`, raw HTML skipped, an image replaced by a text link, a link drawn as a button that opens the confirm dialog, no HTML string and no sanitizer | The parser builds React elements, so there is no HTML to sanitize, and both packages are small, MIT and current | A swap of one component, `markdown-text.tsx` |
| At most two `gh` runs per read, serial, from the workspace folder, never REST, never `fetch` | The user's `gh` owns the token and the host, and Satellite holds neither | None, this is the security boundary |
| The conversation query runs on every read that asks for it, with no change detection | One point per run and only while the tab shows | A few hundred points an hour at worst |
| Failed check lines are read only when the user opens a failed check, 40 lines and 8,000 characters at most | A log can be megabytes and holds whatever the build printed | A click for each check |
| Files is the Branch diff of spec 006 with the pull request's base branch as the base, on local objects | No `baseRefOid`, no fetch, the same viewer | A fork's base branch is read from the remote Satellite already picks, so a stale fork ref shows a wider diff. The note above the list says the files are the workspace's |
| `changes.list` and `changes.file` take an optional `base` branch name instead of a third view | One validated name is less than a second copy of the list logic, and the page can already read the whole workspace | One optional field |
| A thread is a mark on its line and its text is in a panel beside the diff. Threads on the old side, outdated threads and file level threads are listed in the panel only | Marks cannot break the editor, and view zones holding hostile Markdown inside Monaco can | A thread that is one click away |
| Unchanged regions are unfolded while marks show | A mark inside a folded region would be invisible | A longer diff |
| The floor is `gh` 2.18.0, and below it the tab says so in one sentence | `headRefOid` decides whether a review is on the current commit | Users on a 2022 `gh` update it |
| Needs you is a failed check, requested changes on the current head commit, or conflicts, on an open pull request that is not a draft | A check the author can fix, a review they must answer, a branch they must update | An alert too many or too few, fixed in `pull-request-needs.ts` |
| Failure, timed out, startup failure, action required and error fail. Skipped and neutral pass. Cancelled, stale and pending never alert. An unknown value shows as unknown and never alerts | The maintainer's ruling | The table in Exact values |
| Requested changes count while the newest deciding review of some reviewer is a request for changes on the head commit | A push answers the review until the reviewer speaks again | A review that stays red on GitHub leaves the inbox after a push |
| A merged or closed pull request keeps the tab with its state and never needs you | It is history | None |
| Prepared requests carry pointers only, the number, the run id, the job id and a thread address rebuilt from checked parts | Check names, paths and comment text are chosen by other people and would land in the prompt | A request that reads as less specific |
| A notification says Satellite's own sentence with cleaned names and nothing a pull request says, not even its number | The lock screen shows it | None |
| One notification per workspace, not per reason. A workspace that already needs you for a session gets no second one | `notices.ts` dedupes by workspace and stays as it is | A quieter second alert |
| A branch counts as pushed with an upstream or a remote ref of its name. Changed from upstream only | A push without `-u` still has a pull request, and the check is one local git read | One `for-each-ref` per read |
| `GH_HOST` and `GH_REPO` are dropped for every `gh` run, the tool check included | Neither may steer a read, and `gh auth status` lists every host anyway | A user who relies on `GH_HOST` outside a repository sees no change inside Satellite |
| The page drives refresh and the background process paces it | Focus, visibility and turn ends are page facts, and limits must hold against a page that misbehaves | None |
| The shown workspace refreshes on the shared schedule with a 30 second floor and a 300 second cap. Every listed workspace is asked every 300 seconds, and at once when one of its sessions finishes a turn | Few rules, about 14 percent of the hourly points with 50 workspaces | Numbers in Limits |
| The tab is always in the strip and never selects itself. Its label gains the number | Appearing by itself means the number shows up, not that the view jumps | None |
| A sixth scenario, `pr-conflicts`, and a seventh, `pr-appears` | The spec names five, and the inbox item needs conflicts and the journey needs a pull request that arrives later | Two small folders |
| The `gh` stand-in knows the three calls by importing the argument builders, answers by call name, and exits 97 for any other `pr`, `api` or `run` arguments | A scenario cannot drift from the real arguments, and a journey proves no other call is ever made | None |
| `LinkDialog` takes its description as a prop, and every address from a pull request goes through it | One confirmed open for the whole app | None |

## Exact values

### Limits

| What | Value |
| --- | --- |
| `gh pr view` time limit | 20 s |
| `gh api graphql` time limit | 20 s |
| `gh run view` time limit | 30 s |
| Gap between two `gh` starts, app wide, one at a time | 2 s |
| An answer is reused when younger than | 10 s |
| A workspace whose read failed is not asked again for | 60 s, doubling to 1,800 s, reset by a good read. A read with `detail` true skips this hold |
| After a rate limit answer no `gh` runs for | 900 s |
| Reads waiting in the queue | 200, then `limit` |
| Shown workspace schedule | first 30,000 ms, cap 300,000 ms, factor 4 |
| Sweep of every listed workspace | 300,000 ms |
| Title | 256 characters |
| Body of a description, review or comment | 20,000 characters, then cut with `bodyCut` true |
| Checks, commits | 100 each, with a count of the rest |
| Reviews, comments | 50 each, the newest |
| Threads | 100, with 20 comments each |
| Failed lines | 40 lines of 400 characters |
| A name (branch, check, workflow, login) | 255 characters |
| An address | 2,048 characters, `https` only |

### The three runs

`src/main/pull-request/gh-arguments.ts` holds them and nothing else builds a `gh` argument for a pull request.

```ts
export const viewFields =
  "number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,body,mergeable,mergeStateStatus,reviewDecision,changedFiles,reviews,statusCheckRollup,commits";
export const viewProjection =
  "{number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,body,mergeable,mergeStateStatus,reviewDecision,changedFiles,reviews:[.reviews[]?|{state,commit:.commit.oid,login:.author.login,at:.submittedAt}],checks:[.statusCheckRollup[]?|{name,workflow:.workflowName,status,conclusion,context,state,url:(.detailsUrl//.targetUrl),startedAt}],commits:[.commits[]?|{oid,headline:.messageHeadline}]}";
export const threadsQuery =
  "query($owner:String!,$repo:String!,$number:Int!){rateLimit{cost}repository(owner:$owner,name:$repo){pullRequest(number:$number){reviews(last:50){totalCount nodes{url state submittedAt body author{login}}}comments(last:50){totalCount nodes{url createdAt body isMinimized author{login}}}reviewThreads(first:100){totalCount nodes{isResolved isOutdated path line startLine originalLine diffSide subjectType comments(first:20){totalCount nodes{url body createdAt author{login}}}}}}}}";

export interface PullRequestPlace { host: string; owner: string; repo: string; number: number }

export function viewArguments(): string[] {
  return ["pr", "view", "--json", viewFields, "--jq", viewProjection];
}
export function threadsArguments({ host, owner, repo, number }: PullRequestPlace): string[] {
  return ["api", "graphql", "--hostname", host, "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${String(number)}`, "-f", `query=${threadsQuery}`];
}
export function logArguments({ host, owner, repo }: PullRequestPlace, job: string): string[] {
  return ["run", "view", "--job", job, "--log-failed", "-R", `${host}/${owner}/${repo}`];
}
export function placeOf(url: string): PullRequestPlace | null
export function callOf(args: readonly string[]): "pull-request" | "threads" | "failed-log" | null
```

`placeOf` parses the pull request address with `URL.parse` and answers a place only when the protocol is `https:`, there is no user info, port, query or hash, the host matches `ghHost` from the contract, and the path matches `^/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9._-]{1,100})/pull/([1-9][0-9]{0,9})$` with a repository name that is not `.` or `..`. `callOf` answers a name only for arguments that one of the three builders can produce, compared element by element, with the host, owner, repository, number and job (`^[0-9]{1,20}$`) checked by the same patterns. There is no pagination. Each connection is one page and `totalCount` says how much more is on GitHub.

**The environment.** Every `gh` run, through `toolEnvironment("gh", env)`, drops `GH_DEBUG`, `DEBUG`, `GH_FORCE_TTY`, `CLICOLOR_FORCE`, `GH_HOST`, `GH_REPO`, `GH_PAGER`, `PAGER`, `GH_BROWSER`, `BROWSER`, `GH_EDITOR` and every key in `gitDroppedKeys`, and sets `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `GH_NO_EXTENSION_UPDATE_NOTIFIER=1`, `GH_TELEMETRY=false`, `NO_COLOR=1`, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=false`, `SSH_ASKPASS_REQUIRE=never`, `GIT_OPTIONAL_LOCKS=0`, `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.fsmonitor` and `GIT_CONFIG_VALUE_0=` (empty). Token variables and `GH_CONFIG_DIR` stay, they are the user's sign in. `runTool` gains `cwd?: string`, and the pull request runs pass the workspace folder that `sessionFolder` answered.

### Failures

`ghFailure(run: ToolRun | undefined, stopped: StopReason | undefined)` in `gh-failure.ts`, first match wins. Stderr is matched and then dropped. It never reaches the page, a log or a notification.

| Order | Test | Kind |
| --- | --- | --- |
| 1 | `gh` did not resolve | `gh-missing` |
| 2 | stopped by time, or output past the cap | `hung` |
| 3 | exit 4, or stderr holds `gh auth login` | `signed-out` |
| 4 | stderr starts with `no pull requests found` | `none` |
| 5 | stderr holds `no git remotes found` | `not-pushed` |
| 6 | stderr holds `Unknown JSON field` or `unknown flag` | `gh-old` |
| 7 | stderr holds `point to a known GitHub host` | `other-host` |
| 8 | stderr matches `/rate limit/i` | `rate-limited` |
| 9 | stderr matches `/dial tcp\|no such host\|connection refused\|network is unreachable\|i\/o timeout\|TLS handshake timeout\|error connecting to/` | `offline` |
| 10 | anything else, a non-zero exit, output that is not JSON, or JSON the parser refuses whole | `failed` |

### Parsers

`pull-request-parse.ts`. Each parser takes stdout, runs `JSON.parse` in a `try`, then a loose zod schema where every field is `.optional().catch(undefined)` (or `.nullable()`), so one bad field costs that field. Then it builds the strict contract shape.

- `parseView(stdout, localHead: string | null)` answers `null` (kind `failed`) only when the JSON is not an object, `number` is not a positive integer, or `placeOf(url)` is null. Otherwise it answers the `found` parts. A missing title is `""` and the page writes `Untitled`. `state` is `merged` for `MERGED`, `closed` for `CLOSED`, `draft` for `OPEN` with `isDraft` true, `open` for `OPEN`, and `open` for anything else. Branch names that fail `isBranchName` become `null`. `mergeable`, `mergeStateStatus` and `reviewDecision` are lowercased with underscores as dashes, and anything outside the enum, an empty string included, is `unknown` or `none`. The body is cut at 20,000 characters. A commit keeps the first 7 characters of an oid that matches `^[0-9a-f]{40,64}$` and its headline cut at 256, and a commit with no valid oid is dropped. `atHead` is `localHead === headRefOid`, or `null` when either is missing.
- `checksOf(raw)` in `check-result.ts` keeps the newest per key as ruled, maps each with the table below, sorts failed first, then pending, then the rest, each group by workflow then name, and keeps 100. A name is `name`, else `context`, else `""` which the page writes as `Unnamed check`. An address is kept only when `URL.parse` gives `https:` and it is 2,048 characters or fewer. `run` and `job` are set only when the address has the pull request's host and the path `^/<owner>/<repo>/actions/runs/([0-9]{1,20})/job/([0-9]{1,20})$`.
- `parseThreads(stdout, place)` answers `null` when `data.repository.pullRequest` is missing. Reviews keep `state` lowercased from `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`, `PENDING`, and a commented review with an empty body is dropped, since it only carries thread comments. A minimized comment answers `hidden: true` with an empty body. A thread is `placed` data only as far as it is valid, `path` through `isChangePath` else `null`, `line` an integer from 1 to 1,000,000 else `null`, `side` from `diffSide`. Its `url` is the first comment's address only when it equals `https://<host>/<owner>/<repo>/pull/<number>#discussion_r<digits>`, else `null`. Every other address in the conversation is kept under the same `https` rule as a check's.
- `failedLines(stdout)` splits lines, drops the two tab separated prefixes and a leading ISO timestamp, strips ANSI sequences, passes each through `visibleText`, keeps lines that hold `##[error]` with that marker removed, and when none hold it keeps the last 40. It answers at most 40 lines of 400 characters and `more` true when it cut any.

**The check table.**

| Shape | Value | Result |
| --- | --- | --- |
| Check run | `status` is not `COMPLETED` | `pending` |
| Check run | `conclusion` `SUCCESS` | `passed` |
| Check run | `conclusion` `NEUTRAL`, `SKIPPED` | `skipped` |
| Check run | `conclusion` `FAILURE`, `TIMED_OUT`, `STARTUP_FAILURE`, `ACTION_REQUIRED` | `failed` |
| Check run | `conclusion` `CANCELLED`, `STALE` | `cancelled` |
| Status (has `context`) | `state` `SUCCESS` | `passed` |
| Status | `state` `FAILURE`, `ERROR` | `failed` |
| Status | `state` `PENDING`, `EXPECTED` | `pending` |
| Either | anything else | `unknown` |

The counts are `failed`, `pending`, `passed` (passed plus skipped) and `total`, over every check kept after the newest rule, before the cut to 100.

**Needs.** `needsOf(view)` in `pull-request-needs.ts` answers `[]` unless the state is `open`. Otherwise `checks` when `failed > 0`, `review` when, taking for each login the newest review by `at` among `APPROVED`, `CHANGES_REQUESTED` and `DISMISSED`, one is `CHANGES_REQUESTED` with `commit === headRefOid`, and `conflicts` when `mergeable` is `conflicting`. Logins are used here and never stored beyond the answer.

### Contract

Added to `src/shared/bridge-contract.ts`.

```ts
export const pullRequestLimits = {
  titleChars: 256, bodyChars: 20_000, nameChars: 255, urlChars: 2048,
  checks: 100, commits: 100, reviews: 50, comments: 50, threads: 100, threadComments: 20,
  logLines: 40, logLineChars: 400,
} as const;
const address = z.string().max(pullRequestLimits.urlChars).regex(/^https:\/\//);
const shortName = z.string().max(pullRequestLimits.nameChars);
const moment = z.string().max(40).nullable();
const body = z.string().max(pullRequestLimits.bodyChars);
const digits = z.string().regex(/^[0-9]{1,20}$/);
export const checkResult = z.enum(["failed", "pending", "passed", "skipped", "cancelled", "unknown"]);
export const pullRequestNeed = z.enum(["checks", "review", "conflicts"]);
export const pullRequestTrouble = z.enum([
  "signed-out", "gh-missing", "gh-old", "offline", "other-host", "rate-limited", "hung", "failed",
]);
const pullRequestCheck = z.strictObject({
  name: shortName, workflow: shortName.nullable(), result: checkResult,
  url: address.nullable(), run: digits.nullable(), job: digits.nullable(),
});
const pullRequestComment = z.strictObject({
  author: shortName.nullable(), at: moment, body, bodyCut: z.boolean(), hidden: z.boolean(),
  url: address.nullable(),
});
const pullRequestReview = pullRequestComment.extend({
  state: z.enum(["approved", "changes-requested", "commented", "dismissed", "pending"]),
});
const pullRequestThread = z.strictObject({
  resolved: z.boolean(), outdated: z.boolean(),
  path: changePath.nullable(), line: z.int().min(1).max(1_000_000).nullable(),
  side: z.enum(["left", "right"]).nullable(), url: address.nullable(),
  comments: z.array(pullRequestComment).max(pullRequestLimits.threadComments), moreComments: count,
});
const pullRequestDetail = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("read"),
    reviews: z.array(pullRequestReview).max(pullRequestLimits.reviews), moreReviews: count,
    comments: z.array(pullRequestComment).max(pullRequestLimits.comments), moreComments: count,
    threads: z.array(pullRequestThread).max(pullRequestLimits.threads), moreThreads: count,
  }),
  z.strictObject({ kind: z.literal("unavailable"), reason: pullRequestTrouble }),
]);
export const pullRequestAnswer = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("found"),
    number: z.int().min(1).max(9_999_999_999),
    url: address, host: z.string().regex(ghHost),
    title: z.string().max(pullRequestLimits.titleChars),
    state: z.enum(["open", "draft", "merged", "closed"]),
    base: shortName.nullable(), head: shortName.nullable(), crossRepository: z.boolean(),
    mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
    mergeState: z.enum(["behind", "blocked", "clean", "dirty", "draft", "has-hooks", "unstable", "unknown"]),
    review: z.enum(["approved", "changes-requested", "review-required", "none"]),
    counts: z.strictObject({ failed: count, pending: count, passed: count, total: count }),
    needs: z.array(pullRequestNeed).max(3),
    atHead: z.boolean().nullable(),
    body, bodyCut: z.boolean(), changedFiles: count.nullable(),
    commits: z.array(z.strictObject({ oid: z.string().regex(/^[0-9a-f]{7}$/), headline: z.string().max(256) })).max(pullRequestLimits.commits),
    moreCommits: count,
    checks: z.array(pullRequestCheck).max(pullRequestLimits.checks), moreChecks: count,
    detail: pullRequestDetail.nullable(),
  }),
  z.strictObject({ kind: z.literal("absent"), reason: z.enum(["none", "not-pushed"]) }),
  z.strictObject({ kind: z.literal("unavailable"), reason: pullRequestTrouble }),
]);
```

In `bridgeRequests`.

```ts
"pullRequest.read": {
  request: z.strictObject({ workspace: workspaceRef, detail: z.boolean() }),
  response: pullRequestAnswer,
},
"pullRequest.log": {
  request: z.strictObject({ workspace: workspaceRef, job: digits }),
  response: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("lines"),
      lines: z.array(z.string().max(pullRequestLimits.logLineChars)).max(pullRequestLimits.logLines),
      more: z.boolean(),
    }),
    z.strictObject({ kind: z.literal("empty") }),
    z.strictObject({ kind: z.literal("unavailable"), reason: pullRequestTrouble }),
  ]),
},
```

`changes.list` and `changes.file` requests gain `base: z.string().min(1).max(255).refine(isBranchName).optional()`. Exported types `PullRequestAnswer`, `PullRequestFound` (the `found` member), `PullRequestDetail`, `PullRequestNeed`, `PullRequestThread`, `PullRequestCheck`, `PullRequestTrouble`. `detail` is `null` exactly when the request said `detail: false`. No new event and no new error code. Bridge failures are `not-found` for a workspace that is not on record, `limit` for a full queue, and `not-found` for a job that is not among the remembered checks of that workspace.

### What a hostile repository, a hostile pull request or a hostile page could try

| Attempt | Defence | Proof |
| --- | --- | --- |
| A repository configures a program git or `gh` would start | `gh` runs only the config and ref reads listed in Rulings, and its git children get `core.fsmonitor` empty and no optional locks | `tools.test.ts` environment test, the real `gh` marker test in Task 1 |
| A remote address steers `gh` to another host | `gh` refuses a host it holds no login for before any request. The second and third runs name the host from the checked pull request address | `gh-arguments.test.ts` `placeOf` cases, Rulings |
| A remote host that starts with a dash reaches `ssh -G` | Only `.git/config` holds remotes and no clone writes it. ssh printed usage and started nothing | Rulings, recorded in `ARCHITECTURE.md` |
| The environment steers `gh` | `GH_HOST`, `GH_REPO`, pager, browser and editor keys and git's repository keys are dropped | `tools.test.ts` |
| A title, branch, check name or login carries an option or a path into an argument | No such text is ever an argument. Arguments are constants plus five checked values | `gh-arguments.test.ts` `callOf` accepts only what the builders make |
| The page asks for another repository's log or pull request | A request holds a workspace on record and a job that must be among that workspace's remembered checks | `pull-request-reads.test.ts`, `registry.test.ts`, the `boundary` journey |
| The page floods reads | The queue, the gap, the reuse and the pause live in the background process | `gh-pace.test.ts` |
| A description holds a script, raw HTML, an iframe, a style, a form or an event handler | `skipHtml`, no `rehype-raw`, React elements only, the content security policy | `markdown-text.test.ts`, scenario `hostile-description` |
| A description loads a remote image to track the reader | `img` is overridden to a text link, no `<img>` is ever created, `img-src` allows only `'self' data:` | `markdown-text.test.ts`, the journey counts `img` elements |
| A link shows one address and opens another, or uses `javascript:`, `data:` or `file:` | A link is a button with no `href`. Only `https:` opens, through `LinkDialog`, which shows the real address, and `links.open` checks it again | `markdown-text.test.ts`, the journey |
| Text hides or reorders characters | Titles, names, branches, logins and headlines go through `visibleText` or `VisibleName`. Markdown source goes through `revealLines` before parsing | `markdown-text.test.ts` |
| Pull request text reaches the prompt as an instruction | Prepared requests are built from numbers, digits and a rebuilt thread address only | `pull-request-requests.test.ts` |
| Pull request text reaches a notification | The notice is Satellite's sentence with the workspace and project names cleaned by `noticeName` | `notice-text.test.ts` |
| A huge answer or a slow `gh` | Time limits, the 16 MiB cap in `runTool`, every array and string cut by the parser, the schema repeating each bound | `pull-request-parse.test.ts` |
| A log line carries terminal escapes | ANSI stripped, `visibleText`, drawn as plain text | `pull-request-parse.test.ts` |

### Copy

No colon in any of it. Trouble sentences live in `src/renderer/pull-request/pull-request-words.ts`.

| Key | Sentence |
| --- | --- |
| `none` | No pull request for this branch yet. |
| `not-pushed` | This branch is not on GitHub yet. Push it and its pull request shows up here. |
| `signed-out` | The GitHub CLI is signed out. Run gh auth login in a terminal and come back. |
| `gh-missing` | Satellite reads pull requests through the GitHub CLI, and it is not installed. |
| `gh-old` | This GitHub CLI is too old to read pull requests. Update it to 2.18 or newer. |
| `offline` | GitHub is out of reach. Satellite tries again when you are back online. |
| `other-host` | This repository's remote is on a host the GitHub CLI is not signed in to. |
| `rate-limited` | GitHub asked Satellite to slow down. Pull requests refresh again in a few minutes. |
| `hung` | The GitHub CLI took too long to answer. Satellite tries again shortly. |
| `failed` | Satellite could not read this pull request. It tries again shortly. |
| conversation unavailable | The conversation could not be read. The overview above is current. |
| loading | Reading the pull request. |

- **State words.** `Open`, `Draft`, `Merged`, `Closed`. **Checks summary.** `No checks`, `1 failed` or `<n> failed`, else `<n> running`, else `All <n> passed`.
- **What blocks it,** each a row in order, only those that apply. `It is a draft.` `It conflicts with <base>.` `GitHub is still working out whether it can merge.` (mergeable unknown on an open one) `A review asks for changes.` `It still needs a review.` `<n> checks failed.` or `1 check failed.` `<n> checks are still running.` or `1 check is still running.` `It is behind <base>.` `A branch rule blocks it.` (merge state `blocked` and no row above) and with no row at all `Nothing blocks it.` A merged one reads `It is merged.` and a closed one `It is closed.` with no other row.
- **Cuts.** `The rest is on GitHub.` after a cut body, `<n> more on GitHub.` after a cut list, `Untitled`, `Unnamed check`, `Someone` for a missing login, `This comment is hidden on GitHub.`
- **Files.** `These are the files in this workspace against <base>.` and when `atHead` is false `This workspace is not at the pull request's last commit, so lines may be off.` When the list answers `no-base`, `Satellite does not have <base> here yet.` with the request below. Thread panel heading `Threads in this file`, the group `Not on a line here`, the badges `Unresolved`, `Resolved`, `Outdated`. `No unresolved threads.` as an info toast when the key finds none.
- **Checks.** A failed check opened with lines shows them in mono, with `empty` `No failing lines came back. Open the check on GitHub.`
- **Buttons.** `Send to Claude Code`, `Open on GitHub` when the address has the pull request's host and `Open check details` otherwise.
- **Link dialog descriptions.** The terminal keeps its sentence. A pull request address reads `This address comes from the pull request. Check it before you open it.`
- **Prepared requests** (`pull-request-requests.ts`, each through `sendToClaudeCode`).
  - `openRequest()` `Open a pull request for this branch.`
  - `checkRequest(number, run, job)` `A check failed on pull request #<number>. Read the log of job <job> in run <run> with gh and fix what it reports.` and without ids `A check failed on pull request #<number>. Run gh pr checks <number> to see which one and fix it.`
  - `threadRequest(number, url)` `A review thread on pull request #<number> needs an answer in the code. Read it with gh at <url> and address it.` and without an address `Review threads on pull request #<number> are unresolved. Read them with gh and address them.`
  - `baseRequest(base)` `Fetch <base> from the remote so Satellite can show this pull request's files.` with `cleanBase(base)`.
  - Conflicts reuse `conflictRequest(base)` from `src/renderer/changes/prompt-requests.ts`.
- **Inbox.** `Checks failed on the pull request.`, `A review asks for changes.`, `The pull request has conflicts.`, and for more than one need `The pull request needs you.`
- **Notification.** Title as today. Body `The pull request needs you in <project>.` and for the main workspace `The pull request in the main workspace needs you.` The many workspaces text stays.
- **Readouts.** Sidebar row `#<number>` with the aria label `Pull request <number>, <state word>, <checks summary>`. Header `#<number> <state word> · <checks summary>`.

### Commands

Ids join `CommandId`. None runs while a dialog is open.

- `pull-request.show` "Show the pull request", available while a workspace is shown and the centre tab is not Pull request.
- `pull-request.open` "Open the pull request on GitHub", available while the shown workspace has a `found` answer. It opens the link dialog.
- `pull-request.next-thread` "Go to the next unresolved thread", shortcut `{ key: "j" }`, available while the shown workspace has a `found` answer. It selects the Pull request tab and its Files section, then the next unresolved thread after the current one in the order of `threadOrder`, wrapping. A thread with a path selects that file and reveals its line when it has a mark. A thread with no path opens Conversation and focuses it.
- `changes.show` and `files.show` become available from the Pull request tab too.

### Test ids

Kept, every existing id.

- `centre-tab-pull-request` with `data-number`, `pull-request` on the view with `data-state` (`found`, `absent`, `unavailable`, `loading`), `pull-request-sentence`, `pull-request-send-open`, `pull-request-stale` on the strip shown above a kept answer.
- `pull-request-title`, `pull-request-state`, `pull-request-branches`, `pull-request-open`, `pull-request-sections` with tabs `pull-request-section-overview`, `-checks`, `-conversation`, `-files`.
- `pull-request-body`, `pull-request-blocks` with rows `pull-request-block-<index>`, `pull-request-conflict-send`, `pull-request-commits` with rows `pull-request-commit-<index>`.
- `pull-request-checks`, rows `pull-request-check-<index>` with `data-result`, `<row>-toggle`, `<row>-lines`, `<row>-send`, `<row>-open`.
- `pull-request-conversation`, items `pull-request-item-<index>` with `data-kind` (`thread`, `review`, `comment`) and `data-resolved`, `<item>-send`, `<item>-open`.
- `pull-request-files`, `pull-request-files-note`, `pull-request-base-send`, `thread-panel`, entries `thread-<index>` with `data-line` and `data-resolved`, `<entry>-send`, `<entry>-open`. The mark has the class `thread-mark`.
- `markdown` on every Markdown root, `markdown-link` on every link button with `data-address`, `markdown-image` on every image replacement.
- Sidebar `<row>-pull-request` with `data-number` and `data-checks` (`failed`, `pending`, `passed`, `none`), header `header-pull-request`.
- Inbox rows keep their ids and gain `data-reason` (`session` or `pull-request`).

### Scenarios, steps and journeys

- **Scenario schema.** A `gh` entry is the existing `{ args, stdout?, stderr?, exitCode? }` or `{ call: "pull-request" | "threads" | "failed-log", json?: unknown, stdout?, stderr?, exitCode?, after?: string }`, with `after` matching `^[a-z][a-z0-9-]{0,40}$`. The stand-in first tries exact `args`. Otherwise it asks `callOf(args)`, and among the entries of that call takes the last one whose `after` marker file exists in the Satellite home, else the first with no `after`. It prints `JSON.stringify(json)` when `json` is set. With no entry, `pull-request` answers `no pull requests found for branch "stand-in"` with exit 1 and the other two exit 1 with empty output. Arguments that start with `pr`, `api` or `run` and are not one of the three calls print `stand-in gh got arguments Satellite must never send` and exit 97. The `start` event in the log gains `cwd` and `call`.
- **New CLI step** `mark=<name>` and `AppSession.mark(name)`, which write an empty file `<name>` into the Satellite home.
- **Fixtures** are hand written, with the logins `ada-example`, `grace-example` and `review-bot`, the repository `example-org/verify-repo` on `github.com`, pull request 12, run `1001` and jobs `2001` and up. No real person, address or token.
- **Every pull request scenario** clones `folders/upstream` as `mixed-changes` does, has the workspace `alpha` with one commit and `{ "git": ["push", "-u", "origin", "HEAD"] }` as its last step, and the light theme.
  - `pr-open` An open pull request with a Markdown description (a heading, a list, a task list, a table, a code block, one link), three commits, four passed checks and one skipped, one approving review, one comment, one resolved thread.
  - `checks-failed` The same with two failed checks (one Actions job with run and job ids and a `failed-log` answer of six lines with two `##[error]` lines, one status on another host), one pending. With `after: "fixed"` every check passes.
  - `changes-requested` A review that requests changes on the head commit and two unresolved threads on `src/app.ts`, one on the new side at a changed line and one outdated, plus one resolved. With `after: "answered"` a newer approving review from the same login.
  - `pr-conflicts` `mergeable` `CONFLICTING`, merge state `DIRTY`. With `after: "updated"` `MERGEABLE` and `CLEAN`.
  - `pr-appears` No pull request entry until `after: "opened"`, then the `pr-open` answer. Its Claude Code stand-in script ends one turn when told, as the `inbox` scenario's does.
  - `hostile-description` A description and one comment that hold a `<script>`, an `<img onerror>`, an `<iframe>`, a `<style>`, a Markdown image on `https://tracker.example.invalid/pixel.png`, a link whose text is one address and whose target is another, `javascript:`, `data:` and `file:` links, a direction override, and 30,000 characters of filler. A title with a direction override, a check named `--repo evil/x`, a check address with `javascript:`, a thread whose address is on another host.
  - `not-signed-in` gains the upstream clone, the pushed workspace `alpha` and a `pull-request` entry with exit 4 and `To get started with GitHub CLI, please run:  gh auth login` on stderr.
- **Journey** `pull-request`, listed right after `inbox`, steps in Task 9. The `boundary` journey gains the refusals in Task 3.

## Review Focus

1. **No argument a stranger chose.** `gh-arguments.ts` is the only builder, `placeOf` and the job pattern are the only doors, and the stand-in's exit 97 proves no other call in every journey.
2. **Hostile text stays text.** No `<img>`, no `href`, no raw HTML, no `dangerouslySetInnerHTML`, nothing from a pull request in a prompt or a notification.
3. **Bounded and paced in the background process.** Every number in Limits is enforced there and repeated in the schema. A page cannot make `gh` run faster.
4. **Nothing stored, nothing written.** No file, no ref, no fetch, no write through `gh`.
5. **A missing or odd field costs that field.** The parser never throws and never lets one bad value fail the tab.
6. **The inbox follows the truth.** A need enters once, notifies once and leaves when the answer changes, and a transient failure never flaps it.

---

### Task 1: The tool runner takes a folder, and `gh` gets a hardened environment

**Files:**
- Modify: `src/main/platform/tools.ts`, `src/main/platform/tools.test.ts`, `specs/008-pull-request/spec.md` and `specs/README.md` (status In progress)

**Interfaces:**
- Consumes: `runTool`, `toolEnvironment`, `gitDroppedKeys`.
- Produces: `runTool(tool, args, { cwd?: string, ... })`, passed to the spawn as its working folder and absent by default so every existing caller is unchanged. `toolEnvironment("gh", env)` per The environment in Exact values. Key matching stays case-insensitive as it is for the existing keys.

- [ ] **Step 1: Tests.** In `tools.test.ts`, replace the `gh` key list assertion and add
  - `gives gh its quiet keys, git's prompt keys and an empty fsmonitor` (the exact set of added keys and values).
  - `drops the keys that could steer gh or its git` with `GH_HOST`, `gh_repo`, `GH_PAGER`, `PAGER`, `GH_BROWSER`, `BROWSER`, `GH_EDITOR`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_PARAMETERS` and an inherited `GIT_CONFIG_COUNT=5` all gone or replaced, and `GH_TOKEN` and `GH_CONFIG_DIR` kept.
  - `runs a tool in the folder it is given` with the test's existing stand-in script pattern printing its working folder.
  - `real gh in a hostile repository starts no program the repository configured`, skipped with `it.skipIf` when no real `gh` resolves. It builds a repository in a temp folder with a marker script on `core.fsmonitor`, `core.pager`, `core.sshCommand`, `credential.helper`, `pager.remote`, `pager.config` and the aliases `remote` and `config`, a remote `https://example.invalid/o/r.git`, runs `runTool("gh", ["pr", "view", "--json", "number"], { cwd })`, and asserts a non-zero exit and no marker file. Then it runs `git status` through the same `gh` environment and asserts no marker, which proves the environment layer by itself. The temp folder is left behind.
- [ ] **Step 2: Implement.** `npx vitest run src/main/platform`, all pass.
- [ ] **Step 3: Status.** Set the spec to In progress in both files.
- [ ] **Step 4: Prove it.** `npm run --silent verify -- default tree` still launches and the tool check still reads signed in. `./scripts/check` green, `npm run journeys` green.
- [ ] **Step 5: Commit.** `feat(platform): run a tool in a folder and harden the gh environment`.

---

### Task 2: The three runs, the parsers, the check table and the needs

Pure code with no process and no bridge.

**Files:**
- Create: `src/main/pull-request/gh-arguments.ts`, `gh-failure.ts`, `pull-request-parse.ts`, `check-result.ts`, `pull-request-needs.ts`, each with a `.test.ts`
- Modify: `src/shared/bridge-contract.ts` (the limits, the schemas and the exported types from Contract, but not the two channels, which Task 3 adds)

**Interfaces:**
- Consumes: `ghHost`, `isBranchName` (`src/shared/workspace-name.ts`), `isChangePath`, `visibleText`, `ToolRun`, `StopReason`.
- Produces: everything in The three runs, Failures and Parsers, with these signatures.
  - `ghFailure(run, stopped): PullRequestTrouble | "none" | "not-pushed"`
  - `parseView(stdout, localHead): { place: PullRequestPlace; found: Omit<PullRequestFound, "detail">; headOid: string | null } | null`
  - `parseThreads(stdout, place): Extract<PullRequestDetail, { kind: "read" }> | null`
  - `failedLines(stdout): { lines: string[]; more: boolean }`
  - `checksOf(raw, place)`, `countsOf(checks)`, `needsOf({ state, counts, mergeable, reviews, headOid })`

- [ ] **Step 1: Tests**, with fixtures written by hand in the test files.
  - `gh-arguments.test.ts` `the view arguments are one constant array`, `the threads arguments carry only a checked host, owner, repository and number`, `placeOf refuses http, user info, a port, a query, a hash, another path, a dot repository, a host outside the pattern and a number of zero`, `callOf names what the builders make and nothing else` (with an extra flag, a `-R` of two parts, a job with a letter, a query that differs by one character, `--hostname` followed by `-oProxyCommand=x`).
  - `gh-failure.test.ts` one case per row of Failures in order, and `a rate limit line that also holds a network word is rate-limited`.
  - `check-result.test.ts` one case per row of the check table, `keeps the newest of two runs with the same workflow and name`, `keeps the newest status per context`, `sorts failed first then pending`, `sets run and job only for an Actions address on the pull request's own host and repository`, `drops an address that is not https or is too long`, `counts before the cut to 100`.
  - `pull-request-needs.test.ts` `a failed check needs you`, `a draft, a merged and a closed pull request never need you`, `requested changes on the head commit need you`, `requested changes on an older commit do not`, `a later approval or dismissal from the same login clears it`, `a later comment from the same login does not`, `conflicts need you`, `cancelled, pending, skipped and unknown checks do not`.
  - `pull-request-parse.test.ts` `reads a full answer`, `a missing field costs only that field` (each top level key removed in turn still answers), `refuses an answer with no number or an address that placeOf refuses`, `cuts a long body, title, headline and list and counts the rest`, `an empty review decision and an unknown merge state are none and unknown`, `drops a commit with a bad oid`, `reads threads with a null line as listed and not placed`, `keeps a thread address only in the rebuilt shape`, `drops a commented review with no body`, `hides a minimized comment`, `answers null for a missing pull request node`, `reduces a log to its error lines`, `falls back to the last 40 lines`, `strips the prefix, the timestamp and terminal escapes`, `never throws on text that is not JSON`.
- [ ] **Step 2: Implement.** `npx vitest run src/main/pull-request`, all pass.
- [ ] **Step 3: Prove it against the real thing, read only.** From a fresh `mktemp -d` run `gh pr list -R cli/cli --limit 1 --json number`, then `gh pr view <number> -R cli/cli --json <viewFields> --jq <viewProjection>` and pipe the output through a one-off `node --input-type=module` line that imports `parseView` and prints only `kind`-level keys and the counts. Report that output. Add no test that needs the network.
- [ ] **Step 4:** `./scripts/check` green.
- [ ] **Step 5: Commit.** `feat(pull-request): the gh runs, their parsers and what needs you`.

---

### Task 3: The two channels, the pacing and the stand-in

**Files:**
- Create: `src/main/pull-request/gh-pace.ts`, `pushed-branch.ts`, `pull-request-reads.ts`, each with a `.test.ts`
- Modify: `src/shared/bridge-contract.ts` (the two channels), `src/main/main.ts`, `src/main/window/quit-settle.ts` and its test, `src/main/bridge/registry.test.ts`, `verify/scenario.ts`, `verify/stand-ins/gh.ts`, `verify/stand-ins/stand-in-log.ts`, `verify/cli.ts`, `verify/driver.ts`, `verify/journeys/boundary.ts`, skill `satellite-verify` (the new entry shape and step)

**Interfaces:**
- Consumes: Tasks 1 and 2, `sessionFolder` (`src/main/sessions/session-folder.ts`), `headOid` and `currentBranch` (`src/main/changes/change-base.ts`), `readGit` and `gitReadMs`, `BridgeFailure`, `BridgeOwner`, `Needing`.
- Produces:
  - `createPace({ now, after, gapMs = 2000, pauseMs = 900_000, waiting = 200 })` with `run<T>(work: () => Promise<T>): Promise<T>` (serial, starts at least `gapMs` apart, throws `BridgeFailure("limit", "Satellite is reading too many pull requests at once. Try again shortly.")` past 200 waiting), `pause()` and `paused(): boolean`.
  - `isPushed(folder, branch, signal): Promise<boolean | undefined>` which is true when `git for-each-ref --format=%(refname) refs/remotes/*/<branch>` prints a line or `branch.<branch>.merge` is set, false for a detached head, `undefined` when git failed. The branch must pass `isBranchName` first.
  - `createPullRequests({ home, store, onNeeding, now?, after? }): PullRequests` with `handlers: Pick<BridgeHandlers, "pullRequest.read" | "pullRequest.log">`, `stopInside(folder): Promise<void>`, `stopAll(): Promise<void>`.
  - `Needing` gains `reason: "session" | "pull-request"` (set to `session` in `terminal-sessions.ts`). `main.ts` keeps the two latest lists and calls `notices.update([...sessions, ...pullRequests])`, sessions first.
- **`pullRequest.read`,** per workspace key, in this order.
  1. `sessionFolder` or `not-found`.
  2. A running read of the same workspace is joined, and a remembered answer younger than 10 s that has detail when detail is asked is answered as is.
  3. A paused pace answers `unavailable` `rate-limited` without a run. A workspace inside its failure hold answers its remembered failure, unless `detail` is true.
  4. Inside `pace.run`. `currentBranch` and `isPushed`. Not pushed answers `absent` `not-pushed` with no `gh`. A git failure answers `unavailable` `failed`.
  5. `runTool("gh", viewArguments(), { cwd: folder, timeoutMs: 20_000, signal })`. A `ToolStopped` or timeout is `hung`. A non-zero exit goes through `ghFailure`. Exit 0 goes through `parseView` with `headOid(folder)`.
  6. When `detail` is true and the view was found, a second `pace.run` with `threadsArguments(place)` and the same options. Its failure fills `detail: { kind: "unavailable", reason }` and never fails the answer, and `rate-limited` from either run calls `pace.pause()`.
  7. Remember `{ answer, at, place, jobs, owner, failures }` and tell `onNeeding`. The list is every remembered workspace whose last found answer has needs. A `found` or `absent` answer replaces the memory. An `unavailable` answer of `offline`, `hung`, `failed` or `rate-limited` keeps the last found answer for needing and counts a failure. Any other trouble clears it.
- **`pullRequest.log`.** The job must be in the remembered `jobs` of that workspace, else `not-found`. Then one `pace.run` with `logArguments(place, job)` and 30 s. Exit 0 with lines is `lines`, with none is `empty`, anything else `unavailable`.
- **Memory.** A `Map` by workspace key that survives a page reload, so a reload raises no second notification. `stopInside` stops running reads in that folder, forgets its workspaces and tells `onNeeding`. `stopAll` stops everything. `QuitParts` gains `pullRequests: { stopAll(): Promise<void> }`, bounded like `changes`.

- [ ] **Step 1: Contract and registry.** Add the channels. `registry.test.ts` gets the two spies and these payloads that must answer `invalid-request` with no handler run, `detail` as a string, a missing `detail`, an extra key `host`, an extra key `url`, a job of `12a`, a job of 21 digits, a job of `-R`, and a workspace of `../main`.
- [ ] **Step 2: Tests.**
  - `gh-pace.test.ts` (fake clock) `runs one at a time and starts two seconds apart`, `refuses the 201st waiting read`, `pauses for fifteen minutes and then runs again`.
  - `pushed-branch.test.ts` (a temp repository with a local bare remote) `a branch with an upstream is pushed`, `a branch pushed without an upstream is pushed`, `a branch with a slash is found`, `a new local branch is not`, `a detached head is not`.
  - `pull-request-reads.test.ts` (a real `ProjectStore` over a temp repository as `changes-handlers.test.ts` does, and `SATELLITE_GH` pointing at a small script written by the test that logs its arguments and working folder and answers from a file) `runs gh from the workspace folder with exactly the view arguments`, `asks for threads only with detail and names the host of the pull request`, `never runs gh for a branch that is not pushed`, `reuses an answer for ten seconds`, `joins two reads of one workspace`, `holds a failed workspace for a minute and doubles it, and detail skips the hold`, `a rate limit pauses every workspace`, `a failed threads run keeps the overview`, `tells needing when checks fail and again when they pass`, `keeps needing through an offline answer and drops it when signed out`, `forgets a workspace when it is archived`, `refuses a log for a job that is not on the pull request`, `answers not-found for a workspace that is not on record`.
- [ ] **Step 3: Stand-in and step.** Per Scenarios, steps and journeys. `verify/scenario.ts` gets a test or extends its existing one, `accepts a call entry with json and after and refuses an after that is not kebab case`.
- [ ] **Step 4: Boundary journey.** With the page's own `invoke`, `pullRequest.read` answers `invalid-request` for an extra key and a missing `detail`, `not-found` for a workspace not on record, and `pullRequest.log` answers `invalid-request` for a job with a letter and `not-found` for job `1` on a workspace with no pull request. The stand-in log holds no `call` of null for `pr`, `api` or `run`.
- [ ] **Step 5: Implement and wire.** `npx vitest run src/main verify`, all pass.
- [ ] **Step 6: Prove it.** `npm run journeys` shows `pass boundary` and every other journey green, `./scripts/check` green.
- [ ] **Step 7: Commit.** `feat(pull-request): pullRequest.read and pullRequest.log, paced in the background process`.

---

### Task 4: Markdown that cannot hurt

**Files:**
- Create: `src/renderer/pull-request/markdown-text.tsx`, `src/renderer/pull-request/markdown-text.test.ts`
- Modify: `package.json`, `package-lock.json`, `src/renderer/sessions/link-dialog.tsx`, `src/renderer/window/app-window.tsx` (the dialog's new prop only)

**Interfaces:**
- Consumes: `react-markdown`, `remark-gfm`, `revealLines`.
- Produces:
  - `MarkdownText({ text, onLink }: { text: string; onLink: (address: string) => void })`. It renders `<Markdown remarkPlugins={[remarkGfm]} skipHtml components={...}>` over `revealLines(text).text`, inside a root with `data-testid="markdown"`. No `rehypePlugins`, no `urlTransform` override, no `allowElement`.
  - Overrides. `a` is a `<button type="button" data-testid="markdown-link" data-address={href}>` styled as a link that calls `onLink(href)` when `URL.parse(href)?.protocol === "https:"`, and plain text of its children otherwise. `img` is the same button with the label `Image` followed by the alt text when the source is `https:`, with `data-testid="markdown-image"`, and the alt text alone otherwise. `input` (task lists) is a `<span aria-hidden>` box drawn checked or not, never an input. `h1` to `h6` render as `h3` to `h6` sized text so the tab keeps one page heading. `pre` and `code` use the mono face and scroll sideways. `table` sits in a sideways scroller. Everything else is the library default restyled with DESIGN tokens.
  - `LinkDialog` takes `description: string`. The terminal passes its current sentence unchanged. `app-window.tsx` holds `asking` as `{ address, description } | null`.

- [ ] **Step 1: Install.** `npm install --save-dev --save-exact react-markdown@10.1.0 remark-gfm@4.0.1`, after `npm view react-markdown version license` and `npm view remark-gfm version license` confirm these are still the latest and MIT. Report a newer version instead of taking it silently.
- [ ] **Step 2: Tests.** `markdown-text.test.ts` renders with `createElement` and `renderToStaticMarkup` from `react-dom/server`.
  - `draws headings, lists, a table, a task list and code` (the output holds the text, a `<table`, no `<input`).
  - `draws no raw HTML` for a source with `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<iframe src=...>`, `<style>`, `<form>`, `<a href=... onclick=...>`, `<svg onload=...>` and an HTML comment. The output holds none of `<script`, `<img`, `<iframe`, `<style`, `<form`, `<svg`, `onerror`, `onclick`, `onload`.
  - `never draws an image element` for `![x](https://tracker.example.invalid/p.png)`, a reference style image and an image inside a link. No `<img`, no `src=`, and one `markdown-image` with that address.
  - `a link is a button with no href` and the output holds no `href=` at all.
  - `a link that is not https is plain text` for `javascript:alert(1)`, `data:text/html,x`, `file:///etc/hosts`, `http://example.invalid`, `vscode://x` and a relative `../x`.
  - `shows the real address of a link whose text is another address` through `data-address`.
  - `reveals a direction override in the source`.
  - `stays bounded on 20,000 characters of nested quotes` finishes inside the default test timeout.
- [ ] **Step 3: Implement.** `npx vitest run src/renderer/pull-request`, all pass.
- [ ] **Step 4: Prove it.** `npm run build`, then `grep -c "^## react-markdown - 10.1.0\|^## remark-gfm - 4.0.1" out/renderer/third-party-licenses.md` prints 2. List the licence of every section the build added and report any that is not MIT, ISC, BSD or Apache-2.0. `npm run --silent verify -- needs-permission` with the steps the `sessions` journey uses to open a terminal link still shows `link-dialog` with the old sentence. `./scripts/check` and `npm run journeys` green.
- [ ] **Step 5: Commit.** `feat(pull-request): Markdown with no HTML, no images and confirmed links`.

---

### Task 5: The tab, the overview and the readouts

**Files:**
- Create: `src/renderer/pull-request/use-pull-requests.ts`, `pull-request-view.tsx`, `pull-request-overview.tsx`, `pull-request-words.ts`, `pull-request-words.test.ts`, `pull-request-requests.ts`, `pull-request-requests.test.ts`, `verify/scenarios/pr-open/scenario.json`
- Modify: `src/renderer/ui/refresh-schedule.ts` and its test, `src/renderer/window/centre-tabs.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/projects/sidebar.tsx`, `src/renderer/projects/workspace-header.tsx`, `verify/scenarios/not-signed-in/scenario.json`

**Interfaces:**
- Consumes: Tasks 3 and 4, `invoke`, `subscribe`, `sendToClaudeCode`, `conflictRequest`, `cleanBase`, `visibleText`, `VisibleName`, `StatusPixel`.
- Produces:
  - `createSchedule(hooks, pace = { firstMs: 2000, maxMs: 30_000, factor: 4 })`, with `pollDelay` and its callers taking the pace. Existing callers pass nothing.
  - `usePullRequests({ listed, shown, detail, finished, finishedElsewhere }): PullRequests`. `listed` is every workspace ref in the sidebar, `shown` the selected ref or null, `detail` true while the Pull request tab shows, `finished` the same string `app-window.tsx` gives `useChanges`. It answers `of(ref): PullRequestEntry | undefined` and `refresh(ref)`. An entry is `{ answer: PullRequestAnswer | null; last: PullRequestFound | null; needsSince: number | null }`. `last` is the newest found answer, kept through `offline`, `hung`, `failed` and `rate-limited` and cleared by every other answer.
  - Refresh, all of it. The shown workspace runs `createSchedule` with `{ firstMs: 30_000, maxMs: 300_000, factor: 4 }`, reading with `detail`, its key the JSON of the answer. `refresh()` on window focus, on a change of `finished`, on `detail` turning true and on a change of `shown`. Every other listed workspace is read with `detail: false` once at start, then every 300,000 ms, one request after another, and at once when a session of that workspace turns `done` (from the `sessions.status` events the window already holds). A workspace that leaves `listed` is forgotten.
  - `CentreView` gains `"pull-request"`. `CentreTabs` takes `pullRequest: number | null` and labels the third tab `Pull request` or `Pull request #<n>`.
  - `PullRequestView({ workspace, entry, section, onSection, onLink, children })` draws the header (title through `visibleText`, the state word, `head` into `base` through `VisibleName`, Open on GitHub), the sections strip, the sentence states, and the strip `pull-request-stale` with the trouble sentence above a kept answer. `absent` shows the sentence and `pull-request-send-open`.
  - `PullRequestOverview` draws the body with `MarkdownText`, the blocks list with `pull-request-conflict-send` on the conflict row, and the commits.
  - `pull-request-words.ts` `troubleSentence(reason)`, `absentSentence(reason)`, `stateWord(state)`, `checksSummary(counts)`, `blocks(found): { key: string; sentence: string }[]`, `readoutLabel(found)`. `pull-request-requests.ts` per Copy.
  - Sidebar `Readouts` and `WorkspaceHeader` take `pullRequest: PullRequestFound | null` and draw the readouts. The header readout is a button that selects the tab. The pixel beside `#<n>` is `needs-you` for failed, `working` for pending, `ready` for passed, `done` for merged and `idle` otherwise.
  - Commands `pull-request.show` and `pull-request.open`.

- [ ] **Step 1: Tests.**
  - `refresh-schedule.test.ts` `takes a pace and keeps the default`.
  - `pull-request-words.test.ts` `has a sentence for every trouble and absence and none holds a colon`, `summarises checks` (none, one failed, three running, all passed), `lists what blocks a pull request in order` (draft, conflicts, unknown, changes requested, review required, failed, running, behind, branch rule, nothing, merged, closed), `labels the readout`.
  - `pull-request-requests.test.ts` `every request holds only digits and fixed words` (a property style loop over hostile check names proving none can appear, since the functions take none), `uses the ids when it has them and the fallback when not`, `keeps a thread address and falls back without one`, `cleans the base`.
- [ ] **Step 2: Scenarios.** Write `pr-open` and extend `not-signed-in`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Prove it in the real window.**
  - `npm run --silent verify -- pr-open click=centre-tab-pull-request wait-for=pull-request-title text=pull-request shot log` shows the title, `Open`, the blocks row `Nothing blocks it.`, three commits, the tab label `Pull request #12`, and a log where every `gh` start for a pull request has `cwd` ending in the workspace folder and `call` `pull-request` or `threads`.
  - `text=sidebar` shows the row readout `#12`. A light and a dark screenshot.
  - `npm run --silent verify -- not-signed-in click=centre-tab-pull-request wait-for=pull-request-sentence text=pull-request` shows the signed out sentence.
  - `npm run --silent verify -- mixed-changes click=centre-tab-pull-request wait-for=pull-request-sentence text=pull-request` shows `No pull request for this branch yet.` or the not pushed sentence, and `click=pull-request-send-open` puts `Open a pull request for this branch.` in the prompt.
- [ ] **Step 5:** `./scripts/check` and `npm run journeys` green. Journeys that assert the centre tabs or the command list follow the new tab and commands.
- [ ] **Step 6: Commit.** `feat(pull-request): the Pull request tab with its overview and readouts`.

---

### Task 6: Checks, with failing lines on request

**Files:**
- Create: `src/renderer/pull-request/checks-list.tsx`, `verify/scenarios/checks-failed/scenario.json`
- Modify: `src/renderer/pull-request/pull-request-view.tsx`, `pull-request-words.ts` and its test

**Interfaces:**
- Consumes: `pullRequest.log`, `checkRequest`, `PullRequestCheck`.
- Produces: `ChecksList({ workspace, found, onLink })`. A row shows the name through `visibleText`, the workflow, a result word (`Failed`, `Running`, `Passed`, `Skipped`, `Cancelled`, `Unknown`) with a pixel and never colour alone, and its open button with the label rule from Copy. A failed row has a toggle (`aria-expanded`) that asks `pullRequest.log` once when it has a job, keeps the answer for that head while the tab lives, and shows the lines in a mono block, the `empty` sentence or the trouble sentence. A failed row with no job shows no toggle. Every failed row has Send to Claude Code with `checkRequest`.

- [ ] **Step 1: Test.** `pull-request-words.test.ts` gains `names every check result`.
- [ ] **Step 2: Scenario** `checks-failed`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Prove it.** `npm run --silent verify -- checks-failed click=centre-tab-pull-request click=pull-request-section-checks click=pull-request-check-0-toggle wait-for=pull-request-check-0-lines text=pull-request-checks click=pull-request-check-0-send text=terminal shot log` shows the two error lines, a log with exactly one `failed-log` call that came after the click and none before it, and the prompt holding `A check failed on pull request #12. Read the log of job 2001 in run 1001 with gh and fix what it reports.` with no check name in it. `click=pull-request-check-0-open` shows the link dialog with the pull request sentence.
- [ ] **Step 5:** `./scripts/check` and `npm run journeys` green.
- [ ] **Step 6: Commit.** `feat(pull-request): checks with their failing lines and a pointer for Claude Code`.

---

### Task 7: Conversation

**Files:**
- Create: `src/renderer/pull-request/conversation-list.tsx`, `src/renderer/pull-request/thread-order.ts`, `thread-order.test.ts`, `verify/scenarios/changes-requested/scenario.json`
- Modify: `src/renderer/pull-request/pull-request-view.tsx`

**Interfaces:**
- Consumes: `MarkdownText`, `threadRequest`, the `detail` of a found answer.
- Produces:
  - `conversationItems(detail): ConversationItem[]`, unresolved threads first, oldest first by their first comment, then reviews and comments together by time, oldest first, then resolved threads. `threadOrder(detail): number[]`, the indexes of unresolved threads sorted by path, then line, with threads that have no path last. Both pure, in `thread-order.ts`.
  - `ConversationList({ found, onLink, onThread })`. A thread shows its path and line as text, the badges, every comment (author through `visibleText` or `Someone`, the time as the contract string cut to its date, the body with `MarkdownText`), Send to Claude Code with `threadRequest` on unresolved ones and its open button when it has an address. A resolved thread is a closed disclosure. `detail` null shows the loading sentence, and `unavailable` shows the conversation sentence.

- [ ] **Step 1: Tests.** `thread-order.test.ts` `puts unresolved threads first and resolved last`, `orders reviews and comments by time and survives a missing time`, `orders the unresolved by path then line`.
- [ ] **Step 2: Scenario** `changes-requested`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Prove it.** `npm run --silent verify -- changes-requested click=centre-tab-pull-request click=pull-request-section-conversation wait-for=pull-request-item-0 text=pull-request-conversation click=pull-request-item-0-send text=terminal shot` shows the two unresolved threads above the review, and the prompt holding `A review thread on pull request #12 needs an answer in the code. Read it with gh at https://github.com/example-org/verify-repo/pull/12#discussion_r3001 and address it.`
- [ ] **Step 5:** `./scripts/check` and `npm run journeys` green.
- [ ] **Step 6: Commit.** `feat(pull-request): the conversation with unresolved threads first`.

---

### Task 8: Files, threads on their lines and the key

**Files:**
- Create: `src/renderer/pull-request/pull-request-files.tsx`, `thread-panel.tsx`, `thread-places.ts`, `thread-places.test.ts`
- Modify: `src/shared/bridge-contract.ts` (the optional `base`), `src/main/changes/changes-handlers.ts`, `src/main/changes/change-base.ts`, their tests, `src/renderer/changes/use-changes.ts`, `src/renderer/changes/file-diff.tsx`, `src/renderer/diff/diff-view.tsx`, `src/renderer/diff/side-view.tsx`, `src/renderer/window/app-window.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/pull-request/pull-request-view.tsx`, `src/main/bridge/registry.test.ts`

**Interfaces:**
- Consumes: `ChangeList`, `FileDiff`, `useChanges`, `threadOrder`, `threadRequest`, `baseRequest`.
- Produces:
  - **Base.** With `base` set and view `branch`, the list's base is `refs/remotes/<remote>/<base>` with the remote the default lookup already picks, the default branch lookup is skipped, and a missing ref answers `no-base`. The page cache key becomes `${projectId}/${workspace}/${view}/${base ?? ""}`. `base` with view `uncommitted` is ignored. `useChanges(workspace, view, finished, path, base?)`. The window's one `useChanges` reads `branch` with the pull request's `base` while the Pull request tab shows, and as today otherwise.
  - `threadPlaces(detail, path): { marks: ThreadMark[]; listed: number[] }` where a mark is `{ line: number; threads: number[]; unresolved: boolean }`. A thread gets a mark when its path equals `path`, it is not outdated, its side is `right` and it has a line. Every other thread of that path is `listed`.
  - `FileDiff`, `DiffView` and `SideView` take `marks?: readonly { line: number; unresolved: boolean }[]` and `onMark?: (line: number) => void`, and `DiffHandle` gains `reveal(line: number)`. With marks the modified editor sets `glyphMargin: true`, draws one decoration per mark with `glyphMarginClassName: "thread-mark"` (and `thread-mark-open` when unresolved, both styled in the editor's stylesheet with a token colour and a shape, not colour alone), calls `onMark` for a mouse down whose target type is `GUTTER_GLYPH_MARGIN`, and `DiffView` sets `hideUnchangedRegions.enabled` to false. `reveal` calls `revealLineInCenter` on the modified editor. Without marks nothing changes for Changes and Files.
  - `PullRequestFiles` draws the note sentences, `ChangeList`, `FileDiff` with the marks of the selected file and `ThreadPanel` beside it. `no-base` shows its sentence and `pull-request-base-send`.
  - `ThreadPanel({ threads, marks, listed, current, onSelect, onLink })` lists the file's threads in line order then `Not on a line here`, each entry a button that reveals its line, with the comments, the badges, Send to Claude Code and the open button as in Conversation. The current thread is marked with `aria-current`.
  - Command `pull-request.next-thread` per Commands, with its state (`current` thread index) held in `app-window.tsx`.

- [ ] **Step 1: Tests.**
  - `thread-places.test.ts` `marks a right side thread on its line`, `groups two threads on one line`, `lists outdated, left side and file level threads without a mark`, `ignores threads of other files`, `a line is unresolved when any thread on it is`.
  - `changes-handlers.test.ts` `reads the branch diff against a named base`, `answers no-base for a base branch with no remote ref`, `keeps the default base when none is named`, `caches a named base apart from the default`.
  - `registry.test.ts` gains `base` payloads that must answer `invalid-request`, `-x`, `a..b`, `refs/heads/x y`, 256 characters and a number.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Prove it.**
  - `npm run --silent verify -- changes-requested click=centre-tab-pull-request click=pull-request-section-files wait-for=thread-panel text=pull-request-files shot` shows `src/app.ts` in the list, one `thread-mark` in the diff, the outdated thread under `Not on a line here`, and the note with the base.
  - The same run with `press=Meta+J` on macOS or `press=Control+Shift+J` elsewhere from the Changes tab lands on the Pull request tab, Files, with `thread-0` holding `aria-current`, and a second press moves to the next and wraps. `click=thread-0-send text=terminal` shows the thread request.
  - `npm run --silent verify -- pr-open click=centre-tab-pull-request press=<the key> wait-text=toast` shows `No unresolved threads.`
  - `npm run --silent verify -- mixed-changes` with the steps of the `changes` journey's first assertions still shows the Branch diff unchanged.
- [ ] **Step 4:** `./scripts/check` and `npm run journeys` green.
- [ ] **Step 5: Commit.** `feat(pull-request): files against the base with threads on their lines`.

---

### Task 9: Needs you, the notification and the journey

**Files:**
- Create: `src/renderer/inbox/need-order.ts`, `verify/journeys/pull-request.ts`, `verify/scenarios/pr-conflicts/scenario.json`, `verify/scenarios/pr-appears/scenario.json`, `verify/scenarios/hostile-description/scenario.json`
- Modify: `src/renderer/inbox/inbox.ts` and its test, `src/renderer/inbox/inbox-list.tsx`, `src/renderer/sessions/use-sessions.ts`, `src/renderer/pull-request/use-pull-requests.ts`, `src/renderer/window/app-window.tsx`, `src/renderer/projects/sidebar.tsx`, `src/main/inbox/notice-text.ts` and its test, `src/main/inbox/notices.ts` and its test only where the reason passes through, `verify/journeys.ts`

**Interfaces:**
- Consumes: Tasks 3 to 8.
- Produces:
  - `nextNeed(): number` in `need-order.ts`, one module counter that `use-sessions.ts` uses in place of its own `asked` ref and that `usePullRequests` calls when an entry's `last.needs` goes from empty to not empty. `needsSince` returns to null when needs are empty or `last` is null.
  - `InboxReason` becomes a union with `{ kind: "pull-request"; workspace; needs: PullRequestNeed[]; since }`. `inboxReasons(tabs, pullRequests)` takes both. `InboxTarget` becomes `{ kind: "session"; workspace; tab; terminalId } | { kind: "pull-request"; workspace }`. `reasonSentence` gains the pull request sentences from Copy. `openFromInbox` selects the workspace and, for a pull request target, the Pull request tab.
  - The sidebar pixel of a workspace is `needs-you` when its sessions say so or its entry has needs. `pixelFor` gets the entry as a second input in `app-window.tsx`, not inside `use-sessions.ts`.
  - `noticeText(subjects, waiting, reason: Needing["reason"] = "session")` with the pull request bodies from Copy for one subject.

- [ ] **Step 1: Tests.**
  - `inbox.test.ts` `a pull request that needs you is a row with its sentence` (one per need and the many needs sentence), `a workspace with a session and a pull request reason is one row led by the older`, `the target of a pull request row is its tab`, `a pull request reason leaves when its needs clear`.
  - `notice-text.test.ts` `a pull request notice says only Satellite's sentence and cleaned names`, `the main workspace has its own sentence`, `several workspaces keep the shared text`.
- [ ] **Step 2: Scenarios** `pr-conflicts`, `pr-appears`, `hostile-description`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: The journey** `pull-request`, each part its own launch, asserting through test ids and the stand-in log.
  1. `pr-open`. The tab label holds `#12` without a click. The row readout and the header readout show. The Pull request tab shows the title and the description's table. No inbox row. Every `gh` event with a call has `cwd` equal to the workspace folder, and no event has exit 97.
  2. `pr-appears`. The tab reads the none sentence and offers the open request. `mark("opened")`, then one stand-in turn ends. Within 15 seconds the tab label holds `#12` and the row readout shows, with no click, focus change or reload.
  3. `checks-failed`. An inbox row for alpha with `data-reason="pull-request"` and `Checks failed on the pull request.` One recorded notice whose body is `The pull request needs you in <project>.` and holds neither `12` nor the title. A click on the row lands on the Pull request tab. `mark("fixed")` and a finished turn, then the row is gone within 15 seconds and the notice closed. A second finished turn raises no second notice.
  4. `changes-requested`. The row reads `A review asks for changes.`, leaves after `mark("answered")` and a finished turn. The Files section shows one mark, and the key moves to the first unresolved thread.
  5. `pr-conflicts`. The row reads `The pull request has conflicts.`, the overview's conflict row sends `conflictRequest`, and the row leaves after `mark("updated")` and a finished turn.
  6. `hostile-description`. Inside `pull-request` the page holds zero `img`, `script`, `iframe`, `style`, `form` and `a[href]` elements, and `document.title` is unchanged. The link whose text is one address opens the link dialog showing the other, real one. The `javascript:` link is not a button. The check named `--repo evil/x` shows as text and no `gh` event holds that string. The body ends with `The rest is on GitHub.`
  7. `not-signed-in`. The signed out sentence, and after 5 seconds the log holds one `pull-request` call for alpha, not more.
- [ ] **Step 5: Prove it.** `npm run journeys` shows `pass pull-request` and every other journey green. After the run, `pgrep -fl Electron` shows no left over test window. `./scripts/check` green.
- [ ] **Step 6: Commit.** `feat(inbox): pull requests that need you, with one notification and a journey`.

---

### Task 10: Docs, skills and status Done

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md` only where it disagrees with what shipped, `DESIGN.md` (the thread mark, the Markdown styles and the pull request readout), `SECURITY.md` if it lists what Satellite runs, `AGENTS.md` only if the map changed, skills `satellite-stack` (the `pull-request` folders, the two channels, the `cwd` option), `satellite-conventions` (hostile Markdown and prepared requests carry pointers only), `satellite-verify` (the scenarios, `mark`, the call entries, exit 97), `specs/008-pull-request/spec.md` and `specs/README.md` (status Done)

- [ ] **Step 1: `ARCHITECTURE.md`.** The parts gain `src/main/pull-request/` and `src/renderer/pull-request/`. The bridge section gains the two channels and the optional `base`. The security boundary gains the pull request rows from the threat table, the `gh` environment, the `ssh -G` finding as a known limit, and the rule that nothing a pull request says reaches an argument, a prompt or a notification. Decisions gain `gh` over REST, page driven refresh paced in the background process, marks over inline zones, and nothing stored. Present tense, no dates, no history.
- [ ] **Step 2: Skills and the other docs,** each only as far as the code made it wrong or incomplete.
- [ ] **Step 3: Status.** Done in the spec and the index.
- [ ] **Step 4: Prove it.** `./scripts/check` green, `npm run journeys` green, `./guards/test.sh` green, and `git diff main --stat` lists no file under `guards/`, `.githooks/` or `.claude/settings.json`.
- [ ] **Step 5: Commit.** `docs: the pull request tab in the architecture, the skills and the index`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| The tab shows the pull request of the branch (`pr-open`) | 3, 5 | Task 5 Step 4, journey part 1 |
| Failed checks show with their failing lines (`checks-failed`) | 2, 6 | `pull-request-parse.test.ts` log cases, Task 6 Step 4 |
| Requested changes and threads show, unresolved first (`changes-requested`) | 2, 7, 8 | `thread-order.test.ts`, Task 7 Step 4, Task 8 Step 3 |
| Each of the three reasons enters and leaves the inbox | 3, 9 | `pull-request-needs.test.ts`, `pull-request-reads.test.ts` needing cases, `inbox.test.ts`, journey parts 3, 4 and 5 |
| A hostile description cannot run script, draw HTML or load an image (`hostile-description`, renderer unit tests) | 4, 9 | `markdown-text.test.ts`, journey part 6 |
| Parsers hold against missing and odd fields | 2 | `pull-request-parse.test.ts`, `check-result.test.ts`, `gh-failure.test.ts` |
| Signed out shows one sentence (`not-signed-in`) | 2, 3, 5 | `gh-failure.test.ts`, Task 5 Step 4, journey part 7 |
| A new pull request appears by itself | 3, 5, 9 | journey part 2 |
| Scope, without a pull request the tab offers to open one | 5 | Task 5 Step 4 on `mixed-changes`, journey part 2 |
| Scope, Overview with title, number, state, branches, description, commits, mergeable and what blocks it | 5 | `pull-request-words.test.ts`, Task 5 Step 4 |
| Scope, Checks with a pointer to the run | 6 | `pull-request-requests.test.ts`, Task 6 Step 4 |
| Scope, Files in the Changes viewer with threads on lines and one key | 8 | `thread-places.test.ts`, `changes-handlers.test.ts`, Task 8 Step 3, journey part 4 |
| Scope, Open on GitHub for the pull request, a check and a comment | 4, 5, 6, 7 | the link dialog runs in Tasks 5 and 6, journey part 6 |
| Scope, the row and the header show number, state and checks | 5 | Task 5 Step 4, journey part 1 |
| Scope, refresh on a finished turn, on focus and on a slow timer | 3, 5 | `gh-pace.test.ts`, `refresh-schedule.test.ts`, journey parts 2 and 3 |
| Security, no `gh` run reaches another host or starts a program a repository chose | 1, 2, 3 | `tools.test.ts` with the real `gh` marker test, `gh-arguments.test.ts`, exit 97 never seen in any journey |
| Security, nothing a pull request says reaches a prompt or a notification | 5, 9 | `pull-request-requests.test.ts`, `notice-text.test.ts`, journey part 3 |
| Nothing about a pull request is stored | 3 | `pull-request-reads.test.ts` holds memory only, What this writes and where |
