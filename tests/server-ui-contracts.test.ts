import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HandoffCardSchema, UpdateCardSchema } from "../shared/cards";
import * as editor from "../shared/messages-editor";
import * as report from "../shared/messages-report";
import * as side from "../shared/messages-side";
import { parseTeam, type Team } from "../shared/team";
import { TEAMS_DIR } from "../shared/team-files";
import { agentModeOf, memberModeOf, type ProviderEntry } from "../shared/validate";
import { saveTeam } from "../server/team";

const entries: ProviderEntry[] = [
  { provider: "claude", enabled: true, status: "ready", modes: [{ id: "plan" }, { id: "default", label: "Always Ask" }, { id: "auto", label: "Auto mode" }, { id: "bypassPermissions", label: "Bypass", colorTier: "dangerous" }] },
  { provider: "codex", enabled: true, status: "ready", modes: [{ id: "default", label: "Default Permissions" }, { id: "auto-review", label: "Auto-review" }, { id: "full-access", label: "Full Access", isUnattended: true }] },
  { provider: "gemini", enabled: true, status: "ready", modes: [{ id: "default" }, { id: "auto", label: "Auto" }] },
];

describe("a member's mode", () => {
  it("is its provider's full-access mode, so delegated work never stops on a prompt", () => {
    expect(memberModeOf(entries, "claude")).toBe("bypassPermissions");
    expect(memberModeOf(entries, "codex")).toBe("full-access");
  });

  it("falls back to the lead's mode for a provider without one", () => {
    expect(memberModeOf(entries, "gemini")).toBe(agentModeOf(entries, "gemini"));
    expect(memberModeOf(entries, "nobody")).toBeUndefined();
  });
});

describe("the delegation cards", () => {
  it("validate what the daemon appends", () => {
    const at = "2026-11-19T10:00:00.000Z";
    expect(HandoffCardSchema.parse({ runId: "R1", workspaceId: "w", agentId: "a", title: "writer#1", role: "writer", provider: "claude", model: "haiku", task: "Write notes", continued: false, at }).title).toBe("writer#1");
    expect(UpdateCardSchema.parse({ runId: "R1", workspaceId: null, agentId: "a", title: "writer#1", role: "writer", outcome: "completed", result: "Done", at }).outcome).toBe("completed");
    expect(() => UpdateCardSchema.parse({ runId: "R1", workspaceId: null, agentId: "a", title: "w", role: "w", outcome: "maybe", result: "", at })).toThrow();
  });
});

describe("each surface's strings", () => {
  const keys = (resource: object, prefix = ""): string[] => Object.entries(resource).flatMap(([key, value]) => (typeof value === "string" ? [prefix + key] : keys(value, `${prefix}${key}.`))).sort();
  it.each([
    ["editor", editor],
    ["report", report],
    ["side", side],
  ] as const)("%s has the same keys in every language", (_name, set) => {
    for (const lang of [set.ko, set.ja, set.zh]) expect(keys(lang)).toEqual(keys(set.en));
  });
});

describe("saving a team without starting it", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "save-team-"));
    mkdirSync(join(root, TEAMS_DIR), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const paseo = () => ({ projects: { list: async () => ({ projects: [{ projectId: "prj_1", projectDisplayName: "Demo", projectCustomName: null, projectRootPath: root }] }) } }) as never;
  const team: Team = { version: 1, goal: "", mode: "delegation", orchestrator: { workspace: "web", provider: "claude", model: "m" }, roles: [{ name: "a", provider: "claude", model: "m", folders: [], instructions: "" }], candidates: [] };

  it("writes the team file and starts nothing", async () => {
    const saved = await saveTeam({ projectId: "prj_1", team }, { paseo: paseo() } as never);
    expect(saved).toEqual({ ok: true, file: join(root, TEAMS_DIR, "web.json") });
    const parsed = parseTeam(readFileSync(join(root, TEAMS_DIR, "web.json"), "utf8"));
    expect(parsed.ok && parsed.team.mode).toBe("delegation");
  });

  it("refuses an invalid team", async () => {
    const saved = await saveTeam({ projectId: "prj_1", team: { ...team, roles: [], candidates: [] } }, { paseo: paseo() } as never);
    expect(saved.ok).toBe(false);
  });
});
