import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFromPreset } from "../server/team";
import { newPresetId, presetProblems, presetsSettings, presetToTeam, taskWorkspaceTitle, teamToPreset, type Preset } from "../shared/presets";
import { teamPresetStartRpc } from "../shared/rpc";
import { parseTeam, serializeTeam, type Team } from "../shared/team";
import { TEAMS_DIR } from "../shared/team-files";

const preset: Preset = {
  id: "p-1",
  name: "Fast pair",
  description: "Two quick models",
  mode: "team",
  orchestrator: { provider: "claude", model: "m" },
  candidates: [{ name: "fast", provider: "claude", model: "m", notes: "cheap" }, { name: "deep", provider: "claude", model: "m", notes: "" }],
  updatedAt: "",
};

describe("preset helpers", () => {
  it("turns a preset into a team with no fixed roles, its candidates and mode, and remembers where it came from", () => {
    const team = presetToTeam(preset, "Login page", { goal: "Build the login page" });
    expect(team).toMatchObject({ goal: "Build the login page", mode: "team", orchestrator: { workspace: "Login page", provider: "claude", model: "m" }, roles: [], preset: { id: "p-1", name: "Fast pair" } });
    expect(team.candidates).toEqual(preset.candidates);
    expect(team.candidates).not.toBe(preset.candidates);
    expect(presetToTeam(preset, "w", { mode: "delegation" }).mode).toBe("delegation");
    expect(presetToTeam(preset, "w").goal).toBe("Two quick models");
    expect(parseTeam(serializeTeam(team))).toEqual({ ok: true, team });
  });

  it("makes a preset from a team: its candidates, and its fixed roles as candidates noted with their instructions", () => {
    const team: Team = { version: 1, goal: "Game", mode: "auto", orchestrator: { workspace: "w", provider: "claude", model: "o" }, roles: [{ name: "ui", provider: "codex", model: "x", folders: ["src/ui"], instructions: "Owns UI" }, { name: "fast", provider: "codex", model: "y", folders: [], instructions: "" }], candidates: [{ name: "fast", provider: "claude", model: "m", notes: "" }] };
    const made = teamToPreset(team, " Game team ", "p-2", "now");
    expect(made).toMatchObject({ id: "p-2", name: "Game team", description: "Game", mode: "auto", orchestrator: { provider: "claude", model: "o" } });
    expect(made.candidates.map((candidate) => [candidate.name, candidate.model, candidate.notes])).toEqual([["fast", "m", ""], ["ui", "x", "Owns UI"]]);
  });

  it("lists what keeps a draft from being saved", () => {
    expect(presetProblems(preset)).toEqual([]);
    expect(presetProblems({ ...preset, name: " ", candidates: [] })).toEqual(["name", "candidates"]);
    expect(presetProblems({ ...preset, candidates: [preset.candidates[0]!, { ...preset.candidates[0]! }] })).toEqual(["candidateNames"]);
    expect(presetProblems({ ...preset, orchestrator: { provider: "claude", model: "" }, candidates: [{ name: "x", provider: "", model: "", notes: "" }] })).toEqual(["orchestrator", "candidateModels"]);
  });

  it("names a task's workspace after the request, or the preset", () => {
    expect(taskWorkspaceTitle("Add a login page\nwith OAuth", "p")).toBe("Add a login page");
    expect(taskWorkspaceTitle("  ", "Fast pair")).toBe("Fast pair");
    expect(taskWorkspaceTitle("fix a/b: c?", "p")).toBe("fix a b c");
    expect(taskWorkspaceTitle("x".repeat(60), "p")).toHaveLength(41);
  });

  it("lets a candidate go without a name: it gets one from its model, unique, and given names are kept", () => {
    const parsed = presetsSettings.schema.parse({ presets: [{ ...preset, candidates: [{ provider: "claude", model: "claude-haiku-5-5", notes: "quick" }, { name: "", provider: "codex", model: "auto/gpt-6.1-sol" }, { name: "  ", provider: "claude", model: "claude-haiku-5-5" }, { name: "haiku-5-5-2", provider: "x", model: "y" }] }] });
    expect(parsed.presets[0]!.candidates.map((candidate) => candidate.name)).toEqual(["haiku-5-5", "gpt-6.1-sol", "haiku-5-5-3", "haiku-5-5-2"]);
    expect(presetProblems({ ...preset, candidates: [{ name: "", provider: "claude", model: "m", notes: "" }, { name: "", provider: "claude", model: "m", notes: "" }] })).toEqual([]);
  });

  it("stores presets as one host document that defaults to none", () => {
    expect(presetsSettings).toMatchObject({ id: "presets", scope: "host", version: 1 });
    expect(presetsSettings.schema.parse({})).toEqual({ presets: [] });
    expect(newPresetId(() => 0.5)).toBe("p-80000000");
  });
});

describe("startFromPreset", () => {
  let root: string;
  let workspaces: { id: string; projectId: string; archivingAt: string | null; name: string; title: string; workspaceKind: string; projectRootPath: string; projectDisplayName: string; projectCustomName: null }[];
  let createdAgents: { workspaceId: string; options: { prompt?: string; title?: string; config: { provider: string; systemPrompt?: string } } }[];
  let toolsOn: boolean;

  const workspace = (id: string, title: string) => ({ id, projectId: "prj_1", archivingAt: null, name: id, title, workspaceKind: "directory", projectRootPath: root, projectDisplayName: "Demo", projectCustomName: null });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "preset-start-"));
    mkdirSync(join(root, TEAMS_DIR), { recursive: true });
    workspaces = [workspace("wks_main", "main"), workspace("wks_busy", "busy"), workspace("wks_login", "Add a login page")];
    writeFileSync(join(root, TEAMS_DIR, "busy.json"), serializeTeam({ version: 1, goal: "", mode: "auto", orchestrator: { workspace: "busy", provider: "claude", model: "m" }, roles: [{ name: "a", provider: "claude", model: "m", folders: [], instructions: "" }], candidates: [] }), "utf8");
    createdAgents = [];
    toolsOn = true;
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const context = () => ({
    paseo: {
      config: { get: async () => ({ config: { mcp: { injectIntoAgents: toolsOn } } }) },
      providers: {
        snapshot: async () => ({ entries: [{ provider: "claude", enabled: true, status: "ready", models: [{ id: "m", label: "m" }], modes: [{ id: "auto" }] }] }),
        listFeatures: async () => ({ features: [] }),
      },
      projects: { list: async () => ({ projects: [{ projectId: "prj_1", projectCustomName: null, projectDisplayName: "Demo", projectRootPath: root }] }) },
      workspaces: {
        list: async () => ({ entries: workspaces }),
        create: async ({ title }: { title: string }) => {
          const created = workspace(`wks_${workspaces.length + 1}`, title);
          workspaces.push(created);
          return { id: created.id };
        },
        ref: (workspaceId: string) => ({ agents: { create: async (options: never) => { createdAgents.push({ workspaceId, options }); return { id: "agent_lead" }; } } }),
        archive: async () => ({}),
      },
      agents: { list: async () => ({ entries: [] }) },
    } as never,
  });

  it("starts the task in a new workspace named after the request, never on an existing title, with the request as the lead's first message", async () => {
    const result = await startFromPreset({ projectId: "prj_1", presetId: "p-1", workspace: { title: "" }, request: "Add a login page\nEmail and password." }, context(), [preset]);
    expect(result).toMatchObject({ ok: true, orchestratorAgentId: "agent_lead", workspaceId: "wks_4" });
    expect(workspaces.at(-1)!.title).toBe("Add a login page-2");
    const file = readFileSync(join(root, TEAMS_DIR, "add-a-login-page-2.json"), "utf8");
    const parsed = parseTeam(file);
    expect(parsed.ok && parsed.team).toMatchObject({ goal: "Add a login page", mode: "team", roles: [], preset: { id: "p-1", name: "Fast pair" }, orchestrator: { workspace: "Add a login page-2" } });
    expect(createdAgents).toHaveLength(1);
    expect(createdAgents[0]!.options.prompt).toBe("Add a login page\nEmail and password.");
    expect(createdAgents[0]!.options.config.systemPrompt).toContain("- fast (claude/m)\n  cheap");
  });

  it("uses an existing workspace without a team, and the mode picked for this task", async () => {
    const result = await startFromPreset({ projectId: "prj_1", presetId: "p-1", workspace: { workspaceId: "wks_main" }, request: "", mode: "delegation" }, context(), [preset]);
    expect(result.ok).toBe(true);
    const parsed = parseTeam(readFileSync(join(root, TEAMS_DIR, "main.json"), "utf8"));
    expect(parsed.ok && parsed.team.mode).toBe("delegation");
    expect(createdAgents[0]!.options.prompt).toMatch(/^\[agent-team\] Read \.agents\/teams\/main\.json/);
  });

  it("refuses a workspace that already runs a team, an unknown preset, and a host without Paseo tools", async () => {
    expect(await startFromPreset({ projectId: "prj_1", presetId: "p-1", workspace: { workspaceId: "wks_busy" }, request: "x" }, context(), [preset])).toEqual({ ok: false, errors: [expect.stringContaining("already runs a team")] });
    expect(await startFromPreset({ projectId: "prj_1", presetId: "nope", workspace: { title: "t" }, request: "x" }, context(), [preset])).toEqual({ ok: false, errors: [expect.stringContaining("preset was not found")] });
    toolsOn = false;
    expect(await startFromPreset({ projectId: "prj_1", presetId: "p-1", workspace: { title: "t" }, request: "x" }, context(), [preset])).toEqual({ ok: false, errors: [expect.stringContaining("Paseo tools are turned off")] });
    expect(createdAgents).toEqual([]);
  });

  it("has an RPC contract that takes a new title or an existing workspace", () => {
    expect(teamPresetStartRpc.input.safeParse({ projectId: "p", presetId: "x", workspace: { title: "t" } }).success).toBe(true);
    expect(teamPresetStartRpc.input.safeParse({ projectId: "p", presetId: "x", workspace: { workspaceId: "w" }, request: "r", mode: "team" }).success).toBe(true);
    expect(teamPresetStartRpc.input.safeParse({ projectId: "p", presetId: "x", workspace: {} }).success).toBe(false);
  });
});
