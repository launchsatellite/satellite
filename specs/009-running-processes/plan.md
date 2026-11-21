# Running processes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each workspace shows how many long-lived processes its agents started and left running, on its sidebar row and in its header. The header count and one command open a list with the command, the session that started it, how long it has run and any port it listens on. A loopback port opens in the browser after the usual question. Stop ends one process and its children. Satellite never lists or signals a process that does not descend, at that moment, from one of its own sessions.

**Architecture:** The background process reads one process table per tick for every workspace (`ps` on macOS and Linux, one PowerShell CIM query on Windows) in `src/main/platform/process-table.ts`, which also replaces the private lister inside `process-tree.ts`, so there is one reader. A pure rule in a new folder `src/main/processes/` walks from each running session's pty process through parent links and keeps what sits under the agent's command shell, is 10 seconds old and has no listed ancestor. Only when something is listed, one port read (`lsof`, `ss` or a CIM query) finds listeners in those subtrees. Two bridge channels, `processes.list` (no arguments, every workspace of the asking page) and `processes.stop` (a process id and the start time Satellite listed). Stop reads a fresh table, proves the id with that start still sits under a running session, then signals that subtree process by process, never a group. The page polls with the existing schedule only while a session runs and the window is visible, and when a turn ends. Nothing is stored, no new event, no new dependency.

**Tech Stack:** Electron 45.3.4, React 19.3.1, TypeScript 6.0.3, zod 4.6.7, Tailwind 4.3.5, Vitest 5.1.0, playwright-core 1.65.1, vite 8.3.8, node-pty 1.1.0, Node 24 (`.nvmrc`), all read from `package.json`. System tools by absolute path only, `/bin/ps` or `/usr/bin/ps`, `/usr/sbin/lsof` on macOS, `ss` on Linux, Windows PowerShell and `taskkill.exe` under `%SystemRoot%`. No new dependency of any kind.

**Spec:** `specs/009-running-processes/spec.md`

## What this writes and where

- Nothing on disk, in a repository or in the Satellite home. The list lives in memory for one page load and the background process keeps one table for 2 seconds.
- The only effect outside Satellite is the signal Stop sends, `SIGTERM` then `SIGKILL` on macOS and Linux and a forced `taskkill` on Windows, to processes proven to descend from a running session.
- A port link is handed to the existing `links.open` through the existing dialog. Nothing new opens a browser.

## Rulings checked

Checked while planning, by running read-only commands on macOS with throwaway children that the probe ended itself, and against current documentation. Windows and Linux could not be run here, so their shapes are marked unconfirmed and their parsers answer nothing rather than guess.

- **One table, pinned.** `LC_ALL=C TZ=UTC /bin/ps -A -ww -o pid= -o ppid= -o pgid= -o stat= -o lstart= -o command=` printed 515 rows here and every row matched the row pattern in Exact values. `lstart` is five tokens with a space padded day (`Mon Nov  2 08:00:00 2026`). Without the pinned locale the same column prints in the user's language, and without the pinned zone it moves with daylight saving, so both are set. `ps` has no elapsed seconds column on macOS, so age is the read's clock minus the parsed start, which is what `etime` is.
- **`ps` neutralises hostile arguments.** A child started with an argument holding a newline followed by a forged table row printed as one row, the newline as `\012`, a tab as `\011`, an escape as `^[` and non-ASCII bytes in `M-` notation. No forged row appeared. The parser still drops every row of a process id that appears twice, so a system whose `ps` does not escape cannot plant a row.
- **Defunct rows.** A zombie prints `Z` in `stat` and `<defunct>` as its command. It cannot be stopped and would linger, so it is never listed.
- **The shape of a session's tree.** Walking up from a command the agent ran here shows the command's shell (`/bin/zsh -c …`, its own process group) as a direct child of `claude`, and `claude`'s other direct children are its helpers (a language server, a keep-awake tool) in `claude`'s group. Tool commands carry no controlling terminal, so only parent links reach them. Claude Code's setup page says native Windows runs commands through Git Bash when Git for Windows is installed and through PowerShell otherwise, and that every install is a native binary. Hence the rule in Exact values, everything under the first shell below the session's program.
- **Ports on macOS.** `/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -a -p <pids> -F pPnt` printed, per process, `p<pid>` then for each socket `f<fd>`, `tIPv4` or `tIPv6`, `PTCP` and `n<host>:<port>`, with `*` for a wildcard of either family, `127.0.0.1` and `[::1]`. It exits 1 with the data still printed when one of the ids listens on nothing, and exits 1 with no output when none does, so the exit code is ignored and the output is parsed.
- **The address a port opens at.** `new URL("http://127.0.0.1:3000").href` is `http://127.0.0.1:3000/` and `new URL("http://[::1]:3000").href` is `http://[::1]:3000/`, the exact text `checkedLink` in `src/main/terminal/link-check.ts` requires. A numeric loopback address needs no name lookup, so a hosts file or resolver cannot send it elsewhere and there is nothing for DNS rebinding to rebind.
- **Windows table (unconfirmed by run).** `Win32_Process` documents `ProcessId`, `ParentProcessId`, `CreationDate`, `Name` and `CommandLine`, and warns that a parent id may belong to a newer process that reused it, to be told apart by `CreationDate`. So a parent link counts only when the parent did not start after the child, on every system. `wmic` is removed from current Windows and is never used.
- **Windows ports without a script module (unconfirmed by run).** `MSFT_NetTCPConnection` in `Root\StandardCimv2` documents `LocalAddress`, `LocalPort`, `OwningProcess` and `State` with Listen as 2. Reading it through `Get-CimInstance` uses only the binary CIM cmdlets. PowerShell's execution policy page says the default `Restricted` policy on Windows clients blocks module script files, which the `Get-NetTCPConnection` wrapper is, so the plan asks CIM directly and passes no `-ExecutionPolicy` switch.
- **Linux (unconfirmed by run).** The procps `ps` man page documents the same columns, `-ww` and the empty headers. `ss -H -l -t -n -p` is documented, its line shape (`LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=1234,fd=19))`) is not, so the fixture is hand-made and a real read in the unit tests confirms it on the Linux runner. Busybox `ps` has no `lstart`, parses to nothing and lists nothing.
- **Stopping.** `process.kill(pid, signal)` with a positive id reaches one process. A process group is never signalled, because the agent's shell and everything else it started in that call share the listed process's group. Node has no handle that pins a process against id reuse, so every signal follows a table read and matches id plus start time, which leaves only a reuse inside the same second in the milliseconds between read and signal.
- **Guards.** `guards/content.txt` refuses lines that look like real keys and home folder paths. Fixtures use `/srv/…` and `C:\Tools\…`, and tests build token shaped strings at run time (`"t".repeat(40)`), never as literals.

## Open calls decided here

| Decision | Why | Cost if wrong |
| --- | --- | --- |
| No new dependency, the existing tree code is extended and has one table reader | Every package shells out to the same commands and loses the start time or the command | A parser bug also touches session teardown, which the existing tree test covers |
| A process is listed when it sits under the first shell below a running session's program, is 10 seconds old, is not defunct and has no listed ancestor | The first shell is the agent's command shell. What sits beside it is the program's own helpers | A helper started through a shell is listed and can be stopped. A long loop written in the agent's own shell is not listed |
| The first shell at any depth, not only a direct child of the root (changed from the research) | A launcher above the program, such as a wrapper script or a `.cmd` shim, would otherwise hide everything | Same as above, nothing more |
| A shell is told by its name, `sh bash zsh dash fish ksh cmd powershell pwsh` | The group and terminal differ per system, the name is the one thing all three share | An agent shell with another name lists nothing for that session |
| Detached processes are not found, and the list says so | Nothing in an unprivileged table joins them back | A daemonised server keeps running unseen, as it already does when a session ends |
| Stop sends `SIGTERM`, waits up to 2 seconds, then `SIGKILL` to what is left, each matched by id and start time | Dev servers shut down cleanly on `SIGTERM` | A process that needs longer is killed |
| On Windows Stop is `taskkill /F` with one `/PID` per process of the checked subtree and no `/T` (changed from a forced tree kill) | `/T` walks parent ids itself and could follow a reused one | A child started in the instant after the read survives its parent |
| No question before Stop | The list is opened on purpose, the button says Stop and the agent can start it again | A misclick ends a dev server |
| The row count is a readout and the header count is the button, plus the command Show running processes | A workspace row is one button, so nothing inside it can be pressed, exactly like the pull request readout | Opening the list takes selecting the workspace first |
| The list is the kit's dialog, not a new popover or a fourth centre tab | It exists with focus handling and tests, the list is short and opened briefly | The window behind is dimmed while the list is open |
| A port link closes the list and opens the existing link dialog | Two dialogs cannot both hold the keyboard | The user reopens the list after opening a port |
| Windows ports come from the CIM class directly, with no `-ExecutionPolicy` switch (changed from the research's cmdlet) | The cmdlet is a script module the default policy blocks, and a bypass switch is one more thing to defend | A Windows without that class shows no ports |
| The table has no elapsed column and gains `stat` (changed from the research) | Age is the read's clock minus the start, and `stat` tells a defunct row | None |
| Ports are read in a second run only when something is listed, on Windows too | No listed process means no extra process start | A second PowerShell start per tick on Windows while something is listed |
| The table is read with `LC_ALL=C` | The start column must parse the same everywhere | Non-ASCII in a command reads as `M-` notation on macOS |
| The command is cut to 200 characters after best-effort hiding, from the first 1000 characters only | The row is a hint, and bounded work per row | A secret in an unusual shape shows. A long harmless word is hidden |
| At most 4 ports per row and 200 rows per answer | Bounds for the schema | A fifth port is not shown. Rows past 200 are counted in one sentence |
| Only the asking page's sessions are listed and stoppable | Every terminal channel already belongs to its page | None with one window |
| The session root is trusted only when its start is no later than 2 seconds after Satellite spawned it | Closes a reused root id between a session's exit and the next read | A clock that jumps back by more than 2 seconds hides that session's list until it restarts |
| Age shows as of the last read, not ticking | The list refreshes every 10 to 30 seconds and on a turn's end | An age is up to 30 seconds stale |
| Refresh starts at 10 seconds and backs off to 30, only while a session runs and the window is visible, plus a turn ending, a session starting or ending and the window becoming visible | The controller's numbers, on the existing schedule | A process shows up to 30 seconds late |
| Windows and Linux are proven by unit tests on hand-made tables, by a real read in the unit tests and by the journey in the three-system run | They cannot be run here | A wrong shape shows nothing for that field until fixed, never a wrong process |

## Exact values

### Numbers

- `minimumAgeMs = 10_000` and `rootSlackMs = 2000` in `src/main/processes/listed-processes.ts`.
- `psTimeoutMs = 1000` (the value `listTimeoutMs` has now), `windowsReadTimeoutMs = 5000`, output limit 16 MiB, in `process-table.ts`. `portsTimeoutMs = 3000` and at most `portPids = 500` process ids per port read, in `listening-ports.ts`.
- `forceKillGraceMs = 2000` (existing), `termCheckMs = 300`, `subtreeStopBoundMs = forceKillGraceMs + 3 * psTimeoutMs`, in `process-tree.ts`.
- `tableReuseMs = 2000` in `processes-handlers.ts`.
- `commandWindow = 1000` and the cut at `processesLimits.commandChars` in `command-text.ts`.
- Page pace `{ firstMs: 10_000, maxMs: 30_000, factor: 4 }` in `use-processes.ts`.
- In `src/shared/bridge-contract.ts`, `export const processesLimits = { rows: 200, ports: 4, commandChars: 200 };`.

### Commands, columns and environment

- **macOS and Linux table.** The first that exists of `/bin/ps` and `/usr/bin/ps`, arguments `["-A", "-ww", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "stat=", "-o", "lstart=", "-o", "command="]`, environment exactly `{ LC_ALL: "C", TZ: "UTC" }`, `encoding: "utf8"`, timeout `psTimeoutMs`. Neither file, an error or a timeout answers `[]`.
- **Windows table.** `join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")` with `["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsTableScript]`, `windowsHide: true`, timeout `windowsReadTimeoutMs`, and the child's stdin ended right after the start. The script is one line.
  ```
  $ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);ConvertTo-Json -Compress -InputObject @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,CommandLine|ForEach-Object{[pscustomobject]@{p=[int64]$_.ProcessId;pp=[int64]$_.ParentProcessId;s=$(if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{$null});n=$_.Name;c=$_.CommandLine}})
  ```
- **macOS ports.** `/usr/sbin/lsof` with `["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pids.join(","), "-F", "pPnt"]`, environment `{ LC_ALL: "C" }`, timeout `portsTimeoutMs`. The exit code is ignored, a timeout or a missing file answers `[]`.
- **Linux ports.** The first that exists of `/usr/bin/ss`, `/usr/sbin/ss`, `/sbin/ss` and `/bin/ss` with `["-H", "-l", "-t", "-n", "-p"]`, same environment and timeout, the answer filtered to the asked ids.
- **Windows ports.** The same PowerShell and switches with this script, filtered to the asked ids.
  ```
  $ErrorActionPreference='Stop';ConvertTo-Json -Compress -InputObject @(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Filter 'State = 2' -Property LocalAddress,LocalPort,OwningProcess|ForEach-Object{[pscustomobject]@{a=$_.LocalAddress;p=[int]$_.LocalPort;o=[int64]$_.OwningProcess}})
  ```
- Any other system reads no table and no ports.

### What the parsers accept

`ProcessEntry` is `{ pid, parent, group, identity, started, defunct, name, command }`. `started` is milliseconds since the epoch or `null`, `identity` is `"<pid> <start>"` and is what teardown already matches on, `name` is the lower-case program name used only to tell a shell.

- **`parsePsTable(text)`.** Split on `\n`. A row must match `/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}) +(\w{3}) +(\d{1,2}) +(\d\d):(\d\d):(\d\d) +(\d{4})(?: +(.*))?$/`, anything else is skipped. `pid` must be a safe integer above 0. `started` is `Date.UTC(year, month, day, hour, minute, second)` with the month from `Jan` to `Dec`, and `null` when the month is unknown (the row is kept, so teardown still sees it). `identity` is the id, a space and the five start tokens joined by single spaces. `defunct` is `stat` starting with `Z`. `command` is the rest with trailing whitespace removed, or `""`. `name` is the command up to its first space, after its last `/`, without a leading `-`, lower-case. After the loop every row whose id appears more than once is dropped.
- **`parseWindowsTable(text)`.** `JSON.parse` inside a try, then a zod schema that accepts one object or an array of `{ p: int ≥ 0, pp: int ≥ 0, s: int | null, n: string | null, c: string | null }` with unknown keys ignored. Anything else answers `[]`. Rows with `p` of 0 are dropped. `started` is `s`, `identity` is `"<p> <s>"`, `group` is 0, `defunct` is false, `command` is `c ?? n ?? ""`, `name` is `n` lower-case without a trailing `.exe`, or `""`. Duplicate ids are dropped as above.
- **`subtreeOf(root, entries)`.** `root` first, then every entry reachable through links where the child's `parent` equals the parent's `pid`, both have a start and the parent's start is not after the child's. Each id once, so a loop ends.
- **`parseLsof(text)`.** Line by line. `p<digits>` sets the process, `f…` clears the family, `tIPv4` and `tIPv6` set it, `n<host>:<port>` split at the last `:` adds a port. A `*` host is `0.0.0.0` for IPv4 and `::` for IPv6 and is skipped with no family.
- **`parseSs(text)`.** Per line, split on whitespace, the first token must be `LISTEN`, the fourth is `<host>:<port>` split at the last `:`, a `*` host is `::`, and every `,pid=<digits>,fd=<digits>)` later in the line adds a port for that process.
- **`parseWindowsPorts(text)`.** One object or an array of `{ a: string, p: int, o: int }`, anything else `[]`.
- All three strip `[` and `]` and a `%zone` suffix from the host, need `net.isIP(host) !== 0` and a port from 1 to 65535, and answer `{ pid, host, port }`.

### Fixtures

`src/main/platform/process-fixtures.ts` exports these as template strings, exactly. They are hand-made. `fixtureNow` is `Date.UTC(2026, 10, 21, 10, 10, 0)`.

`psMacos`, where 4100 is a session's program.

```
    1     0     1 Ss   Mon Nov  2 08:00:00 2026     /sbin/launchd
  900     1   900 Ss   Sat Nov 21 09:00:00 2026     /Applications/Satellite.app/Contents/MacOS/Satellite
 4100   900  4100 Ss+  Sat Nov 21 10:00:00 2026     claude --session-id 11111111-1111-4111-8111-111111111111
 4110  4100  4100 S+   Sat Nov 21 10:00:02 2026     node /srv/tools/language-server --stdio
 4111  4110  4100 S+   Sat Nov 21 10:00:03 2026     node /srv/tools/language-worker
 4200  4100  4200 Ss   Sat Nov 21 10:05:00 2026     /bin/zsh -c source /srv/snapshot.sh && eval 'npm run dev'
 4201  4200  4200 S    Sat Nov 21 10:05:01 2026     npm run dev
 4202  4201  4200 S    Sat Nov 21 10:05:02 2026     sh -c vite --port 5173
 4203  4202  4200 S    Sat Nov 21 10:05:02 2026     node /srv/app/node_modules/.bin/vite --port 5173
 4300  4100  4300 Ss   Sat Nov 21 10:09:55 2026     /bin/zsh -c git status
 4301  4300  4300 R    Sat Nov 21 10:09:56 2026     git status
 4400  4100  4400 Ss   Sat Nov 21 10:06:00 2026     /bin/zsh -c node /srv/app/worker.js one\012two
 4401  4400  4400 Z    Sat Nov 21 10:06:01 2026     <defunct>
 4402  4400  4400 S    Sat Nov 21 10:06:01 2026     node /srv/app/worker.js one\012two
 5000     1  5000 S    Sat Nov 21 09:30:00 2026     node /srv/other/server.js
 5001   900   900 S    Sat Nov 21 10:07:00 2026     /bin/ps -A -ww -o pid= -o ppid= -o pgid= -o stat= -o lstart= -o command=
```

`psLinux`.

```
      1       0       1 Ss   Mon Nov  2 08:00:00 2026 /sbin/init
      2       0       0 S    Mon Nov  2 08:00:00 2026 [kthreadd]
   2100    1900    2100 Ssl+ Sat Nov 21 10:00:00 2026 claude
   2200    2100    2200 Ss   Sat Nov 21 10:05:00 2026 /bin/bash -c pnpm dev
   2201    2200    2200 Sl   Sat Nov 21 10:05:01 2026 node /srv/app/node_modules/.bin/pnpm dev
   2202    2201    2200 Z    Sat Nov 21 10:05:02 2026 [sh] <defunct>
```

`psBusybox`.

```
PID   USER     TIME  COMMAND
    1 root      0:00 /sbin/init
   12 root      0:00 node /srv/app/server.js
```

`tableWindows`, one line of JSON, where 3300 names a parent that started after it.

```
[{"p":0,"pp":0,"s":null,"n":"System Idle Process","c":null},{"p":4,"pp":0,"s":1793606400000,"n":"System","c":null},{"p":3100,"pp":2900,"s":1795255200000,"n":"claude.exe","c":"C:\\Tools\\claude.exe --session-id 11111111-1111-4111-8111-111111111111"},{"p":3200,"pp":3100,"s":1795255500000,"n":"bash.exe","c":"\"C:\\Program Files\\Git\\bin\\bash.exe\" -c \"npm run dev\""},{"p":3201,"pp":3200,"s":1795255501000,"n":"node.exe","c":"node C:\\srv\\app\\server.js --port 3000"},{"p":3300,"pp":3201,"s":1795251600000,"n":"notepad.exe","c":null}]
```

`lsofMacos`, the lines `p4203`, `f12`, `tIPv6`, `PTCP`, `n*:5173`, `f13`, `tIPv4`, `PTCP`, `n127.0.0.1:9229`, `f14`, `tIPv6`, `PTCP`, `n[::1]:9230`, `p4402`, `f9`, `tIPv4`, `PTCP`, `n192.168.1.20:8080`, `f10`, `tIPv4`, `PTCP`, `n*:8081`.

`ssLinux`.

```
LISTEN 0      511        127.0.0.1:3000       0.0.0.0:*    users:(("node",pid=2201,fd=19))
LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*
LISTEN 0      511                *:5173             *:*    users:(("node",pid=2201,fd=21),("node",pid=2203,fd=21))
LISTEN 0      128             [::]:8080          [::]:*    users:(("python3",pid=2300,fd=3))
LISTEN 0      128    [fe80::1%eth0]:9000         [::]:*    users:(("node",pid=2201,fd=22))
```

`portsWindows`, `[{"a":"0.0.0.0","p":3000,"o":3201},{"a":"::","p":3000,"o":3201},{"a":"192.168.1.20","p":8080,"o":3201},{"a":"::1","p":9229,"o":3201}]`.

### The listing rule

Pure, in `listed-processes.ts`, over one table, the running session roots and the read's clock.

1. A root is `{ session, workspace, pid, spawnedAt }`. Its entry must exist with a start that is not `null` and not after `spawnedAt + rootSlackMs`, otherwise the session lists nothing.
2. Walk down from the root entry through the links `subtreeOf` accepts, each process once across all roots. A process is **owned** when at least one shell stands strictly between the root and it (the root itself never counts as that shell, and the first shell is not owned), and it is not defunct. A shell is a `name` in `sh bash zsh dash fish ksh cmd powershell pwsh`.
3. An owned process is **listed** when `now - started >= minimumAgeMs` and no ancestor of it is listed.
4. Rows sort by project id, workspace, start and id.

With `psMacos`, root 4100 spawned at its start and `fixtureNow`, the listed ids are 4201 and 4402. 4100 is the program, 4110 and 4111 are helpers, 4200, 4300 and 4400 are the agent's shells, 4301 is 4 seconds old, 4401 is defunct, 4202 and 4203 sit under 4201, 5000 detached, 900 and 5001 are not descendants.

### Stop

`processes.stop` takes `{ pid, started }`. One stop runs at a time.

1. Read a fresh table, never the reused one. An empty table refuses.
2. `ownedProcess(table, the asking page's roots, pid, started)` finds the entry with that id and exactly that start and requires it to be owned by rule 2 above under one of the asking page's running sessions. The age does not matter. Otherwise refuse and signal nothing.
3. `endSubtree(entry, table)`. On macOS and Linux the subtree is `subtreeOf(entry, table)`, each gets `SIGTERM` by its own positive id, never an id of 1 or less and never Satellite's own. After `termCheckMs` a new table is read and the stop is over when no identity of the subtree is left. Otherwise it waits out `forceKillGraceMs` from the first signal, reads again and sends `SIGKILL` to every entry whose identity is still there and to what those started since. On Windows it runs `taskkill.exe /F /PID <id>` with one `/PID` pair per subtree process, no `/T`, bounded by the existing `taskkillTimeoutMs`.
4. The reused table is dropped, so the page's next list is fresh.

### Ports and the address rule

Ports are asked for every process in every listed subtree, at most `portPids`. A row's ports are the listeners whose process is in its subtree, grouped by port number, lowest first, at most `processesLimits.ports`. `portUrl(hosts, port)` in `port-address.ts` decides the link from all hosts bound on that port in that row.

| A bound host is | Link |
| --- | --- |
| IPv4 with a first octet of 127, or `0.0.0.0`, or either of those written as `::ffff:<IPv4>` | `http://127.0.0.1:<port>/` |
| otherwise `::1` or `::` | `http://[::1]:<port>/` |
| anything else, or nothing `net.isIP` accepts | `null`, the port shows as text |

The first row that matches any host wins. The background process builds the address from a constant host and the parsed number, the contract accepts only those two shapes, and the page passes it unchanged to the existing link dialog and `links.open`.

### The command text

`shownCommand(raw)` in `command-text.ts` answers `{ text, cut }`.

1. Take the first `commandWindow` characters. When that cut something, drop the trailing partial word.
2. Split on whitespace into words. In every word replace `/([a-z][a-z0-9+.-]*:\/\/)[^\/@\s]+@/gi` with `$1***@`. A word matching `/^(-{0,2}[^=\s]*(?:token|secret|password|passwd|pwd|key|auth|credential|cookie|bearer)[^=\s]*=)(.+)$/i` becomes `$1***`. A word matching `/^-{1,2}[^=\s]*(?:token|secret|password|passwd|pwd|key|auth|credential|cookie|bearer)[^=\s]*$/i`, or equal to `bearer` or `basic` in any case, turns the next word into `***` unless that word starts with `-`. Then every run of 32 or more characters of `[A-Za-z0-9_+=-]` in a word becomes `***`.
3. Join with single spaces. Longer than `processesLimits.commandChars` is cut there, one character earlier when the cut would split a surrogate pair, with `cut` true.

It is a courtesy, not a boundary. The full command and the environment never cross the bridge. The page draws `visibleText(command)` as text, with `…` after it when `cut`.

### Contract

In `src/shared/bridge-contract.ts`, placed after `terminalId` is declared.

```ts
export type ProcessRow = z.output<typeof processRow>;
export type ProcessesList = BridgeResponse<"processes.list">;

const processId = z.int().min(2).max(4_294_967_295);
const processStart = z.int().min(1).max(8_640_000_000_000_000);
const loopbackAddress = z.string().regex(/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/$/);
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
```

Added to `bridgeRequests`.

```ts
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
```

`at` is the read's clock, so an age is `at - started`. `session` is the terminal id the page chose in `terminal.start`. A listed process with an id of 1 or a start of `null` cannot exist by the rule, and a row the schema would refuse is left out rather than sent.

### Background failures

`BridgeFailure` from `processes-handlers.ts`.

- No entry with that id and start, `not-found`, `That process already ended.`
- An entry no running session of this page owns, `refused`, `Satellite only stops processes that its own sessions started.`
- A stop already running, `limit`, `Satellite is already stopping a process. Try again in a moment.`
- The fresh table is empty, `failed`, `Satellite couldn't read the running processes, so it stopped nothing.`
- `processes.list` never fails for an unreadable table or port read. It answers no rows, or rows without ports.

### Threat model

Recorded in `ARCHITECTURE.md` in Task 6.

| Threat | Defence | Proof |
| --- | --- | --- |
| A compromised page asks to stop any process id | The request is two integers. The background process finds that id with that start in a table it reads now and requires it to be owned under a running session of that page, so the root, its helpers, the agent's shell, Satellite itself and every stranger are refused | `listed-processes.test.ts` `refuses the root, a helper, the agent's shell, a detached process and a stranger`, `processes-handlers.test.ts` `refuses an id that left the table…`, `registry.test.ts`, the `processes` journey's forged requests |
| A process id reused after it was listed | Id plus start time, read fresh before the first signal and again before the kill | `refuses a right id with another start time`, `stops a listed process from a fresh table and never the cached one` |
| A parent id reused, or a session's root id reused | A link needs a parent that did not start after the child, and a root that did not start after Satellite spawned it | `drops a link to a parent that started after its child`, `ignores a root that started after Satellite spawned the session` |
| A hostile process name or command line forges a row or draws markup | `-ww` with `ps`' own escaping, the strict row pattern, duplicate ids dropped, JSON on Windows, then the hidden and cut text through `visibleText`, drawn as text | `parses the macOS table with a padded day, a defunct row and an escaped newline`, `drops every row of a process id that appears twice`, the journey reading the row |
| A secret on a command line | Best-effort hiding before the cut, and only 200 characters ever cross | `command-text.test.ts` |
| A port that is not a web server, or a hostile listener | Only a click opens it, through the existing dialog that shows the full address, only `http` to a numeric loopback address built by the background process, one open a second | `port-address.test.ts`, the journey's recorded link |
| A hostile process name inside `ss` output moves a port to another row | The owner must match `,pid=<digits>,fd=<digits>)`, and a mislabelled port still opens only loopback after the question | `reads ss lines, with a zone, a star, brackets and two owners` |
| A page floods `processes.list` or `processes.stop` | One table per 2 seconds shared by every caller, one stop at a time | `reads the table once for callers that overlap…`, `refuses a second stop while one runs` |

What a hostile page gains from the two channels is the cut command text of its own sessions' processes and the power to end them, both of which it already has by typing into `terminal.write`.

### Copy

Every sentence on screen. No colons in prose.

- Count, `1 running process` and `<n> running processes`, the accessible name and tooltip of the header button and a part of the row's hidden sentence.
- Command `Show running processes`.
- Dialog title `Running processes`, description `What the agents in <workspace label> started and left running.`, footer button `Done`.
- Empty `Nothing is running here.`
- Under the list, always, `A process that detached from the session that started it keeps running and isn't listed here.`
- `1 more process is not listed.` and `<n> more processes are not listed.`
- Row. The command, then `Session <n>` (or `A session` when the page has no tab for it), the age and the ports. Age readout `45S`, `12M`, `3H 05M`, `2D 4H`, with the hidden words `running for 45 seconds`, `1 minute`, `12 minutes`, `3 hours 5 minutes`, `2 days 4 hours`.
- A port with a link reads `:5173`, named `Open port 5173 in your browser`. A port without one reads `:8080`, with the tooltip and name `Port 8080 is bound to another address, so Satellite doesn't open it`.
- `Stop`, and `Stopping…` while it runs.
- Link dialog description `A process an agent started in this workspace listens on this port. Check the address before you open it.`

### The surface

- **Sidebar row.** In `Readouts`, after the pull request readout, a span with the `running` icon at 12 and the count, in the same Geist Pixel style, test id `<row>-processes`, only above 0.
- **Header.** Before the pull request button, a button like it (`h-6`, `rounded-[6px]`, `px-[7px]`, Geist Pixel 12px `dim`, hover and focus ring as that button), the `running` icon at 13 and the count, test id `header-processes` with `data-count`, only above 0.
- **Icon.** `running` in `src/renderer/ui/icon.tsx`, `<path d="M5.5 3.5v9l7-4.5z" />`.
- **Dialog.** The kit `Dialog`, `closable`, test id `processes-dialog`. Rows `process-row-<index>` with `data-pid`, each a column of the command (`<row>-command`, Geist Mono 12px `fg`, `break-all`) and a line in `dim` 12px holding `<row>-session`, `<row>-age` (Geist Pixel, with the words in `sr-only`) and ports `<row>-port-<port>` with `data-link` `true` or `false` (a link port is a button in Geist Pixel with the hover of a ghost button, a plain one a span), and at the right `<row>-stop`, a small `danger` button. Rows are separated by a `line` border. Then `processes-more`, `processes-empty` and `processes-note` in `dim` 12px. Footer `processes-close`, a primary button with focus.
- **Command.** `processes.show`, available while a workspace is selected, its folder is present and the tool check card is closed. It closes the palette and opens the dialog. The dialog counts as modal, so no command runs under it.

### Scenario, steps and journey

- Stand-in step `{ "child": "dev-server" }`. The stand-in starts a command shell as its direct child, which runs `verify/stand-ins/dev-server.ts` with the same Node and stays its parent. On Windows `spawn(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", "\"\"<node>\" \"<script>\"\""], { stdio: "ignore", windowsVerbatimArguments: true })`, elsewhere `spawn("/bin/sh", ["-c", "\"$0\" \"$1\"; exit $?", <node>, <script>], { stdio: "ignore" })`.
- `dev-server.ts` listens on `127.0.0.1` port 0, starts one child of its own (`process.execPath` with `-e` and a one second interval, `stdio: "ignore"`), then appends the stand-in event `{ type: "server", pid, port, child }`. It handles no signal.
- Scenario `verify/scenarios/dev-server/scenario.json`, the `flood` scenario's repo, home, gh and version, described as a fresh repo whose stand-in Claude Code starts a dev server on a port the system chose, with a child of its own, and ends a turn at each Enter. Script, `print` `Claude Code stand-in\r\n`, `child` `dev-server`, `print` `> `, then three times `await` `\r`, `hook` `UserPromptSubmit`, `hook` `Stop`, `print` `\r\nReady.\r\n> `.
- CLI step `links`, the addresses `links.open` would have opened, from `session.openedLinks()`.
- Journey `processes`, scenario `dev-server`, listed right after `sessions`.

## Review Focus

1. **Nothing is signalled that is not owned.** Stop reads its own table, matches id and start, walks only checked links to a running root of the asking page, never signals a group, an id of 1 or less or Satellite itself, and checks identity again before the kill.
2. **A wrong shape shows nothing.** Every parser skips what it cannot read, duplicate ids are dropped, and no field is guessed.
3. **Only loopback, only through the question.** The address is built from a constant host and a parsed number, and the page never builds or edits it.
4. **Untrusted text stays text and stays short.** Hidden, cut, bounded by the schema, drawn through `visibleText`.
5. **Bounded and quiet.** One table per tick for everyone, ports only when something is listed, no read while no session runs or the window is hidden, absolute tool paths, argument arrays, timeouts on every run.
6. **Teardown still works.** `endUnixTree` and `endWindowsTree` behave as before on the new reader.

---

### Task 1: The process table and ending a subtree

One table reader for every system with its parsers and fixtures, the subtree stop, and the pty's process id. The spec goes In progress.

**Files:**
- Create: `src/main/platform/process-table.ts`, `src/main/platform/process-table.test.ts`, `src/main/platform/process-fixtures.ts`
- Modify: `src/main/platform/process-tree.ts`, `src/main/platform/process-tree.test.ts`, `src/main/platform/pty.ts`, `specs/009-running-processes/spec.md`, `specs/README.md`

**Interfaces:**
- Produces:
  ```ts
  // process-table.ts
  export interface ProcessEntry {
    readonly pid: number;
    readonly parent: number;
    readonly group: number;
    readonly identity: string;
    readonly started: number | null;
    readonly defunct: boolean;
    readonly name: string;
    readonly command: string;
  }
  export const psTimeoutMs = 1000;
  export function parsePsTable(text: string): ProcessEntry[];
  export function parseWindowsTable(text: string): ProcessEntry[];
  export function subtreeOf(root: ProcessEntry, entries: readonly ProcessEntry[]): ProcessEntry[];
  export function readProcessTable(): Promise<ProcessEntry[]>;
  // process-tree.ts
  export const subtreeStopBoundMs: number;
  export function endSubtree(target: ProcessEntry, table: readonly ProcessEntry[]): Promise<void>;
  // pty.ts
  interface PtyProcess { readonly pid: number }
  ```
- Commands, columns, environment, the parsers and the fixtures are in Exact values, under Commands, What the parsers accept and Fixtures. The stop sequence is step 3 of Stop.
- `process-tree.ts` drops its private `ProcessEntry`, `listProcesses`, `psPaths`, `processLine` and `listTimeoutMs` and uses `readProcessTable` and `psTimeoutMs`. `treeKillBoundMs`, `endUnixTree`, `endWindowsTree`, `signal`, the raw `withDescendants` and `survivors` keep their behaviour. `endSubtree` skips, in both of its loops and in the Windows id list, an entry whose id is 1 or less or equals `process.pid`.

- [ ] **Step 1: Status.** In `specs/009-running-processes/spec.md` the status line reads `Status **In progress** · Depends on **004**`, and the 009 row of the index in `specs/README.md` reads `In progress`.
- [ ] **Step 2: Fixtures.** Write `process-fixtures.ts` exactly as in Exact values (this task needs `psMacos`, `psLinux`, `psBusybox`, `tableWindows` and `fixtureNow`, write all seven so later tasks only import).
- [ ] **Step 3: Tests**, each seen failing first.
  - `process-table.test.ts`
    - `parses the macOS table with a padded day, a defunct row and an escaped newline`, 16 entries, id 1 started `Date.UTC(2026, 10, 2, 8, 0, 0)`, 4401 defunct, 4402's command ending `one\012two` as those eight characters.
    - `parses the Linux table with kernel threads and a defunct row`.
    - `answers nothing for a busybox table`.
    - `keeps a row whose start it cannot read with no start time`, a row with the month `Foo`.
    - `drops every row of a process id that appears twice`.
    - `reads the shell name from a path, a login shell and a Windows executable`, `/bin/zsh -c x` is `zsh`, `-zsh` is `zsh`, `bash.exe` is `bash`.
    - `parses the Windows table, one object or many, and a process with no command line or start`, the idle process dropped, 3300's command `notepad.exe`.
    - `answers nothing for Windows output that is not the expected JSON`, an empty string, `not json` and `{"p":"1"}`.
    - `walks a subtree once through links whose parent is not newer than the child`, 4201 gives 4201, 4202 and 4203, the Windows 3201 does not reach 3300, and a hand-made loop ends.
    - `reads a child of this test from the real table`, on every system, a `process.execPath -e` child with a marker argument, found with `parent` this process, a start within 5 seconds of now and the marker in its command. The child is ended in a `finally`.
  - `process-tree.test.ts`, inside `describe.skipIf(process.platform === "win32")`
    - `ends a process and its child and leaves its parent and its sibling running`, real Node children that print their child's id, `endSubtree` given the entry and a table from `readProcessTable`.
    - `kills a child that ignores SIGTERM once the grace is over`.
    - The two existing tests pass unchanged. Every started process is killed in a `finally`.
- [ ] **Step 4: Implement** per the interfaces. `PtyProcess` exposes `pid` from `pty.pid`. Run `npx vitest run src/main/platform src/main/terminal`, all pass.
- [ ] **Step 5: Prove it.** `./scripts/check` green. List processes whose command holds a test marker and confirm none is left.
- [ ] **Step 6: Commit.** `docs(specs): start running processes`, `feat(platform): read one process table on every system`, `feat(platform): end one process and its children`.

---

### Task 2: Listening ports, the address rule and the command text

Three small pure pieces and one reader. Nothing calls them from the bridge yet.

**Files:**
- Create: `src/main/platform/listening-ports.ts`, `src/main/platform/listening-ports.test.ts`, `src/main/processes/port-address.ts`, `src/main/processes/port-address.test.ts`, `src/main/processes/command-text.ts`, `src/main/processes/command-text.test.ts`
- Modify: `src/shared/bridge-contract.ts` (`processesLimits` only)

**Interfaces:**
- Consumes: `lsofMacos`, `ssLinux`, `portsWindows` from `src/main/platform/process-fixtures.ts`, `checkedLink` from `src/main/terminal/link-check.ts` (test only), `processesLimits`.
- Produces:
  ```ts
  // listening-ports.ts
  export interface ListeningPort { readonly pid: number; readonly host: string; readonly port: number }
  export function parseLsof(text: string): ListeningPort[];
  export function parseSs(text: string): ListeningPort[];
  export function parseWindowsPorts(text: string): ListeningPort[];
  export function readListeningPorts(pids: readonly number[]): Promise<ListeningPort[]>;
  // port-address.ts
  export function portUrl(hosts: readonly string[], port: number): string | null;
  // command-text.ts
  export function shownCommand(raw: string): { text: string; cut: boolean };
  ```
- The commands, parsers, numbers, the address table and the command steps are in Exact values under Commands, What the parsers accept, Numbers, Ports and the address rule and The command text. `readListeningPorts` answers `[]` for no ids, asks for the first `portPids` ids, and keeps only answers whose `pid` was asked.

- [ ] **Step 1: Tests**, each seen failing first.
  - `listening-ports.test.ts`
    - `reads lsof fields into ports with the family deciding what a star means`, `lsofMacos` gives 4203 on `::` 5173, `127.0.0.1` 9229 and `::1` 9230, and 4402 on `192.168.1.20` 8080 and `0.0.0.0` 8081.
    - `reads ss lines, with a zone, a star, brackets and two owners`, `ssLinux` gives 2201 on `127.0.0.1` 3000, 2201 and 2203 on `::` 5173, 2300 on `::` 8080, 2201 on `fe80::1` 9000, and nothing for the line with no owner.
    - `reads the Windows listeners, one object or many`.
    - `answers nothing for output it cannot read`, for each parser an empty string, prose and a port of 0 or 70000.
    - `reads the port a child of this test listens on`, on every system, a `process.execPath -e` child that listens on `127.0.0.1` port 0 and prints the port, read back by `readListeningPorts([pid])` as that port on `127.0.0.1`. The child is ended in a `finally`.
  - `port-address.test.ts`
    - `opens 127.0.0.1 for an IPv4 loopback or wildcard bind`, `127.0.0.1`, `127.0.0.53`, `0.0.0.0`, and `::` beside `0.0.0.0`.
    - `opens [::1] for an IPv6 loopback or wildcard bind with no IPv4 one`.
    - `treats an IPv4 mapped loopback as IPv4`, `::ffff:127.0.0.1`.
    - `gives no address for a LAN, link-local or unreadable bind`, `192.168.1.20`, `fe80::1`, `10.0.0.5`, `example.com`, `127.evil`, an empty list.
    - `builds an address links.open accepts as it is`, `checkedLink(url)?.href === url` for both shapes.
  - `command-text.test.ts`, with every secret shaped value built at run time, for example `"t".repeat(40)`, so no literal in the file looks like a key.
    - `leaves an ordinary command as it is`, `npm run dev` and `node /srv/app/node_modules/.bin/vite --port 5173`.
    - `hides credentials inside an address`, `postgres://admin:hunter@db.local/app` reads `postgres://***@db.local/app`, also inside `DATABASE_URL=…`.
    - `hides the value of a secret looking name, as an assignment and after a flag`, `API_KEY=abc`, `--token=abc`, `--password abc`, and `--no-auth --port 3000` keeps `--port`.
    - `hides a bearer value and a long opaque word`.
    - `cuts to 200 characters after hiding, never through a pair, and says so`.
    - `reads at most 1000 characters and drops the word the cut went through`.
- [ ] **Step 2: Implement** per the interfaces, `processesLimits` first. Run `npx vitest run src/main/platform src/main/processes`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green, and no test child left running.
- [ ] **Step 4: Commit.** `feat(platform): read listening ports per process`, `feat(processes): the loopback address rule and the shown command`.

---

### Task 3: The listing rule, the two channels and the wiring

**Files:**
- Create: `src/main/processes/listed-processes.ts`, `src/main/processes/listed-processes.test.ts`, `src/main/processes/processes-handlers.ts`, `src/main/processes/processes-handlers.test.ts`
- Modify: `src/shared/bridge-contract.ts`, `src/main/terminal/terminal-sessions.ts`, `src/main/terminal/terminal-sessions.test.ts`, `src/main/main.ts`, `src/main/bridge/registry.test.ts`

**Interfaces:**
- Consumes: `ProcessEntry`, `readProcessTable`, `subtreeOf`, `endSubtree`, `ListeningPort`, `readListeningPorts`, `portUrl`, `shownCommand`, the fixtures, `BridgeFailure`, `BridgeHandlers`, `BridgeOwner`.
- Produces:
  ```ts
  // listed-processes.ts
  export interface SessionRoot {
    readonly session: string;
    readonly workspace: WorkspaceRef;
    readonly pid: number;
    readonly spawnedAt: number;
  }
  export interface OwnedProcess {
    readonly root: SessionRoot;
    readonly entry: ProcessEntry;
    readonly subtree: readonly ProcessEntry[];
  }
  export const minimumAgeMs = 10_000;
  export const rootSlackMs = 2000;
  export function listedProcesses(entries: readonly ProcessEntry[], roots: readonly SessionRoot[], now: number): OwnedProcess[];
  export function ownedProcess(entries: readonly ProcessEntry[], roots: readonly SessionRoot[], pid: number, started: number): OwnedProcess | undefined;
  // processes-handlers.ts
  export interface Processes { handlers: Pick<BridgeHandlers, "processes.list" | "processes.stop"> }
  export interface RunningRoot { readonly owner: BridgeOwner; readonly root: SessionRoot }
  export function createProcesses(options: {
    roots: () => readonly RunningRoot[];
    readTable?: () => Promise<ProcessEntry[]>;
    readPorts?: (pids: readonly number[]) => Promise<ListeningPort[]>;
    end?: (target: ProcessEntry, table: readonly ProcessEntry[]) => Promise<void>;
    now?: () => number;
  }): Processes;
  // terminal-sessions.ts
  interface TerminalSessions { roots(): RunningRoot[] }
  ```
- The contract, the listing rule, Stop, the failures and the numbers are in Exact values.
- `terminal-sessions.ts`. `Session` gains `spawnedAt?: number`, set to `Date.now()` right after `spawnPty` returns. `roots()` answers one entry for every session in `running` that is not `ended` and has a pty, its `owner` and a root with `session` the terminal id, the workspace reference, `pty.pid` and `spawnedAt`.
- `processes.list`. One read is shared by every caller. A caller while a read runs awaits it, and a caller within `tableReuseMs` of the last finished read gets its answer. A read takes `at = now()`, the table, then `listedProcesses(table, every running root, at)`. With nothing listed it stops there and `readPorts` is not called. Otherwise one `readPorts` over the ids of every listed subtree, and every row is built once and kept with its root's owner. A row is `{ workspace, session, pid, started, command, cut, ports }`, the command and `cut` from `shownCommand`, the ports per Ports and the address rule. Each call answers `at`, the rows whose owner is the asking page, cut at `processesLimits.rows`, and the rest counted in `more`.
- `processes.stop` per Stop, over the roots whose owner is the asking page, with the `stopping` flag cleared in a `finally` and the shared read dropped.
- `main.ts`. `Parts` gains `processes`, `assemble` builds `createProcesses({ roots: () => terminals.roots() })`, and `start` spreads `...processes.handlers` into `registerBridge`.

- [ ] **Step 1: Tests**, each seen failing first.
  - `listed-processes.test.ts`, on `parsePsTable(psMacos)` with root `{ pid: 4100, spawnedAt: Date.UTC(2026, 10, 21, 10, 0, 0) }` and `fixtureNow` unless said.
    - `lists the command under the agent's shell and not the shell, the session's program or its helpers`, ids 4201 and 4402.
    - `lists only the topmost process of a chain`, 4201's subtree holds 4202 and 4203 and neither is a row.
    - `waits until a process is 10 seconds old`, 4301 is absent at `fixtureNow` and present 6 seconds later.
    - `skips a defunct process and one with no readable start`.
    - `finds nothing for a process whose parent is gone`, 5000.
    - `drops a link to a parent that started after its child`, `tableWindows` with root 3100 lists 3201 and its subtree has no 3300.
    - `lists under the first shell however deep the session's program sits`, a hand-made table of a `cmd` root, the program under it, a `bash` under that and a server under that, the server listed and the program not.
    - `ignores a root that started after Satellite spawned the session`, `spawnedAt` 10 seconds before the root's start lists nothing, 1 second before lists.
    - `names the session and workspace of each process, with two sessions`, `psMacos` joined with a second hand-made tree.
    - `owns a listed process, its child and a young one`, `ownedProcess` for 4201, 4203 and 4301 with their starts.
    - `refuses the root, a helper, the agent's shell, a detached process and a stranger`, 4100, 4110, 4200, 5000, 900 and 1.
    - `refuses a right id with another start time`, 4201 with its start plus 1000.
  - `processes-handlers.test.ts`, with every option injected and two fake owners.
    - `lists rows with a hidden, cut command and the ports of the whole subtree`, 4201 shows port 5173 with `http://[::1]:5173/` from 4203's listener, and every row passes `processRow`.
    - `shows a port bound elsewhere with no address`, and `processRow` refuses a row whose address is `http://example.com:80/`.
    - `reads no ports when nothing is listed`.
    - `reads the table once for callers that overlap and again after 2 seconds`.
    - `lists only the asking page's sessions`.
    - `stops a listed process from a fresh table and never the cached one`, `end` called once with 4201's entry and the fresh table.
    - `refuses an id that left the table, an id whose start changed and a process no session started, and ends nothing`, codes `not-found`, `not-found` and `refused`.
    - `refuses a second stop while one runs`, code `limit`.
    - `stops nothing when the table cannot be read`, code `failed`.
  - `terminal-sessions.test.ts`, `answers a root with its owner only while the session runs`, absent before the pty starts, after its exit and once Satellite ends it.
  - `registry.test.ts`, `refuses processes.stop with a process id of 1, a fraction, a missing start or a field of the page's own` and `refuses processes.list with any field`.
- [ ] **Step 2: Implement** per the interfaces. Run `npx vitest run src/main src/shared`, all pass.
- [ ] **Step 3: Prove it.** `./scripts/check` green.
- [ ] **Step 4: Commit.** `feat(processes): list what each session started and stop one of them`.

---

### Task 4: The count, the list and Stop on the page

**Files:**
- Create: `src/renderer/processes/use-processes.ts`, `src/renderer/processes/process-words.ts`, `src/renderer/processes/process-words.test.ts`, `src/renderer/processes/processes-dialog.tsx`
- Modify: `src/renderer/ui/icon.tsx`, `src/renderer/projects/sidebar.tsx`, `src/renderer/projects/workspace-header.tsx`, `src/renderer/commands/command-registry.ts`, `src/renderer/window/app-window.tsx`

**Interfaces:**
- Consumes: `invoke`, `createSchedule` and `Pace` from `src/renderer/ui/refresh-schedule.ts`, `visibleText`, `Dialog`, `Button`, `Icon`, `ProcessRow`, `sessions.all`, the existing `asking` state and `LinkDialog` in `app-window.tsx`.
- Produces:
  ```ts
  // use-processes.ts
  export interface Processes {
    rowsOf: (ref: WorkspaceRef) => readonly ProcessRow[];
    at: number;
    more: number;
    stopping: ReadonlySet<string>;
    stop: (row: ProcessRow) => void;
  }
  export function useProcesses(input: { live: string; finished: string; notify: Notify }): Processes;
  // process-words.ts
  export const detachedSentence: string;
  export const nothingRunning: string;
  export const portLinkSentence: string;
  export function countLabel(count: number): string;
  export function moreSentence(more: number): string;
  export function ageReadout(ms: number): string;
  export function ageWords(ms: number): string;
  export function portLabel(port: number, linked: boolean): string;
  ```
- Copy, the surface and the numbers are in Exact values under Copy, The surface and Numbers.
- `app-window.tsx` computes `live`, the terminal ids of every tab whose status is not `stopped` joined by spaces, and `finished`, the keys of every tab whose status is `done` joined by spaces.
- `useProcesses`. With `live` empty it holds no rows and runs no schedule. Otherwise one `createSchedule` with the page pace, `visible` from `document.visibilityState`, `read` calling `invoke("processes.list", {})`, storing the answer when it is ok, keeping the last rows when it is not, and answering `{ files: result.ok, key }` with `key` the JSON of each row's id, start and ports. `visibilitychange` calls `refresh` when visible and `hide` when not. A change of `live` or `finished` after the first render calls `refresh`. `rowsOf` keeps the rows of that workspace whose `session` is still in `live`, so a session that ended clears at once. `stop` adds `"<pid>/<started>"` to `stopping`, calls `invoke("processes.stop", { pid, started })`, on a refusal calls `notify(message, code === "not-found" ? "info" : "error")`, then removes the key and calls `refresh`.
- `app-window.tsx` holds `processesOpen`, adds it to `modal`, passes `processesFor` (the length of `rowsOf`) to `Sidebar` and `processes` with `onShowProcesses` to `WorkspaceHeader`, renders `ProcessesDialog` for the shown workspace, and on a port click closes the dialog and sets `asking` to `{ address: url, description: portLinkSentence }`. The dialog closes when the shown workspace changes.
- `ProcessesDialog` takes `{ label, rows, at, more, sessionNumber, stopping, onStop, onPort, onClose }`, where `sessionNumber(terminalId)` is the tab number or `undefined`.

- [ ] **Step 1: Tests**, each seen failing first, in `process-words.test.ts`.
  - `reads an age as a readout and as words`, 45 seconds, 1 minute, 12 minutes, 3 hours 5 minutes, 2 days 4 hours, and a negative age as `0S`.
  - `counts one process and many, and what is not listed`.
- [ ] **Step 2: Implement** the hook, the words, the icon, the readouts, the dialog, the command and the wiring. `npx vitest run src/renderer`, all pass.
- [ ] **Step 3: Prove it in the window.** The scenario arrives in Task 5, so use `needs-permission` for the empty state. `npm run --silent verify -- needs-permission click=workspace-repo-main press=Meta+K type=running press=Enter wait-for=processes-dialog text=processes-empty text=processes-note shot=processes-empty theme=dark shot=processes-empty-dark` (`Control+Shift+K` off macOS, and the row id the scenario's tree shows). Read both screenshots against `DESIGN.md`, and confirm `consoleErrors` is empty and that no `processes.list` ran before a session started (no row, no header count).
- [ ] **Step 4: Check.** `./scripts/check` green, no Electron process of this repo left running.
- [ ] **Step 5: Commit.** `feat(processes): the running count, the list and stop`.

---

### Task 5: The dev-server scenario and the journey

**Files:**
- Create: `verify/stand-ins/dev-server.ts`, `verify/scenarios/dev-server/scenario.json`, `verify/journeys/processes.ts`
- Modify: `verify/scenario.ts`, `verify/scenario.test.ts` if it lists step kinds, `verify/stand-ins/claude.ts`, `verify/stand-ins/stand-in-log.ts`, `verify/cli.ts`, `verify/journeys.ts`

**Interfaces:**
- `claudeStepSchema`'s child step becomes `z.strictObject({ child: z.enum(["ignores-hangup", "dev-server"]) })`.
- `standInEventSchema` gains `z.strictObject({ type: z.literal("server"), pid: z.int(), port: z.int(), child: z.int() })`.
- The stand-in step, `dev-server.ts`, the scenario, the `links` step and the journey's place are in Exact values under Scenario, steps and journey. Test ids are under The surface.
- Journey `processes`, using `startClaude`, `waitUntil`, `processGone`, `bridgeCode`, `goneTimeoutMs` and `promptTimeoutMs` from `verify/journeys/conditions.ts`.
  1. Click `workspace-repo-main`, start Claude Code, wait for the `server` event and keep its `pid`, `port` and `child` and the moment it was seen. Both processes are alive.
  2. Wait until 11 seconds have passed since that moment, then press Enter in the terminal, which ends a turn. `header-processes` appears with `data-count` `1` and `workspace-repo-main-processes` reads `1`.
  3. Click `header-processes`. Exactly one row. Its command holds `dev-server`, its session reads `Session 1`, its age is not empty, and `process-row-0-port-<port>` reads `:<port>` with `data-link` `true`. `processes-note` holds the detached sentence. Screenshot `processes`.
  4. Click the port. The link dialog's address reads `http://127.0.0.1:<port>/`. Click `link-open`, and `openedLinks()` is exactly that one address.
  5. Open the list again with the header count, click `process-row-0-stop`. Within `goneTimeoutMs + 3000` both the server and its child are gone, the stand-in Claude Code still runs, `processes-empty` shows and `header-processes` is gone.
  6. Forged requests through `bridgeCode`. `processes.stop` with the driver's own `process.pid` and a start of 1 answers `not-found`, with the stand-in's own id and a start of 1 `not-found`, with a process id of 1, a negative id or an extra `signal` field `invalid-request`, and `processes.list` with a `workspace` field `invalid-request`. The driver and the stand-in still run.
  7. No console errors.

- [ ] **Step 1: Stand-in and scenario.** Write the step, the event, `dev-server.ts` and the scenario. `npx vitest run verify`, all pass.
- [ ] **Step 2: Prove it from the CLI**, on the built app. `npm run --silent verify -- dev-server click=workspace-repo-main click=start-claude wait=12000 press=Enter wait-for=header-processes click=header-processes text=process-row-0-command shot=processes theme=dark shot=processes-dark log`, then a second run that adds the port click, `click=link-open links`, a reopen and `click=process-row-0-stop wait-for=processes-empty`. Paste the row's command, the port, the recorded link and the two screenshots' paths into the report, and read the screenshots against `DESIGN.md`.
- [ ] **Step 3: The journey.** Write it and list it after `sessions`. Before trusting it, make `ownedProcess` answer `undefined` for one run and see step 5 fail with a legible reason, then restore it.
- [ ] **Step 4: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report, and no process of this repo's Electron, no `dev-server.ts` and no stand-in left running.
- [ ] **Step 5: Commit.** `test(verify): a dev server scenario and the processes journey`.

---

### Task 6: Docs, skills and status Done

**Files:**
- Modify: `ARCHITECTURE.md`, `SATELLITE.md`, `DESIGN.md`, `.claude/skills/satellite-stack/SKILL.md`, `.claude/skills/satellite-verify/SKILL.md`, `specs/009-running-processes/spec.md`, `specs/README.md`

- [ ] **Step 1: ARCHITECTURE.md.**
  - Bridge. Rows for `processes.list` and `processes.stop` with what each does, the bounds from Exact values and what a hostile page could do from here, taken from Threat model. The error paragraph's `limit` gains one stop at a time.
  - Platform. `process-table.ts` (the one table reader, the pinned `ps` columns and environment, the PowerShell CIM query, duplicate ids dropped, a link needing a parent that is not newer), `listening-ports.ts` (the three port reads, absolute paths, the ignored `lsof` exit code) and `endSubtree` in `process-tree.ts` (id by id, never a group, the grace, the Windows form without `/T`). `PtyProcess` exposes its process id.
  - Terminal. Sessions answer their running roots with the spawn moment.
  - A new section `## Running processes` after Pull request. The listing rule in its four steps and why the first shell, what is never listed (detached processes, defunct ones, young ones, a loop in the agent's own shell), the fresh-table check before every stop and its residual same-second window, ports and the address rule, the command text as a courtesy that is not a boundary, the shared read and its 2 second reuse, the page owned schedule, and the threat table.
  - Folder layout. `src/main/processes/` and `src/renderer/processes/`.
  - Decisions. Rows for the parent chain over an environment marker or a process group, one table for all workspaces, CIM over the script module on Windows, the dialog over a new surface, and loopback numbers over `localhost`.
- [ ] **Step 2: SATELLITE.md.** A `## Running processes` section after Pull request, in sentences, the count on the row and in the header, the list and what a row shows, ports and the question before one opens, Stop, how it refreshes, and that a process that detached is not listed. Layout mentions the header count.
- [ ] **Step 3: DESIGN.md.** In App, one bullet for the running count readout on the row and in the header and for the list dialog with its row, port and Stop styles. The `running` icon joins wherever icons are named.
- [ ] **Step 4: Skills.** `satellite-stack`, the process table and port readers as the only way to read processes, and that a feature signals a process only through `endSubtree` after `ownedProcess`. `satellite-verify`, the `links` step, the `dev-server` child step, the `server` event, the `dev-server` scenario, the `processes` journey row and feature map rows for 009.
- [ ] **Step 5: Status.** Spec and index to **Done**, and tick the spec's acceptance items. Leave `plan.md` to the controller.
- [ ] **Step 6: Check.** `./scripts/check` and `npm run --silent journeys` green, last lines in the report. Commit `docs: describe running processes and mark spec 009 done`.

---

## Acceptance map

| Acceptance item or scope bullet | Task | Proof |
| --- | --- | --- |
| A process started by a session appears with its command and age, and leaves when it ends | 1, 3, 4, 5 | `listed-processes.test.ts`, scenario `dev-server` in Task 5 Step 2, `processes` journey steps 2, 3 and 5 |
| A listening process shows its port and the link opens the loopback address | 2, 3, 4, 5 | `listening-ports.test.ts`, `port-address.test.ts`, journey steps 3 and 4 with the recorded link |
| Stop ends the process and its children | 1, 3, 5 | `process-tree.test.ts` `ends a process and its child…`, journey step 5 |
| A process id that does not descend from a session is refused | 3, 5 | `listed-processes.test.ts` refusals, `processes-handlers.test.ts` refusals, `registry.test.ts`, journey step 6 |
| The process table parses on macOS, Windows and Linux | 1, 2 | `process-table.test.ts` and `listening-ports.test.ts` on the fixtures, and the real reads on each system's runner |
| Scope, a count on the workspace row and in the header that opens a list | 4, 5 | Task 4 Step 3, journey steps 2 and 3 |
| Scope, only long-lived processes that descend from the workspace's sessions | 3 | `waits until a process is 10 seconds old`, `finds nothing for a process whose parent is gone`, `lists only the asking page's sessions` |
| Scope, only loopback addresses are ever opened | 2, 3 | `port-address.test.ts`, the contract's address pattern, `shows a port bound elsewhere with no address` |
| Scope, Satellite only ever stops processes that descend from its own sessions | 1, 3 | Review Focus 1 and the tests under the first three threats |
| Scope, the list updates on a slow timer and when a session finishes a turn | 4, 5 | the page pace in `use-processes.ts`, journey step 2, where the count appears right after the turn ends |
