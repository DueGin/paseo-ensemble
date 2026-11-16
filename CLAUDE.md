# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A Paseo plugin (`paseo-plugin.json`, id `paseo-agent-team`) that turns a Paseo project into an agent team: each role gets its own provider/model, every role runs in the orchestrator's workspace (one workspace per team), and the orchestrator agent delegates to them. Team definitions live in the project repo, one per workspace, as `.agents/teams/<orchestrator workspace>.json` (the older single `.agents/team.json` is still read), not in plugin settings (see `.forge/adr/`). Domain terms (Project, Workspace, Role, Orchestrator, Team definition) are defined in `.forge/CONTEXT.md`; use them as written.

## Commands

```bash
npm install                        # .npmrc sets legacy-peer-deps (works around an npm 10.9 resolver crash)
npm run typecheck                  # tsc --noEmit; run before every install/reload
npm test                           # vitest unit tests
npx vitest run tests/validate.test.ts            # one file
npx vitest run -t "returns auto only"            # one test by name
PASEO_E2E=1 npx vitest run tests/daemon.e2e.test.ts   # live daemon; starts real agents and costs tokens (PASEO_URL overrides ws://127.0.0.1:6767/ws)
PASEO_E2E=1 npx vitest run tests/collab.e2e.test.ts   # both collaboration modes with real agents; needs the plugin installed from this checkout

paseo plugin install "$(pwd)"      # local install; then `paseo plugin ls` must show "running"
paseo plugin reload paseo-agent-team
paseo plugin logs paseo-agent-team
```

There is no build or lint step; Paseo bundles the TypeScript sources itself on install. Do not restart the daemon to pick up changes; use `paseo plugin reload`.

## Architecture

Paseo plugins have two runtimes, each with one entry that default-exports a `contribute` function:

- `index.server.ts` + `server/` run in a daemon subprocess. `server/team.ts` holds the team RPC handlers; `server/collab.ts` holds the collaboration runs: the agent tools attached to leads and members, the run store, and the lifecycle hooks that move runs along. `server/common.ts` has helpers both use. Handlers get `{ paseo }` (the Paseo SDK) and do the filesystem and agent work.
- `index.client.tsx` + `client/` run inside the Paseo app (React Native, all platforms). It registers the team panel (`TeamPanel`), two dashboards from one component (`AgentDashboard`: the workspace's sessions, and `SessionDashboard`, an agent panel scoped to one session), an always-visible sidebar item and screen that lists every project's teams (`TeamScreen`), and Command Center items. `client/session-access.ts` adds the per-agent composer pills (Dashboard, Mode), the agent Command Center item and the `/dashboard` slash command.
- `shared/` is compiled into both and must stay pure (Zod contracts and plain values, no Node or React Native APIs). It holds the team schema (`team.ts`), RPC contracts (`rpc.ts`), provider/model validation (`validate.ts`), the planner and orchestrator prompts (`proposal.ts`, `prompt.ts`), workspace matching (`apply-plan.ts`), planner cleanup (`cleanup.ts`) and UI strings (`messages.ts`, English, Korean, Japanese and Simplified Chinese). Most logic lives here so it can be unit-tested without a daemon.

The user-facing flow is propose → review → apply. Propose starts a planner agent with `outputSchema: TEAM_JSON_SCHEMA`. The client then polls `teamProposal`, which calls `waitForFinish(1000)` and parses the planner's last message. Apply re-validates, refuses workspaces another team of the project uses, writes the team's own file, reuses or creates the orchestrator's workspace matched by title, and then either tells a running orchestrator on the same provider/model to re-read the team or starts a new one. Finally it archives planner agents and an emptied `Team planner` workspace.

```
propose → planner agent → poll teamProposal → user edits draft → apply
apply: validate → check other teams' workspaces → write the team's file → match/create the orchestrator's workspace → reuse or start orchestrator → archive planners
```

Members (role agents) are created by the plugin, through the team tools the lead calls. `agent.open.before` attaches `leadTools` to agents labelled `workspace-agents=orchestrator` and `memberTools` to `workspace-agents=member`; tool names live in `shared/modes.ts`. A member is created with `parent: <lead>`, labels `role=<name>` and `workspace-agents=member`, its role's provider/model/mode, and `memberSystemPrompt`; an idle member of the role on the same provider/model is continued instead.

Collaboration modes (`shared/modes.ts`): `delegation` (MA-04: `team_delegate` → isolated members → `team_wait`) and `team` (MA-08: intake with the user → `team_brief` records the brief and the end of the lead's timeline in `.agents/runs/briefs.json` → `team_kickoff` requires `userConfirmation` quoted from a user message after that position (`confirmsBrief`) → shared board → automatic review round). A team file's `mode` is `auto`, `team`, `delegation` or `none` (missing = `delegation`); in auto mode the first run locks the session (`sessions.json` holds `{mode, locked}`; `effectiveMode` puts the lock first); `roles` may be empty when `candidates` has entries; the planner works without a goal (`plannerPrompt("")` reads the project); a session override (composer Mode pill, dashboard switch, `team.session.mode` RPC) is stored in `.agents/runs/sessions.json`. Tools enforce the effective mode (`allowsMode`). To add a mode: extend `COLLAB_MODES`/`MODE_SPECS`, add lead/member prompts in `prompt.ts` and `prompt-zh.ts`, its tools and run handling in `server/collab.ts`, its parts in `shared/flow.ts`, and UI strings in all four languages.
Collaboration languages (`PROMPT_LANGUAGES`): a team's `language` picks the prompt set (`promptsFor` in `shared/prompts.ts`) and the tool descriptions and results (`buildTools(lang)` in `server/collab.ts`, attached by the `agent-team-lang` label); every run carries the language it started in, and `shared/collab.ts` localizes board text through its `WORDS` table.
Data flow (`shared/flow.ts`): team runs use the components brief/tasks/plans/board/claims; delegation runs use split/contexts/reports/summary, with `Run.batches` (`addBatch`, `attachPacket` in `mirrorTask`, `summarizeBatch` from the lead's turn end via `batchToSummarize`) and explicit `contexts` start/continue events from `team_delegate` and `team_send`. The store traces each run change by diffing the run before and after (`traceRun`), with the actor taken from `AsyncLocalStorage` (set around tool calls and around `advance`); events are kept in the run (`events`, `eventSeq`, last 400). Plugin-sent notices are logged after the send succeeds, never derived. The dashboard reads the last 60 with `team.session`, and everything with `team.session.detail`.

Team mode is complete in the "team" sense (lead + shared task board + mailbox): tasks (`T1`… with role, deps, files, state todo/doing/done/dropped, owner, optional plan, feedback) are claimed atomically (`claimTask`, also claims files), unlock when deps are done, are handed to idle members by `dispatchPlan`/`assignTasks`, and roles with ready work but no member are staffed (`unstaffedRoles` → `staff`). Posts addressed to roles/`lead`/`all` are "mail": appended to the recipient's next team tool result (`withMail`/`withLeadMail`, `inboxSeq`/`leadInboxSeq`) and wake idle recipients. Optional plan approval (`submitPlan`/`reviewPlan`; a pending plan keeps its task with the owner and blocks the round), rejection of done tasks (`rejectTask`), retiring members (`retireRole`) and `team_close`. Candidates: `candidates` in the team file are models, not roles; `name` is an optional handle (filled from the model by `fillCandidateNames` in the schema's preprocess), `notes` is the description (good at / must not do) the lead assigns work by. `roleSpec` resolves fixed roles, roles formed with `team_role` (stored in `.agents/runs/roles.json`, `SessionRole`), candidates by name (description becomes the member's notes), or `helper` only when there are no candidates, so no model outside the pool can be used.

Global presets (`shared/presets.ts`): a host-scoped plugin settings document (`presetsSettings`, id `presets`) registered in `index.server.ts` and read in the client with `useSettings`. A preset is a mode + orchestrator model + candidate pool. `team.preset.start` (`startFromPreset`) writes the project's team from a preset (`presetToTeam`, with `preset: { id, name }` provenance) for a new workspace (title via `taskWorkspaceTitle` + `freeWorkspace`) or a free existing one, then runs `applyTeam` with `request`, which becomes the orchestrator's first prompt instead of the ready prompt. UI: `client/Presets.tsx` (library + start dialog) on the Agent teams screen; `SelectHost` in `TeamPanel.tsx` hosts the searchable picker for any editor.

Runs are JSON files in `<project>/.agents/runs/` (with a plugin-written `.gitignore`). `shared/collab.ts` is the pure state machine (members `working|attention|done|failed`, rounds, board posts, claims, tasks, `nextStep`); `RunStore` in `server/collab.ts` serializes mutations per run. Hooks (`agent.turn.after`, `agent.permission.*`, `agent.archive.after`) finish members and call `advance`, which starts the next team round or tells an idle lead. The plugin only ever `send`s to idle agents (a `send` interrupts a running turn). Decisions that send (start a round, notify the lead) are made inside `mutate` so racing callers act once, and `finishIfCurrent` ignores a turn end that predates the member's latest dispatch. `team_wait` and a 60-second sweep reconcile members whose events were missed.

Key details that span files:

- A team belongs to the workspace in its `orchestrator.workspace`, matched by title (`shared/team-files.ts`). The panel of a workspace reads only that workspace's team, and the orchestrator prompt names only its own file.
- Agents the plugin starts carry the label key `LABEL = "workspace-agents"` (`shared/cleanup.ts`) with value `planner`, `orchestrator` or `member`. Cleanup, orchestrator reuse and tool attachment depend on it, so do not rename it casually.
- Every message the plugin sends to an agent starts with `PLUGIN_MESSAGE_PREFIX` (`[agent-team]`), so the intake check never mistakes it for the user's confirmation. Keep that when adding messages.
- Session scoping of the dashboard (`sessionRootOf`, `sessionMembers`, `sessionForest`, `workspaceForest` in `shared/agent-tree.ts`) builds the project forest first and then picks trees, so filtering rules stay identical in both dashboards.
- Agents get `modeId: "auto"` only when the provider's snapshot `modes` include `auto` (`autoModeOf`). Otherwise the provider's default mode applies.
- `outputSchema` is not enforced by every provider, so `proposal.ts` also embeds an example of the exact shape in the prompt and parses defensively.
- Workspace and agent lists are read as a single page; pagination is a known open follow-up in `.forge/followups.md`.
- Daemon-side error strings are English only; client UI text goes through `client/i18n.ts` and `shared/messages.ts` (see the i18n rule below).

## Plugin constraints that have bitten this repo

- **Server code must not import `@getpaseo/client`, even with `import type`.** The registry/daemon build rejects it (`paseo-plugin-server-runtime-boundary`), while local `tsc` passes. Derive types from the plugin SDK instead, for example `type PaseoApi = PluginHandlerContext["paseo"]`. `@getpaseo/client` is fine in `tests/`.
- Client code cannot import `server/` or `node:*`; server code cannot import `client/`. No code modules in the repo root other than the two entries.
- Client UI must use React Native primitives only and take every text color from `theme.colors`.
- **Every new user-facing text must be added to all languages at once.** Add the key to `en` in `shared/messages.ts` and to each other resource there (`ko`, `ja`, `zh`), keeping `{{placeholders}}` and plural suffixes identical; never hard-code UI strings in `client/`. A new language needs its resource in `shared/messages.ts`, registration in `client/i18n.ts`, coverage in `tests/messages.test.ts`, its Command Center search `keywords` in `index.client.tsx` (the one per-language list kept outside `messages.ts`), and the Language sections of README and OVERVIEW. Resource keys are language codes (`zh` is Simplified Chinese); i18next falls back from tags like `zh-CN` or `ja-JP` to them, and to `en` when a language is missing.
- `requirements.paseo` in `paseo-plugin.json` must be raised when adopting newer plugin APIs. It is `>=0.15.0` (hooks via `addHook`, `defineAgentTool`, `addAgentPanel`, composer pills, slash commands); the dev SDK is pinned to 0.15.4.
- Team tools reach agents only with Paseo tools injected (`daemon.mcp.injectIntoAgents`, Settings → Orchestration → Enable Paseo tools), which is **off by default**. `teamToolsEnabled` reads it via `paseo.config.get()`; apply and restart refuse while it is off. The live daemon used for e2e has it on.
- Paseo 0.15 gives a panel no way to learn which agent tab has focus (`useComposers({ focused })` is 0.16+ and exposes no agent id). The session is handed over from the agent's own context (pill, agent Command Center item, slash command) via `addAgentPanel` + `openPanel(..., { agentId, location: "explorer" })`.

## Publishing

- Releases follow `.claude/skills/deploy/SKILL.md` ("배포해줘"): bump the version, tag, create a GitHub release, then open a PR on the registry record.
- The registry listing is `gyuha/agent-team` in `getpaseo/plugins` (`plugins/gyuha/agent-team.json`). It pins one reviewed Git commit, so pushing to `main` does not update `paseo plugin add gyuha/agent-team`. Update it with a PR that changes the record's commit. Do not use `gh issue create --label submission`: the label is dropped for this account, and the intake bot skips unlabeled issues. A pin change requested only in a review-PR comment was not applied (#1526).
- The pinned commit must contain `OVERVIEW.md`. Keep it factual, with no install instructions, and update it, and README "Limitations", when behaviour changes.
- To test the latest `main` before review, install directly with `paseo plugin add git:gyuha/paseo-agent-team`. A local-directory install and a Git or registry install share the id `paseo-agent-team`, so `paseo plugin remove paseo-agent-team` first.
