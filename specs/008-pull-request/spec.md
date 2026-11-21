# 008 Pull request

Status **In progress** · Depends on **004, 006**

## Why

After an agent opens a pull request, the user goes to GitHub to read it, see its checks and follow its comments. The Pull request tab shows all of that beside the agent that made it, and hands the next step back to the agent.

## Scope

- The Pull request tab in the centre column, fed by `gh` with the user's existing sign-in.
- It appears by itself when the workspace's branch has a pull request. Without one, the tab offers Send to Claude Code with a request to open it.
- Overview shows the title, number, state, branches, description, commits, whether it can merge and what blocks it.
- Checks lists every check with its result. A failed check shows its failing lines and offers Send to Claude Code with a pointer to the run.
- Conversation shows reviews and comments in order, unresolved threads first.
- Files shows the pull request's diffs in the same viewer as Changes, with review threads on the lines they belong to. Each thread offers Send to Claude Code with a pointer to it. One key jumps to the next unresolved thread.
- Open on GitHub opens the pull request, a check or a comment in the system browser.
- The sidebar row and the workspace header show the pull request number, state and checks summary.
- Failed checks, requested changes and conflicts make the workspace need the user and appear in the inbox.
- Data refreshes when a session finishes a turn, when the window regains focus and on a slow timer, within GitHub's limits.
- Descriptions and comments are untrusted. They render as sanitised Markdown with no scripts, no raw HTML and no remote images.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Pointers in prepared requests | Pasting comment or log text into the prompt | The agent has `gh` and fetches the full content itself, and untrusted text never rides into the prompt unseen. |
| Merge on GitHub | A merge button | Merging has several types and rules that GitHub already presents correctly. |
| Remote images replaced by a link | Loading them | Loading a remote image tells its host that the user opened the pull request. |

## Not in scope

Creating pull requests, replying, reviewing and merging. Agents and GitHub own those.

## Acceptance

- [ ] A branch with an open pull request shows its overview, checks, conversation and files. Proof, scenario `pr-open`.
- [ ] A failed check shows its failing lines and the request lands in the prompt. Proof, scenario `checks-failed`.
- [ ] A review thread appears on its line in the diff and its request lands in the prompt. Proof, scenario `changes-requested`.
- [ ] Each of failed checks, requested changes and conflicts puts the workspace in the inbox and leaves when fixed. Proof, the three scenarios.
- [ ] A description with a script, raw HTML and a remote image renders none of them. Proof, scenario `hostile-description` and unit tests on the renderer.
- [ ] Every shape of `gh` answer the view depends on parses, and a missing field degrades to a sentence. Proof, unit tests on the parsers.
- [ ] With `gh` signed out the tab says so and names the fix. Proof, scenario `not-signed-in`.
- [ ] A new pull request opened by the agent appears without any action. Proof, a journey.
