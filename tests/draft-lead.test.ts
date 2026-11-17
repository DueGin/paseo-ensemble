import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { draftCreateRequest, prepareDraftLead } from "../server/draft";
import { agentJob, agentLanguage, findOrchestrator, LABEL } from "../shared/cleanup";
import { DRAFT_TEAM, draftChoiceValue, draftTeamFor, draftTeamOf, LEAD_META, leadMetaOf } from "../shared/draft-lead";
import type { Preset } from "../shared/presets";
import { parseTeam, serializeTeam } from "../shared/team";
import { TEAMS_DIR } from "../shared/team-files";

const preset: Preset = {
  id: "p-1",
  name: "Fast pair",
  description: "Two quick models",
  mode: "team",
  language: "zh",
  orchestrator: { provider: "claude", model: "m" },
  candidates: [{ name: "fast", provider: "claude", model: "m", notes: "cheap" }],
  updatedAt: "",
};

describe("the draft's team choice", () => {
  it("round-trips between the composer's value and the metadata, keeping the mode", () => {
    expect(draftChoiceValue(null)).toBe("none");
    expect(draftTeamFor("none", null, "en")).toBeNull();
    const workspace = draftTeamFor("workspace", null, "zh-CN");
    expect(workspace).toEqual({ source: "workspace", locale: "zh-CN" });
    expect(draftChoiceValue(workspace)).toBe("workspace");
    const fromPreset = draftTeamFor("preset:p-1", { source: "workspace", mode: "delegation" }, "en");
    expect(fromPreset).toEqual({ source: "preset", presetId: "p-1", mode: "delegation", locale: "en" });
    expect(draftChoiceValue(fromPreset)).toBe("preset:p-1");
    expect(draftTeamFor("preset:", null, "en")).toBeNull();
  });

  it("reads only well-formed choices", () => {
    expect(draftTeamOf({ [DRAFT_TEAM]: { source: "workspace" } })).toEqual({ source: "workspace" });
    expect(draftTeamOf({ [DRAFT_TEAM]: { source: "preset" } })).toBeNull();
    expect(draftTeamOf({ [DRAFT_TEAM]: { source: "elsewhere" } })).toBeNull();
    expect(draftTeamOf({})).toBeNull();
    expect(draftTeamOf(null)).toBeNull();
  });

  it("knows a draft lead by its metadata, a plugin-started agent by its labels", () => {
    expect(agentJob({ labels: { [LABEL]: "member" } })).toBe("member");
    expect(agentJob({ labels: {}, metadata: { [LEAD_META]: { language: "zh" } } })).toBe("orchestrator");
    expect(agentJob({ labels: {}, metadata: { [LEAD_META]: { language: "fr" } } })).toBeUndefined();
    expect(agentLanguage({ labels: {}, metadata: { [LEAD_META]: { language: "zh" } } })).toBe("zh");
    // A running draft lead is reused on Apply like a labelled one.
    const lead = { id: "a1", workspaceId: "w", labels: {}, metadata: { [LEAD_META]: { language: "en" } }, provider: "claude", model: "m" };
    expect(findOrchestrator([lead], "w", { version: 1, goal: "", mode: "auto", orchestrator: { workspace: "x", provider: "claude", model: "m" }, roles: [], candidates: [{ name: "c", provider: "claude", model: "m", notes: "" }] }, undefined)?.id).toBe("a1");
  });
});

describe("agent.create.before for a draft", () => {
  const request = (metadata: Record<string, unknown>, systemPrompt?: string) => ({ config: { provider: "claude", cwd: "/x", ...(systemPrompt ? { systemPrompt } : {}) }, metadata }) as never;

  it("leaves a draft without a team alone", () => {
    expect(draftCreateRequest(request({}), [preset])).toBeUndefined();
  });

  it("makes the agent a lead in the client's language, keeping the user's own instructions after the lead's", () => {
    const result = draftCreateRequest(request({ [DRAFT_TEAM]: { source: "workspace", locale: "en-US" } }, "Be brief."), []) as { config: { systemPrompt: string }; metadata: Record<string, unknown> };
    expect(result.config.systemPrompt).toMatch(/^You are the lead of an agent team in Paseo, started from a new chat/);
    expect(result.config.systemPrompt).toMatch(/team_status/);
    expect(result.config.systemPrompt.endsWith("Be brief.")).toBe(true);
    expect(leadMetaOf(result.metadata)).toEqual({ language: "en" });
    expect(result.metadata[DRAFT_TEAM]).toEqual({ source: "workspace", locale: "en-US" });
  });

  it("uses a preset's language, and refuses a preset that is gone", () => {
    const result = draftCreateRequest(request({ [DRAFT_TEAM]: { source: "preset", presetId: "p-1", locale: "en" } }), [preset]) as { config: { systemPrompt: string }; metadata: Record<string, unknown> };
    expect(leadMetaOf(result.metadata)?.language).toBe("zh");
    expect(result.config.systemPrompt).toMatch(/^你是 Paseo 里一支智能体团队的协调器/);
    expect(() => draftCreateRequest(request({ [DRAFT_TEAM]: { source: "preset", presetId: "p-9", locale: "en" } }), [preset])).toThrow(/no longer exists/);
  });
});

describe("agent.open.before for a new draft lead", () => {
  let root: string;
  let toolsOn: boolean;
  const workspace = (id: string, title: string) => ({ id, projectId: "prj_1", archivingAt: null, name: id, title, workspaceKind: "directory", projectRootPath: root, projectDisplayName: "Demo", projectCustomName: null });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "draft-lead-"));
    mkdirSync(join(root, TEAMS_DIR), { recursive: true });
    writeFileSync(join(root, TEAMS_DIR, "busy.json"), serializeTeam({ version: 1, goal: "", mode: "auto", orchestrator: { workspace: "busy", provider: "claude", model: "m" }, roles: [{ name: "a", provider: "claude", model: "m", folders: [], instructions: "" }], candidates: [] }), "utf8");
    toolsOn = true;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const paseo = () => ({
    config: { get: async () => ({ config: { mcp: { injectIntoAgents: toolsOn } } }) },
    providers: { snapshot: async () => ({ entries: [{ provider: "claude", enabled: true, status: "ready", models: [{ id: "m", label: "m" }], modes: [{ id: "auto" }] }] }) },
    workspaces: { list: async () => ({ entries: [workspace("wks_busy", "busy"), workspace("wks_free", "free")] }) },
  }) as never;
  const open = (workspaceId: string, choice: Record<string, unknown>, reason = "create", lead: Record<string, unknown> = { language: "en" }) =>
    ({ agentId: "a1", workspaceId, provider: "claude", cwd: root, reason, purpose: "interactive", title: null, background: false, labels: {}, metadata: { [DRAFT_TEAM]: choice, [LEAD_META]: lead }, tools: [], env: {}, mcpServers: {} }) as never;

  it("leads the workspace's own team, with the draft's mode for the session", async () => {
    const setup = await prepareDraftLead(paseo(), open("wks_busy", { source: "workspace", mode: "team" }), [preset]);
    expect(setup).toMatchObject({ root, file: `${TEAMS_DIR}/busy.json`, mode: "team", lead: { language: "en", file: `${TEAMS_DIR}/busy.json` } });
    expect((await prepareDraftLead(paseo(), open("wks_busy", { source: "workspace", mode: "auto" }), [preset]))?.mode).toBeNull();
  });

  it("refuses a workspace without a team, saying what to do", async () => {
    await expect(prepareDraftLead(paseo(), open("wks_free", { source: "workspace" }), [preset])).rejects.toThrow(/has no team yet. Pick a preset/);
  });

  it("writes a preset as the workspace's team file, in the preset's language", async () => {
    const setup = await prepareDraftLead(paseo(), open("wks_free", { source: "preset", presetId: "p-1" }, "create", { language: "zh" }), [preset]);
    expect(setup?.file).toBe(`${TEAMS_DIR}/free.json`);
    const parsed = parseTeam(readFileSync(join(root, TEAMS_DIR, "free.json"), "utf8"));
    expect(parsed.ok && parsed.team).toMatchObject({ mode: "team", language: "zh", roles: [], orchestrator: { workspace: "free" }, preset: { id: "p-1" } });
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(true);
  });

  it("won't put a preset over a workspace's existing team", async () => {
    await expect(prepareDraftLead(paseo(), open("wks_busy", { source: "preset", presetId: "p-1" }), [preset])).rejects.toThrow(/already runs the team/);
  });

  it("does nothing on later opens, or once the lead has its team", async () => {
    expect(await prepareDraftLead(paseo(), open("wks_busy", { source: "workspace" }, "resume"), [preset])).toBeNull();
    expect(await prepareDraftLead(paseo(), open("wks_busy", { source: "workspace" }, "create", { language: "en", file: "x.json" }), [preset])).toBeNull();
  });

  it("refuses while Paseo tools are off for agents", async () => {
    toolsOn = false;
    await expect(prepareDraftLead(paseo(), open("wks_busy", { source: "workspace" }), [preset])).rejects.toThrow(/Paseo tools are turned off/);
  });
});
