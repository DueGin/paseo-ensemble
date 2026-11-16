// The data flow of a collaboration run: which agent wrote into which component of the mode and what each component handed
// to whom. Team mode (MA-08): the brief, the shared task board, plan approval, the team board, file claims. Delegation
// mode (MA-04, "split → N isolated sub-agents → summary"): the task split, the sub-agents' contexts, the reports and the
// lead's summary. Events are derived by comparing a run before and after each change, so every path that changes a run
// is traced the same way.
import type { BoardTask, Run } from "./collab";
import type { CollabMode } from "./modes";

/** The parts of a collaboration mode that agents read from and write to. */
export const RUN_COMPONENTS = ["brief", "tasks", "plans", "board", "claims", "split", "contexts", "reports", "summary"] as const;
export type RunComponent = (typeof RUN_COMPONENTS)[number];

export const FLOW_ACTIONS = [
  "confirm", "publish", "deliver", "add", "update", "drop", "reopen", "claim", "assign", "done", "release", "reassign", "reject",
  "submit", "approve", "return", "verdict", "notify", "post", "read", "round", "conflict", "report", "collect", "close", "selfClaim",
  "split", "followup", "warn", "start", "continue", "attention", "resume", "summarize",
] as const;
export type FlowAction = (typeof FLOW_ACTIONS)[number];

/** Who acted or received: the lead, the user, the plugin, or a member's agent id. */
export type FlowParty = "lead" | "user" | "plugin" | (string & {});

export interface RunEvent {
  seq: number;
  /** When it last happened; repeated reads and deliveries fold into one event. */
  at: string;
  component: RunComponent;
  action: FlowAction;
  /** "in": `from` wrote into the component. "out": the component handed something to `to`. */
  direction: "in" | "out";
  from: FlowParty;
  /** Receivers of an "out" event; for a post, the roles or titles it is addressed to. */
  to: string[];
  /** A task id (`T3`), post numbers (`#4`, `#5–#9`) or paths. */
  subject: string;
  note: string;
  count: number;
}

export type NewEvent = Omit<RunEvent, "seq" | "count" | "at">;

/** Events a run keeps; older ones drop off. */
export const MAX_EVENTS = 400;
/** Repeated reads and deliveries to the same agent within this window fold into one event. */
const FOLD_MS = 90_000;
const FOLDED = new Set<FlowAction>(["read", "deliver"]);

/** The components a run of the mode has, in the order the dashboard shows them. */
export function componentsOf(mode: CollabMode): RunComponent[] {
  return mode === "team" ? ["brief", "tasks", "plans", "board", "claims"] : ["split", "contexts", "reports", "summary"];
}

const clip = (text: string | null | undefined, max: number) => {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
};

const range = (from: number, to: number) => (to > from + 1 ? `#${from + 1}–#${to}` : `#${to}`);

/** Appends events, folding a repeated read or delivery into the previous one. */
export function logEvents(run: Run, events: readonly NewEvent[], now: string): Run {
  if (!events.length) return run;
  const log = [...(run.events ?? [])];
  let seq = run.eventSeq ?? log.at(-1)?.seq ?? 0;
  for (const event of events) {
    if (FOLDED.has(event.action)) {
      const index = log.findLastIndex((entry) => entry.component === event.component && entry.action === event.action && entry.to.join() === event.to.join());
      const last = index >= 0 ? log[index]! : undefined;
      // Fold only while nothing else came in between for that receiver.
      if (last && index >= log.length - 6 && Date.parse(now) - Date.parse(last.at) < FOLD_MS) {
        const start = last.subject.match(/^#(\d+)/)?.[1];
        const end = event.subject.match(/(\d+)$/)?.[1];
        log[index] = { ...last, at: now, count: last.count + 1, subject: start && end && Number(end) > Number(start) ? `#${start}–#${end}` : event.subject };
        continue;
      }
    }
    seq += 1;
    log.push({ ...event, seq, at: now, count: 1 });
  }
  return { ...run, events: log.slice(-MAX_EVENTS), eventSeq: seq };
}

/**
 * The events between two states of a run. Notices the plugin sends (plans waiting, verdicts, a finished round) are not
 * derived here: the plugin marks them before sending and undoes the mark when the send fails, so it logs them once sent.
 * `actor` is who caused the change: "lead", a member's agent id, or the plugin
 * (the default) moving the run along on its own.
 */
export function traceRun(before: Run | null, after: Run, actor: FlowParty = "plugin"): NewEvent[] {
  const events: NewEvent[] = [];
  const add = (component: RunComponent, action: FlowAction, direction: "in" | "out", from: FlowParty, to: string[] = [], subject = "", note = "") =>
    events.push({ component, action, direction, from, to, subject, note });
  const prior: Run = before ?? { ...after, brief: null, members: [], posts: [], claims: [], tasks: [], batches: [], leadReadSeq: 0, leadInboxSeq: 0, notifiedRound: 0, round: after.round };
  const delegation = after.mode === "delegation";

  // Delegation: each split of a request, the overlap check on it, and the lead's summary once the reports are in.
  for (const batch of after.batches ?? []) {
    const was = (prior.batches ?? []).find((entry) => entry.round === batch.round && entry.at === batch.at);
    if (!was) {
      if (batch.followUp) add("split", "followup", "in", "lead", [], String(batch.round), clip(batch.title, 120));
      else add("split", "split", "in", "lead", [], String(batch.round), clip(batch.title, 120));
      if (batch.warnings.length) add("split", "warn", "in", "plugin", [], String(batch.round), clip(batch.warnings.join("; "), 200));
    }
    if (batch.summaryAt && !was?.summaryAt) {
      add("summary", "summarize", "in", "lead", [], String(batch.round), clip(batch.summary, 160));
      add("summary", "deliver", "out", "lead", ["user"], String(batch.round), "");
    }
  }

  if (!prior.brief && after.brief) {
    if (after.brief.userConfirmation) add("brief", "confirm", "in", "user", [], "", clip(after.brief.userConfirmation, 160));
    add("brief", "publish", "in", "lead", [], "", clip(after.brief.title, 120));
  }

  // Members joining a team run get the brief with their first message.
  for (const member of after.members) {
    const was = prior.members.find((entry) => entry.agentId === member.agentId);
    if (!was && after.mode === "team" && after.brief) add("brief", "deliver", "out", actor, [member.agentId], "", member.role);
    // A sub-agent stopping on a permission prompt or an error, and going on again.
    if (delegation && was?.state === "working" && member.state === "attention") add("contexts", "attention", "in", member.agentId, [], member.role);
    if (delegation && was?.state === "attention" && member.state === "working") add("contexts", "resume", "in", member.agentId, [], member.role);
    if (after.mode === "delegation" && was && (was.state === "working" || was.state === "attention") && (member.state === "done" || member.state === "failed")) {
      add("reports", "report", "in", member.agentId, ["lead"], "", clip(member.result, 160));
    }
    if (after.mode === "delegation" && was && !was.collected && member.collected && member.state !== "working") add("reports", "collect", "out", "lead", ["lead"], "", member.title);
    // Reading the board also empties the inbox; the read says it all.
    const read = was !== undefined && member.readSeq > was.readSeq;
    if (read) add("board", "read", "out", member.agentId, [member.agentId], range(was.readSeq, member.readSeq));
    else if (was && member.inboxSeq > was.inboxSeq) add("board", "deliver", "out", "plugin", [member.agentId], range(was.inboxSeq, member.inboxSeq));
  }
  const leadRead = before !== null && after.leadReadSeq > prior.leadReadSeq;
  if (leadRead) add("board", "read", "out", "lead", ["lead"], range(prior.leadReadSeq, after.leadReadSeq));
  else if (before && after.leadInboxSeq > prior.leadInboxSeq) add("board", "deliver", "out", "plugin", ["lead"], range(prior.leadInboxSeq, after.leadInboxSeq));

  const lastSeq = prior.posts.at(-1)?.seq ?? 0;
  for (const post of after.posts.filter((entry) => entry.seq > lastSeq)) {
    add("board", "post", "in", post.author === "lead" ? "lead" : post.agentId, post.to, `#${post.seq}`, `${post.kind}: ${clip(post.text, 140)}`);
  }

  for (const task of after.tasks) traceTask(prior.tasks.find((entry) => entry.id === task.id), task, actor, add, delegation);

  const key = (claim: { agentId: string; path: string }) => `${claim.agentId}\u0000${claim.path}`;
  const had = new Set(prior.claims.map(key));
  const has = new Set(after.claims.map(key));
  const byAgent = (claims: Run["claims"]) => {
    const grouped = new Map<string, string[]>();
    for (const claim of claims) grouped.set(claim.agentId, [...(grouped.get(claim.agentId) ?? []), claim.path || "."]);
    return grouped;
  };
  for (const [agentId, paths] of byAgent(after.claims.filter((claim) => !had.has(key(claim))))) add("claims", "claim", "in", agentId, [], paths.join(", "));
  for (const [agentId, paths] of byAgent(prior.claims.filter((claim) => !has.has(key(claim))))) add("claims", "release", "in", agentId, [], paths.join(", "));

  // A team run's next round; a delegation run's next batch is its split instead.
  if (before && after.round > prior.round && !delegation) {
    add("board", "round", "out", actor, after.members.filter((member) => member.state === "working").map((member) => member.agentId), String(after.round));
  }
  if (before && prior.status === "active" && after.status === "closed") add(delegation ? "summary" : "tasks", "close", "in", actor);
  return events;
}

function traceTask(was: BoardTask | undefined, task: BoardTask, actor: FlowParty, emit: (component: RunComponent, action: FlowAction, direction: "in" | "out", from: FlowParty, to?: string[], subject?: string, note?: string) => void, delegation = false): void {
  const id = task.id;
  // In a delegation run a task is a packet of the split; its outcome comes back as the member's report.
  const add: typeof emit = (component, action, ...rest) => {
    if (!delegation || component !== "tasks") return emit(component, action, ...rest);
    if (action !== "done") emit("split", action, ...rest);
  };
  if (!was) {
    add("tasks", "add", "in", actor === "plugin" && task.createdBy === "lead" ? "lead" : actor, [], id, clip(task.title, 100));
    if (task.state === "doing" && task.owner) add("tasks", "assign", "out", actor, [task.owner], id, clip(task.title, 100));
    return;
  }
  if (was.state !== task.state) {
    if (was.state === "todo" && task.state === "doing" && task.owner) {
      // A member taking a task is a claim; the lead taking one for itself, or the plugin handing it over, is not.
      if (task.owner === actor && actor !== "plugin" && actor !== "lead") add("tasks", "claim", "out", task.owner, [task.owner], id, clip(task.title, 100));
      else if (task.owner === "lead" || actor === "lead") add("tasks", "selfClaim", "out", task.owner === "lead" ? "lead" : actor, [task.owner], id, clip(task.title, 100));
      else add("tasks", "assign", "out", actor, [task.owner], id, clip(task.title, 100));
    } else if (task.state === "done") {
      add("tasks", "done", "in", was.owner ?? actor, [], id, clip(task.result, 140));
    } else if (was.state === "doing" && task.state === "todo") {
      if (was.owner && (actor === was.owner || task.returnedBy === was.owner)) add("tasks", "release", "in", was.owner, [], id, clip(task.feedback, 120));
      else add("tasks", "reassign", "in", actor, was.owner ? [was.owner] : [], id, clip(task.feedback, 120));
    } else if (was.state === "done" && task.state === "todo") {
      add("tasks", "reject", "in", actor, [], id, clip(task.feedback, 140));
    } else if (task.state === "dropped") {
      add("tasks", "drop", "in", actor, [], id, clip(task.result || task.title, 100));
    } else if (was.state === "dropped") {
      add("tasks", "reopen", "in", actor, [], id, clip(task.title, 100));
    }
  } else if (was.title !== task.title || was.detail !== task.detail || was.role !== task.role || was.deps.join() !== task.deps.join() || was.files.join() !== task.files.join()) {
    add("tasks", "update", "in", actor, [], id, clip(task.title, 100));
  }
  const plan = task.plan;
  const old = was.plan;
  if (plan) {
    if (plan.status === "pending" && (!old || old.status !== "pending" || old.text !== plan.text)) add("plans", "submit", "in", task.owner ?? actor, [], id, clip(plan.text, 140));
    if (old?.status === "pending" && plan.status === "approved") add("plans", "approve", "in", actor === "plugin" ? "lead" : actor, [], id, clip(plan.feedback, 120));
    if (old?.status === "pending" && plan.status === "rejected") add("plans", "return", "in", actor === "plugin" ? "lead" : actor, [], id, clip(plan.feedback, 140));
  }
}

/** Per party: how often it wrote into each component and was handed something by it. */
export function flowTotals(events: readonly RunEvent[]): Map<string, Map<RunComponent, { in: number; out: number }>> {
  const totals = new Map<string, Map<RunComponent, { in: number; out: number }>>();
  const bump = (party: string, component: RunComponent, direction: "in" | "out", count: number) => {
    const row = totals.get(party) ?? new Map<RunComponent, { in: number; out: number }>();
    const cell = row.get(component) ?? { in: 0, out: 0 };
    cell[direction] += count;
    row.set(component, cell);
    totals.set(party, row);
  };
  for (const event of events) {
    if (event.direction === "in") bump(event.from, event.component, "in", event.count);
    else for (const party of event.to) bump(party, event.component, "out", event.count);
  }
  return totals;
}
