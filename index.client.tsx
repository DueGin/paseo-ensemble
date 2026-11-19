import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentDashboard, SessionDashboard } from "./client/AgentDashboard";
import { contributeCards } from "./client/Cards";
import { contributeDraftTeam } from "./client/DraftTeam";
import { contributeTeamBadge } from "./client/TeamBadge";
import { messages } from "./client/i18n";
import { contributeSessionAccess, SESSION_PANEL } from "./client/session-access";
import { SIDE_PANEL_ID, SidePanel } from "./client/SidePanel";
import { TeamPanel } from "./client/TeamPanel";
import { SCREEN_ID, TeamScreen, TeamSidebarItem } from "./client/TeamScreen";

export default function contribute(client: PluginClientContext) {
  // The workspace's sessions, with a picker; opened from the workspace's tab launcher.
  client.addWorkspacePanel({ id: "agent-dashboard", title: messages.message("dashboardTitle"), icon: "Network", locations: ["workspace", "explorer"], Component: AgentDashboard });
  // One session only; opened from that session (composer pill, Command Center, /dashboard), in the right sidebar.
  client.addAgentPanel({ id: SESSION_PANEL, title: messages.message("session.title"), icon: "Network", locations: ["explorer", "workspace"], Component: SessionDashboard });
  client.addWorkspacePanel({ id: "team", title: messages.message("panelTitle"), icon: "Users", locations: ["workspace"], Component: TeamPanel });
  // The right sidebar's Ensemble panel, as in Orca: the session, starting a team, and the project's teams and presets.
  client.addWorkspacePanel({
    id: SIDE_PANEL_ID,
    title: messages.message("panelTitle"),
    icon: "Bot",
    locations: ["explorer"],
    Component: (props) => <SidePanel {...props} openPanel={(id, options) => client.openPanel(id, options)} openScreen={(input) => client.openScreen(input)} />,
  });
  client.addScreen({ id: SCREEN_ID, title: messages.message("commandTitle"), Component: (props) => <TeamScreen {...props} openTeamPanel={(workspaceId) => client.openPanel("team", { workspaceId })} /> });
  client.addSidebarHeaderItem({ id: "team", title: messages.message("commandTitle"), Component: TeamSidebarItem });
  client.addCommandCenterItem({
    id: "team",
    title: messages.message("commandTitle"),
    icon: "Users",
    keywords: ["team", "agents", "orchestrator", "팀", "에이전트", "チーム", "エージェント", "团队", "智能体"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("team");
    },
  });
  client.addCommandCenterItem({
    id: "ensemble-panel",
    title: messages.message("sideUi.panelCommand"),
    icon: "Bot",
    keywords: ["ensemble", "team", "session", "团队", "会话"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(SIDE_PANEL_ID, { location: "explorer" });
    },
  });
  // Paseo 0.16: pick a team in a new agent's own draft composer, and that agent becomes its lead.
  const removeDraftTeam = contributeDraftTeam(client);
  // Paseo 0.16: a badge on the sidebar's workspace rows that run a team.
  const removeTeamBadge = contributeTeamBadge(client);
  const removeSessionAccess = contributeSessionAccess(client);
  // Delegation shown in the lead's chat: "Handed off to agent" and "Update from worker" cards.
  const removeCards = contributeCards(client);
  return () => {
    removeCards();
    removeDraftTeam();
    removeTeamBadge();
    removeSessionAccess();
  };
}
