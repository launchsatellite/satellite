# 008 Pull request

Status **Done** · Depends on **004, 006**

## Why

After an agent opens a pull request, the one question left is what still stands between it and the merge. GitHub answers it across several pages. Ready answers it in one card beside the agent that made the pull request, and hands each blocker back to the agent.

## Scope

- Ready, the rail's third tab, fed by `gh` with the user's existing sign-in. It carries the pull request's number once there is one, and a signal pixel on the tab and its folded icon while the pull request needs the user.
- It appears by itself when the workspace's branch has a pull request opened by the user, their agent, or an owner, a member or a collaborator of the repository. Without one, Ready offers Send to Claude Code with a request to open it.
- A card says Nothing blocks the merge with a volt pixel, or 1 thing blocks the merge or N things block the merge, then the number and the head into the base. It never says ready to merge or safe. A merged or closed pull request says Merged or Closed with no rows.
- One row each, with a check or a cross, in this order. Still a draft, only for a draft. The checks, as No checks ran, Checks passed with passed over total, N checks are running, or N checks failed with each failed check under it. The reviews. The conflicts with the base. The open review threads. Then A branch rule blocks it, only when GitHub reports the merge blocked and no other row blocks. Then the commits.
- A failed check shows its failing lines and offers Send to Claude Code with a pointer to its job and run, and Open check details.
- Reviews count only from owners, members and collaborators, the newest deciding review of each. Changes requested on the latest commit names the reviewers and offers Send to Claude Code with a pointer to the review. Changes requested on an earlier commit, or by GitHub's review decision with no reviewer Satellite can name, is a grey blocker with the same Send. Waiting for a review shows while GitHub's review decision says a review is required. Then Approved by the reviewers, or No reviews yet.
- Conflicts with the base offers Send to Claude Code with the request to update from the base. GitHub still checking for conflicts and a branch behind its base are grey blockers. Otherwise No conflicts with the base.
- N open threads is grey and never blocks, with Send to Claude Code pointing at the pull request's unresolved threads. Otherwise Every thread resolved.
- Signal marks only failed checks, changes requested on the latest commit and conflicts, the card's edge takes signal only while one of those rows shows, and grey blockers alone give the card a grey pixel.
- The footer offers Merge on GitHub once nothing blocks and Open on GitHub otherwise, both through the link dialog.
- The sidebar row and the workspace header show the pull request number, state and checks summary.
- Failed checks, changes requested on the latest commit and conflicts make the workspace need the user and appear in the inbox.
- Data refreshes when a session finishes a turn, when the window regains focus and on a slow timer, within GitHub's limits. The review threads are read only while Ready shows.
- What a pull request says is untrusted. Titles, descriptions and comments are never read. Check names, branches, commit headlines and logins draw as plain text with hidden characters written out.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| Ready, one card of what blocks the merge | Overview, Checks, Conversation and Files sections, a thread panel and a next thread key | Those copy pages GitHub draws better. Satellite answers the one question GitHub buries and links to the rest. |
| Nothing blocks the merge | Ready to merge, safe, a merge button | GitHub has the last word, through rules Satellite cannot all see, so Ready says only what it knows. Merging has several types and rules that GitHub already presents correctly. |
| Merge on GitHub through the link dialog | A merge button | The same reason, and Satellite never writes to a pull request. |
| Only owners, members and collaborators count, the newest deciding review of each | Every reviewer | Anyone can review a public pull request, so a bot or a stranger could otherwise block or approve. |
| Open threads grey, never blocking | Threads as blockers | Many repositories merge with threads open, so a thread is worth seeing but is not GitHub's blocker unless a branch rule says so, which the branch rule row covers. |
| Grey blockers for a draft, running checks, a review still required, changes asked on an earlier commit, unknown mergeability, a branch behind its base and a branch rule | Only the three signal reasons as blockers | Each one stops the merge, and none needs the user right now, so they count without turning orange. |
| Pointers in prepared requests, a number, a job and run, or a review id | Pasting comment, review or log text into the prompt | The agent has `gh` and fetches the full content itself, and untrusted text never rides into the prompt unseen. |
| The review pointer as the review's node id from `gh pr view`, checked against its pattern, with a number-only request as the fallback | The review's web address | The id comes with the read Satellite already makes, while the address needs another fetch. |
| No title, description or comment read | Sanitised Markdown with remote images replaced by links | Ready needs none of them, so no hostile text reaches the page and no Markdown stack has to guard it. |

## Not in scope

Creating pull requests, replying, reviewing and merging. Agents and GitHub own those. Reading or drawing titles, descriptions, comments or diffs of a pull request, which GitHub shows.

## Acceptance

- [x] A branch with an open pull request carries its number on Ready without a click, says Nothing blocks the merge with every thread resolved, and Merge on GitHub goes through the link dialog. Proof, journey `pull-request` on scenario `pr-open`.
- [x] A pull request opened by the agent appears without any action, and a stranger's newer one is set aside for the one a writer opened. Proof, journey `pull-request` on scenario `pr-appears`.
- [x] A failed check is a signal row, shows its failing lines, puts the workspace in the inbox with one notification that holds nothing the pull request said, and leaves once the checks pass. Proof, journey `pull-request` on scenario `checks-failed`.
- [x] Changes requested on the latest commit is a signal row whose Send types the review's id, two open threads are a row that does not block and whose Send types the number-only request, and the row clears once approved. Proof, journey `pull-request` on scenario `changes-requested`.
- [x] Conflicts put the workspace in the inbox, Send types the update-from-base request, and the row leaves once updated. Proof, journey `pull-request` on scenario `pr-conflicts`.
- [x] A hostile check name and commit headline draw as text, no `img`, `script`, `iframe`, `style`, `form` or link element appears, no check name reaches a `gh` argument, and a hostile review id falls back to the number-only request. Proof, journey `pull-request` on scenario `hostile-description`.
- [x] With `gh` signed out Ready says so and names the fix. Proof, journey `pull-request` on scenario `not-signed-in`.
- [x] The card says nothing blocks only when every row is clear, signal marks only the three reasons, a draft, running checks and a missing review are grey blockers, an open thread never blocks, a branch rule shows only when no other row blocks, and merged and closed show no rows. Proof, `ready-rows.test.ts`.
- [x] Only owners, members and collaborators count, the newest decision of each, changes on an older commit never need the user, and a review id that is not an id is dropped. Proof, `pull-request-needs.test.ts`.
- [x] Every shape of `gh` answer Ready depends on parses, a missing field degrades to its empty value, and the open threads are counted with the rest as more. Proof, `pull-request-parse.test.ts`.
- [x] Prepared requests hold only numbers and ids, with a fallback when an id is missing. Proof, `pull-request-requests.test.ts`.
</content>
</invoke>
