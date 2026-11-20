## Concept

Ensemble gives a Paseo project a team of agents. One lead agent, the orchestrator, controls the team, and each role on the team is a separate agent that can use its own provider and model. A team might have a Claude role for gameplay code, a Codex role for design and a Pi role for tests.

The team works in one of two collaboration modes, chosen in advance or per request:

- **Delegation** (pattern MA-04): the orchestrator splits your request, gives each part to the role that owns it, and sums up. Members work alone and report only to the orchestrator.
- **Team** (pattern MA-08): the orchestrator first works out the requirement with you, as the team's liaison, and nothing reaches the members until you confirm a written brief and task plan. Then the members work from a shared task board: they claim ready tasks (dependencies unlock as tasks finish), message each other through a mailbox, can be asked to get each plan approved, and review each other's done tasks in a second round; the orchestrator checks the result against the brief.
- **Auto**: the orchestrator picks one of the two for each request and says why.

A team has fixed roles, **candidate members** (a pool of models described by what they are good at and must not do, which the orchestrator assigns work to by those descriptions, never using other models), or both.

The team definition is a file in the repository, `.agents/teams/<workspace>.json`, so it can be committed and shared through git. A project can have several teams, but each team belongs to one workspace, and no two teams share a workspace.

```
delegation: request → orchestrator splits it → members work alone → orchestrator sums up
team:       request → intake with you → confirmed brief → members on a shared board (work, then review) → orchestrator integrates
```

## Requirements

- Paseo 0.16.0 or newer, and at least one ready provider on the host.
- Paseo tools turned on for agents: Settings → Orchestration → **Enable Paseo tools** (off by default). The orchestrator and members use the plugin's team tools, which Paseo serves next to its own tools. The team editor warns, and Start a session, Apply again and Reset session refuse, while it is off.

## Creating a team

- Open the workspace's **Agent team** tab (the team editor), the **Teams** tab of the Agent team sidebar, or run **Agent teams** from the Command Center.
- The sidebar's **Agent teams** screen lists every project with its teams. From there you can open a team's editor in its orchestrator's workspace, start a new team for a project, and reconnect a team whose orchestrator workspace was renamed (see Changing a team).
- Describe your goal to have a planner propose the team, leave the goal empty to have it read the project and work the goal out itself, or start with an empty team. The planner proposes fixed roles and/or candidate members, and a collaboration mode.
- Review the draft in the team editor, then press **Save** (writes the team file only) or **Start a session** (writes it and starts the lead, with an optional first request and the session's mode and agent language, in this workspace, the one named in the team, or a new one).

### Reviewing a proposal

- Review the names, models, folders and instructions of every role before you start a session. The editor checks the team as you edit: its header shows **Valid** or the number of problems, and each problem links to its field. Every role runs in the orchestrator's workspace.
- A blank role is named `role`. If that name is already in use, it gets a `#` and four random uppercase hex characters, such as `role#4F2A`.
- **Edit team with AI**: type a request under the role list. A request that names a role, or whose work fits one, changes that role; a new role is added only when asked for or when no role fits. A planner proposes the revised team, which is applied to the draft at once with a notice of what changed. **Undo** and **Redo** step through AI edits. Nothing is written to the team file until you press **Save** or **Start a session**.
- **Edit instructions** opens a dialog with the full instructions. **Improve with AI** asks an instructions planner to propose a rewrite, which you can apply or discard. **Save** in the dialog only updates the draft; the team's file is written by the editor's **Save** or **Start a session**.
- A proposal survives leaving the screen. When you reopen it, the plugin picks up the newest planner for that workspace or project, whether it is still running or ready to review.
- Proposing again, or cancelling the review, archives the earlier planner.

### Starting a session

Start a session does four things in order:

1. Writes the team to its own file. A new team goes to `.agents/teams/<orchestrator workspace>.json` in the registered project root. A team that already has a file keeps it, including the older `.agents/team.json`.
2. Reuses a project workspace whose title matches the orchestrator's workspace, or creates it.
3. Starts an orchestrator. If the team's orchestrator is already running on the same provider and model, it is told to re-read the team instead, so no second orchestrator starts. Starting also refuses a team that uses a workspace another team of the project already uses.
4. Archives the project's plugin-labelled planner agents and any unused, otherwise empty `Team planner` workspace. If cleanup fails, the session still starts and the failure is shown as a warning.

Starting may also write the allow rules described under Agent modes and permissions. You are then taken to the orchestrator's workspace.

## Starting a team from a new chat

A new agent's draft and the New workspace screen have a **Team** control in the composer: no team, the workspace's own team, or a global preset. With a team picked, the agent that the draft creates becomes the team's lead: it gets the lead's tools when it opens, and its standing instructions with its first team status. A preset picks its lead model and is written as the workspace's team file; a workspace that already runs another team refuses it. Picking "this workspace's team" where there is none refuses to start the agent and says what to do. A **Team mode** control sets the session's mode. When Paseo renames a new workspace (it is first titled with the prompt), the lead's team follows the new title. Workspaces that run a team show a badge in the sidebar: the mode, or how many members are working or need you.

## Working with the orchestrator

After **Start a session**, find the agent titled **Orchestrator** in the orchestrator's workspace (the sidebar's **Session** tab opens its chat), and talk to it in plain language. It starts and coordinates members only through the plugin's team tools, which give each role exactly its provider, model and mode and put it under the orchestrator on the dashboard.

- **Members work unattended**: a member starts in its provider's unattended mode (see Agent modes and permissions), and the plugin allows any tool permission prompt it still raises, so delegated work never waits for you to click Allow.
- **Delegation cards**: the orchestrator's chat shows **Handed off to agent** (or **Given more work**) when a member is given work, and **Update from worker** with the result when the member's turn ends (marked **Failed** or **Stopped** when it did not complete). A card expands to the task or the result, its member's name opens the member's chat, and its network icon opens the session dashboard. Paseo groups these rows with the turn's tool calls, so they sit inside the turn's tool group.

### Choosing the collaboration mode

- **In advance**: the team's mode (**Auto**, **Team** or **Delegation**) is set in the team editor and saved in the team file. A planner proposing a team picks it from the goal, usually **Auto**.
- **Per session**: the orchestrator's chat has a **Mode** pill next to the composer, and the session dashboard has a mode switch. Switching changes the mode for that orchestrator session only and tells the orchestrator; a run in progress keeps its mode. Picking the team file's mode again clears the switch.
- **Auto**: the orchestrator picks per request. The first run it starts fixes the session to that mode: the pills and the switch then show it locked (🔒) and refuse to change it, until the session is reset in the team editor. **None** (无) means no collaboration: the orchestrator does the work itself, and starting members is refused.
- **Language**: each team has an agent language (中文 or English; the app's language when unset), set in the team editor, the preset editor or when starting a session. It picks the prompts, the replies and the tool descriptions and results the plugin gives the orchestrator and members, so a Chinese team works and replies in Chinese. A team without a language takes the app's when it is applied or its orchestrator restarted, and a running orchestrator is replaced when the language changes.
- **Per request**: in **Auto**, the orchestrator picks for each request; you can also name a mode in the request.
- The plugin enforces the mode: in Team mode it refuses to delegate, and in Delegation mode it refuses to start a team run.

### Delegation

- The orchestrator splits the request into self-contained tasks and gives each to the role that owns it, or to a `helper` on its own provider and model when no role fits. A member sees only its own task.
- An idle member of the role on the same provider and model is continued; otherwise a new one starts, titled `<role>#<id>` and labelled `role=<role>`.
- When every member has finished, the orchestrator collects the results, follows up with a member if needed, and reports. If it ended its turn while members worked, the plugin tells it when they are done.

### Team

1. **Intake.** The orchestrator restates the request, asks what it needs to know (scope, acceptance criteria, constraints, which roles take part), and writes a brief and a task plan: tasks with details, a role, the tasks they wait for and the files they change. It doesn't start members or change files during intake.
2. **Confirmation.** The orchestrator records the brief and plan with the plugin and shows them to you; you confirm or correct them. The plugin starts a team run only when the orchestrator quotes a message you sent after the brief was recorded, so a request, or anything said before the brief, can't start a run.
3. **Work.** The plugin posts the brief, fills the task board and starts the roles. Members claim ready tasks (claiming a task also claims its files), mark them done with what they changed, and take the next one; a task that waits for others unlocks when they are done. The plugin hands ready tasks to idle members and starts a member for a role that has work but no member yet. Members can add tasks they discover.
4. **Mailbox.** Members address posts to roles, a member's title, the orchestrator or all; a message reaches a working recipient with its next tool result and wakes an idle one.
5. **Plan approval (optional).** When the brief asks for it, a member submits a plan for each task and waits until the orchestrator approves it or sends it back with feedback; the verdict reaches the member even if it was busy, and the task stays with it meanwhile.
6. **Review round.** When the work is done, each member checks the others' done tasks against the brief and sends back what misses it, with a reason; a sent-back task goes back to its role.
7. **Integration and close.** The orchestrator checks the acceptance criteria, sends back what still misses them, reports to you, and closes the run, optionally archiving the members.

### Global team presets

The Agent teams screen holds a library of team presets shared by every project on the host: a collaboration mode (Auto, Team or Delegation), the orchestrator's model and a pool of candidate members. Press **New task from preset** on any project to pick a preset, describe the request and choose a new or free workspace; the plugin writes the team for that workspace from the preset, starts the orchestrator with the request as its first message and opens it. The team editor can also fill a new team from a preset, or save its team as a preset. **Rename** renames a preset in place, and **Copy to project** writes it into a project as a team file (`.agents/teams/<preset>.json`) that you then **Reconnect** to a workspace. The Agent team sidebar's **Start** tab starts a lead from a preset, and its **Teams** tab has Copy to project and Rename too. Removing the plugin installation deletes the presets; teams started from them keep their own copy. Presets saved by this plugin under its former id, `paseo-agent-team`, can be imported once from the same screen.

### Candidate members

Candidate members are a pool of models, not roles. Each has a provider and model, an optional identifier (taken from the model when left empty) and a description of what it is good at and suited for, its cost or speed, and the work it must not be given. The orchestrator splits the work and gives each piece to the candidate whose description fits; what a description rules out is a hard rule in its instructions. It can give work to a candidate directly, or form a narrower session role on one, and it can only use the candidates' providers and models.

## Several teams per project

- A project can run several teams, one per workspace. A team belongs to the workspace its orchestrator runs in, and the **Agent team** tab of that workspace shows that team.
- Each team has its own file in `.agents/teams/`, and each team's orchestrator reads only its own file, so teams do not change each other.
- To create another team, open the **Agent team** tab in a workspace that has no team yet and create one as usual.

```
Workspace A editor → team A (.agents/teams/a.json) → orchestrator in A
Workspace B editor → team B (.agents/teams/b.json) → orchestrator in B
```

## Changing a team

- Open the team editor (the **Agent team** tab) in the team's orchestrator workspace, change the team and press **Save**, then **Apply again** so a running orchestrator re-reads it.
- Or edit the team's file directly and press **Apply again**. The editor shows the file's path, whether it has changes the file doesn't have yet, and flags any provider or model the host cannot run.
- **Reset session**: to reset the orchestrator session with the same team, press **Reset session** next to **Apply again**. Use it instead of `/clear`. Sending `/clear` in the orchestrator's chat makes Paseo archive that agent and start a new one with no labels and no instructions, so the plugin no longer treats it as the team's orchestrator. **Reset session** asks for confirmation, then archives the labelled orchestrator and starts a new one with the same team, provider, model, mode and instructions, read from the team file. Role sessions are kept. Close the agent that `/clear` created yourself.
- **Reconnect**: if you rename the orchestrator's workspace in Paseo, the team shows as "workspace not found" on the **Agent teams** screen. Press **Reconnect** on its row and pick the renamed workspace. That rewrites `orchestrator.workspace` in the team's file (and in an old `.agents/team.json` for the same workspace) to the new title. The file name and agents are not changed, and Reconnect refuses a workspace another team uses. If the orchestrator's workspace is gone rather than renamed, the Reconnect panel also offers **Start in a new workspace**, which runs the team like **Start a session** with its saved file, creating the workspace named in the file if needed and starting the orchestrator there. The panel lists only the project's workspaces that no other team uses, since one workspace runs one team. When none is free, the panel says so and offers only that button and Cancel.

## Deleting a team

- Press **Delete** on the team's row in the **Agent teams** screen and confirm.
- The delete archives the team's orchestrator, the role sessions labelled with its roles in its workspace (role names match case-insensitively), and any planner still proposing for its workspace, so a pending proposal does not come back.
- Agents in a workspace another team uses are left alone.
- No workspace is archived. Paseo workspaces carry no labels, so the plugin cannot tell a workspace it created from one you made. Empty workspaces stay for you to archive.
- Files are removed only after every agent is archived. Then the team's file and any old `.agents/team.json` for the same orchestrator workspace are deleted.
- If an agent cannot be archived, no file is deleted, and you can retry from the same row. If a file cannot be deleted, a separate message says so.
- A file committed to git shows up as a deletion to commit.

## Watching agents

The **Agent team sidebar** (the right sidebar's **+** menu, or **Open the Ensemble side panel** in the Command Center) has three tabs. **Session** shows the workspace's orchestrator and state, the mode switch, the members (each opens its chat) and the latest run's data flow, whose parts open the session dashboard. **Start** starts an orchestrator from this workspace's team or a preset, here or in a new workspace. **Teams** lists the project's teams and the presets.

The **session dashboard** shows one conversation. Its **Agents** tab shows the session's agents as a tree: an agent started by another agent appears under it.

- **Session dashboard**: one conversation only. Open it with **Open the session dashboard** at the bottom of the sidebar's **Session** tab, from a collaborating agent's **Dashboard** pill next to the composer, from the Command Center (**Session dashboard: this session**), or with `/dashboard` in the chat. It opens in the right sidebar and shows the session the agent belongs to: its orchestrator and every agent started under it, including members started in other workspaces, and nothing else from the project. A team lead's session has tabs: **Overview**, **Agents** (the tree), one tab per part of the mode, and **Data flow**. The overview has the mode switch, the run's header (mode, state, round or batch) and its details (run, lead, language, when it was created and last changed, how long it has run), the members and the roles the orchestrator formed, and its **data flow**: who takes part (you, the orchestrator, the members, the plugin), the parts of the mode (team: the brief, the shared task board, plan approval, the team board, file claims; delegation, after MA-04: the task split, the sub-agents' contexts, the reports, the summary), the latest flows between them with a moving dot for the last 30 seconds, and each part's newest event. A narrow panel stacks the participants above the parts. The latest flows are listed below, and every part opens its tab with its full content, who used it, and its history; **Data flow** lists every step. The task board is a Kanban (To do, In progress, Done, and Dropped when there are any) when the panel is wide enough, and stacked sections otherwise; the team board reads like a chat, grouped by round, with the orchestrator's posts on the right and long posts folded.

The plugin records the flow as the run changes and keeps the last 400 steps in the run file. In delegation mode every `team_delegate` call, and every follow-up the orchestrator sends one member, is a batch: its packets, the folder-overlap check, and the orchestrator's reply after it collected the batch's reports, which is recorded as the batch's summary. Delegation has no check step (MA-04), and the summary page says so. Notices the plugin sends by itself (a waiting plan, a verdict, a finished round) are recorded only once the send went through.

Use the **Density** toggle in the Agents tab's header to choose one of three levels. **Normal** is the default.

- **Brief**: a one-line pill with the provider logo, the role or title, a short model name and the status.
- **Normal**: a two-line card, 150px wide (140px in a narrow panel), with the logo, title and status, then `model · mode`.
- **Detailed**: the full card with caption, model, effort and mode chips, described below.

The choice is remembered per tab, like **Show closed**. Glow, arrival flash, signal dots and dashes are scaled to each level's node size.

- The orchestrator's caption shows the team's mode.
- Agents with no parent are roots and stay shown unless they are closed or archived. Roots without children are listed under **Solo agents**.
- Roles of the team that have not been started yet appear under the newest orchestrator of the team's workspace as dimmed **Waiting** cards on a dashed line. A waiting card is replaced by the real card once an agent labelled with that role shows up in the team's workspace.
- Provider sub-agents, such as those Claude Code starts with its Agent tool, appear as lighter **Sub-agent** cards under the Paseo agent that spawned them, labelled with their sub-agent type. They cannot be opened, since they are not Paseo agents. In **Brief** density they are collapsed into a **+N** badge under their parent, which expands on press. With **Show closed** off, a role agent or sub-agent is shown only while it is running or has the **!** badge, when one of its descendants is, or when it is the newest finished one of its type (role, or sub-agent type) under the same parent. Older finished ones, and the agents under them, are hidden. With **Show closed** on, every agent is shown.
- In **Detailed** density, each card shows the provider logo, the role or caption, the title, and the model, effort (thinking option) and permission mode chips. When an agent has no effort set, its effort chip shows the model's default effort from the provider, dimmed.
- Badges: **!** means the agent is waiting for a permission or has failed. An amber pulsing dot means it is running. ✓ means it has finished.
- Lines to running agents turn into animated red dashes with moving signal dots. An agent that is not running itself but has a running agent below it, such as an orchestrator waiting on its members, gets an amber border without the glow.
- Press a card to open that agent. Closed and archived agents are hidden unless **Show closed** is on.
- With **Show closed** on, a closed or archived agent card, or a finished sub-agent card, shows a small × that hides it, together with the agents under it, from that dashboard tab. **Restore hidden (N)** brings them all back, and **Hide closed (N)** hides every card that has a × at once. Hiding does not delete or archive anything in Paseo. A Paseo agent whose session stopped on an error also shows a small **Archive** button.

## Agent modes and permissions

Planner and orchestrator agents start in the provider's reviewed auto mode when it has one. The order is:

1. Codex's **Auto-review** (`auto-review`).
2. Otherwise an `auto` mode, such as Claude's **Auto** mode (`auto`).
3. Otherwise any other mode whose id or label has a word starting with `auto`, such as `auto_edit` or `Auto accept`.
4. Only a provider with none of these uses its unattended mode: the one marked unattended, otherwise the one Paseo marks dangerous, such as Antigravity's **Full access**.
5. Otherwise, a provider with none of these modes but an Auto Accept feature, such as Cursor, starts agents with that feature on. It approves every permission prompt without a reviewer.
6. Otherwise agents use the default mode.

- Auto mode and Auto-review send permission requests to an automatic reviewer. The unattended mode keeps running without asking you.
- **Members** start in their provider's unattended mode instead: the mode marked unattended, otherwise the one Paseo marks dangerous, otherwise a mode named like bypass, full access or yolo (for example `bypassPermissions` for Claude and `full-access` for Codex). A provider with none of these starts members like the orchestrator. The plugin allows any tool permission prompt a member raises; plan, question and mode prompts are left to you. Members can therefore run commands and change files without asking, so give a team only work you would let an unattended agent do.
- The planner is told not to change files, but it is not technically prevented from doing so.

**Allow rules in `.claude/settings.local.json`.** When the orchestrator runs on Claude, Start a session, Apply again and Reset session add the orchestrator's team tools (`mcp__paseo__team_status`, `mcp__paseo__team_delegate` and the others) to the project's `.claude/settings.local.json`, so Claude's Auto-mode reviewer doesn't block the orchestrator from starting a member in an unattended mode. When a role runs on Claude, the board tools are added too. Remove the rules to undo them. Check that you don't commit the file: Claude Code ignores it in git only when Claude Code itself created it.

## Data and privacy

- The plugin reads project, workspace, agent and provider metadata, the team files and the orchestrator's recent chat (to check that you confirmed a team brief). It may write the project's `.claude/settings.local.json`.
- Collaboration runs (briefs, task boards, board posts, members' final replies), briefs awaiting confirmation, per-session modes and formed roles are stored in the project under `.agents/runs/`, which the plugin keeps out of git with its own `.gitignore`. The newest 50 finished runs are kept.
- Planning sends your goal to the selected provider, preferring Claude when it is ready. The planner is instructed to inspect the repository.
- Orchestrator and member agents send their instructions, prompts, and any repository content or tool results they read to their configured providers, under those providers' normal behavior.
- These agents consume provider usage. Team mode costs more than delegation: every member reads the board and works through a review round.
- The plugin has no separate external service and no software download.

## Language

English, Korean, Japanese and Simplified Chinese UI text are included. Daemon-side error messages are in English.

## Limitations

- **Shared checkout.** All roles run in the orchestrator's workspace and share one project checkout; there is no per-member worktree. In team mode, task and file claims keep members from editing the same paths at the same time, but only for members that claim before they edit; folder assignments guide agents but do not enforce filesystem isolation.
- **Presets and reinstalling.** Global presets live in the plugin's host settings, so removing the installation deletes them.
- **Limits.** A team run has at most 8 members; the plugin hands a member at most 6 tasks and wakes it for messages at most 3 times per round, after which the orchestrator decides.
- **Tools must reach the agents.** The orchestrator and members need the plugin's team tools. If Paseo tools are turned off for a provider, the orchestrator says so and stops; a member without the board tools reports in its final reply, which the plugin puts on the board.
- **Model scope.** A role's model applies to members the plugin starts. Agents you start yourself in the team's workspace from Paseo's own UI still use whatever model you pick there.
- **Session focus.** Paseo doesn't tell a sidebar panel which chat has focus. The session dashboard follows the session it was opened from; open it again from another chat to follow that one.
- **Run timing.** The plugin moves a run along from Paseo's turn events. If the plugin was reloaded while members worked, the orchestrator's next wait catches up on members that finished meanwhile. A wait returns after at most 9 minutes; the orchestrator then waits again or answers you, and the plugin tells it when the run has finished.
- **Workspace matching.** A team is matched to its workspace by `orchestrator.workspace`. Renaming that workspace in Paseo or in the file detaches the team until the two match again. After renaming in Paseo, press **Reconnect** on the team's row, or edit `orchestrator.workspace` in the file.
- **Older team files.** A team file without a mode runs in delegation mode. A file written by an older version may still list a workspace for a role; starting a session or Apply again removes it.
- **Reset instead of /clear.** Sending `/clear` to the orchestrator makes Paseo replace it with an unlabelled agent that has no team tools. Use **Reset session**.
- **Sidebar order.** Paseo's sidebar puts a workspace it has not seen yet at the top of its project, so a workspace that Start a session creates appears there. The plugin cannot set the sidebar order.
- **Single-page lists.** Workspace and agent lists are read as a single page. Very long lists can make an existing workspace get missed and created again, and the session dashboard can miss agents beyond that page.
- **Client navigation.** On Paseo hosts without client navigation, the dashboard cards cannot be pressed.
- **Sub-agent discovery.** Sub-agents started before the dashboard opened are found in the last 200 timeline items of each unarchived agent shown. A sub-agent found that way takes its status from the timeline and can read as finished while it still runs in the background.
- **Narrow sidebar.** When the right sidebar is too narrow for the whole tree, the orchestrator card shrinks to its provider icon and model name, and the tree scrolls horizontally.
