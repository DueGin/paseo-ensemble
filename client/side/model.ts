// The side panel's view of sessions, members and teams, worked out from Paseo's agent snapshots and the plugin's RPC
// replies. Pure, so it is unit-tested without the app.
import type { RpcOutput } from "@getpaseo/plugin";
import { freeWorkspace } from "../../shared/apply-plan";
import { parentOf, type DashboardAgent } from "../../shared/agent-tree";
import { agentJob } from "../../shared/cleanup";
import { leadMetaOf } from "../../shared/draft-lead";
import type { Preset } from "../../shared/presets";
import type { teamProjectsRpc, teamReadRpc, teamSessionRpc } from "../../shared/rpc";
import { checkTeam, type Team } from "../../shared/team";

type ProjectsRpc = typeof teamProjectsRpc;
type ReadRpc = typeof teamReadRpc;
type SessionRpc = typeof teamSessionRpc;

export type Projects = RpcOutput<ProjectsRpc>;
export type ProjectTeams = Projects[number];
export type ProjectTeam = ProjectTeams["teams"][number];
export type WorkspaceTeam = RpcOutput<ReadRpc>;
export type SessionInfo = RpcOutput<SessionRpc>;
export type RunView = NonNullable<SessionInfo["run"]>;
export type Agent = DashboardAgent;

/** The workspace's team leads, newest first. */
export function workspaceLeads(agents: readonly Agent[], workspaceId: string): Agent[] {
  return agents.filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt && agentJob(agent) === "orchestrator").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type AgentState = "working" | "idle" | "attention" | "failed" | "starting" | "ended";

/** What an agent is doing, from its Paseo snapshot. */
export function agentState(agent: Pick<Agent, "status" | "archivedAt" | "requiresAttention" | "attentionReason">): AgentState {
  if (agent.archivedAt || agent.status === "closed") return "ended";
  if (agent.requiresAttention && (agent.attentionReason === "permission" || agent.attentionReason === "error")) return "attention";
  if (agent.status === "error") return "failed";
  if (agent.status === "running") return "working";
  if (agent.status === "initializing") return "starting";
  return "idle";
}

export interface MemberRow {
  agentId: string;
  title: string;
  role: string | null;
  provider: string | null;
  model: string | null;
  /** The run's state for a run member, else the agent's own. */
  state: string;
  live: boolean;
  retired: boolean;
  /** The agent still exists, so it can be opened. */
  open: boolean;
}

/** The lead's members: the run's members first, then other agents the lead started. */
export function leadMembers(agents: readonly Agent[], leadId: string, run: RunView | null): MemberRow[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const rows: MemberRow[] = (run?.members ?? []).map((member) => {
    const agent = byId.get(member.agentId);
    const own = agent ? agentState(agent) : null;
    // A member the run counts as done may still be busy in Paseo, or waiting on a prompt.
    const state = own === "working" || own === "attention" ? own : member.state;
    return { agentId: member.agentId, title: member.title, role: member.role, provider: agent?.provider ?? null, model: agent?.model ?? null, state, live: state === "working", retired: member.retired, open: !!agent };
  });
  const seen = new Set(rows.map((row) => row.agentId));
  for (const agent of agents) {
    if (seen.has(agent.id) || parentOf(agent) !== leadId || agent.subagent) continue;
    const state = agentState(agent);
    rows.push({ agentId: agent.id, title: agent.title?.trim() || agent.id.slice(0, 7), role: agent.labels.role ?? null, provider: agent.provider, model: agent.model ?? null, state, live: state === "working", retired: false, open: true });
  }
  return rows;
}

/** A team file's name without its folder and extension: `.agents/teams/web.json` → `web`. */
export function fileTitle(file: string): string {
  return (file.split("/").pop() ?? file).replace(/\.json$/i, "");
}

/** The team as the app reads it (defaults filled in), or null when there is none or it doesn't parse. */
export function parsedTeam(value: unknown): Team | null {
  if (!value) return null;
  const checked = checkTeam(value);
  return checked.ok ? checked.team : null;
}

/** What a team is called: its preset's name, else its file's name, else its workspace. */
export function teamLabel(team: { preset?: { name: string } } | null | undefined, file: string | null | undefined, fallback: string): string {
  return team?.preset?.name?.trim() || (file ? fileTitle(file) : "") || fallback;
}

/** The team file a lead started from a draft recorded, if any. */
export function leadFile(agent: Agent): string | null {
  return leadMetaOf(agent.metadata)?.file ?? null;
}

/** `provider/model`, or the provider alone. */
export function runtimeText(provider: string | null | undefined, model: string | null | undefined): string {
  if (!provider) return model ?? "";
  return model ? `${provider}/${model}` : provider;
}

/** A path inside the project shown relative to its root. */
export function relativeTo(root: string, file: string): string {
  return file.startsWith(root) ? file.slice(root.length).replace(/^[\\/]+/, "") : file;
}

/** Why a preset can't take a name: empty, or another preset has it (case-insensitively); null when it can. */
export function renameProblem(presets: readonly Pick<Preset, "id" | "name">[], id: string, name: string): "empty" | "taken" | null {
  const next = name.trim();
  if (!next) return "empty";
  return presets.some((preset) => preset.id !== id && preset.name.trim().toLowerCase() === next.toLowerCase()) ? "taken" : null;
}

/**
 * The workspace a preset copied into a project runs in: the current workspace when it has no team yet (the preset becomes
 * its team), else a title after the preset that no workspace or team of the project uses.
 */
export function copyWorkspace(presetName: string, taken: readonly string[], here: { title: string; hasTeam: boolean } | null): string {
  if (here && here.title && !here.hasTeam) return here.title;
  return freeWorkspace(presetName.trim() || "team", [...taken, ...(here?.title ? [here.title] : [])]);
}
