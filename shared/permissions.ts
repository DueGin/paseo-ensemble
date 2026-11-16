import { LEAD_TOOLS, MEMBER_TOOLS } from "./modes";
import type { Team } from "./team";

/** The project's local Claude settings; Paseo starts Claude agents with user, project and local settings. */
export const CLAUDE_LOCAL_SETTINGS = ".claude/settings.local.json";

/** Paseo serves agent tools, including plugin tools, from its MCP server named "paseo". */
export const claudeToolRule = (tool: string) => `mcp__paseo__${tool}`;

/**
 * Narrow allow rules for the plugin's team tools, which Claude's Auto mode honours instead of asking its reviewer. The
 * reviewer could otherwise deny `team_delegate` or `team_kickoff` for starting a member in an unattended mode. Lead tools
 * are added when the lead runs on Claude, board tools when a role or candidate member does.
 */
export function claudeToolRules(team: Team): string[] {
  return [
    ...(team.orchestrator.provider === "claude" ? Object.values(LEAD_TOOLS) : []),
    ...([...team.roles, ...team.candidates].some((member) => member.provider === "claude") ? Object.values(MEMBER_TOOLS) : []),
  ].map(claudeToolRule);
}

/** The settings with the rule added to `permissions.allow`, or null when it is already there. */
export function withAllowRule(settings: Record<string, unknown>, rule: string): Record<string, unknown> | null {
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? (permissions.allow as unknown[]) : [];
  if (allow.includes(rule)) return null;
  return { ...settings, permissions: { ...permissions, allow: [...allow, rule] } };
}
