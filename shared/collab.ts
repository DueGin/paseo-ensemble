// The state of one collaboration run: the request the lead hands to members, the members working on it and, in team
// mode, the shared board. Pure functions only, so the daemon handlers and the tests share them.
import type { RunEvent } from "./flow";
import { MODE_SPECS, PLUGIN_MESSAGE_PREFIX, type CollabMode, type PromptLanguage } from "./modes";

export const POST_KINDS = ["brief", "update", "finding", "question", "answer", "done", "note"] as const;
export type PostKind = (typeof POST_KINDS)[number];
/** What a member may post; the brief and notes come from the lead. */
export const MEMBER_POST_KINDS = ["update", "finding", "question", "answer", "done"] as const;

/** The requirement the lead and the user agreed before a team run starts. */
export interface Brief {
  title: string;
  goal: string;
  requirements: string[];
  acceptance: string[];
  constraints: string[];
  outOfScope: string[];
  /** The user's own words confirming the brief, quoted by the lead. */
  userConfirmation: string;
}

export interface BoardPost {
  seq: number;
  at: string;
  round: number;
  /** A role name, or "lead". */
  author: string;
  agentId: string;
  kind: PostKind;
  text: string;
  /** Role names the post is addressed to. */
  to: string[];
  files: string[];
}

export type MemberState = "working" | "done" | "attention" | "failed";

export interface RunMember {
  role: string;
  agentId: string;
  title: string;
  /** The delegated task; empty in a team run, where the brief applies. */
  task: string;
  state: MemberState;
  /** The member's final reply of its latest turn, shortened. */
  result: string | null;
  /** The lead has seen the latest result. */
  collected: boolean;
  /** The round of the member's latest "done" post; 0 when none. */
  doneRound: number;
  /** Board posts up to this seq have been shown to the member. */
  readSeq: number;
  /** Wake-ups for posts addressed to it in this round; capped so members can't ping-pong forever. */
  nudges: number;
  /** When the member was last given work; a member that looks idle right after it may not have started yet. */
  dispatchedAt: string;
  /** Tasks the plugin handed it while it was idle, this round. */
  dispatches: number;
  /** Posts addressed to it (or to all) up to this seq have been delivered to it. */
  inboxSeq: number;
  /** Replaced (its role moved to another model, or the lead let it go); gets no more work in this run. */
  retired: boolean;
}

export interface Claim {
  role: string;
  agentId: string;
  path: string;
  at: string;
}

/** todo: open (ready once its dependencies are done); doing: claimed by a member; done; dropped by the lead. */
export const TASK_STATES = ["todo", "doing", "done", "dropped"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export interface BoardTask {
  /** `T1`, `T2`, … in the order tasks were added. */
  id: string;
  title: string;
  detail: string;
  /** The role that should do it; null when any member may. */
  role: string | null;
  /** Tasks that must be done first. */
  deps: string[];
  /** Paths the task will change; claimed for its owner while it works on it. */
  files: string[];
  state: TaskState;
  /** The member working on it or that did it. */
  owner: string | null;
  ownerTitle: string | null;
  result: string;
  /** In a run with plan approval: the owner's plan and the lead's verdict. */
  plan: TaskPlan | null;
  /** Why the task was sent back, by the lead or a reviewer; the next owner reads it. */
  feedback: string;
  /** The member that last gave it back unfinished; the plugin doesn't hand it straight back to that member. */
  returnedBy: string | null;
  /** "lead", or the role of the member that added it. */
  createdBy: string;
  updatedAt: string;
}

export interface TaskPlan {
  text: string;
  status: "pending" | "approved" | "rejected";
  feedback: string;
  /** The idle lead was told the plan waits for it. */
  notified: boolean;
  /** The owner has been given the lead's verdict. */
  delivered: boolean;
}

/**
 * One fan-out of a delegation run (MA-04): the lead's split of a request into task packets, one per role, and the lead's
 * summary once the packets' reports are in. A follow-up the lead sends one member is a batch of its own.
 */
export interface DelegationBatch {
  round: number;
  title: string;
  /** Why the lead picked delegation for the request (auto mode). */
  reason: string;
  at: string;
  /** The packets handed out (board task ids). */
  taskIds: string[];
  /** Roles whose folders overlap, so two packets may write the same files. */
  warnings: string[];
  /** A follow-up to one member (team_send), not a new split. */
  followUp: boolean;
  /** The lead's reply after it collected the batch's reports. */
  summary: string;
  summaryAt: string | null;
}

/** A task as the lead or a member describes it; `after` names the tasks it waits for. */
export interface NewTask {
  title: string;
  detail?: string;
  role?: string | null;
  after?: string[];
  files?: string[];
}

export interface Run {
  version: 1;
  id: string;
  /** The language of everything the plugin writes for this run's agents. */
  language: PromptLanguage;
  leadAgentId: string;
  workspaceId: string;
  mode: CollabMode;
  title: string;
  /** Why the lead picked this mode (in auto mode). */
  reason: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "closed";
  /** Team: the round in progress. Delegation: the batch of tasks in progress. */
  round: number;
  /** Team: rounds to run before the lead integrates. Delegation: always equal to `round`. */
  rounds: number;
  brief: Brief | null;
  members: RunMember[];
  posts: BoardPost[];
  claims: Claim[];
  /** The shared task board. A team run's members claim and finish tasks; a delegation run's tasks mirror what was delegated. */
  tasks: BoardTask[];
  /** Members submit a plan for each task and wait for the lead's approval before they do it. */
  planApproval: boolean;
  /** Posts addressed to the lead up to this seq have been delivered to it. */
  leadInboxSeq: number;
  /** Board posts up to this seq have been shown to the lead. */
  leadReadSeq: number;
  /** The round the lead was last told about; 0 when never. */
  notifiedRound: number;
  /** The run's data flow, newest last (see flow.ts). */
  events: RunEvent[];
  eventSeq: number;
  /** Delegation runs: each split of a request into packets, and its summary. */
  batches: DelegationBatch[];
}

/** Wake-ups a member can get for posts addressed to it, per round. */
export const MAX_NUDGES = 3;
/** Tasks the plugin hands an idle member per round; past that, the lead decides. */
export const MAX_DISPATCHES = 6;
/** Members one run may have; staffing roles on demand stops there. */
export const MAX_TEAM_SIZE = 8;
/** Addressing every member of the run in a post's `to`. */
export const TO_ALL = "all";
export const MAX_ROUNDS = 3;
export const DEFAULT_TEAM_ROUNDS = 2;

export function excerpt(text: string | null | undefined, max: number): string {
  const value = (text ?? "").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** A run id such as `R3F2A90C1`; `random` returns 0..1. */
export function newRunId(random: () => number = Math.random): string {
  return `R${Math.floor(random() * 0x100000000).toString(16).padStart(8, "0").toUpperCase()}`;
}

/** A member title such as `ui#ADB2`. */
export function memberTitle(role: string, random: () => number = Math.random): string {
  return `${role}#${Math.floor(random() * 0x10000).toString(16).padStart(4, "0").toUpperCase()}`;
}

export function createRun(input: { id: string; leadAgentId: string; workspaceId: string; mode: CollabMode; title: string; reason?: string; rounds?: number; brief?: Brief | null; planApproval?: boolean; language?: PromptLanguage; now: string }): Run {
  const rounds = input.mode === "team" ? Math.min(MAX_ROUNDS, Math.max(1, input.rounds ?? DEFAULT_TEAM_ROUNDS)) : 1;
  return {
    version: 1,
    id: input.id,
    language: input.language ?? "en",
    leadAgentId: input.leadAgentId,
    workspaceId: input.workspaceId,
    mode: input.mode,
    title: input.title.trim() || input.id,
    reason: input.reason?.trim() ?? "",
    createdAt: input.now,
    updatedAt: input.now,
    status: "active",
    round: 1,
    rounds,
    brief: input.brief ?? null,
    members: [],
    posts: [],
    claims: [],
    tasks: [],
    planApproval: input.mode === "team" && input.planApproval === true,
    leadInboxSeq: 0,
    leadReadSeq: 0,
    notifiedRound: 0,
    events: [],
    eventSeq: 0,
    batches: [],
  };
}

/** A run as read from disk; files written before the task board have no tasks. */
export function normalizeRun(run: Run): Run {
  return {
    ...run,
    language: run.language ?? "en",
    planApproval: run.planApproval ?? false,
    leadInboxSeq: run.leadInboxSeq ?? 0,
    events: Array.isArray(run.events) ? run.events : [],
    batches: Array.isArray(run.batches) ? run.batches : [],
    eventSeq: run.eventSeq ?? (Array.isArray(run.events) ? run.events.at(-1)?.seq ?? 0 : 0),
    tasks: (Array.isArray(run.tasks) ? run.tasks : []).map((task) => ({ ...task, plan: task.plan ? { ...task.plan, delivered: task.plan.delivered ?? true } : null, feedback: task.feedback ?? "", returnedBy: task.returnedBy ?? null })),
    members: run.members.map((member) => ({ ...member, dispatches: member.dispatches ?? 0, inboxSeq: member.inboxSeq ?? 0, retired: member.retired ?? false })),
  };
}

export function memberOf(run: Run, agentId: string): RunMember | undefined {
  return run.members.find((member) => member.agentId === agentId);
}

export function updateMember(run: Run, agentId: string, patch: Partial<RunMember>, now: string): Run {
  return { ...run, updatedAt: now, members: run.members.map((member) => (member.agentId === agentId ? { ...member, ...patch } : member)) };
}

/** Adds the member, or puts an existing one back to work on the new task. */
export function upsertMember(run: Run, member: Pick<RunMember, "role" | "agentId" | "title" | "task">, now: string): Run {
  const fresh: RunMember = { ...member, state: "working", result: null, collected: false, doneRound: 0, readSeq: memberOf(run, member.agentId)?.readSeq ?? 0, nudges: 0, dispatchedAt: now, dispatches: 0, inboxSeq: memberOf(run, member.agentId)?.inboxSeq ?? 0, retired: false };
  const exists = memberOf(run, member.agentId) !== undefined;
  return { ...run, updatedAt: now, members: exists ? run.members.map((entry) => (entry.agentId === member.agentId ? fresh : entry)) : [...run.members, fresh] };
}

export function addPost(run: Run, post: Omit<BoardPost, "seq" | "at" | "round">, now: string): { run: Run; post: BoardPost } {
  const full: BoardPost = { ...post, text: post.text.trim(), seq: (run.posts.at(-1)?.seq ?? 0) + 1, at: now, round: run.round };
  let next: Run = { ...run, updatedAt: now, posts: [...run.posts, full] };
  if (post.kind === "done" && post.author !== "lead") {
    next = updateMember(next, post.agentId, { doneRound: run.round }, now);
    next = releaseFreeClaims(next, post.agentId);
  }
  return { run: next, post: full };
}

/** A repository-relative path in one spelling; "" is the whole repository. */
export function normalizePath(path: string): string {
  const value = path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  return value === "." ? "" : value;
}

/** Two paths overlap when one contains the other. */
export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  return left === "" || right === "" || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export interface ClaimConflict {
  path: string;
  heldBy: string;
  held: string;
}

/** Claims paths for a member; nothing is claimed when another working member holds an overlapping path. */
export function claimPaths(run: Run, agentId: string, paths: readonly string[], now: string): { run: Run; conflicts: ClaimConflict[] } {
  const member = memberOf(run, agentId);
  if (!member) return { run, conflicts: [] };
  const wanted = [...new Set(paths.map(normalizePath))];
  const holders = new Set(run.members.filter((entry) => entry.state === "working" || entry.state === "attention").map((entry) => entry.agentId));
  const conflicts = wanted.flatMap((path) =>
    run.claims
      .filter((claim) => claim.agentId !== agentId && holders.has(claim.agentId) && pathsOverlap(claim.path, path))
      .map((claim) => ({ path: path || ".", heldBy: claim.role, held: claim.path || "." })),
  );
  if (conflicts.length) return { run, conflicts };
  const own = new Set(run.claims.filter((claim) => claim.agentId === agentId).map((claim) => claim.path));
  const added = wanted.filter((path) => !own.has(path)).map((path) => ({ role: member.role, agentId, path, at: now }));
  return { run: { ...run, updatedAt: now, claims: [...run.claims, ...added] }, conflicts: [] };
}

/** Releases a member's claims, except the files of tasks it still holds. */
export function releaseFreeClaims(run: Run, agentId: string): Run {
  const held = new Set((run.tasks ?? []).filter((task) => task.owner === agentId && task.state === "doing").flatMap((task) => task.files));
  return { ...run, claims: run.claims.filter((claim) => claim.agentId !== agentId || held.has(claim.path)) };
}

/** Releases the given paths of a member, or all of them. */
export function releaseClaims(run: Run, agentId: string, paths?: readonly string[]): Run {
  const drop = paths ? new Set(paths.map(normalizePath)) : null;
  return { ...run, claims: run.claims.filter((claim) => claim.agentId !== agentId || (drop !== null && !drop.has(claim.path))) };
}

const busy = (member: RunMember) => member.state === "working" || member.state === "attention";

/** No member is still working on the current round or batch. */
export function roundComplete(run: Run): boolean {
  return run.members.length > 0 && !run.members.some(busy);
}

/** Every member finished the run's last round or batch and no open task is waiting for an idle member; a follow-up may still reopen it. */
export function runFinished(run: Run): boolean {
  return roundComplete(run) && (run.mode === "delegation" || (run.round >= run.rounds && !dispatchPlan(run).length && !pendingPlans(run).length && !undeliveredVerdicts(run).length));
}

export function workingMembers(run: Run): RunMember[] {
  return run.members.filter(busy);
}

export type NextStep =
  | { kind: "none" }
  | { kind: "dispatch"; assignments: Assignment[] }
  | { kind: "verdicts"; taskIds: string[] }
  | { kind: "plans"; taskIds: string[] }
  | { kind: "next-round"; round: number }
  | { kind: "notify-lead" };

/**
 * What the plugin does after a change: hand open tasks to idle members (team runs), start the next team round, tell the
 * lead, or nothing yet.
 */
export function nextStep(run: Run): NextStep {
  if (run.status !== "active") return { kind: "none" };
  if (run.mode === "team") {
    const assignments = dispatchPlan(run);
    if (assignments.length) return { kind: "dispatch", assignments };
    const verdicts = undeliveredVerdicts(run);
    const idleOwners = verdicts.filter((task) => memberOf(run, task.owner!)?.state === "done").map((task) => task.id);
    if (idleOwners.length) return { kind: "verdicts", taskIds: idleOwners };
    const plans = pendingPlans(run);
    const untold = plans.filter((task) => !task.plan!.notified).map((task) => task.id);
    if (untold.length) return { kind: "plans", taskIds: untold };
    // The round can't end while plans wait for the lead's verdict, or a verdict waits for its owner.
    if (plans.length || verdicts.length) return { kind: "none" };
  }
  if (!roundComplete(run)) return { kind: "none" };
  if (run.mode === "team" && run.round < run.rounds && run.members.some((member) => member.state === "done")) return { kind: "next-round", round: run.round + 1 };
  if (run.notifiedRound >= run.round) return { kind: "none" };
  if (!run.members.some((member) => !member.collected)) return { kind: "none" };
  return { kind: "notify-lead" };
}

/** Starts the next team round: members that finished go back to work and may be woken again. */
export function startRound(run: Run, now: string): Run {
  return {
    ...run,
    updatedAt: now,
    round: run.round + 1,
    rounds: Math.max(run.rounds, run.round + 1),
    members: run.members.map((member) => (member.state === "failed" || member.retired ? member : { ...member, state: "working", collected: false, nudges: 0, dispatches: 0, dispatchedAt: now })),
  };
}

/**
 * Puts members back to work for a message from the lead. When the round is over, it starts another one with just them,
 * so the lead hears back once they finish.
 */
export function wakeMembers(run: Run, agentIds: readonly string[], now: string): Run {
  const ids = new Set(agentIds);
  const complete = roundComplete(run);
  const round = complete ? run.round + 1 : run.round;
  return {
    ...run,
    updatedAt: now,
    round,
    rounds: Math.max(run.rounds, round),
    members: run.members.map((member) => (ids.has(member.agentId) && member.state !== "working" ? { ...member, state: "working", collected: false, nudges: complete ? 0 : member.nudges, dispatches: complete ? 0 : member.dispatches, dispatchedAt: now } : member)),
  };
}

/** Starts another delegation batch, so a finished batch's notice doesn't block the next one. */
export function startBatch(run: Run, now: string): Run {
  return roundComplete(run) ? { ...run, updatedAt: now, round: run.round + 1, rounds: run.round + 1 } : run;
}

/** Opens a delegation batch for the run's current round; packets join it as they are handed out. */
export function addBatch(run: Run, batch: Pick<DelegationBatch, "title" | "reason" | "warnings" | "followUp">, now: string): Run {
  const fresh: DelegationBatch = { round: run.round, title: batch.title.trim(), reason: batch.reason.trim(), at: now, taskIds: [], warnings: [...batch.warnings], followUp: batch.followUp, summary: "", summaryAt: null };
  return { ...run, updatedAt: now, batches: [...run.batches.filter((entry) => entry.round !== run.round), fresh] };
}

/** Adds a handed-out packet to the batch of the run's current round. */
export function attachPacket(run: Run, taskId: string): Run {
  return { ...run, batches: run.batches.map((batch) => (batch.round === run.round && !batch.taskIds.includes(taskId) ? { ...batch, taskIds: [...batch.taskIds, taskId] } : batch)) };
}

/** The batch whose reports the lead has all collected but not summarized yet. */
export function batchToSummarize(run: Run): DelegationBatch | undefined {
  const batch = run.batches.at(-1);
  if (run.mode !== "delegation" || !batch || batch.summaryAt || !batch.taskIds.length) return undefined;
  const owners = new Set(batch.taskIds.map((id) => taskOf(run, id)?.owner).filter((owner): owner is string => !!owner));
  const members = run.members.filter((member) => owners.has(member.agentId));
  return members.length && members.every((member) => !busy(member) && member.collected) ? batch : undefined;
}

/** Records the lead's reply after collecting a batch as its summary. */
export function summarizeBatch(run: Run, text: string, now: string): Run {
  const batch = batchToSummarize(run);
  if (!batch) return run;
  return { ...run, updatedAt: now, batches: run.batches.map((entry) => (entry === batch ? { ...entry, summary: excerpt(text, 8000), summaryAt: now } : entry)) };
}

/** The lead has seen every finished member's result, and the posts up to `readSeq` (all of them when omitted). */
export function markCollected(run: Run, now: string, readSeq?: number): Run {
  return { ...run, updatedAt: now, leadReadSeq: Math.max(run.leadReadSeq, readSeq ?? run.posts.at(-1)?.seq ?? 0), members: run.members.map((member) => (busy(member) ? member : { ...member, collected: true })) };
}

/** Records a member's finished turn; in a team run, its final reply goes on the board when it posted no "done" itself. */
export function finishMember(run: Run, agentId: string, outcome: "completed" | "failed" | "canceled", lastMessage: string | null, now: string): Run {
  const member = memberOf(run, agentId);
  if (!member) return run;
  let next = updateMember(run, agentId, { state: outcome === "failed" ? "failed" : "done", result: excerpt(lastMessage, 4000) || null, collected: false }, now);
  if (run.mode === "team" && member.doneRound !== run.round) {
    const zh = run.language === "zh";
    const text = outcome === "failed" ? `${zh ? "（出错停止）" : "(stopped with an error)"} ${excerpt(lastMessage, 600)}`.trim() : excerpt(lastMessage, 1500) || (zh ? "（结束时没有最终回复）" : "(finished without a final reply)");
    next = addPost(next, { author: member.role, agentId, kind: "done", text, to: [], files: [] }, now).run;
  }
  if (run.mode === "delegation") {
    // A delegated task is the member's whole turn: done when the turn completes; dropped when it failed or was canceled,
    // so the lead re-delegates it as a new task.
    const finished = outcome === "completed";
    next = { ...next, tasks: next.tasks.map((task) => (task.owner === agentId && task.state === "doing" ? { ...task, state: finished ? "done" : "dropped", result: finished ? excerpt(lastMessage, 300) : `${outcome}: ${excerpt(lastMessage, 300)}`, updatedAt: now } : task)) };
    return releaseClaims(next, agentId);
  }
  // A task whose plan waits for the lead, or whose verdict hasn't reached its owner yet, stays with the owner, with its
  // files claimed: the owner is woken with the verdict. Any other task the member still held goes back on the board.
  const keep = (task: BoardTask) => task.plan !== null && (task.plan.status === "pending" || !task.plan.delivered);
  const held = next.tasks.filter((task) => task.owner === agentId && task.state === "doing" && !keep(task));
  if (held.length) {
    next = { ...next, tasks: next.tasks.map((task) => (held.includes(task) ? { ...task, state: "todo", owner: null, ownerTitle: null, plan: null, returnedBy: agentId, updatedAt: now } : task)) };
    const ids = held.map((task) => task.id).join(", ");
    next = addPost(next, { author: "lead", agentId: run.leadAgentId, kind: "note", text: run.language === "zh" ? `${member.title} 本轮结束时没有完成 ${ids}，已放回任务板。` : `${member.title} ended its turn without finishing ${ids}; back on the board.`, to: [], files: [] }, now).run;
  }
  const kept = new Set(next.tasks.filter((task) => task.owner === agentId && task.state === "doing").flatMap((task) => task.files));
  return { ...next, claims: next.claims.filter((claim) => claim.agentId !== agentId || kept.has(claim.path)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Task board

/** A message in the run's language. */
const say = (run: Pick<Run, "language">, en: string, zh: string) => (run.language === "zh" ? zh : en);

const sameRole = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export function taskOf(run: Run, id: string): BoardTask | undefined {
  return run.tasks.find((task) => task.id.toLowerCase() === id.trim().toLowerCase());
}

/** The dependencies of a task that are not done yet; a dependency the lead dropped no longer holds it back. */
export function waitingOn(run: Run, task: BoardTask): string[] {
  return task.deps.filter((dep) => { const state = taskOf(run, dep)?.state; return state !== "done" && state !== "dropped"; });
}

/** Open, with every dependency done. */
export function taskReady(run: Run, task: BoardTask): boolean {
  return task.state === "todo" && waitingOn(run, task).length === 0;
}

/** Whether the member's role may take the task. */
export function mayTake(member: Pick<RunMember, "role">, task: BoardTask): boolean {
  return task.role === null || sameRole(task.role, member.role);
}

/**
 * Adds tasks; `after` may name existing tasks or, by 1-based position, earlier tasks in the same list. A task may only
 * wait for earlier tasks, so the board never has a dependency cycle.
 */
export function addTasks(run: Run, tasks: readonly NewTask[], createdBy: string, now: string): { run: Run; added: BoardTask[]; errors: string[] } {
  const errors: string[] = [];
  const added: BoardTask[] = [];
  let number = run.tasks.reduce((max, task) => Math.max(max, Number(task.id.slice(1)) || 0), 0);
  tasks.forEach((input, index) => {
    const deps: string[] = [];
    for (const ref of input.after ?? []) {
      const trimmed = String(ref).trim();
      const position = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
      const byPosition = Number.isInteger(position) && position >= 1 && position <= index ? added[position - 1] : undefined;
      const target = byPosition ?? taskOf({ ...run, tasks: [...run.tasks, ...added] }, trimmed);
      if (!target) errors.push(say(run, `task ${index + 1} ("${input.title}"): "${trimmed}" is not an earlier task`, `任务 ${index + 1}（「${input.title}」）：「${trimmed}」不是排在它前面的任务`));
      else if (!deps.includes(target.id)) deps.push(target.id);
    }
    number += 1;
    added.push({
      id: `T${number}`,
      title: input.title.trim(),
      detail: (input.detail ?? "").trim(),
      role: input.role?.trim() ? input.role.trim() : null,
      deps,
      files: [...new Set((input.files ?? []).map(normalizePath))],
      state: "todo",
      owner: null,
      ownerTitle: null,
      result: "",
      plan: null,
      feedback: "",
      returnedBy: null,
      createdBy,
      updatedAt: now,
    });
  });
  if (errors.length) return { run, added: [], errors };
  return { run: { ...run, updatedAt: now, tasks: [...run.tasks, ...added] }, added, errors };
}

/** The member takes a task: the given one, else the first ready one for its role, else the first ready one for anyone. */
export function claimTask(run: Run, agentId: string, id: string | undefined, now: string): { run: Run; task?: BoardTask; error?: string } {
  const member = memberOf(run, agentId);
  if (!member) return { run, error: say(run, "You are not a member of this run.", "你不是这次运行的成员。") };
  if (member.retired) return { run, error: say(run, "You were replaced in this run; take no more tasks.", "你在这次运行中已被替换，不要再领取任务。") };
  const ready = run.tasks.filter((task) => taskReady(run, task) && mayTake(member, task));
  const task = id
    ? taskOf(run, id)
    : ready.find((entry) => entry.role !== null) ?? ready[0];
  if (!task) return { run, error: id ? say(run, `There is no task ${id}.`, `没有任务 ${id}。`) : say(run, "No open task is ready for you.", "现在没有可以领取的任务。") };
  if (task.state === "doing") return { run, error: say(run, `${task.id} is already taken by ${task.ownerTitle ?? "another member"}.`, `${task.id} 已被 ${task.ownerTitle ?? "其他成员"} 领取。`) };
  if (task.state !== "todo") return { run, error: say(run, `${task.id} is ${task.state}.`, `${task.id} 的状态是 ${task.state}。`) };
  if (!mayTake(member, task)) return { run, error: say(run, `${task.id} is for the ${task.role} role.`, `${task.id} 指定给角色 ${task.role}。`) };
  const waiting = waitingOn(run, task);
  if (waiting.length) return { run, error: say(run, `${task.id} waits for ${waiting.join(", ")}.`, `${task.id} 需要等待 ${waiting.join(", ")} 完成。`) };
  let next = run;
  if (task.files.length) {
    const result = claimPaths(next, agentId, task.files, now);
    if (result.conflicts.length) return { run, error: say(run, `${task.id}'s files are held: ${result.conflicts.map((conflict) => `${conflict.path} by ${conflict.heldBy}`).join("; ")}. Take another task or ask them on the board.`, `${task.id} 的文件已被占用：${result.conflicts.map((conflict) => `${conflict.path}（${conflict.heldBy}）`).join("；")}。请领取其他任务，或在黑板上问对方。`) };
    next = result.run;
  }
  const taken = { ...task, state: "doing" as const, owner: agentId, ownerTitle: member.title, plan: null, returnedBy: null, updatedAt: now };
  return { run: { ...next, updatedAt: now, tasks: next.tasks.map((entry) => (entry.id === task.id ? taken : entry)) }, task: taken };
}

/** The owner finishes a task; its files are released. */
export function completeTask(run: Run, agentId: string, id: string, result: string, now: string): { run: Run; task?: BoardTask; error?: string } {
  const task = taskOf(run, id);
  if (!task) return { run, error: say(run, `There is no task ${id}.`, `没有任务 ${id}。`) };
  if (task.owner !== agentId || task.state !== "doing") return { run, error: say(run, `${task.id} is not yours to finish (${task.state}${task.ownerTitle ? `, ${task.ownerTitle}` : ""}). Claim it first.`, `${task.id} 不是你正在做的任务（${task.state}${task.ownerTitle ? `，${task.ownerTitle}` : ""}），请先领取。`) };
  if (run.planApproval && task.plan?.status !== "approved") return { run, error: say(run, `${task.id} needs an approved plan first: submit it (action "plan") and end your turn; the lead approves or sends it back.`, `${task.id} 需要先通过计划审批：提交计划（action "plan"）后结束本轮，由协调器批准或打回。`) };
  if (!result.trim()) return { run, error: say(run, "Say what you changed and how you checked it in the result.", "请在 result 里写清改了什么、怎么验证的。") };
  const done = { ...task, state: "done" as const, result: result.trim(), updatedAt: now };
  const next = task.files.length ? releaseClaims(run, agentId, task.files) : run;
  return { run: { ...next, updatedAt: now, tasks: next.tasks.map((entry) => (entry.id === task.id ? done : entry)) }, task: done };
}

/** The owner puts a task back on the board. */
export function releaseTask(run: Run, agentId: string, id: string, now: string): { run: Run; error?: string } {
  const task = taskOf(run, id);
  if (!task || task.owner !== agentId || task.state !== "doing") return { run, error: say(run, `${id} is not a task you are working on.`, `${id} 不是你正在做的任务。`) };
  const next = task.files.length ? releaseClaims(run, agentId, task.files) : run;
  return { run: { ...next, updatedAt: now, tasks: next.tasks.map((entry) => (entry.id === task.id ? { ...entry, state: "todo", owner: null, ownerTitle: null, plan: null, returnedBy: agentId, updatedAt: now } : entry)) } };
}

export interface TaskChange {
  id: string;
  title?: string;
  detail?: string;
  /** A role, or null for anyone; changing it takes the task off its current owner. */
  role?: string | null;
  /** "todo" reopens or takes a task off its owner; "dropped" cancels it. */
  state?: "todo" | "dropped";
  after?: string[];
  /** Why it is reopened; reopening a done task with feedback sends it back to its role. */
  feedback?: string;
}

/** The lead edits, reassigns, reopens or drops tasks. */
export function updateTasks(run: Run, changes: readonly TaskChange[], now: string): { run: Run; errors: string[] } {
  const errors: string[] = [];
  let next = run;
  for (const change of changes) {
    const task = taskOf(next, change.id);
    if (!task) {
      errors.push(say(run, `There is no task ${change.id}.`, `没有任务 ${change.id}。`));
      continue;
    }
    let deps = task.deps;
    if (change.after) {
      const position = next.tasks.indexOf(task);
      const earlier = new Set(next.tasks.slice(0, position).map((entry) => entry.id.toLowerCase()));
      const bad = change.after.filter((dep) => !earlier.has(dep.trim().toLowerCase()));
      if (bad.length) {
        errors.push(say(run, `${task.id} can only wait for earlier tasks, not ${bad.join(", ")}.`, `${task.id} 只能等待排在它前面的任务，不能等待 ${bad.join(", ")}。`));
        continue;
      }
      deps = change.after.map((dep) => taskOf(next, dep)!.id);
    }
    const reassigned = change.role !== undefined && !sameRole(change.role, task.role);
    const reopen = change.state === "todo" || (reassigned && task.state === "doing");
    const owner = reopen || change.state === "dropped" ? null : task.owner;
    if (task.owner && owner === null && task.files.length) next = releaseClaims(next, task.owner, task.files);
    const updated: BoardTask = {
      ...task,
      title: change.title?.trim() || task.title,
      detail: change.detail !== undefined ? change.detail.trim() : task.detail,
      role: change.role !== undefined ? (change.role?.trim() ? change.role.trim() : null) : task.role,
      deps,
      state: change.state ?? (reopen ? "todo" : task.state),
      owner,
      ownerTitle: owner ? task.ownerTitle : null,
      plan: owner ? task.plan : null,
      feedback: change.feedback !== undefined ? change.feedback.trim() : task.feedback,
      returnedBy: reopen || reassigned ? null : task.returnedBy,
      updatedAt: now,
    };
    next = { ...next, updatedAt: now, tasks: next.tasks.map((entry) => (entry.id === task.id ? updated : entry)) };
  }
  return { run: next, errors };
}

export interface Assignment {
  taskId: string;
  agentId: string;
}

/**
 * Which ready, unowned tasks go to which idle members: a task for a role goes to an idle member of that role, a task
 * for anyone to any idle member; one task per member at a time, and at most MAX_DISPATCHES per member per round.
 */
export function dispatchPlan(run: Run): Assignment[] {
  if (run.status !== "active" || run.mode !== "team") return [];
  // After the lead was told the run finished, new work opens a new round (see assignTasks), with a fresh budget.
  const reopen = roundComplete(run) && run.notifiedRound >= run.round;
  const holding = new Set(run.tasks.filter((task) => task.state === "doing" && task.owner).map((task) => task.owner!));
  const idle = run.members.filter((member) => member.state === "done" && !member.retired && !holding.has(member.agentId) && (reopen || member.dispatches < MAX_DISPATCHES));
  const used = new Set<string>();
  const assignments: Assignment[] = [];
  for (const task of run.tasks) {
    if (!taskReady(run, task)) continue;
    const fits = (member: RunMember) => !used.has(member.agentId) && member.agentId !== task.returnedBy && (task.files.length === 0 || claimPaths(run, member.agentId, task.files, run.updatedAt).conflicts.length === 0);
    const member = idle.find((entry) => fits(entry) && task.role !== null && sameRole(task.role, entry.role)) ?? (task.role === null ? idle.find(fits) : undefined);
    if (!member) continue;
    used.add(member.agentId);
    assignments.push({ taskId: task.id, agentId: member.agentId });
  }
  return assignments;
}

/**
 * Hands tasks to idle members: each task is claimed for its member and the member goes back to work. After the lead was
 * told the run finished, this opens another round, so the lead hears back when the new work is done.
 */
export function assignTasks(run: Run, assignments: readonly Assignment[], now: string): Run {
  const reopen = roundComplete(run) && run.notifiedRound >= run.round;
  let next: Run = reopen ? { ...run, round: run.round + 1, rounds: Math.max(run.rounds, run.round + 1) } : run;
  for (const { taskId, agentId } of assignments) {
    const member = memberOf(next, agentId);
    const task = taskOf(next, taskId);
    if (!member || !task || !taskReady(next, task) || member.state === "working") continue;
    const taken = claimTask(next, agentId, task.id, now);
    if (!taken.task) continue;
    next = updateMember(taken.run, agentId, { state: "working", collected: false, dispatchedAt: now, dispatches: (reopen ? 0 : member.dispatches) + 1 }, now);
  }
  return { ...next, updatedAt: now };
}

/** Sends a done task back to its role with the reviewer's reason; the next owner reads the feedback. */
export function rejectTask(run: Run, id: string, feedback: string, now: string): { run: Run; task?: BoardTask; error?: string } {
  const task = taskOf(run, id);
  if (!task) return { run, error: say(run, `There is no task ${id}.`, `没有任务 ${id}。`) };
  if (task.state !== "done") return { run, error: say(run, `${task.id} is ${task.state}; only a done task can be sent back.`, `${task.id} 的状态是 ${task.state}，只能打回已完成的任务。`) };
  if (!feedback.trim()) return { run, error: say(run, "Say what is wrong, so the next owner can fix it.", "请写明问题所在，方便下一个负责人修正。") };
  const reopened: BoardTask = { ...task, state: "todo", owner: null, ownerTitle: null, plan: null, returnedBy: null, feedback: feedback.trim(), result: `previous attempt: ${excerpt(task.result, 300)}`, updatedAt: now };
  return { run: { ...run, updatedAt: now, tasks: run.tasks.map((entry) => (entry.id === task.id ? reopened : entry)) }, task: reopened };
}

/** The owner submits its plan for a task, in a run with plan approval. */
export function submitPlan(run: Run, agentId: string, id: string, text: string, now: string): { run: Run; task?: BoardTask; error?: string } {
  if (!run.planApproval) return { run, error: say(run, "This run doesn't need plan approval; go ahead with the task.", "这次运行不需要计划审批，直接做任务即可。") };
  const task = taskOf(run, id);
  if (!task || task.owner !== agentId || task.state !== "doing") return { run, error: say(run, `${id} is not a task you are working on. Claim it first.`, `${id} 不是你正在做的任务，请先领取。`) };
  if (!text.trim()) return { run, error: say(run, "The plan is empty.", "计划是空的。") };
  const planned: BoardTask = { ...task, plan: { text: text.trim(), status: "pending", feedback: "", notified: false, delivered: false }, updatedAt: now };
  return { run: { ...run, updatedAt: now, tasks: run.tasks.map((entry) => (entry.id === task.id ? planned : entry)) }, task: planned };
}

/** Marks plans as told to the lead. */
export function markPlansNotified(run: Run, taskIds: readonly string[], notified: boolean, now: string): Run {
  const ids = new Set(taskIds);
  return { ...run, updatedAt: now, tasks: run.tasks.map((task) => (ids.has(task.id) && task.plan ? { ...task, plan: { ...task.plan, notified } } : task)) };
}

/** The lead approves a pending plan, or sends it back with feedback. */
export function reviewPlan(run: Run, id: string, approve: boolean, feedback: string, now: string): { run: Run; task?: BoardTask; error?: string } {
  const task = taskOf(run, id);
  if (!task?.plan || task.plan.status !== "pending" || task.state !== "doing") return { run, error: say(run, `${id} has no plan waiting for approval.`, `${id} 没有待审批的计划。`) };
  if (!approve && !feedback.trim()) return { run, error: say(run, "Say what to change when you send a plan back.", "打回计划时请写明要改什么。") };
  const reviewed: BoardTask = { ...task, plan: { ...task.plan, status: approve ? "approved" : "rejected", feedback: feedback.trim(), delivered: false }, updatedAt: now };
  return { run: { ...run, updatedAt: now, tasks: run.tasks.map((entry) => (entry.id === task.id ? reviewed : entry)) }, task: reviewed };
}

export function pendingPlans(run: Run): BoardTask[] {
  return run.tasks.filter((task) => task.state === "doing" && task.plan?.status === "pending");
}

/** Whether a post is addressed to the member: by its role, its title (such as `api#1A2B`), or to all. */
export function addressedTo(post: BoardPost, member: Pick<RunMember, "role" | "title">): boolean {
  return post.to.some((to) => sameRole(to, member.role) || sameRole(to, member.title) || sameRole(to, TO_ALL));
}

/** Posts addressed to the member it hasn't been given yet; its own posts excluded. */
export function inboxOf(run: Run, agentId: string): BoardPost[] {
  const member = memberOf(run, agentId);
  if (!member) return [];
  return run.posts.filter((post) => post.seq > member.inboxSeq && post.agentId !== agentId && addressedTo(post, member));
}

/** Posts addressed to the lead it hasn't been given yet. */
export function leadInbox(run: Run): BoardPost[] {
  return run.posts.filter((post) => post.seq > run.leadInboxSeq && post.author !== "lead" && post.to.some((to) => sameRole(to, "lead")));
}

/** Text for unread messages, appended to a tool result so mail reaches a member mid-turn without interrupting it. */
export function inboxText(posts: readonly BoardPost[], lang: PromptLanguage = "en"): string {
  if (!posts.length) return "";
  return [WORDS[lang].inbox(posts.length), ...posts.map((post) => postLine(post, lang))].join("\n");
}

export function markInbox(run: Run, agentId: string | "lead", seq: number, now: string): Run {
  if (agentId === "lead") return { ...run, updatedAt: now, leadInboxSeq: Math.max(run.leadInboxSeq, seq) };
  return updateMember(run, agentId, { inboxSeq: Math.max(memberOf(run, agentId)?.inboxSeq ?? 0, seq) }, now);
}

/** Roles with a ready task that no active member of the run can take; the plugin starts a member for each. */
export function unstaffedRoles(run: Run): string[] {
  if (run.status !== "active" || run.mode !== "team") return [];
  const staffed = (role: string) => run.members.some((member) => !member.retired && member.state !== "failed" && sameRole(member.role, role));
  const roles: string[] = [];
  for (const task of run.tasks) {
    if (task.role && taskReady(run, task) && !staffed(task.role) && !roles.some((role) => sameRole(role, task.role))) roles.push(task.role);
  }
  return roles;
}

/** Retires the run's members of a role, after the role moved to another model; their open tasks go back on the board. */
export function retireRole(run: Run, role: string, now: string): Run {
  const leaving = run.members.filter((member) => sameRole(member.role, role) && !member.retired).map((member) => member.agentId);
  if (!leaving.length) return run;
  return {
    ...run,
    updatedAt: now,
    members: run.members.map((member) => (leaving.includes(member.agentId) ? { ...member, retired: true } : member)),
    tasks: run.tasks.map((task) => (task.owner && leaving.includes(task.owner) && task.state === "doing" ? { ...task, state: "todo", owner: null, ownerTitle: null, plan: null, returnedBy: null, updatedAt: now } : task)),
    claims: run.claims.filter((claim) => !leaving.includes(claim.agentId)),
  };
}

/** Plans the lead decided on whose owner hasn't been given the verdict yet. */
export function undeliveredVerdicts(run: Run): BoardTask[] {
  return run.tasks.filter((task) => task.state === "doing" && task.owner !== null && task.plan !== null && task.plan.status !== "pending" && !task.plan.delivered);
}

export function markVerdictsDelivered(run: Run, taskIds: readonly string[], delivered: boolean, now: string): Run {
  const ids = new Set(taskIds);
  return { ...run, updatedAt: now, tasks: run.tasks.map((task) => (ids.has(task.id) && task.plan ? { ...task, plan: { ...task.plan, delivered } } : task)) };
}

/**
 * A member that calls a team tool is in a turn, even one the plugin didn't start (the user wrote to it, or a message
 * reached it late); marking it working means the end of that turn is tracked. Its dispatch time is set a few seconds
 * back, so the end of this very turn is never mistaken for an older one.
 */
export function touchMember(run: Run, agentId: string, now: string): Run {
  const member = memberOf(run, agentId);
  if (!member || member.retired || member.state !== "done") return run;
  return updateMember(run, agentId, { state: "working", collected: false, dispatchedAt: new Date(Date.parse(now) - 5000).toISOString() }, now);
}

/** Lets one member go (it was archived): no more work, and its open tasks go back on the board. */
export function retireMember(run: Run, agentId: string, now: string): Run {
  if (!memberOf(run, agentId)) return run;
  return {
    ...run,
    updatedAt: now,
    members: run.members.map((member) => (member.agentId === agentId ? { ...member, retired: true } : member)),
    tasks: run.tasks.map((task) => (task.owner === agentId && task.state === "doing" ? { ...task, state: "todo", owner: null, ownerTitle: null, plan: null, returnedBy: agentId, updatedAt: now } : task)),
    claims: run.claims.filter((claim) => claim.agentId !== agentId),
  };
}

/** Words in the texts the plugin writes for agents: the board, the task board, briefs and run summaries. */
const WORDS = {
  en: {
    taskState: { todo: "todo", doing: "doing", done: "done", dropped: "dropped" } as Record<TaskState, string>,
    waitsFor: "waits for", anyone: "anyone", result: "result", plan: "plan", planStatus: { pending: "pending", approved: "approved", rejected: "rejected" } as Record<TaskPlan["status"], string>,
    lead: "lead", sentBack: "sent back", files: "files", noTasks: "No tasks on the board.", tasks: "Tasks",
    round: "round", empty: "The board is empty.", noNew: (seq: number) => `No new posts since #${seq}.`,
    more: (seq: number) => `… more posts after #${seq}; read again with since ${seq}.`,
    inbox: (count: number) => `📬 ${count} new message${count === 1 ? "" : "s"} for you:`,
    requirements: "Requirements", acceptance: "Acceptance criteria", constraints: "Constraints", outOfScope: "Out of scope",
    memberState: { working: "working", done: "finished", attention: "needs attention", failed: "failed" } as Record<MemberState, string>,
    runState: { closed: "closed", finished: "finished", progress: "in progress" },
    run: (id: string, mode: string, pattern: string, title: string) => `Run ${id} (${mode} mode, ${pattern}) "${title}"`,
    roundOf: (round: number, rounds: number) => `round ${round} of ${rounds}`, batch: (round: number) => `batch ${round}`,
    task: "task", claims: "Claims", noMembers: "no members yet", board: (count: number, unread: number) => `Board: ${count} posts, ${unread} unread.`,
    mode: { team: "team", delegation: "delegation" } as Record<CollabMode, string>,
    colon: ": ", comma: ", ", paren: (text: string) => ` (${text})`,
  },
  zh: {
    taskState: { todo: "待办", doing: "进行中", done: "已完成", dropped: "已取消" } as Record<TaskState, string>,
    waitsFor: "等待", anyone: "任何人", result: "结果", plan: "计划", planStatus: { pending: "待审批", approved: "已批准", rejected: "已打回" } as Record<TaskPlan["status"], string>,
    lead: "协调器", sentBack: "被打回", files: "文件", noTasks: "任务板上还没有任务。", tasks: "任务",
    round: "第", empty: "黑板上还没有帖子。", noNew: (seq: number) => `#${seq} 之后没有新帖子。`,
    more: (seq: number) => `…… #${seq} 之后还有帖子；用 since ${seq} 继续读取。`,
    inbox: (count: number) => `📬 你有 ${count} 条新消息：`,
    requirements: "需求", acceptance: "验收标准", constraints: "约束", outOfScope: "不在范围内",
    memberState: { working: "进行中", done: "已完成", attention: "需处理", failed: "失败" } as Record<MemberState, string>,
    runState: { closed: "已结束", finished: "已完成", progress: "进行中" },
    run: (id: string, mode: string, pattern: string, title: string) => `运行 ${id}（${mode}模式，${pattern}）「${title}」`,
    roundOf: (round: number, rounds: number) => `第 ${round}/${rounds} 轮`, batch: (round: number) => `第 ${round} 批`,
    task: "任务", claims: "已认领", noMembers: "还没有成员", board: (count: number, unread: number) => `黑板：${count} 条帖子，${unread} 条未读。`,
    mode: { team: "团队", delegation: "委派" } as Record<CollabMode, string>,
    colon: "：", comma: "，", paren: (text: string) => `（${text}）`,
  },
};

export function taskLine(run: Run, task: BoardTask, lang: PromptLanguage = run.language ?? "en"): string {
  const w = WORDS[lang];
  const waiting = task.state === "todo" ? waitingOn(run, task) : [];
  const state = waiting.length ? `${w.taskState.todo}${w.comma}${w.waitsFor} ${waiting.join(", ")}` : w.taskState[task.state];
  const who = task.ownerTitle ? ` — ${task.ownerTitle}` : "";
  const result = task.result && (task.state === "done" || task.state === "todo") ? `\n    ${w.result}${w.colon}${excerpt(task.result, 200)}` : "";
  const plan = task.plan ? `\n    ${w.plan}${w.paren(w.planStatus[task.plan.status]).trimStart()}${w.colon}${excerpt(task.plan.text, 200)}${task.plan.feedback ? ` · ${w.lead}${w.colon}${excerpt(task.plan.feedback, 160)}` : ""}` : "";
  const feedback = task.feedback && task.state !== "done" ? `\n    ${w.sentBack}${w.colon}${excerpt(task.feedback, 200)}` : "";
  return `- ${task.id} [${state}] (${task.role ?? w.anyone}) ${task.title}${who}${task.files.length ? ` · ${w.files}${w.colon}${task.files.join(", ")}` : ""}${result}${plan}${feedback}`;
}

/** The task board as text, in board order. */
export function taskBoardText(run: Run, lang: PromptLanguage = run.language ?? "en"): string {
  const w = WORDS[lang];
  if (!run.tasks.length) return w.noTasks;
  const counts = TASK_STATES.map((state) => `${run.tasks.filter((task) => task.state === state).length} ${w.taskState[state]}`).join(w.comma);
  return [`${w.tasks}${w.paren(counts)}${w.colon.trimEnd()}`, ...run.tasks.map((task) => taskLine(run, task, lang))].join("\n");
}

export function postLine(post: BoardPost, lang: PromptLanguage = "en"): string {
  const w = WORDS[lang];
  const to = post.to.length ? ` → ${post.to.join(", ")}` : "";
  const files = post.files.length ? `\n  ${w.files}${w.colon}${post.files.join(", ")}` : "";
  const round = lang === "zh" ? `[第 ${post.round} 轮]` : `[round ${post.round}]`;
  return `#${post.seq} ${round} ${post.author} · ${post.kind}${to}\n${post.text.split("\n").map((line) => `  ${line}`).join("\n")}${files}`;
}

/** The board after `since`, oldest first. */
export function boardText(run: Run, since = 0): string {
  return boardPage(run, since, Infinity).text;
}

/**
 * The board after `since`, oldest first, within `budget` characters. `lastSeq` is the last post shown, so a reader's
 * marker never moves past posts it didn't get; at least one post is shown even when it alone exceeds the budget.
 */
export function boardPage(run: Run, since: number, budget: number): { text: string; lastSeq: number; more: boolean } {
  const w = WORDS[run.language ?? "en"];
  const posts = run.posts.filter((post) => post.seq > since);
  if (!posts.length) return { text: since ? w.noNew(since) : w.empty, lastSeq: since, more: false };
  const lines: string[] = [];
  let used = 0;
  let lastSeq = since;
  for (const post of posts) {
    const line = postLine(post, run.language ?? "en");
    if (lines.length && used + line.length + 2 > budget) break;
    lines.push(line);
    used += line.length + 2;
    lastSeq = post.seq;
  }
  const more = lastSeq < posts.at(-1)!.seq;
  return { text: lines.join("\n\n") + (more ? `\n\n${w.more(lastSeq)}` : ""), lastSeq, more };
}

export function briefText(brief: Brief, lang: PromptLanguage = "en"): string {
  const w = WORDS[lang];
  const list = (title: string, items: readonly string[]) => (items.length ? [`${title}${lang === "zh" ? "：" : ":"}`, ...items.map((item) => `- ${item}`)] : []);
  return [
    `# ${brief.title}`,
    brief.goal,
    ...list(w.requirements, brief.requirements),
    ...list(w.acceptance, brief.acceptance),
    ...list(w.constraints, brief.constraints),
    ...list(w.outOfScope, brief.outOfScope),
  ].join("\n");
}

/** What the lead reads about a run. */
export function runSummary(run: Run): string {
  const lang = run.language ?? "en";
  const w = WORDS[lang];
  const state = run.status === "closed" ? w.runState.closed : runFinished(run) ? w.runState.finished : w.runState.progress;
  const head = `${w.run(run.id, w.mode[run.mode], MODE_SPECS[run.mode].pattern, run.title)} · ${state} · ${run.mode === "team" ? w.roundOf(run.round, run.rounds) : w.batch(run.round)}`;
  const members = run.members.map((member) => `- ${member.title} (${member.role}): ${w.memberState[member.state]}${member.task ? ` · ${w.task}: ${excerpt(member.task, 120)}` : ""}`);
  const claims = run.claims.length ? [`${w.claims}:`, ...run.claims.map((claim) => `- ${claim.role}: ${claim.path || "."}`)] : [];
  return [head, ...(members.length ? members : [`- ${w.noMembers}`]), ...claims, run.tasks.length ? taskBoardText(run) : "", run.mode === "team" ? w.board(run.posts.length, run.posts.filter((post) => post.seq > run.leadReadSeq).length) : ""].filter(Boolean).join("\n");
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ").replace(/^["'“”「」『』]+|["'“”「」『』]+$/g, "").trim();

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** The timeline position; later messages have larger ones. */
  seq: number;
}

/** A brief the lead showed the user, waiting for their confirmation; `seq` is the end of the lead's chat when it was recorded. */
export interface PendingBrief {
  brief: Omit<Brief, "userConfirmation">;
  roles: string[];
  rounds: number;
  reason: string;
  /** The task breakdown shown with the brief; `after` holds 1-based positions in this list. */
  tasks: NewTask[];
  planApproval: boolean;
  seq: number;
  at: string;
}

/**
 * Whether `quote` is the user's confirmation of a brief recorded at `afterSeq`: a fair part of a message the user sent
 * after the brief was shown, not a message the plugin sent. The request, or anything said before the brief, can't count,
 * so intake always takes a turn in which the lead shows the brief and the user agrees to it.
 */
export function confirmsBrief(conversation: readonly ChatMessage[], afterSeq: number, quote: string): boolean {
  const needle = squash(quote);
  if (!needle) return false;
  return conversation.some((message) => {
    if (message.role !== "user" || message.seq <= afterSeq || message.text.trimStart().startsWith(PLUGIN_MESSAGE_PREFIX)) return false;
    const text = squash(message.text);
    // A word picked out of a long correction isn't a confirmation.
    return text.includes(needle) && needle.length >= Math.min(text.length, Math.ceil(text.length * 0.4));
  });
}

/** The user and assistant messages in a timeline page (`timeline.refetch().entries`), oldest first. */
export function conversationFrom(entries: readonly unknown[]): ChatMessage[] {
  return entries
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { item, seqStart } = entry as { item?: unknown; seqStart?: unknown };
      if (!item || typeof item !== "object" || typeof seqStart !== "number") return [];
      const { type, text } = item as { type?: unknown; text?: unknown };
      if (typeof text !== "string" || (type !== "user_message" && type !== "assistant_message")) return [];
      return [{ role: type === "user_message" ? "user" : "assistant", text, seq: seqStart } as ChatMessage];
    })
    .sort((a, b) => a.seq - b.seq);
}

/** The end of a timeline page: the last position in it, 0 when empty. */
export function timelineEnd(entries: readonly unknown[]): number {
  return entries.reduce<number>((end, entry) => {
    const value = entry && typeof entry === "object" ? (entry as { seqEnd?: unknown; seqStart?: unknown }) : {};
    const seq = typeof value.seqEnd === "number" ? value.seqEnd : typeof value.seqStart === "number" ? value.seqStart : 0;
    return Math.max(end, seq);
  }, 0);
}
