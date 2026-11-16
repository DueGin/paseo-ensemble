import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUNS_DIR, store, toolsFor } from "../server/collab";
import { findOrchestrator, type OrchestratorCandidate } from "../shared/cleanup";
import { createRun, taskBoardText, addTasks } from "../shared/collab";
import { allowsMode, effectiveMode, languageFromLocale, LANGUAGE_LABEL, LEAD_TOOLS, MEMBER_TOOLS, TEAM_MODES } from "../shared/modes";
import { promptsFor } from "../shared/prompts";
import { checkTeam, type Team } from "../shared/team";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const tempRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-team-lock-"));
  roots.push(root);
  return root;
};

describe("the none mode", () => {
  it("is a mode a team or session can pick, and starts no run", () => {
    expect(TEAM_MODES).toContain("none");
    expect(allowsMode("none", "team")).toBe(false);
    expect(allowsMode("none", "delegation")).toBe(false);
  });
});

describe("the auto lock", () => {
  it("wins over the user's override and the team file", () => {
    expect(effectiveMode("auto", null, "team")).toBe("team");
    expect(effectiveMode("auto", "delegation", "team")).toBe("team");
    expect(effectiveMode("auto", "delegation", null)).toBe("delegation");
  });

  it("is kept for the session: a later lock doesn't replace the first", async () => {
    const root = await tempRoot();
    await store.lockSession(root, "lead1", "delegation");
    await store.lockSession(root, "lead1", "team");
    expect(store.sessionLock(root, "lead1")).toBe("delegation");
    await store.setSessionMode(root, "lead1", "team");
    expect(store.sessionLock(root, "lead1")).toBe("delegation");
    const saved = JSON.parse(await readFile(join(root, RUNS_DIR, "sessions.json"), "utf8"));
    expect(saved.lead1).toEqual({ mode: "team", locked: "delegation" });
  });

  it("reads sessions files written before locks, which held a bare mode", async () => {
    const root = await tempRoot();
    await mkdir(join(root, RUNS_DIR), { recursive: true });
    await writeFile(join(root, RUNS_DIR, "sessions.json"), JSON.stringify({ old: "team", bad: 3, next: { mode: "none", locked: "team" } }));
    const sessions = await store.readSessions(root);
    expect(sessions).toEqual({ old: { mode: "team", locked: null }, next: { mode: "none", locked: "team" } });
    expect(store.sessionMode(root, "old")).toBe("team");
    expect(store.sessionLock(root, "next")).toBe("team");
  });

  it("is a session lock no other lead shares", async () => {
    const root = await tempRoot();
    await store.lockSession(root, "a", "team");
    expect(store.sessionLock(root, "b")).toBeNull();
  });
});

describe("the agents' language", () => {
  it("follows the app's locale when a team names none", () => {
    expect(languageFromLocale("zh-CN")).toBe("zh");
    expect(languageFromLocale("zh-Hant")).toBe("zh");
    expect(languageFromLocale("en-US")).toBe("en");
    expect(languageFromLocale("ko")).toBe("en");
    expect(languageFromLocale(undefined)).toBe("en");
  });

  it("gives Chinese agents the same tools, described in Chinese", () => {
    const en = toolsFor("en");
    const zh = toolsFor("zh");
    expect(zh.lead.map((tool) => tool.name)).toEqual(en.lead.map((tool) => tool.name));
    expect(zh.member.map((tool) => tool.name)).toEqual(en.member.map((tool) => tool.name));
    expect(en.lead.map((tool) => tool.name)).toEqual(Object.values(LEAD_TOOLS));
    expect(en.member.map((tool) => tool.name).sort()).toEqual(Object.values(MEMBER_TOOLS).sort());
    for (const tool of [...zh.lead, ...zh.member]) expect(tool.description).toMatch(/[一-鿿]/);
    for (const tool of [...en.lead, ...en.member]) expect(tool.description).not.toMatch(/[一-鿿]/);
  });

  it("falls back to English tools for an agent without a language label", () => {
    expect(toolsFor(undefined)).toBe(toolsFor("en"));
    expect(toolsFor("fr")).toBe(toolsFor("en"));
  });

  it("tells the agents to reply in Chinese, and renders the board in Chinese", () => {
    const team = checkTeam({ version: 1, goal: "", mode: "auto", language: "zh", orchestrator: { workspace: "lead", provider: "claude", model: "m" }, roles: [{ name: "api", provider: "claude", model: "m", folders: [], instructions: "" }] });
    expect(team.ok).toBe(true);
    const parsed = (team as { ok: true; team: Team }).team;
    expect(parsed.language).toBe("zh");
    expect(promptsFor("zh").orchestratorPrompt(parsed, ".agents/teams/x.json")).toMatch(/简体中文/);
    expect(promptsFor("zh").memberSystemPrompt(parsed, { name: "api", folders: [], instructions: "" })).toMatch(/简体中文/);
    const run = addTasks(createRun({ id: "R1", leadAgentId: "l", workspaceId: "w", mode: "team", title: "t", language: "zh", now: "2026-11-13T00:00:00Z" }), [{ title: "接口", role: "api" }], "lead", "2026-11-13T00:00:00Z").run;
    expect(taskBoardText(run)).toBe("任务（1 待办，0 进行中，0 已完成，0 已取消）：\n- T1 [待办] (api) 接口");
  });
});

describe("findOrchestrator and the language", () => {
  const team = { version: 1, goal: "", mode: "auto", language: "zh", orchestrator: { workspace: "lead", provider: "claude", model: "m" }, roles: [], candidates: [] } as unknown as Team;
  const lead = (labels: Record<string, string>): OrchestratorCandidate => ({ id: "o1", workspaceId: "w", labels: { "workspace-agents": "orchestrator", ...labels }, archivedAt: null, provider: "claude", model: "m", currentModeId: null });

  it("reuses a lead started in the team's language", () => {
    expect(findOrchestrator([lead({ [LANGUAGE_LABEL]: "zh" })], "w", team, undefined)?.id).toBe("o1");
  });

  it("starts a new lead when the language changed, since its instructions and tools are in the old one", () => {
    expect(findOrchestrator([lead({ [LANGUAGE_LABEL]: "en" })], "w", team, undefined)).toBeUndefined();
    expect(findOrchestrator([lead({})], "w", team, undefined)).toBeUndefined();
    expect(findOrchestrator([lead({})], "w", { ...team, language: undefined }, undefined)?.id).toBe("o1");
  });
});
