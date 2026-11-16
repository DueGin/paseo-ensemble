import { describe, expect, it } from "vitest";
import {
  addPost, addTasks, assignTasks, claimTask, completeTask, createRun, dispatchPlan, finishMember, inboxOf, inboxText, leadInbox, markInbox,
  markPlansNotified, MAX_DISPATCHES, mayTake, nextStep, normalizeRun, pendingPlans, rejectTask, releaseTask, retireRole, reviewPlan, runFinished, startRound,
  submitPlan, taskBoardText, taskOf, taskReady, unstaffedRoles, updateMember, updateTasks, upsertMember, waitingOn, TO_ALL, type Run,
  claimPaths, markVerdictsDelivered, retireMember, touchMember, undeliveredVerdicts,
} from "../shared/collab";
import { claudeToolRules } from "../shared/permissions";
import { plannerPrompt, TEAM_JSON_SCHEMA } from "../shared/proposal";
import { checkTeam } from "../shared/team";
import { validateTeam } from "../shared/validate";

const T = "2026-11-12T00:00:00.000Z";

function team(planApproval = false): Run {
  let run = createRun({ id: "R1", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", planApproval, now: T });
  run = upsertMember(run, { role: "api", agentId: "a", title: "api#1", task: "" }, T);
  run = upsertMember(run, { role: "ui", agentId: "u", title: "ui#1", task: "" }, T);
  return addTasks(run, [
    { title: "Schema", role: "api", files: ["src/api/schema.ts"] },
    { title: "Endpoint", role: "api", after: ["1"] },
    { title: "Page", role: "ui", after: ["2"] },
    { title: "Docs" },
  ], "lead", T).run;
}

const idle = (run: Run, ...ids: string[]) => ids.reduce((state, id) => updateMember(state, id, { state: "done" }, T), run);

describe("adding tasks", () => {
  it("numbers tasks and resolves dependencies by position or id", () => {
    const run = team();
    expect(run.tasks.map((task) => [task.id, task.deps, task.role])).toEqual([["T1", [], "api"], ["T2", ["T1"], "api"], ["T3", ["T2"], "ui"], ["T4", [], null]]);
    const more = addTasks(run, [{ title: "Tests", after: ["T3", "t4"] }], "ui", T);
    expect(more.added[0]).toMatchObject({ id: "T5", deps: ["T3", "T4"], createdBy: "ui", state: "todo" });
  });

  it("refuses a dependency on a later or unknown task, so the board has no cycles", () => {
    const run = createRun({ id: "R", leadAgentId: "l", workspaceId: "w", mode: "team", title: "t", now: T });
    expect(addTasks(run, [{ title: "A", after: ["2"] }, { title: "B" }], "lead", T).errors[0]).toMatch(/"2" is not an earlier task/);
    expect(addTasks(run, [{ title: "A", after: ["T9"] }], "lead", T).errors).toHaveLength(1);
    expect(addTasks(run, [{ title: "A", after: ["2"] }, { title: "B" }], "lead", T).run).toBe(run);
  });
});

describe("claiming and finishing tasks", () => {
  it("claims the next ready task for the member's role, its files too, and never one that waits", () => {
    let run = team();
    const first = claimTask(run, "a", undefined, T);
    expect(first.task).toMatchObject({ id: "T1", state: "doing", owner: "a", ownerTitle: "api#1" });
    expect(first.run.claims.map((claim) => claim.path)).toEqual(["src/api/schema.ts"]);
    run = first.run;
    expect(claimTask(run, "a", "T2", T).error).toBe("T2 waits for T1.");
    expect(claimTask(run, "u", "T1", T).error).toMatch(/already taken by api#1/);
    expect(claimTask(run, "u", "T2", T).error).toBe("T2 is for the api role.");
    expect(claimTask(run, "u", undefined, T).task?.id).toBe("T4");
  });

  it("refuses a task for another role", () => {
    const run = team();
    expect(claimTask(run, "u", "T1", T).error).toBe("T1 is for the api role.");
    expect(mayTake({ role: "UI" }, taskOf(run, "T3")!)).toBe(true);
  });

  it("unlocks a waiting task when its dependency is done, and releases the finished task's files", () => {
    let run = claimTask(team(), "a", "T1", T).run;
    expect(taskReady(run, taskOf(run, "T2")!)).toBe(false);
    expect(completeTask(run, "a", "T1", "  ", T).error).toMatch(/what you changed/);
    expect(completeTask(run, "u", "T1", "x", T).error).toMatch(/not yours/);
    run = completeTask(run, "a", "T1", "schema added", T).run;
    expect(taskOf(run, "T1")).toMatchObject({ state: "done", result: "schema added" });
    expect(run.claims).toEqual([]);
    expect(waitingOn(run, taskOf(run, "T2")!)).toEqual([]);
    expect(taskReady(run, taskOf(run, "T3")!)).toBe(false);
  });

  it("puts a released task, or one its owner left unfinished, back on the board", () => {
    let run = claimTask(team(), "a", "T1", T).run;
    expect(releaseTask(run, "u", "T1", T).error).toBeDefined();
    expect(taskOf(releaseTask(run, "a", "T1", T).run, "T1")).toMatchObject({ state: "todo", owner: null });
    run = finishMember(run, "a", "completed", "bye", T);
    expect(taskOf(run, "T1")).toMatchObject({ state: "todo", owner: null });
    expect(run.posts.some((post) => post.kind === "note" && /without finishing T1/.test(post.text))).toBe(true);
  });
});

describe("dispatching tasks to idle members", () => {
  it("hands each idle member one ready task for its role, or one for anyone", () => {
    const run = idle(team(), "a", "u");
    expect(dispatchPlan(run)).toEqual([{ taskId: "T1", agentId: "a" }, { taskId: "T4", agentId: "u" }]);
    expect(nextStep(run)).toEqual({ kind: "dispatch", assignments: [{ taskId: "T1", agentId: "a" }, { taskId: "T4", agentId: "u" }] });
  });

  it("claims the task for its member and puts the member back to work", () => {
    const run = assignTasks(idle(team(), "a", "u"), [{ taskId: "T1", agentId: "a" }], T);
    expect(taskOf(run, "T1")).toMatchObject({ state: "doing", owner: "a" });
    expect(run.members.find((member) => member.agentId === "a")).toMatchObject({ state: "working", dispatches: 1 });
    expect(dispatchPlan(run)).toEqual([{ taskId: "T4", agentId: "u" }]);
  });

  it("stops handing tasks to a member after MAX_DISPATCHES in a round", () => {
    const run = updateMember(idle(team(), "a", "u"), "a", { dispatches: MAX_DISPATCHES }, T);
    expect(dispatchPlan(run).map((entry) => entry.agentId)).toEqual(["u"]);
  });

  it("opens a new round when the lead had already been told the run finished", () => {
    let run = idle(team(), "a", "u");
    run = { ...run, round: 2, rounds: 2, notifiedRound: 2 };
    run = assignTasks(run, [{ taskId: "T1", agentId: "a" }], T);
    expect(run.round).toBe(3);
    expect(run.rounds).toBe(3);
  });

  it("dispatches before it starts the review round, and the run isn't finished while tasks wait for idle members", () => {
    const run = idle(team(), "a", "u");
    expect(runFinished({ ...run, round: 2 })).toBe(false);
    const empty = { ...run, tasks: [] };
    expect(nextStep(empty)).toEqual({ kind: "next-round", round: 2 });
  });

  it("names roles with ready work but no member, for the plugin to staff", () => {
    let run = createRun({ id: "R2", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", now: T });
    run = upsertMember(run, { role: "api", agentId: "a", title: "api#1", task: "" }, T);
    run = addTasks(run, [{ title: "A", role: "api" }, { title: "B", role: "qa" }, { title: "C", role: "docs", after: ["1"] }, { title: "D" }], "lead", T).run;
    expect(unstaffedRoles(run)).toEqual(["qa"]);
    expect(unstaffedRoles({ ...run, mode: "delegation" })).toEqual([]);
  });
});

describe("plan approval", () => {
  it("makes the owner submit a plan and wait for the lead before it may finish", () => {
    let run = claimTask(team(true), "a", "T1", T).run;
    expect(completeTask(run, "a", "T1", "done", T).error).toMatch(/needs an approved plan/);
    run = submitPlan(run, "a", "T1", "add zod schema", T).run;
    expect(pendingPlans(run).map((task) => task.id)).toEqual(["T1"]);
    run = idle(run, "a", "u");
    expect(nextStep({ ...run, tasks: run.tasks.map((task) => (task.id === "T4" ? { ...task, state: "dropped" } : task)) })).toEqual({ kind: "plans", taskIds: ["T1"] });
    const told = markPlansNotified(run, ["T1"], true, T);
    const noDispatch = { ...told, tasks: told.tasks.map((task) => (task.id === "T4" ? { ...task, state: "dropped" as const } : task)) };
    expect(nextStep(noDispatch)).toEqual({ kind: "none" });
    expect(runFinished({ ...noDispatch, round: 2 })).toBe(false);
    expect(reviewPlan(told, "T1", false, "", T).error).toMatch(/Say what to change/);
    const rejected = reviewPlan(told, "T1", false, "use the shared types", T).run;
    expect(taskOf(rejected, "T1")!.plan).toMatchObject({ status: "rejected", feedback: "use the shared types" });
    run = reviewPlan(told, "T1", true, "", T).run;
    expect(completeTask(run, "a", "T1", "schema added", T).run.tasks[0]!.state).toBe("done");
  });

  it("keeps a task whose plan waits for the lead with its owner when the owner's turn ends", () => {
    let run = claimTask(team(true), "a", "T1", T).run;
    run = submitPlan(run, "a", "T1", "plan", T).run;
    run = finishMember(run, "a", "completed", "waiting", T);
    expect(taskOf(run, "T1")).toMatchObject({ state: "doing", owner: "a" });
  });

  it("isn't asked for in a run without plan approval", () => {
    const run = claimTask(team(), "a", "T1", T).run;
    expect(submitPlan(run, "a", "T1", "plan", T).error).toMatch(/doesn't need plan approval/);
  });
});

describe("sending tasks back", () => {
  it("reopens a done task for its role with the reason, which the next owner reads", () => {
    let run = completeTask(claimTask(team(), "a", "T1", T).run, "a", "T1", "first try", T).run;
    expect(rejectTask(run, "T2", "x", T).error).toMatch(/only a done task/);
    expect(rejectTask(run, "T1", " ", T).error).toMatch(/what is wrong/);
    run = rejectTask(run, "T1", "missing the email field", T).run;
    expect(taskOf(run, "T1")).toMatchObject({ state: "todo", owner: null, role: "api", feedback: "missing the email field", result: "previous attempt: first try" });
    expect(taskBoardText(run)).toContain("sent back: missing the email field");
  });

  it("lets the lead reassign, reopen with feedback or drop tasks", () => {
    let run = claimTask(team(), "u", "T4", T).run;
    run = updateTasks(run, [{ id: "T4", role: "api", feedback: "api knows the endpoints" }], T).run;
    expect(taskOf(run, "T4")).toMatchObject({ role: "api", state: "todo", owner: null, feedback: "api knows the endpoints" });
    run = updateTasks(run, [{ id: "T3", state: "dropped" }], T).run;
    expect(taskOf(run, "T3")!.state).toBe("dropped");
    expect(updateTasks(run, [{ id: "T1", after: ["T3"] }], T).errors[0]).toMatch(/only wait for earlier tasks/);
    expect(updateTasks(run, [{ id: "T9", title: "x" }], T).errors).toEqual(["There is no task T9."]);
  });
});

describe("mail", () => {
  it("delivers posts addressed to a member's role, or to all, once; never its own", () => {
    let run = team();
    run = addPost(run, { author: "ui", agentId: "u", kind: "question", text: "Which route?", to: ["api"], files: [] }, T).run;
    run = addPost(run, { author: "lead", agentId: "lead", kind: "note", text: "Freeze the API", to: [TO_ALL], files: [] }, T).run;
    run = addPost(run, { author: "api", agentId: "a", kind: "update", text: "public", to: [], files: [] }, T).run;
    expect(inboxOf(run, "a").map((post) => post.text)).toEqual(["Which route?", "Freeze the API"]);
    expect(inboxOf(run, "u").map((post) => post.text)).toEqual(["Freeze the API"]);
    expect(inboxText(inboxOf(run, "a"))).toMatch(/^📬 2 new messages for you:/);
    run = markInbox(run, "a", 2, T);
    expect(inboxOf(run, "a")).toEqual([]);
  });

  it("gives the lead the posts addressed to it", () => {
    let run = addPost(team(), { author: "ui", agentId: "u", kind: "question", text: "Scope?", to: ["lead"], files: [] }, T).run;
    expect(leadInbox(run).map((post) => post.text)).toEqual(["Scope?"]);
    run = markInbox(run, "lead", 1, T);
    expect(leadInbox(run)).toEqual([]);
  });
});

describe("replacing members", () => {
  it("retires a role's members and frees their tasks when the role moves to another model", () => {
    let run = claimTask(team(), "a", "T1", T).run;
    run = retireRole(run, "API", T);
    expect(run.members.find((member) => member.agentId === "a")!.retired).toBe(true);
    expect(taskOf(run, "T1")).toMatchObject({ state: "todo", owner: null });
    expect(run.claims).toEqual([]);
    expect(unstaffedRoles(run)).toEqual(["api"]);
    expect(claimTask(run, "a", "T1", T).error).toMatch(/replaced/);
    expect(dispatchPlan(idle(run, "a", "u")).some((entry) => entry.agentId === "a")).toBe(false);
    expect(startRound(idle(run, "a", "u"), T).members.find((member) => member.agentId === "a")!.state).toBe("done");
  });
});

describe("old run files", () => {
  it("gain an empty task board and default fields", () => {
    const old = { ...createRun({ id: "R3", leadAgentId: "l", workspaceId: "w", mode: "team", title: "t", now: T }) } as Partial<Run>;
    delete old.tasks;
    delete old.planApproval;
    const normalized = normalizeRun({ ...(old as Run), members: [{ role: "a", agentId: "x", title: "a#1", task: "", state: "done", result: null, collected: true, doneRound: 0, readSeq: 0, nudges: 0, dispatchedAt: T } as never] });
    expect(normalized.tasks).toEqual([]);
    expect(normalized.planApproval).toBe(false);
    expect(normalized.members[0]).toMatchObject({ dispatches: 0, inboxSeq: 0, retired: false });
  });
});

describe("preset teams (candidate members)", () => {
  const base = { version: 1, goal: "", mode: "auto", orchestrator: { workspace: "lead", provider: "claude", model: "m" } };

  it("may have no fixed roles when it has candidates, but needs one of the two", () => {
    expect(checkTeam({ ...base, roles: [], candidates: [{ name: "opus", provider: "claude", model: "m" }] }).ok).toBe(true);
    const none = checkTeam({ ...base, roles: [], candidates: [] });
    expect(!none.ok && none.errors.join(" ")).toMatch(/at least one role or one candidate/);
    const dup = checkTeam({ ...base, candidates: [{ name: "a", provider: "p", model: "m" }, { name: "A", provider: "p", model: "n" }] });
    expect(!dup.ok && dup.errors.join(" ")).toMatch(/duplicate candidate/);
  });

  it("checks every candidate's provider and model against the host", () => {
    const parsed = checkTeam({ ...base, candidates: [{ name: "x", provider: "ghost", model: "m" }] });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    expect(validateTeam(parsed.team, [{ id: "claude", ready: true, status: "ready", models: [{ id: "m", label: "m" }] }])).toEqual([{ target: "candidate x", message: 'provider "ghost" is not enabled on this host' }]);
  });

  it("gets the board tools allowed when a candidate runs on Claude", () => {
    const parsed = checkTeam({ ...base, orchestrator: { ...base.orchestrator, provider: "codex" }, candidates: [{ name: "o", provider: "claude", model: "m" }] });
    if (!parsed.ok) throw new Error(parsed.errors.join());
    expect(claudeToolRules(parsed.team)).toContain("mcp__paseo__team_task");
  });
});

describe("planning without a goal", () => {
  const catalog = [{ id: "claude", ready: true, status: "ready", models: [{ id: "m", label: "m" }] }];

  it("asks the planner to read the project and write the goal itself", () => {
    const prompt = plannerPrompt("  ", catalog);
    expect(prompt).toContain("No goal was given. Work it out from the project itself.");
    expect(prompt).toMatch(/Read the project before proposing: README/);
    expect(prompt).toMatch(/goal to one sentence you write/);
    expect(prompt).not.toContain("Goal: ");
  });

  it("explains fixed roles and candidates either way, and asks for both keys", () => {
    for (const prompt of [plannerPrompt("", catalog), plannerPrompt("A game", catalog)]) {
      expect(prompt).toMatch(/Candidate members are a preset pool of models/);
      expect(prompt).toContain('"candidates"');
    }
    expect(plannerPrompt("A game", catalog)).toContain("Goal: A game");
    expect(TEAM_JSON_SCHEMA.required).toContain("candidates");
  });
});

describe("review fixes", () => {
  it("keeps a decided plan with its owner until the verdict reaches it, then wakes the idle owner with it", () => {
    let run = claimTask(team(true), "a", "T1", T).run;
    run = submitPlan(run, "a", "T1", "plan", T).run;
    run = reviewPlan(run, "T1", true, "", T).run;
    // The owner's turn ended before it got the verdict: the task stays with it, files claimed.
    run = finishMember(run, "a", "completed", "waiting", T);
    expect(taskOf(run, "T1")).toMatchObject({ state: "doing", owner: "a" });
    expect(run.claims.map((claim) => claim.path)).toEqual(["src/api/schema.ts"]);
    expect(undeliveredVerdicts(run).map((task) => task.id)).toEqual(["T1"]);
    run = updateMember(run, "u", { state: "working" }, T);
    expect(nextStep(run)).toEqual({ kind: "verdicts", taskIds: ["T1"] });
    run = markVerdictsDelivered(run, ["T1"], true, T);
    // Delivered but the owner stopped again without finishing: now it goes back on the board.
    run = finishMember(updateMember(run, "a", { state: "working" }, T), "a", "completed", "stopped", T);
    expect(taskOf(run, "T1")).toMatchObject({ state: "todo", owner: null, returnedBy: "a" });
  });

  it("doesn't hand a new task to a member that still holds one", () => {
    let run = claimTask(team(true), "a", "T1", T).run;
    run = submitPlan(run, "a", "T1", "plan", T).run;
    run = idle(run, "a", "u");
    run = addTasks(run, [{ title: "More api", role: "api" }], "lead", T).run;
    expect(dispatchPlan(run).map((entry) => entry.agentId)).not.toContain("a");
  });

  it("gives a member a fresh dispatch budget when a task is sent back after the lead was told", () => {
    let run = completeTask(claimTask(team(), "a", "T1", T).run, "a", "T1", "done", T).run;
    run = { ...idle(run, "a", "u"), round: 2, rounds: 2, notifiedRound: 2, tasks: run.tasks.map((task) => (task.id === "T1" ? task : { ...task, state: "done" as const })) };
    run = updateMember(run, "a", { dispatches: MAX_DISPATCHES }, T);
    run = rejectTask(run, "T1", "missing a field", T).run;
    expect(dispatchPlan(run)).toEqual([{ taskId: "T1", agentId: "a" }]);
    expect(assignTasks(run, dispatchPlan(run), T).round).toBe(3);
  });

  it("marks a member that calls a tool while idle as working, with a dispatch time safely in the past", () => {
    const run = touchMember(idle(team(), "a"), "a", T);
    const member = run.members.find((entry) => entry.agentId === "a")!;
    expect(member.state).toBe("working");
    expect(Date.parse(member.dispatchedAt)).toBeLessThan(Date.parse(T));
    expect(touchMember(updateMember(run, "u", { state: "failed" }, T), "u", T).members.find((entry) => entry.agentId === "u")!.state).toBe("failed");
  });

  it("doesn't hand a returned task straight back to the member that returned it", () => {
    let run = upsertMember(team(), { role: "api", agentId: "a2", title: "api#2", task: "" }, T);
    run = releaseTask(claimTask(run, "a", "T1", T).run, "a", "T1", T).run;
    run = idle(run, "a", "a2", "u");
    expect(dispatchPlan(run).find((entry) => entry.taskId === "T1")).toEqual({ taskId: "T1", agentId: "a2" });
    expect(dispatchPlan(retireMember(run, "a2", T)).find((entry) => entry.taskId === "T1")).toBeUndefined();
    expect(claimTask(run, "a", "T1", T).task?.returnedBy).toBeNull();
  });

  it("frees an archived member's tasks, even one waiting for a verdict", () => {
    let run = submitPlan(claimTask(team(true), "a", "T1", T).run, "a", "T1", "plan", T).run;
    run = retireMember(run, "a", T);
    expect(taskOf(run, "T1")).toMatchObject({ state: "todo", owner: null, plan: null });
    expect(run.claims).toEqual([]);
    expect(pendingPlans(run)).toEqual([]);
  });

  it("delivers a post addressed to a member's title", () => {
    const run = addPost(team(), { author: "lead", agentId: "lead", kind: "note", text: "Stop T1", to: ["API#1"], files: [] }, T).run;
    expect(inboxOf(run, "a").map((post) => post.text)).toEqual(["Stop T1"]);
    expect(inboxOf(run, "u")).toEqual([]);
  });

  it("doesn't plan a dispatch whose files another working member holds", () => {
    let run = claimPaths(team(), "u", ["src/api"], T).run;
    run = idle(run, "a");
    expect(dispatchPlan(run).map((entry) => entry.taskId)).not.toContain("T1");
  });

  it("lets a dropped dependency stop holding its dependents back", () => {
    const run = updateTasks(team(), [{ id: "T1", state: "dropped" }], T).run;
    expect(taskReady(run, taskOf(run, "T2")!)).toBe(true);
  });

  it("drops a delegated task whose turn failed or was canceled", () => {
    let run = createRun({ id: "R9", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "t", now: T });
    run = upsertMember(run, { role: "docs", agentId: "d", title: "docs#1", task: "x" }, T);
    run = addTasks(run, [{ title: "x", role: "docs" }], "lead", T).run;
    run = { ...run, tasks: run.tasks.map((task) => ({ ...task, state: "doing" as const, owner: "d", ownerTitle: "docs#1" })) };
    expect(taskOf(finishMember(run, "d", "canceled", "stopped", T), "T1")).toMatchObject({ state: "dropped", result: "canceled: stopped" });
    expect(taskOf(finishMember(run, "d", "completed", "ok", T), "T1")).toMatchObject({ state: "done", result: "ok" });
  });
});
