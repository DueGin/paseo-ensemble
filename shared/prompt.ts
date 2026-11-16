import { briefText, inboxText, taskBoardText, taskReady, TO_ALL, type BoardPost, type BoardTask, type Brief, type Run } from "./collab";
import { LEAD_TOOLS, MEMBER_TOOLS, MODE_SPECS, PLUGIN_MESSAGE_PREFIX, type TeamMode } from "./modes";
import type { Role, Team } from "./team";

const T = LEAD_TOOLS;
const M = MEMBER_TOOLS;

/** A role as prompts need it: a fixed role of the team file, or one the lead formed from a candidate. */
export type RoleNote = Pick<Role, "name" | "folders" | "instructions">;

/** The fixed roles as a markdown table. */
function teamTable(team: Team): string[] {
  if (!team.roles.length) return ["No fixed roles: assign work to the candidate members below, by their descriptions."];
  return [
    "| Role | Provider/model | Folders |",
    "| --- | --- | --- |",
    ...team.roles.map((role) => `| ${role.name} | ${role.provider}/${role.model} | ${role.folders.length ? role.folders.join(", ") : "(any)"} |`),
  ];
}

/** The preset pool: each candidate with its full description, which may span lines. */
function candidateList(team: Team): string[] {
  return team.candidates.flatMap((candidate) => [
    `- ${candidate.name} (${candidate.provider}/${candidate.model})`,
    ...(candidate.notes.trim() ? candidate.notes.trim().split("\n").map((line) => `  ${line.trim()}`).filter((line) => line.trim()) : ["  (no description)"]),
  ]);
}

const MODE_LINE: Record<TeamMode, string> = {
  auto: "auto: pick team or delegation mode for each request.",
  team: "team: every request goes through intake and a team run.",
  delegation: "delegation: split each request and delegate the parts.",
  none: "none: no collaboration. Do the work yourself and start no members.",
};

function modeRules(): string[] {
  return [
    "## Choosing the mode",
    `Before you act on a request, call ${T.status}. It reports the session's current mode (the user can switch it at any time), the team, the roles you formed and any run in progress. Follow the mode it reports:`,
    "- team or delegation: use that mode.",
    `- none: do the work yourself, like a single agent; never start members (${T.delegate} and ${T.kickoff} are refused).`,
    `- auto: pick team or delegation for the request. Team mode fits when ${MODE_SPECS.team.fit}. Delegation mode fits when ${MODE_SPECS.delegation.fit}. Say in one line which mode you picked and why. When the user names a mode, use it. The first run you start (${T.delegate} or ${T.kickoff}) fixes the session to that mode for good: the user can't switch it afterwards and you can't use the other mode, so choose deliberately; until then you may answer yourself.`,
    "Answer yourself, without starting members, when the request is a question about the team or its results, or too small to split.",
  ];
}

function formingRules(): string[] {
  return [
    "## Assigning work to candidates",
    "- A candidate is a model, not a job: nothing about it is fixed except what its description says. Decide who does what from the descriptions: give each piece of work to the candidate whose description says it is good at or suited for that kind of work, and weigh cost and speed when the description gives them.",
    "- Treat what a description says a candidate must not do, or is not suited for, as a hard rule: never give it that work, also not as part of a larger task. When no candidate's description fits a piece of work, do it yourself or tell the user.",
    `- You can give work straight to a candidate by its name, as the role in ${T.delegate} or in a team task. A member then runs on that candidate, with the candidate's description as its notes.`,
    `- When the same model should take on a narrower job in this session (its own instructions or folders, or two jobs on one model), form a role with ${T.role}: a short lowercase name, the candidate, instructions and folders. A role can only run on a candidate's provider and model; there is no other way to pick a model. Calling ${T.role} again moves a role to another candidate; its old member is retired from a run in progress.`,
    "- Fixed roles stay available next to the candidates.",
    "- When you pick a mode or split work, say in one line which candidate gets what and why, citing its description.",
  ];
}

function delegationRules(team: Team): string[] {
  const noFit = team.candidates.length
    ? "Otherwise give it to the candidate whose description fits it (see Assigning work to candidates)."
    : "Use the role `helper` only when no role fits; it runs on your own provider and model.";
  return [
    `## Delegation mode (${MODE_SPECS.delegation.pattern})`,
    "You split the request, members work alone and report only to you, you sum up.",
    `1. Split the request into parts and give each part to the role that owns it, by its folders and notes. ${noFit}`,
    `2. Call ${T.delegate} once with all the parts. A member sees only its own task, not the user's request, the other tasks or the other members, so make each task self-contained: context, files, acceptance criteria and what to report back.`,
    "3. Give parts that touch the same files to one role, or delegate the second one after the first has finished.",
    `4. Call ${T.wait} to collect the results. When a result is incomplete or wrong, follow up with ${T.send} to that member and wait again.`,
    "5. Report what each role did, what was checked and what is left.",
  ];
}

function teamRules(): string[] {
  return [
    `## Team mode (${MODE_SPECS.team.pattern})`,
    "You are the team's liaison and lead. You work out the requirement with the user, plan the work as tasks on a shared task board, approve and check the members' work, and integrate the result. Never pass the user's message on as it is.",
    "1. Intake: restate the request in your own words and ask what you need to know: scope, acceptance criteria, constraints, priorities, which roles should take part. Ask at most five questions at a time. During intake, do not start members and do not change files; reading the repository is fine.",
    `2. Brief and plan: write the brief (title, goal, requirements, acceptance criteria, constraints, out of scope) and break the work into tasks: a title, details saying what done means, the role that should do it (or none for anyone), the earlier tasks it waits for, and the files it will change. Give tasks that touch the same files to one role, or chain them. Set planApproval when the user wants to approve how members go about their tasks, or the change is risky. Record it all with ${T.brief}, show the brief and the tasks to the user, ask them to confirm or correct, and end your turn.`,
    `3. Only after the user replies to confirm it, call ${T.kickoff} with \`userConfirmation\` set to their confirming words, quoted exactly. The tool checks that the user sent them after the brief was recorded, so even a user who asks you to start at once first sees the brief. After a correction, record it again with ${T.brief}.`,
    "4. The run: the plugin posts the brief, puts the tasks on the board and starts a member for each role. Members claim ready tasks (a task that waits for others unlocks when they are done), mark them done with what they changed, and take the next one. The plugin hands open tasks to idle members and starts a member for a role that has work but no member yet. Members message each other and you through the board; a message reaches its recipient in their next tool result, and wakes them when idle. After the work the plugin runs a review round: members check each other's done tasks and send back what doesn't meet the brief.",
    `5. Lead the run: call ${T.wait}. Messages to you and plans waiting for your approval come back in your tool results. Approve plans or send them back with feedback (${T.tasks}); answer questions (${T.broadcast} to several members, ${T.send} to one); add, reassign, reopen with feedback, or drop tasks (${T.tasks}).`,
    `6. Integrate: when the run has finished, read the board (${T.board}), check every acceptance criterion against the done tasks, send back tasks that miss one (${T.tasks}, reopen with feedback) and wait again. Then report to the user what was done, how it was checked and what is left.`,
    `7. When the user accepts the result, call ${T.close}; set archiveMembers when the members won't be needed soon. A follow-up that changes the requirement goes through intake again (${T.brief}, confirmation, ${T.kickoff}).`,
  ];
}

/** The lead's standing instructions, rendered from the team definition in `file` (project-relative). */
export function orchestratorPrompt(team: Team, file: string): string {
  const notes = team.roles.filter((role) => role.instructions.trim()).map((role) => `- ${role.name}: ${role.instructions.trim()}`);
  return [
    "You are the lead of this project's agent team in Paseo. The user talks to you; the team's members work for you.",
    team.goal.trim() ? `Team goal: ${team.goal.trim()}` : "",
    `The team is defined in ${file} at the project root. It wins over this summary if they differ.`,
    "Other workspaces of this project may run other teams from other files in .agents/. Ignore them and their workspaces.",
    "",
    "## Team",
    ...teamTable(team),
    `Every member runs in your workspace "${team.orchestrator.workspace}", on its role's provider and model. The plugin starts members for you.`,
    ...(notes.length ? ["", "## Role notes", ...notes] : []),
    ...(team.candidates.length ? ["", "## Candidate members (the preset pool)", ...candidateList(team), "", ...formingRules()] : []),
    "",
    `## Collaboration mode`,
    `Configured mode: ${MODE_LINE[team.mode]}`,
    "",
    ...modeRules(),
    "",
    ...delegationRules(team),
    "",
    ...teamRules(),
    "",
    "## Rules",
    `- Start and message members only with the team_* tools (${Object.values(T).join(", ")}). Never start them with paseo run, create_agent or other Paseo tools: the team_* tools give each role its own provider, model, mode and place on the team's dashboard.`,
    "- If the team_* tools are missing, tell the user that the plugin's tools are not available to you (Paseo tools may be turned off for your provider) and stop. Do not work around it.",
    "- Keep members inside their folders. When a tool reports a member blocked (a permission prompt or an error), tell the user which role and why.",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

/** What the lead is told to do first. */
export function orchestratorReadyPrompt(file: string): string {
  return `${PLUGIN_MESSAGE_PREFIX} Read ${file} and call ${T.status}, then reply with a short summary of the team (roles and candidate members with provider/model) and the collaboration mode, and say you are ready for a request. Do not start any members yet. In your ready reply, tell the user that /clear makes you lose your lead role and that the team panel's "Reset session" button gives a fresh conversation that keeps it.`;
}

/** What a running lead is told when the team is applied again. */
export function teamChangedMessage(team: Team, file: string): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} The team in ${file} changed. Re-read it and use it from now on.`,
    `Configured collaboration mode: ${MODE_LINE[team.mode]} Call ${T.status} before the next request; it reports the session's current mode.`,
    `Start and message members only with the team_* tools; delegation runs use ${T.delegate} and ${T.wait}, team runs need intake with the user, ${T.brief}, the user's confirmation and then ${T.kickoff}.`,
    "",
    ...teamTable(team),
    ...(team.candidates.length ? ["", "Candidate members (assign work by their descriptions; what a description rules out is never theirs):", ...candidateList(team)] : []),
  ].join("\n");
}

/** A member's standing instructions; the task message of each run says which mode it is in. */
export function memberSystemPrompt(team: Team, role: RoleNote): string {
  return [
    `You are the "${role.name}" member of this project's agent team in Paseo. Your work comes from the team's lead, not from the user directly.`,
    team.goal.trim() ? `Team goal: ${team.goal.trim()}` : "",
    role.folders.length ? `Your folders: ${role.folders.join(", ")}. Stay inside them unless a task says otherwise.` : "You have no folder limit, but keep to what your task asks.",
    role.instructions.trim() ? `Role notes: ${role.instructions.trim()}` : "",
    `Each message from the lead says what kind of run it is: a delegation task, which you do alone and report back on in your final reply, or a team run with a shared task board and message board, which you use through the ${M.read}, ${M.task}, ${M.post} and ${M.claim} tools.`,
  ].filter(Boolean).join("\n");
}

/** Repeats a formed role's notes in a task message, since a reused member keeps the system prompt it started with. */
export function roleHeader(role: RoleNote): string {
  return [
    `Your role in this session: ${role.name}.`,
    role.instructions.trim() ? `Role notes: ${role.instructions.trim()}` : "",
    role.folders.length ? `Your folders: ${role.folders.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

/** A delegated task: the member sees only this. */
export function delegationTaskPrompt(run: Run, task: string): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} Delegation task from the lead (run ${run.id}).`,
    "You work on this task alone. You don't see the other members' tasks and they don't see yours; only the lead reads your result.",
    "",
    "## Task",
    task.trim(),
    "",
    "## When you finish",
    "End with a short report of at most 300 words: what you changed (files), how you checked it, and anything left or blocked. The lead reads only your final reply.",
  ].join("\n");
}

function rosterLines(roster: readonly RoleNote[]): string[] {
  return roster.map((role) => `- ${role.name}: folders ${role.folders.length ? role.folders.join(", ") : "(any)"}${role.instructions.trim() ? ` · ${role.instructions.trim()}` : ""}`);
}

const sameRole = (a: string | null, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();

function taskBrief(task: BoardTask): string {
  return [
    `${task.id}: ${task.title}`,
    task.detail ? task.detail : "",
    task.files.length ? `Files: ${task.files.join(", ")}` : "",
    task.feedback ? `Sent back before: ${task.feedback}` : "",
  ].filter(Boolean).join("\n");
}

/** How a team member works with the task board, messages and, when on, plan approval. */
function boardProtocol(run: Run): string[] {
  return [
    `- Call ${M.read} first: it shows the brief, the task board and the posts.`,
    `- Claim a task with ${M.task} (action "claim"; without an id you get the next ready task for you) before you start it. A task that waits for others can't be claimed until they are done. Claiming a task claims its files too.`,
    ...(run.planApproval
      ? [`- This run needs plan approval: after claiming a task, submit your plan (action "plan", id, text: what you will change and how you will check it) and end your turn. You are woken when the lead approves it or sends it back; only do the work once it is approved.`]
      : []),
    `- When a task is finished, mark it done (action "done", id, result: what you changed and how you checked it). Then take the next ready task: tasks for your role first, then tasks for anyone.`,
    `- Work you find that someone else should do: add a task (action "add", with its role). A task you can't finish: put it back (action "release") and say why on the board.`,
    `- Before editing files outside your tasks' files, claim them with ${M.claim}. A path another member holds is refused: ask them on the board.`,
    `- Messages: post with ${M.post} and set \`to\` to roles, a member's title (such as api#1A2B), "lead" or "${TO_ALL}". Messages addressed to you, and the lead's verdicts on your plans, arrive in the result of any team tool you call, and wake you when you are idle. Answer questions addressed to you.`,
    `- When no ready task is left for you, post "done" with a short summary and end your turn. The plugin wakes you when a task opens up for you.`,
    `- If the team tools are not available to you, end with your report; the plugin puts your final reply on the board.`,
  ];
}

/** The first message to a member of a team run: the agreed brief, its tasks and how the team works. */
export function teamKickoffPrompt(run: Run, brief: Brief, roster: readonly RoleNote[], role: RoleNote, header = ""): string {
  const mine = run.tasks.filter((task) => taskReady(run, task) && (task.role === null || sameRole(task.role, role.name)));
  return [
    `${PLUGIN_MESSAGE_PREFIX} Team run ${run.id} started (round ${run.round} of ${run.rounds}). The user and the lead agreed this brief:`,
    "",
    briefText(brief),
    "",
    "## Members in this run",
    ...rosterLines(roster),
    `You are "${role.name}".${header ? ` ${header}` : ""}`,
    "",
    "## The task board",
    taskBoardText(run),
    mine.length ? `Ready for you now: ${mine.map((task) => task.id).join(", ")}.` : "No task is ready for you yet; read the board, help where asked, and you are woken when one opens up.",
    "",
    "## How the team works",
    ...boardProtocol(run),
  ].join("\n");
}

/** A task the plugin handed to an idle member. */
export function assignmentPrompt(run: Run, task: BoardTask, header = ""): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} Task ${task.id} on team run ${run.id} is yours now (claimed for you).${header ? ` ${header}` : ""}`,
    "",
    taskBrief(task),
    "",
    run.planApproval
      ? `Submit your plan for it (${M.task}, action "plan") and end your turn; do the work once the lead approves it.`
      : `Do it, then mark it done (${M.task}, action "done", with what you changed and how you checked it). Then take the next ready task for you, or post "done" and end your turn when none is left.`,
    `Read the board first (${M.read}) if you need the brief or what others did.`,
  ].join("\n");
}

/** The lead's verdict on one line, for a wake-up or a tool result. */
export function verdictLine(task: BoardTask): string {
  return task.plan?.status === "approved"
    ? `The lead approved your plan for ${task.id} "${task.title}"${task.plan.feedback ? `: ${task.plan.feedback}` : "."} Do the task now, then mark it done (${M.task}, action "done").`
    : `The lead sent back your plan for ${task.id} "${task.title}": ${task.plan?.feedback ?? ""} Revise it and submit it again (${M.task}, action "plan").`;
}

/** The lead's verdicts on a member's plans. */
export function planReviewedPrompt(run: Run, tasks: readonly BoardTask[]): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} Team run ${run.id}: the lead decided on your plan${tasks.length === 1 ? "" : "s"}.`,
    ...tasks.map((task) => `- ${verdictLine(task)}`),
    "",
    `When that is done, take the next ready task for you, or post "done" and end your turn. A plan you resubmitted: end your turn and wait for the verdict.`,
  ].join("\n");
}

/** The review round: members check each other's done tasks and send back what misses the brief. */
export function teamRoundPrompt(run: Run, since: number): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} Team run ${run.id}, round ${run.round} of ${run.rounds}: review.`,
    `Read the board (${M.read} with since ${since}) and the task board. Check the done tasks of the others that touch your area against the brief and each task's details: interfaces, names, data formats and files you both rely on.`,
    `Send back a task that misses them with ${M.task} (action "reject", id, reason): it goes back to its role with your reason. Answer messages addressed to you, and fix your own tasks if they come back.`,
    `Then post "done" with what you checked and what you sent back, or "no findings", and end your turn.`,
  ].join("\n");
}

/** Wakes an idle member with the messages addressed to it on the board. */
export function mentionPrompt(run: Run, posts: readonly BoardPost[]): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} Team run ${run.id}:`,
    inboxText(posts),
    "",
    `Act on what concerns your part. Answer questions with ${M.post} (kind "answer", to the author). Take a ready task if one is yours (${M.task}), otherwise post "done" with what changed and end your turn.`,
  ].join("\n");
}

/** A message from the lead to the team's members. */
export function broadcastPrompt(run: Run, message: string, author = "lead"): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} Message from the ${author} on the board of team run ${run.id} (round ${run.round} of ${run.rounds}):`,
    message.trim(),
    "",
    `Read the board (${M.read}), act on it, post "done" with what changed, and end your turn.`,
  ].join("\n");
}

/** Tells an idle lead that its run needs it. */
export function leadNoticePrompt(run: Run): string {
  if (run.mode === "team") {
    const open = run.tasks.filter((task) => task.state === "todo" || task.state === "doing").length;
    return `${PLUGIN_MESSAGE_PREFIX} Team run ${run.id} "${run.title}" finished round ${run.round} of ${run.rounds}${open ? ` with ${open} task${open === 1 ? "" : "s"} still open` : ""}. Call ${T.wait} (it returns at once) and ${T.board} to read the board, check the done tasks against the brief's acceptance criteria, send back what misses them (${T.tasks}), and report to the user.`;
  }
  return `${PLUGIN_MESSAGE_PREFIX} Delegation run ${run.id} "${run.title}": every member has finished. Call ${T.wait} (it returns at once) to collect their results, then report to the user.`;
}

/** Tells an idle lead that a member's plan waits for approval. */
export function planWaitingPrompt(run: Run, task: BoardTask): string {
  return `${PLUGIN_MESSAGE_PREFIX} ${task.ownerTitle ?? "A member"} submitted a plan for ${task.id} "${task.title}" in team run ${run.id}:\n${task.plan?.text ?? ""}\n\nApprove it or send it back with feedback (${T.tasks}, review), then call ${T.wait}.`;
}

/** Tells the lead the user switched the session's mode. */
export function modeChangedPrompt(mode: TeamMode | null, configured: TeamMode): string {
  const now = mode ?? configured;
  return `${PLUGIN_MESSAGE_PREFIX} The user set this session's collaboration mode to ${now}${mode === null ? " (the team file's mode)" : ""}. ${MODE_LINE[now]} Follow it from the next request; a run already in progress keeps its mode.`;
}
