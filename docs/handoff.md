# Handoff — how to continue the build from any Claude session or account

HEARTBEAT: 2026-10-20T21:47+05:30
BUILD_STATUS: IN_PROGRESS

The orchestrator rewrites the two lines above after every merge or step. `BUILD_STATUS` becomes `COMPLETE` when wave 4 is merged.

## If you are a new Claude session picking this up

1. Read `CLAUDE.md`, then this file, then `docs/development-coding-progress.md` (task table + log) and `docs/incremental-ai-coding-detailed-plan.md` (task specs).
2. **Collision check:** if HEARTBEAT is less than 90 minutes old, another orchestrator is probably active. Do not start agents; stop, or only read.
3. Check the repo state:
   - `git status` and `git log --oneline -15` on branch `develop`.
   - `git worktree list` and `git branch --list "worktree-*" "w[0-9]*"` for unmerged agent branches.
4. For every task marked `running` in the progress table:
   - If its branch has commits not in `develop` and its tests pass → merge it (see the merge procedure in the plan) and mark `done`.
   - If it has partial or no work → restart the task with a fresh agent (worktree isolation, same spec from the plan, tell it to build on the existing branch if one exists).
5. Continue with the next tasks whose dependencies are `done`, at most 7 agents at once, the tier given in the plan.
6. Never stop to ask Saravana: make an assumption and add it to `docs/morning-review.md`.
7. Commit after each merge to `develop` (never push), then update the progress log, this file's HEARTBEAT, and "Current state" below.

## Current state

- Branch: `develop` (local only, not pushed). `main` has only the initial commit.
- Done: W0 (scaffold + contracts + docs), commit a88a281.
- Running: wave 1 (W1-A … W1-G), each in its own worktree under .claude/worktrees with its own branch. Find them with `git worktree list`; each agent commits with a message starting with its task ID.
- Next: merge each finished wave-1 branch into develop, then wave 2.

## Known gotchas

- Agent worktrees (`isolation: worktree`) are sometimes created from `main` instead of `develop`. Every agent prompt must start with: "run `git log --oneline -1`; if HEAD is not a descendant of develop, run `git merge --ff-only develop` before `npm ci`".
- `.claude/worktrees/` is git-ignored; never `git add` it.

## Auto-resume set-up (overnight 2026-10-20)

- In-session cron (session-only) fires about every 20 minutes and tells the orchestrator to continue if idle.
- Backup: a Claude desktop scheduled task `vision-sim-auto-resume` runs hourly; it only acts if HEARTBEAT is older than 8 hours and BUILD_STATUS is not COMPLETE (meaning the original session died). Disable it once the build is complete.

## Environment facts

- Windows 10, Git Bash + PowerShell, Node 18.20.1, npm 10.5.
- Repo: `C:\Temp_DDrive\Git_Repo\TSKGitHub\VisionImageSimulationTool`, remote `origin` = github.com/SaravanaTelapolu/VisionImageSimulationTool.
- Commands: `npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`.
