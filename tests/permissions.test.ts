import { describe, expect, it } from "vitest";
import { LEAD_TOOLS, MEMBER_TOOLS } from "../shared/modes";
import { claudeToolRule, claudeToolRules, withAllowRule } from "../shared/permissions";
import type { Team } from "../shared/team";

const team = (orchestrator: string, roles: string[]): Team => ({
  version: 1,
  mode: "delegation",
  candidates: [],
  goal: "",
  orchestrator: { workspace: "orchestrator", provider: orchestrator, model: "m" },
  roles: roles.map((provider, at) => ({ name: `r${at}`, provider, model: "m", folders: [], instructions: "" })),
});

describe("claudeToolRules", () => {
  it("allows the lead tools when the lead runs on Claude", () => {
    expect(claudeToolRules(team("claude", ["codex"]))).toEqual(Object.values(LEAD_TOOLS).map(claudeToolRule));
  });

  it("allows the board tools when a role runs on Claude", () => {
    expect(claudeToolRules(team("codex", ["codex", "claude"]))).toEqual(Object.values(MEMBER_TOOLS).map(claudeToolRule));
  });

  it("allows both, or nothing for a team without Claude", () => {
    expect(claudeToolRules(team("claude", ["claude"]))).toHaveLength(Object.values(LEAD_TOOLS).length + Object.values(MEMBER_TOOLS).length);
    expect(claudeToolRules(team("codex", ["pi"]))).toEqual([]);
  });

  it("names tools as Claude sees Paseo's MCP server", () => {
    expect(claudeToolRule(LEAD_TOOLS.delegate)).toBe("mcp__paseo__team_delegate");
  });
});

describe("withAllowRule", () => {
  it("adds the rule to an empty settings file", () => {
    expect(withAllowRule({}, "mcp__paseo__team_status")).toEqual({ permissions: { allow: ["mcp__paseo__team_status"] } });
  });

  it("keeps the other settings and rules", () => {
    expect(withAllowRule({ model: "opus", permissions: { allow: ["Read"], deny: ["Bash(rm *)"] } }, "mcp__paseo__team_status")).toEqual({
      model: "opus",
      permissions: { allow: ["Read", "mcp__paseo__team_status"], deny: ["Bash(rm *)"] },
    });
  });

  it("returns null when the rule is already there", () => {
    expect(withAllowRule({ permissions: { allow: ["mcp__paseo__team_status"] } }, "mcp__paseo__team_status")).toBeNull();
  });
});
