# Handoff — how to continue the build from any Claude session or account

HEARTBEAT: 2026-10-21T01:45+05:30
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
- Done: W0, W1, W2 (all), W3-2, W4-1 — the app runs with a live preview (`npm run dev`).
- Running: W3-1 compare/present/wiring, W3-3 export panel, W3-4 freehand/brush, W3-6 map worker — each in its own worktree (`git worktree list`, branches worktree-agent-*).
- Next: merge wave 3 → W4-2 accessibility pass, W4-3 Playwright smoke test, W4-4 Opus final review → set BUILD_STATUS: COMPLETE.

## Known gotchas

- Agent worktrees (`isolation: worktree`) are sometimes created from `main` instead of `develop`. Every agent prompt must start with: "run `git log --oneline -1`; if HEAD is not a descendant of develop, run `git merge --ff-only develop` before `npm ci`".
- `.claude/worktrees/` is git-ignored; never `git add` it.
- Usage limits stop every agent at once. An agent with no commits may lose its worktree (auto-cleaned); tell agents to commit early. Resume a stopped agent by messaging it; restart it if its worktree is gone.
- In bash, never put backticks inside a double-quoted `node -e` script — the shell runs them. Use a script file.

## Auto-resume set-up (overnight 2026-10-20)

- In-session cron (session-only) fires about every 20 minutes and tells the orchestrator to continue if idle.
- Backup: a Claude desktop scheduled task `vision-sim-auto-resume` runs hourly; it only acts if HEARTBEAT is older than 8 hours and BUILD_STATUS is not COMPLETE (meaning the original session died). Disable it once the build is complete.

## Environment facts

- Windows 10, Git Bash + PowerShell, Node 18.20.1, npm 10.5.
- Repo: `C:\Temp_DDrive\Git_Repo\TSKGitHub\VisionImageSimulationTool`, remote `origin` = github.com/SaravanaTelapolu/VisionImageSimulationTool.
- Commands: `npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`.
