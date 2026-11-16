// Ways into a session's dashboard and mode from the session itself: a composer pill on each collaborating agent, a
// "Mode" pill on each team lead, a Command Center item and a slash command. Paseo 0.15 doesn't tell a sidebar panel
// which agent tab has focus, so the session is handed over from the agent's own context.
import type { PluginButtonMenuEntry, PluginButtonRegistration, PluginClientContext, PluginMessage, PluginText } from "@getpaseo/plugin/client";
import { parentOf, sessionRootOf, type DashboardAgent } from "../shared/agent-tree";
import { LABEL } from "../shared/cleanup";
import { TEAM_MODES, type CollabMode, type TeamMode } from "../shared/modes";
import { teamSessionModeRpc, teamSessionRpc } from "../shared/rpc";
import { messages } from "./i18n";

export const SESSION_PANEL = "session-dashboard";

type Agent = Pick<DashboardAgent, "id" | "workspaceId" | "labels" | "archivedAt" | "parentAgentId" | "createdAt"> & { provider: string; status: string };

const PILL_LABEL: Record<TeamMode, PluginMessage> = {
  auto: messages.message("mode.pillAuto"),
  team: messages.message("mode.pillTeam"),
  delegation: messages.message("mode.pillDelegation"),
  none: messages.message("mode.pillNone"),
};

/** A session auto fixed to a mode shows it, and the pill can't change it. */
const LOCKED_LABEL: Record<CollabMode, PluginMessage> = {
  team: messages.message("mode.pillLockedTeam"),
  delegation: messages.message("mode.pillLockedDelegation"),
};

/** Opens the session's dashboard in the right sidebar, for the top of the session in this workspace. */
export async function openSessionDashboard(client: PluginClientContext, workspaceId: string, agentId: string): Promise<void> {
  let target = agentId;
  try {
    const { entries } = await client.paseo.agents.list();
    target = sessionRootOf(entries.map((entry) => entry.agent as unknown as DashboardAgent), agentId, { sameWorkspace: true });
  } catch {
    // Without the list, the agent's own session still opens.
  }
  try {
    client.openPanel(SESSION_PANEL, { workspaceId, agentId: target, location: "explorer" });
  } catch {
    client.openPanel(SESSION_PANEL, { workspaceId, agentId, location: "explorer" });
  }
}

export function contributeSessionAccess(client: PluginClientContext): () => void {
  const cleanups: Array<() => void> = [];
  cleanups.push(client.addCommandCenterItem({
    id: SESSION_PANEL,
    title: messages.message("session.command"),
    icon: "Network",
    keywords: ["dashboard", "session", "agents", "대시보드", "세션", "ダッシュボード", "セッション", "仪表盘", "会话", "智能体"],
    context: "agent",
    onSelect: ({ agent }) => openSessionDashboard(client, agent.workspaceId, agent.id),
  }));
  cleanups.push(client.addSlashCommand({
    name: "dashboard",
    description: messages.message("session.slash"),
    argumentHint: "",
    context: "agent",
    onSubmit: ({ agent }) => openSessionDashboard(client, agent.workspaceId, agent.id),
  }));

  const lifetime = new AbortController();
  const agents = new Map<string, Agent>();
  const dashboardPills = new Map<string, PluginButtonRegistration<PluginText>>();
  const modePills = new Map<string, PluginButtonRegistration<PluginText>>();
  const modes = new Map<string, TeamMode>();
  const locks = new Map<string, CollabMode | null>();
  const refreshedAt = new Map<string, number>();

  const collaborating = (agent: Agent) =>
    agent.labels[LABEL] === "orchestrator" || agent.labels[LABEL] === "member" || parentOf(agent as DashboardAgent) !== undefined ||
    [...agents.values()].some((other) => parentOf(other as DashboardAgent) === agent.id);

  const modeMenu = (agentId: string): readonly PluginButtonMenuEntry<PluginText>[] =>
    TEAM_MODES.map((mode) => ({
      kind: "item" as const,
      id: mode,
      title: messages.message(`mode.${mode}`),
      ...(modes.get(agentId) === mode ? { icon: "Check" } : {}),
      behavior: {
        kind: "action" as const,
        async onPress() {
          const result = await client.rpc(teamSessionModeRpc, { agentId, mode });
          if (!result.ok) throw new Error(result.errors.join("; "));
          setMode(agentId, result.effective, null);
        },
      },
    }));

  const setMode = (agentId: string, mode: TeamMode, locked: CollabMode | null) => {
    modes.set(agentId, mode);
    locks.set(agentId, locked);
    modePills.get(agentId)?.update({ label: locked ? LOCKED_LABEL[locked] : PILL_LABEL[mode], disabled: locked !== null, behavior: { kind: "menu", items: modeMenu(agentId) } });
  };

  /** Reads the lead's mode at most every few seconds; the dashboard can switch it too. */
  const refreshMode = (agentId: string) => {
    const last = refreshedAt.get(agentId) ?? 0;
    if (Date.now() - last < 5000) return;
    refreshedAt.set(agentId, Date.now());
    void client.rpc(teamSessionRpc, { agentId }).then((info) => {
      if (!lifetime.signal.aborted && info.effective && modePills.has(agentId)) setMode(agentId, info.effective, info.locked);
      return undefined;
    }).catch(() => undefined);
  };

  const sync = () => {
    if (lifetime.signal.aborted) return;
    for (const [id, pill] of dashboardPills) {
      const agent = agents.get(id);
      if (!agent || agent.archivedAt || !collaborating(agent)) {
        pill.remove();
        dashboardPills.delete(id);
      }
    }
    for (const [id, pill] of modePills) {
      const agent = agents.get(id);
      if (!agent || agent.archivedAt || agent.labels[LABEL] !== "orchestrator") {
        pill.remove();
        modePills.delete(id);
      }
    }
    for (const agent of agents.values()) {
      const workspaceId = agent.workspaceId;
      if (agent.archivedAt || !workspaceId) continue;
      if (!dashboardPills.has(agent.id) && collaborating(agent)) {
        dashboardPills.set(agent.id, client.addComposerPill({
          id: "session-dashboard",
          workspaceId,
          agentId: agent.id,
          button: {
            title: messages.message("session.pillTitle"),
            icon: "Network",
            label: messages.message("session.pill"),
            behavior: { kind: "action", onPress: () => openSessionDashboard(client, workspaceId, agent.id) },
          },
        }));
      }
      if (agent.labels[LABEL] === "orchestrator") {
        if (!modePills.has(agent.id)) {
          modePills.set(agent.id, client.addComposerPill({
            id: "session-mode",
            workspaceId,
            agentId: agent.id,
            button: {
              title: messages.message("mode.pillTitle"),
              icon: "Users",
              label: locks.get(agent.id) ? LOCKED_LABEL[locks.get(agent.id)!] : PILL_LABEL[modes.get(agent.id) ?? "auto"],
              disabled: Boolean(locks.get(agent.id)),
              behavior: { kind: "menu", items: modeMenu(agent.id) },
            },
          }));
        }
        refreshMode(agent.id);
      }
    }
  };

  const removeAll = () => {
    for (const pill of [...dashboardPills.values(), ...modePills.values()]) pill.remove();
    dashboardPills.clear();
    modePills.clear();
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return undefined;
      }
      cleanups.push(() => void subscription.release());
      subscription.subscribe({
        snapshot: ({ entries }) => {
          agents.clear();
          for (const { agent } of entries) agents.set(agent.id, agent as unknown as Agent);
          sync();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") agents.set(update.agent.id, update.agent as unknown as Agent);
          else agents.delete(update.agentId);
          sync();
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("[ensemble] watching agents for composer pills failed", error);
    });

  return () => {
    lifetime.abort();
    removeAll();
    for (const cleanup of cleanups) cleanup();
  };
}
