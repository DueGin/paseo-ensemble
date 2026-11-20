import { describe, expect, it } from "vitest";
import { agentState, copyWorkspace, fileTitle, freeWorkspaces, leadMembers, parsedTeam, projectsWithTeams, relativeTo, renameProblem, runtimeText, teamLabel, workspaceLeads, type Agent, type ProjectTeam, type ProjectTeams, type RunView } from "../client/side/model";
import * as side from "../shared/messages-side";

const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({ id, workspaceId: "w1", provider: "claude", model: "haiku", title: id, status: "idle", labels: {}, createdAt: "2026-11-19T10:00:00.000Z", ...extra });

const run = (members: RunView["members"]): RunView => ({
  id: "R1",
  mode: "team",
  title: "Dark mode",
  status: "active",
  round: 1,
  rounds: 2,
  planApproval: false,
  createdAt: "2026-11-19T10:00:00.000Z",
  updatedAt: "2026-11-19T10:05:00.000Z",
  brief: null,
  members,
  tasks: [],
  posts: [],
  postCount: 0,
  claims: [],
  events: [],
  batches: [],
});

describe("a workspace's team sessions", () => {
  it("are its unarchived leads, labelled or started from a draft, newest first", () => {
    const agents = [
      agent("old", { labels: { "workspace-agents": "orchestrator" }, createdAt: "2026-11-19T09:00:00.000Z" }),
      agent("draft", { metadata: { "paseo-ensemble.lead": { language: "en" } }, createdAt: "2026-11-19T11:00:00.000Z" }),
      agent("member", { labels: { "workspace-agents": "member" } }),
      agent("archived", { labels: { "workspace-agents": "orchestrator" }, archivedAt: "2026-11-19T12:00:00.000Z" }),
      agent("elsewhere", { labels: { "workspace-agents": "orchestrator" }, workspaceId: "w2" }),
    ];
    expect(workspaceLeads(agents, "w1").map((lead) => lead.id)).toEqual(["draft", "old"]);
  });

  it("read an agent's state from its snapshot", () => {
    expect(agentState({ status: "running" })).toBe("working");
    expect(agentState({ status: "idle" })).toBe("idle");
    expect(agentState({ status: "idle", requiresAttention: true, attentionReason: "permission" })).toBe("attention");
    expect(agentState({ status: "idle", requiresAttention: true, attentionReason: "finished" })).toBe("idle");
    expect(agentState({ status: "error" })).toBe("failed");
    expect(agentState({ status: "initializing" })).toBe("starting");
    expect(agentState({ status: "idle", archivedAt: "2026-11-19T12:00:00.000Z" })).toBe("ended");
  });
});

describe("a lead's members", () => {
  it("list the run's members first, then other agents the lead started, without provider sub-agents", () => {
    const agents = [
      agent("lead"),
      agent("m1", { parentAgentId: "lead", status: "running", labels: { role: "writer" } }),
      agent("m3", { parentAgentId: "lead", labels: { role: "tester" }, title: "tester#AB12" }),
      agent("sub", { parentAgentId: "lead", subagent: true }),
      agent("stranger", { parentAgentId: "other" }),
    ];
    const rows = leadMembers(agents, "lead", run([
      { role: "writer", agentId: "m1", title: "writer#F579", state: "done", task: "", retired: false },
      { role: "checker", agentId: "gone", title: "checker#4CC3", state: "done", task: "", retired: true },
    ]));
    expect(rows.map((row) => [row.agentId, row.state, row.open])).toEqual([
      // Busy in Paseo though the run counts it done.
      ["m1", "working", true],
      ["gone", "done", false],
      ["m3", "idle", true],
    ]);
    expect(rows[0]).toMatchObject({ provider: "claude", model: "haiku", live: true });
    expect(rows[1]!.retired).toBe(true);
  });

  it("are the lead's children when there is no run yet", () => {
    expect(leadMembers([agent("lead"), agent("m1", { labels: { "paseo.parent-agent-id": "lead" } })], "lead", null).map((row) => row.agentId)).toEqual(["m1"]);
  });
});

describe("team names and paths", () => {
  it("name a team after its preset, else its file", () => {
    expect(fileTitle(".agents/teams/web-app.json")).toBe("web-app");
    expect(teamLabel({ preset: { name: "Review crew" } }, ".agents/teams/main.json", "main")).toBe("Review crew");
    expect(teamLabel(null, ".agents/teams/main.json", "main")).toBe("main");
    expect(teamLabel(null, null, "main")).toBe("main");
  });

  it("show models, and files relative to the project", () => {
    expect(runtimeText("claude", "haiku")).toBe("claude/haiku");
    expect(runtimeText("claude", null)).toBe("claude");
    expect(relativeTo("/repo", "/repo/.agents/teams/main.json")).toBe(".agents/teams/main.json");
    expect(relativeTo("/repo", "/elsewhere/x.json")).toBe("/elsewhere/x.json");
  });

  it("read a team with its defaults, or nothing", () => {
    expect(parsedTeam({ version: 1, orchestrator: { workspace: "main", provider: "claude", model: "haiku" }, candidates: [{ provider: "claude", model: "haiku" }] })).toMatchObject({ mode: "delegation", roles: [], goal: "" });
    expect(parsedTeam(null)).toBeNull();
    expect(parsedTeam({ version: 1 })).toBeNull();
  });
});

describe("preset edits", () => {
  const presets = [{ id: "a", name: "Everyday team" }, { id: "b", name: "Review crew" }];

  it("refuse an empty name or one another preset has, whatever its case", () => {
    expect(renameProblem(presets, "a", "  ")).toBe("empty");
    expect(renameProblem(presets, "a", "review CREW ")).toBe("taken");
    expect(renameProblem(presets, "b", "Review Crew")).toBeNull();
    expect(renameProblem(presets, "a", "Night shift")).toBeNull();
  });

  it("copy a preset into the current workspace when it has no team, else into a free workspace", () => {
    expect(copyWorkspace("Review crew", ["main"], { title: "main", hasTeam: false })).toBe("main");
    expect(copyWorkspace("Review crew", ["main", "Review crew"], { title: "main", hasTeam: true })).toBe("Review crew-2");
    expect(copyWorkspace("main", [], { title: "main", hasTeam: true })).toBe("main-2");
    expect(copyWorkspace("  ", [], null)).toBe("team");
  });
});

describe("the Agent teams screen's projects", () => {
  const team = (file: string, workspaceId: string | null): ProjectTeam => ({ file, goal: "", orchestratorWorkspace: file, workspaceId, roles: 1, candidates: 0, mode: "auto", orchestrator: { provider: "claude", model: "haiku" }, language: null });
  const project = (id: string, teams: ProjectTeam[], errors: string[] = []): ProjectTeams => ({
    id,
    name: id,
    root: `/src/${id}`,
    workspaces: [
      { id: `${id}-main`, title: "main" },
      { id: `${id}-ui`, title: "ui" },
    ],
    teams,
    errors,
  });

  it("list only projects with a team, or with a team file that couldn't be read", () => {
    const projects = [project("empty", []), project("teams", [team("a.json", "teams-main")]), project("broken", [], ["bad.json: not JSON"])];
    expect(projectsWithTeams(projects).map((entry) => entry.id)).toEqual(["teams", "broken"]);
  });

  it("offer a new team only the workspaces no team runs in", () => {
    expect(freeWorkspaces(project("p", [team("a.json", "p-main"), team("gone.json", null)])).map((entry) => entry.id)).toEqual(["p-ui"]);
    expect(freeWorkspaces(project("p", [])).map((entry) => entry.id)).toEqual(["p-main", "p-ui"]);
  });
});

describe("the side panel's strings", () => {
  const placeholders = (resource: object, prefix = ""): Record<string, string[]> =>
    Object.fromEntries(Object.entries(resource).flatMap(([key, value]) => (typeof value === "string" ? [[prefix + key, [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]!).sort()]] : Object.entries(placeholders(value, `${prefix}${key}.`)))));
  it.each([["ko", side.ko], ["ja", side.ja], ["zh", side.zh]] as const)("use the same placeholders in English and %s", (_name, resource) => {
    expect(placeholders(resource)).toEqual(placeholders(side.en));
  });
});
