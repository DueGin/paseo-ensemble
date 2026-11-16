import { describe, expect, it } from "vitest";
import {
  addBatch, addPost, addTasks, assignTasks, attachPacket, batchToSummarize, claimPaths, startBatch, summarizeBatch, claimTask, completeTask, createRun, finishMember, markCollected, markInbox, markPlansNotified,
  markVerdictsDelivered, rejectTask, reviewPlan, submitPlan, updateMember, upsertMember, type Brief, type Run,
} from "../shared/collab";
import { componentsOf, flowTotals, logEvents, MAX_EVENTS, traceRun, type FlowParty, type NewEvent } from "../shared/flow";

const T0 = "2026-11-14T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const brief: Brief = { title: "Login", goal: "Users sign in", requirements: ["Form"], acceptance: ["Works"], constraints: [], outOfScope: [], userConfirmation: "yes, go" };

/** Applies a change the way the run store does: trace, then log. */
const step = (run: Run, change: (run: Run) => Run, actor: FlowParty = "plugin", seconds = 0): Run => {
  const after = change(run);
  return after === run ? run : logEvents(after, traceRun(run, after, actor), at(seconds));
};
const brief0 = (planApproval = false) => {
  const created = createRun({ id: "R1", leadAgentId: "lead1", workspaceId: "w", mode: "team", title: "Login", brief, planApproval, now: T0 });
  return logEvents(created, traceRun(null, created, "lead"), T0);
};
const pick = (run: Run) => run.events.map((event) => `${event.component}:${event.action}:${event.direction}:${event.from}>${event.to.join("+")}:${event.subject}`);

describe("traceRun", () => {
  it("records the user's confirmation and the brief when a team run starts", () => {
    expect(pick(brief0())).toEqual(["brief:confirm:in:user>:", "brief:publish:in:lead>:"]);
  });

  it("follows a task from the lead through the board to a member and back", () => {
    let run = brief0();
    run = step(run, (current) => upsertMember(current, { role: "api", agentId: "m1", title: "api#1", task: "" }, T0), "lead");
    run = step(run, (current) => addTasks(current, [{ title: "Endpoint", role: "api", files: ["src/api"] }, { title: "Form", role: "ui" }], "lead", T0).run, "lead");
    run = step(run, (current) => claimTask(current, "m1", "T1", T0).run, "m1");
    run = step(run, (current) => completeTask(current, "m1", "T1", "added POST /login", T0).run, "m1");
    run = step(run, (current) => rejectTask(current, "T1", "no tests", T0).run, "lead");
    run = step(run, (current) => updateMember(current, "m1", { state: "done" }, T0), "plugin");
    run = step(run, (current) => assignTasks(current, [{ taskId: "T1", agentId: "m1" }], T0), "plugin");
    expect(pick(run).slice(2)).toEqual([
      "brief:deliver:out:lead>m1:",
      "tasks:add:in:lead>:T1",
      "tasks:add:in:lead>:T2",
      "tasks:claim:out:m1>m1:T1",
      "claims:claim:in:m1>:src/api",
      "tasks:done:in:m1>:T1",
      "claims:release:in:m1>:src/api",
      "tasks:reject:in:lead>:T1",
      "tasks:assign:out:plugin>m1:T1",
      "claims:claim:in:m1>:src/api",
    ]);
    expect(run.events.find((event) => event.action === "done")?.note).toBe("added POST /login");
  });

  it("traces plan approval: the member's plan and the lead's verdict", () => {
    let run = brief0(true);
    run = step(run, (current) => upsertMember(current, { role: "api", agentId: "m1", title: "api#1", task: "" }, T0), "lead");
    run = step(run, (current) => addTasks(current, [{ title: "Endpoint", role: "api" }], "lead", T0).run, "lead");
    run = step(run, (current) => claimTask(current, "m1", "T1", T0).run, "m1");
    run = step(run, (current) => submitPlan(current, "m1", "T1", "add a route", T0).run, "m1");
    run = step(run, (current) => markPlansNotified(current, ["T1"], true, T0), "plugin");
    run = step(run, (current) => reviewPlan(current, "T1", false, "use the router", T0).run, "lead");
    run = step(run, (current) => markVerdictsDelivered(current, ["T1"], true, T0), "plugin");
    // The notice to the lead and the verdict's delivery are logged by the plugin once they were sent, not derived.
    expect(pick(run).filter((line) => line.startsWith("plans"))).toEqual([
      "plans:submit:in:m1>:T1",
      "plans:return:in:lead>:T1",
    ]);
    expect(run.events.find((event) => event.action === "return")?.note).toBe("use the router");
  });

  it("traces board posts, deliveries and reads, folding repeated reads", () => {
    let run = brief0();
    run = step(run, (current) => upsertMember(current, { role: "api", agentId: "m1", title: "api#1", task: "" }, T0), "lead");
    run = step(run, (current) => addPost(current, { author: "api", agentId: "m1", kind: "question", text: "Which DB?", to: ["lead"], files: [] }, T0).run, "m1");
    run = step(run, (current) => markInbox(current, "lead", 1, T0), "plugin", 1);
    run = step(run, (current) => ({ ...current, members: current.members.map((member) => ({ ...member, readSeq: 1 })) }), "m1", 2);
    run = step(run, (current) => addPost(current, { author: "lead", agentId: "lead1", kind: "note", text: "Postgres", to: ["api"], files: [] }, T0).run, "lead", 3);
    run = step(run, (current) => ({ ...current, members: current.members.map((member) => ({ ...member, readSeq: 2 })) }), "m1", 4);
    const board = run.events.filter((event) => event.component === "board");
    expect(board.map((event) => `${event.action}:${event.from}>${event.to.join("+")}:${event.subject}:${event.count}`)).toEqual([
      "post:m1>lead:#1:1",
      "deliver:plugin>lead:#1:1",
      "read:m1>m1:#1–#2:2",
      "post:lead>api:#2:1",
    ]);
  });

  it("traces delegated reports and the lead collecting them", () => {
    const created = createRun({ id: "R2", leadAgentId: "lead1", workspaceId: "w", mode: "delegation", title: "Docs", now: T0 });
    let run = logEvents(created, traceRun(null, created, "lead"), T0);
    run = step(run, (current) => upsertMember(current, { role: "docs", agentId: "m2", title: "docs#2", task: "write it" }, T0), "lead");
    run = step(run, (current) => finishMember(current, "m2", "completed", "wrote README", T0), "plugin");
    run = step(run, (current) => markCollected(current, T0), "lead");
    expect(pick(run)).toEqual(["reports:report:in:m2>lead:", "reports:collect:out:lead>lead:"]);
  });

  it("logs a refused claim, and nothing for an unchanged run", () => {
    let run = brief0();
    run = step(run, (current) => upsertMember(current, { role: "api", agentId: "m1", title: "api#1", task: "" }, T0), "lead");
    run = step(run, (current) => claimPaths(current, "m1", ["src"], T0).run, "m1");
    expect(traceRun(run, run, "m1")).toEqual([]);
    const conflict: NewEvent = { component: "claims", action: "conflict", direction: "in", from: "m2", to: ["api"], subject: "src/a.ts", note: "src (api)" };
    expect(logEvents(run, [conflict], T0).events.at(-1)).toMatchObject({ action: "conflict", from: "m2", count: 1 });
  });

  it("keeps the newest events only", () => {
    let run = brief0();
    const posts = Array.from({ length: MAX_EVENTS + 20 }, (_, index): NewEvent => ({ component: "board", action: "post", direction: "in", from: "lead", to: [], subject: `#${index}`, note: "" }));
    run = logEvents(run, posts, T0);
    expect(run.events.length).toBe(MAX_EVENTS);
    expect(run.events.at(-1)?.seq).toBe(MAX_EVENTS + 22);
  });
});

describe("delegation (MA-04): split → isolated sub-agents → reports → summary", () => {
  const created = () => {
    const run = createRun({ id: "R3", leadAgentId: "lead1", workspaceId: "w", mode: "delegation", title: "Docs", now: T0 });
    return logEvents(run, traceRun(null, run, "lead"), T0);
  };
  /** Hands a packet to a member, the way team_delegate mirrors it on the board. */
  const handOut = (run: Run, agentId: string, role: string, text: string): Run => {
    const joined = upsertMember(run, { role, agentId, title: `${role}#1`, task: text }, T0);
    const result = addTasks(joined, [{ title: text, detail: text, role }], "lead", T0);
    const id = result.added[0]!.id;
    return attachPacket({ ...result.run, tasks: result.run.tasks.map((task) => (task.id === id ? { ...task, state: "doing" as const, owner: agentId, ownerTitle: `${role}#1` } : task)) }, id);
  };

  it("traces the split, its packets, the reports, and the lead's summary to the user", () => {
    let run = created();
    run = step(run, (current) => addBatch(current, { title: "Write the docs", reason: "two independent files", warnings: ["writer ↔ checker"], followUp: false }, T0), "lead");
    run = step(run, (current) => handOut(current, "m1", "writer", "notes/a.txt"), "lead");
    run = step(run, (current) => handOut(current, "m2", "checker", "checks/a.check"), "lead");
    expect(run.batches[0]).toMatchObject({ round: 1, taskIds: ["T1", "T2"], warnings: ["writer ↔ checker"], summaryAt: null });
    run = step(run, (current) => finishMember(current, "m1", "completed", "wrote a.txt", T0));
    expect(batchToSummarize(run)).toBeUndefined();
    run = step(run, (current) => finishMember(current, "m2", "completed", "wrote a.check", T0));
    run = step(run, (current) => markCollected(current, T0), "lead");
    expect(batchToSummarize(run)?.round).toBe(1);
    run = step(run, (current) => summarizeBatch(current, "Both files are in place.", T0), "lead");
    expect(batchToSummarize(run)).toBeUndefined();
    expect(pick(run)).toEqual([
      "split:split:in:lead>:1",
      "split:warn:in:plugin>:1",
      "split:add:in:lead>:T1",
      "split:assign:out:lead>m1:T1",
      "split:add:in:lead>:T2",
      "split:assign:out:lead>m2:T2",
      "reports:report:in:m1>lead:",
      "reports:report:in:m2>lead:",
      "reports:collect:out:lead>lead:",
      "reports:collect:out:lead>lead:",
      "summary:summarize:in:lead>:1",
      "summary:deliver:out:lead>user:1",
    ]);
    expect(run.batches[0]!.summary).toBe("Both files are in place.");
  });

  it("traces a sub-agent stopping for attention and going on, and closing under the summary", () => {
    let run = created();
    run = step(run, (current) => addBatch(current, { title: "Docs", reason: "", warnings: [], followUp: false }, T0), "lead");
    run = step(run, (current) => handOut(current, "m1", "writer", "notes/a.txt"), "lead");
    run = step(run, (current) => updateMember(current, "m1", { state: "attention" }, T0));
    run = step(run, (current) => updateMember(current, "m1", { state: "working" }, T0));
    run = step(run, (current) => ({ ...current, status: "closed" }), "lead");
    expect(pick(run).slice(3)).toEqual(["contexts:attention:in:m1>:writer", "contexts:resume:in:m1>:writer", "summary:close:in:lead>:"]);
  });

  it("makes a follow-up a batch of its own, summarized on its own", () => {
    let run = created();
    run = step(run, (current) => addBatch(current, { title: "Docs", reason: "", warnings: [], followUp: false }, T0), "lead");
    run = step(run, (current) => handOut(current, "m1", "writer", "notes/a.txt"), "lead");
    run = step(run, (current) => markCollected(finishMember(current, "m1", "completed", "done", T0), T0), "lead");
    run = step(run, (current) => summarizeBatch(current, "first", T0), "lead");
    run = step(run, (current) => addBatch(startBatch(current, T0), { title: "Fix the typo", reason: "", warnings: [], followUp: true }, T0), "lead");
    run = step(run, (current) => handOut(current, "m1", "writer", "fix the typo"), "lead");
    expect(run.batches.map((batch) => [batch.round, batch.followUp, batch.taskIds])).toEqual([[1, false, ["T1"]], [2, true, ["T2"]]]);
    expect(batchToSummarize(run)).toBeUndefined();
    run = step(run, (current) => markCollected(finishMember(current, "m1", "completed", "fixed", T0), T0), "lead");
    run = step(run, (current) => summarizeBatch(current, "second", T0), "lead");
    expect(run.batches.map((batch) => batch.summary)).toEqual(["first", "second"]);
    expect(pick(run).filter((line) => line.startsWith("split:followup") || line.startsWith("summary:summarize"))).toEqual(["summary:summarize:in:lead>:1", "split:followup:in:lead>:2", "summary:summarize:in:lead>:2"]);
  });
});

describe("components and totals", () => {
  it("lists a mode's components", () => {
    expect(componentsOf("team")).toEqual(["brief", "tasks", "plans", "board", "claims"]);
    expect(componentsOf("delegation")).toEqual(["split", "contexts", "reports", "summary"]);
  });

  it("counts what each party wrote into and got from each component", () => {
    let run = brief0();
    run = step(run, (current) => upsertMember(current, { role: "api", agentId: "m1", title: "api#1", task: "" }, T0), "lead");
    run = step(run, (current) => addTasks(current, [{ title: "A", role: "api" }, { title: "B", role: "api" }], "lead", T0).run, "lead");
    run = step(run, (current) => claimTask(current, "m1", "T1", T0).run, "m1");
    const totals = flowTotals(run.events);
    expect(totals.get("lead")?.get("tasks")).toEqual({ in: 2, out: 0 });
    expect(totals.get("m1")?.get("tasks")).toEqual({ in: 0, out: 1 });
    expect(totals.get("m1")?.get("brief")).toEqual({ in: 0, out: 1 });
  });
});
