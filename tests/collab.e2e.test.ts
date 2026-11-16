// Drives a real team through both collaboration modes on the local daemon, with the plugin installed from this
// checkout (`paseo plugin install "$(pwd)"`; reload it after changes). Plugin RPCs go through the daemon to that install. It starts real agents and costs tokens, so it only runs with PASEO_E2E=1:
//   PASEO_E2E=1 npx vitest run tests/collab.e2e.test.ts
// PASEO_E2E_MODEL picks the model every agent runs on (default claude/claude-haiku-5-5).
import type { RpcOutput } from "@getpaseo/plugin";
import { createPaseoClient, type PaseoClient } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUNS_DIR } from "../server/collab";
import { applyTeam, proposeTeam, teamProposal } from "../server/team";
import { LABEL } from "../shared/cleanup";
import { excerpt, type Run } from "../shared/collab";
import type { TeamMode } from "../shared/modes";
import type { teamSessionModeRpc, teamSessionRpc } from "../shared/rpc";
import { TeamSchema, type Team } from "../shared/team";

const [provider, model] = (process.env.PASEO_E2E_MODEL ?? "claude/claude-haiku-5-5").split("/") as [string, string];

describe.skipIf(!process.env.PASEO_E2E)("collaboration modes against the local daemon", () => {
  let paseo: PaseoClient;
  let daemon: DaemonClient;
  let root: string;
  let projectId: string;
  let lead: string;

  const team = (): Team => ({
    version: 1,
    goal: "A tiny notes folder used to test the agent team plugin",
    mode: "delegation",
    candidates: [],
    orchestrator: { workspace: "lead", provider, model },
    roles: [
      { name: "writer", provider, model, folders: ["notes"], instructions: "Writes short text files in notes/. Keep every file under 5 lines." },
      { name: "checker", provider, model, folders: ["checks"], instructions: "Writes short check files in checks/. Keep every file under 5 lines." },
    ],
  });

  // The plugin's own RPCs, served by the installed plugin's process, so the test sees what the app sees.
  const sessionInfo = (agentId: string) => daemon.invokePluginRpc("paseo-agent-team", "team.session", { agentId }) as Promise<RpcOutput<typeof teamSessionRpc>>;
  const setSessionMode = (agentId: string, mode: TeamMode | null) => daemon.invokePluginRpc("paseo-agent-team", "team.session.mode", { agentId, mode }) as Promise<RpcOutput<typeof teamSessionModeRpc>>;

  const runs = (): Run[] => (existsSync(join(root, RUNS_DIR)) ? readdirSync(join(root, RUNS_DIR)).filter((name) => /^R.*\.json$/.test(name)).map((name) => JSON.parse(readFileSync(join(root, RUNS_DIR, name), "utf8")) as Run) : []);

  /** Sends the lead a prompt and waits until its turn ends. */
  async function ask(text: string, timeoutMs = 360_000, to = lead): Promise<string> {
    await paseo.agents.ref(to).send(text);
    const result = await paseo.agents.ref(to).waitForFinish(timeoutMs);
    if (result.status === "permission") throw new Error("the lead stopped on a permission prompt");
    if (result.status === "error") throw new Error(`the lead failed: ${result.error}`);
    return result.lastMessage ?? "";
  }

  /** Waits until the lead's runs settle: no member working, no plan waiting, and the lead idle. */
  async function settle(mode: Run["mode"], timeoutMs = 480_000, leadId = lead): Promise<Run> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = runs().filter((entry) => entry.mode === mode && entry.leadAgentId === leadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const leadState = (await paseo.agents.ref(leadId).refresh())?.agent.status;
      const plansWaiting = run?.tasks?.some((task) => task.state === "doing" && task.plan?.status === "pending");
      if (run && run.members.length && run.members.every((member) => member.state !== "working") && !plansWaiting && leadState !== "running") return run;
      if (Date.now() > deadline) throw new Error(`run did not settle: ${JSON.stringify(run?.members.map((member) => [member.title, member.state]))}`);
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  beforeAll(async () => {
    paseo = createPaseoClient({ url: process.env.PASEO_URL ?? "ws://127.0.0.1:6767/ws", reconnect: { enabled: false } });
    await paseo.connect();
    daemon = new DaemonClient({ url: process.env.PASEO_URL ?? "ws://127.0.0.1:6767/ws", clientId: "agent-team-collab-e2e", clientType: "cli" });
    await daemon.connect();
    root = mkdtempSync(join(tmpdir(), "agent-team-collab-"));
    execFileSync("git", ["init", "-q", root]);
    const workspace = await paseo.workspaces.create({ title: "lead", source: { kind: "directory", path: root } });
    projectId = (await paseo.workspaces.ref(workspace.id).refresh())!.projectId;
    const applied = await applyTeam({ projectId, team: team() }, { paseo });
    if (!applied.ok) throw new Error(applied.errors.join("\n"));
    lead = applied.orchestratorAgentId;
    const ready = await paseo.agents.ref(lead).waitForFinish(240_000);
    expect(ready.status).toBe("idle");
    console.log(`[e2e] project ${root}, lead ${lead}\n[e2e] ready reply: ${ready.lastMessage}`);
  }, 300_000);

  afterAll(async () => {
    if (!paseo) return;
    try {
      const ids = new Set((await paseo.workspaces.list()).entries.filter((entry) => entry.projectId === projectId).map((entry) => entry.id));
      for (const { agent } of (await paseo.agents.list()).entries) {
        if (ids.has(agent.workspaceId ?? "") && !agent.archivedAt && !process.env.PASEO_E2E_KEEP) await paseo.agents.ref(agent.id).archive().catch(() => undefined);
      }
    } finally {
      await paseo.close();
      await daemon?.close();
    }
  }, 120_000);

  it("gives the lead its team tools, and reports the configured mode", async () => {
    const info = await sessionInfo(lead);
    expect(info).toMatchObject({ leadAgentId: lead, configured: "delegation", override: null, effective: "delegation", run: null });
    const reply = await ask("Call team_status and tell me the collaboration mode it reports, in one line. Do not start members.");
    console.log(`[e2e] status reply: ${reply}`);
    expect(reply.toLowerCase()).toContain("delegation");
  }, 400_000);

  it("delegation: splits the request, members work alone as children of the lead, the lead collects the results", async () => {
    const reply = await ask("Create notes/hello.txt containing the word hello, and checks/hello.check containing the word ok. Delegate the two files to the roles that own those folders, wait for both, then report.");
    console.log(`[e2e] delegation reply: ${reply}`);
    const run = await settle("delegation");
    console.log(`[e2e] delegation run: ${JSON.stringify({ id: run.id, members: run.members.map((member) => [member.role, member.state, member.task.slice(0, 80)]) })}`);
    expect(run.members.map((member) => member.role).sort()).toEqual(["checker", "writer"]);
    expect(run.members.every((member) => member.state === "done")).toBe(true);
    expect(run.posts).toEqual([]);
    expect(readFileSync(join(root, "notes/hello.txt"), "utf8").toLowerCase()).toContain("hello");
    expect(readFileSync(join(root, "checks/hello.check"), "utf8").toLowerCase()).toContain("ok");
    const agents = (await paseo.agents.list()).entries.map((entry) => entry.agent);
    for (const member of run.members) {
      const agent = agents.find((entry) => entry.id === member.agentId)!;
      expect(agent.labels[LABEL]).toBe("member");
      expect(agent.labels.role).toBe(member.role);
      expect(agent.labels["paseo.parent-agent-id"] ?? (agent as { parentAgentId?: string }).parentAgentId).toBe(lead);
      expect(agent.provider).toBe(provider);
    }
    const info = await sessionInfo(run.members[0]!.agentId);
    expect(info.leadAgentId).toBe(lead);
    expect(info.run?.id).toBe(run.id);
    // The data flow: the lead's tasks went to the members, and their reports came back.
    const flow = run.events.map((event) => `${event.component}:${event.action}:${event.from}`);
    console.log(`[e2e] delegation flow: ${JSON.stringify(flow)}`);
    const ids = run.members.map((member) => member.agentId).sort();
    expect(run.events.filter((event) => event.component === "split" && event.action === "split" && event.from === "lead")).toHaveLength(1);
    expect(run.events.filter((event) => event.component === "split" && event.action === "add" && event.from === "lead").length).toBeGreaterThanOrEqual(2);
    expect(run.events.filter((event) => event.component === "split" && event.action === "assign").map((event) => event.to[0]).sort()).toEqual(ids);
    expect(run.events.filter((event) => event.component === "contexts" && (event.action === "start" || event.action === "continue")).map((event) => event.to[0]).sort()).toEqual(ids);
    expect(run.events.filter((event) => event.component === "reports" && event.action === "report").map((event) => event.from).sort()).toEqual(ids);
    // The lead's reply after collecting the reports is the batch's summary, handed to the user; the turn-end hook writes it.
    for (let attempt = 0; attempt < 15 && !runs().find((entry) => entry.id === run.id)?.batches?.[0]?.summaryAt; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
    Object.assign(run, runs().find((entry) => entry.id === run.id));
    console.log(`[e2e] delegation flow after summary: ${JSON.stringify(run.events.map((event) => `${event.component}:${event.action}:${event.from}>${event.to.join("+")}`))}`);
    expect(run.batches).toHaveLength(1);
    expect(run.batches[0]!.taskIds).toHaveLength(2);
    expect(run.batches[0]!.summaryAt).toBeTruthy();
    expect(run.batches[0]!.summary.length).toBeGreaterThan(0);
    expect(run.events.some((event) => event.component === "summary" && event.action === "deliver" && event.to[0] === "user")).toBe(true);
  }, 900_000);

  it("refuses a team run while the session is in delegation mode", async () => {
    const reply = await ask('Call team_kickoff right now with userConfirmation "x", and tell me exactly what the tool answered. This is a test of the refusal.');
    console.log(`[e2e] refusal reply: ${reply}`);
    expect(runs().filter((run) => run.mode === "team")).toEqual([]);
  }, 400_000);

  it("team: intake first, nothing reaches members before the user confirms the brief", async () => {
    const switched = await setSessionMode(lead, "team");
    expect(switched).toMatchObject({ ok: true, effective: "team" });
    await paseo.agents.ref(lead).waitForFinish(120_000);
    const intake = await ask("Please add a short notes/todo.txt with three todo items and a matching checks/todo.check that lists how to verify each item.");
    console.log(`[e2e] intake reply: ${intake}`);
    expect(runs().filter((run) => run.mode === "team")).toEqual([]);
    // Answer the intake questions; the lead must still show a brief and wait for a confirmation.
    const brief = await ask("Use your defaults for every open question and show me the brief.");
    console.log(`[e2e] brief reply: ${brief}`);
    expect(runs().filter((run) => run.mode === "team")).toEqual([]);
    expect(Object.keys(JSON.parse(readFileSync(join(root, RUNS_DIR, "briefs.json"), "utf8")))).toEqual([lead]);
    const start = await ask("Confirmed, go ahead with exactly that brief.");
    console.log(`[e2e] kickoff reply: ${start}`);
    const run = await settle("team", 900_000);
    console.log(`[e2e] team run: ${JSON.stringify({ id: run.id, round: run.round, rounds: run.rounds, posts: run.posts.map((post) => [post.seq, post.round, post.author, post.kind, post.to]) })}`);
    expect(run.brief?.userConfirmation).toBeTruthy();
    expect(JSON.parse(readFileSync(join(root, RUNS_DIR, "briefs.json"), "utf8"))).toEqual({});
    expect(run.posts[0]).toMatchObject({ author: "lead", kind: "brief" });
    expect(run.round).toBe(run.rounds);
    expect(run.posts.filter((post) => post.kind === "done").map((post) => post.author)).toEqual(expect.arrayContaining(["writer", "checker"]));
    // The lead picks the number of rounds; with a review round, members post again in it.
    if (run.rounds >= 2) expect(run.posts.some((post) => post.kind === "done" && post.round === 2)).toBe(true);
    console.log(`[e2e] team tasks: ${JSON.stringify(run.tasks.map((task) => [task.id, task.role, task.state, task.ownerTitle, task.deps]))}`);
    expect(run.tasks.length).toBeGreaterThan(0);
    expect(run.tasks.every((task) => task.state === "done" || task.state === "dropped")).toBe(true);
    expect(existsSync(join(root, "notes/todo.txt"))).toBe(true);
    // The data flow: the user confirmed, the lead published the brief and filled the board, members took and finished tasks and posted.
    console.log(`[e2e] team flow: ${JSON.stringify(run.events.map((event) => `${event.component}:${event.action}:${event.from}>${event.to.join("+")}:${event.subject}`))}`);
    const memberIds = new Set(run.members.map((member) => member.agentId));
    expect(run.events.slice(0, 2).map((event) => `${event.component}:${event.action}:${event.from}`)).toEqual(["brief:confirm:user", "brief:publish:lead"]);
    expect(run.events.some((event) => event.component === "brief" && event.action === "deliver" && memberIds.has(event.to[0]!))).toBe(true);
    expect(run.events.filter((event) => event.component === "tasks" && event.action === "add").length).toBeGreaterThanOrEqual(run.tasks.length);
    expect(run.events.some((event) => event.component === "tasks" && (event.action === "claim" || event.action === "assign") && memberIds.has(event.to[0]!))).toBe(true);
    expect(run.events.some((event) => event.component === "tasks" && event.action === "done" && memberIds.has(event.from))).toBe(true);
    expect(run.events.some((event) => event.component === "board" && event.action === "post" && memberIds.has(event.from))).toBe(true);
    const info = await sessionInfo(lead);
    expect(info).toMatchObject({ configured: "delegation", override: "team", effective: "team", run: { id: run.id, mode: "team" } });
  }, 1_500_000);

  it("preset team: the lead forms roles only from candidate members, and members wait for plan approval", async () => {
    const workspace = await paseo.workspaces.create({ title: "preset", source: { kind: "directory", path: root } });
    const preset: Team = {
      version: 1,
      goal: "A tiny notes folder used to test preset teams",
      mode: "team",
      orchestrator: { workspace: "preset", provider, model },
      roles: [],
      candidates: [{ name: "fast", provider, model, notes: "quick, cheap; fine for small text files" }],
    };
    const applied = await applyTeam({ workspaceId: workspace.id, team: preset }, { paseo });
    if (!applied.ok) throw new Error(applied.errors.join("\n"));
    const presetLead = applied.orchestratorAgentId;
    expect((await paseo.agents.ref(presetLead).waitForFinish(240_000)).status).toBe("idle");
    const intake = await ask("Add notes/plan.txt with two lines and checks/plan.check that says how to verify each line. Form two roles for it on the fast candidate: author (folder notes/) and verifier (folder checks/); verifier's task waits for author's. Use plan approval for this run. Use your defaults for anything open and show me the brief and the task plan.", 360_000, presetLead);
    console.log(`[e2e] preset intake: ${intake}`);
    const roles = JSON.parse(readFileSync(join(root, RUNS_DIR, "roles.json"), "utf8"))[presetLead] as { name: string; candidate: string; provider: string; model: string }[];
    console.log(`[e2e] formed roles: ${JSON.stringify(roles)}`);
    expect(roles.map((role) => role.name).sort()).toEqual(["author", "verifier"]);
    expect(roles.every((role) => role.candidate === "fast" && role.provider === provider && role.model === model)).toBe(true);
    const pending = JSON.parse(readFileSync(join(root, RUNS_DIR, "briefs.json"), "utf8"))[presetLead];
    expect(pending?.planApproval).toBe(true);
    expect(pending?.tasks?.length).toBeGreaterThanOrEqual(2);
    const start = await ask("Confirmed, go ahead with exactly that brief and plan. Approve the members' plans yourself if they fit the brief.", 900_000, presetLead);
    console.log(`[e2e] preset kickoff: ${start}`);
    let run = await settle("team", 1_200_000, presetLead);
    // A lead that stopped to ask about plans or the result gets a nudge, as a user would give.
    for (let nudge = 0; nudge < 2 && (!run.tasks.every((task) => task.state === "done" || task.state === "dropped")); nudge += 1) {
      console.log(`[e2e] nudging the lead: ${JSON.stringify(run.tasks.map((task) => [task.id, task.state, task.plan?.status]))}`);
      await ask("Carry on: approve the plans that fit the brief and finish the run.", 900_000, presetLead);
      run = await settle("team", 1_200_000, presetLead);
    }
    console.log(`[e2e] preset run: ${JSON.stringify({ tasks: run.tasks.map((task) => [task.id, task.role, task.state, task.ownerTitle, task.deps, task.plan?.status]), members: run.members.map((member) => [member.title, member.role, member.state]), posts: run.posts.map((post) => [post.seq, post.round, post.author, post.kind, post.to]) })}`);
    expect(run.planApproval).toBe(true);
    expect(run.tasks.every((task) => task.state === "done" || task.state === "dropped")).toBe(true);
    expect(run.tasks.filter((task) => task.state === "done").every((task) => task.plan?.status === "approved")).toBe(true);
    expect(run.tasks.some((task) => task.deps.length > 0)).toBe(true);
    const agents = (await paseo.agents.list()).entries.map((entry) => entry.agent);
    for (const member of run.members) {
      const agent = agents.find((entry) => entry.id === member.agentId)!;
      expect([agent.provider, agent.model]).toEqual([provider, model]);
      expect(["author", "verifier"]).toContain(member.role);
    }
    expect(existsSync(join(root, "notes/plan.txt"))).toBe(true);
    expect(existsSync(join(root, "checks/plan.check"))).toBe(true);
    console.log(`[e2e] preset flow: ${JSON.stringify(run.events.map((event) => `${event.component}:${event.action}:${event.from}>${event.to.join("+")}:${event.subject}`))}`);
    expect(run.events.some((event) => event.component === "plans" && event.action === "submit")).toBe(true);
    expect(run.events.some((event) => event.component === "plans" && (event.action === "approve" || event.action === "return") && event.from === "lead")).toBe(true);
    const info = await sessionInfo(presetLead);
    expect(info.roles.map((role) => role.name).sort()).toEqual(["author", "verifier"]);
    expect(info.run?.tasks.length).toBe(run.tasks.length);
  }, 3_000_000);

  it("a Chinese team works in Chinese, and auto mode locks the session to the mode of its first run", async () => {
    const workspace = await paseo.workspaces.create({ title: "zh", source: { kind: "directory", path: root } });
    const chinese: Team = { ...team(), mode: "auto", language: "zh", orchestrator: { workspace: "zh", provider, model } };
    const applied = await applyTeam({ workspaceId: workspace.id, team: chinese }, { paseo });
    if (!applied.ok) throw new Error(applied.errors.join("\n"));
    const zhLead = applied.orchestratorAgentId;
    const ready = await paseo.agents.ref(zhLead).waitForFinish(240_000);
    console.log(`[e2e] zh ready: ${ready.lastMessage}`);
    expect(ready.lastMessage ?? "").toMatch(/[\u4e00-\u9fff]/);
    expect((await paseo.agents.ref(zhLead).refresh())?.agent.labels["agent-team-lang"]).toBe("zh");
    expect(await sessionInfo(zhLead)).toMatchObject({ configured: "auto", locked: null, effective: "auto" });
    const reply = await ask("请创建 notes/zh.txt，内容是“你好”。这是一个可以独立完成的小任务，请委派给负责 notes 文件夹的角色，等它完成后用中文向我汇报。", 600_000, zhLead);
    console.log(`[e2e] zh reply: ${reply}`);
    expect(reply).toMatch(/[\u4e00-\u9fff]/);
    const run = await settle("delegation", 600_000, zhLead);
    expect(run.language).toBe("zh");
    const member = (await paseo.agents.ref(run.members[0]!.agentId).refresh())?.agent;
    expect(member?.labels["agent-team-lang"]).toBe("zh");
    const info = await sessionInfo(zhLead);
    expect(info).toMatchObject({ locked: "delegation", effective: "delegation" });
    const switched = await setSessionMode(zhLead, "team");
    expect(switched.ok).toBe(false);
  }, 1_200_000);

  it.skipIf(!process.env.PASEO_E2E_PLANNER)("plans a team from the project files when no goal is given", async () => {
    const { agentId } = await proposeTeam({ projectId, goal: "" }, { paseo });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await teamProposal({ agentId }, { paseo });
      if (result.status === "failed") throw new Error(result.errors.join("\n"));
      if (result.status === "done") {
        const planned = TeamSchema.parse(result.team);
        console.log(`[e2e] planned without a goal: ${JSON.stringify({ goal: planned.goal, mode: planned.mode, roles: planned.roles.map((role) => role.name), candidates: planned.candidates.map((candidate) => candidate.name) })}`);
        expect(planned.goal.trim().length).toBeGreaterThan(0);
        expect(planned.roles.length + planned.candidates.length).toBeGreaterThan(0);
        await paseo.agents.ref(agentId).archive().catch(() => undefined);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("the planner did not finish");
  }, 900_000);

  it("assigns work to unnamed candidates by their descriptions, and keeps what a description rules out away from them", async () => {
    const workspace = await paseo.workspaces.create({ title: "described", source: { kind: "directory", path: root } });
    const described: Team = {
      version: 1,
      goal: "A tiny notes folder used to test candidate descriptions",
      mode: "delegation",
      orchestrator: { workspace: "described", provider, model },
      roles: [],
      candidates: [
        { name: "", provider, model, notes: "擅长：写 notes/ 目录下的简短文字笔记。\n不要让它做：checks/ 目录下的任何工作。" },
        { name: "", provider, model, notes: "擅长：写 checks/ 目录下的校验清单。\n不要让它做：notes/ 目录下的任何工作。" },
      ],
    };
    const applied = await applyTeam({ workspaceId: workspace.id, team: described }, { paseo });
    if (!applied.ok) throw new Error(applied.errors.join("\n"));
    const describedLead = applied.orchestratorAgentId;
    expect((await paseo.agents.ref(describedLead).waitForFinish(240_000)).status).toBe("idle");
    const file = JSON.parse(readFileSync(applied.file, "utf8")) as Team;
    expect(file.candidates.map((candidate) => candidate.name)).toEqual([`${model.replace(/^claude-/, "")}`, `${model.replace(/^claude-/, "")}-2`]);
    const reply = await ask("Create notes/desc.txt containing the word hello, and checks/desc.check containing the word ok. Then report who did what.", 600_000, describedLead);
    console.log(`[e2e] described reply: ${reply}`);
    const run = await settle("delegation", 600_000, describedLead);
    console.log(`[e2e] described run: ${JSON.stringify(run.tasks.map((task) => [task.role, excerpt(task.detail, 120)]))}`);
    const [notesOwner, checksOwner] = file.candidates.map((candidate) => candidate.name);
    const notesTask = run.tasks.find((task) => /notes\/desc\.txt/.test(task.detail));
    const checksTask = run.tasks.find((task) => /checks\/desc\.check/.test(task.detail));
    expect(notesTask?.role).toBe(notesOwner);
    expect(checksTask?.role).toBe(checksOwner);
    expect(run.tasks.every((task) => !(task.role === notesOwner && /checks\//.test(task.detail)) && !(task.role === checksOwner && /notes\//.test(task.detail)))).toBe(true);
    expect(existsSync(join(root, "notes/desc.txt")) && existsSync(join(root, "checks/desc.check"))).toBe(true);
  }, 1_500_000);
});
