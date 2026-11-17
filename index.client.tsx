import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentDashboard, SessionDashboard } from "./client/AgentDashboard";
import { contributeDraftTeam } from "./client/DraftTeam";
import { contributeTeamBadge } from "./client/TeamBadge";
import { messages } from "./client/i18n";
import { contributeSessionAccess, SESSION_PANEL } from "./client/session-access";
import { TeamPanel } from "./client/TeamPanel";
import { SCREEN_ID, TeamScreen, TeamSidebarItem } from "./client/TeamScreen";

export default function contribute(client: PluginClientContext) {
  // The workspace's sessions, with a picker; opened from the workspace's tab launcher.
  client.addWorkspacePanel({ id: "agent-dashboard", title: messages.message("dashboardTitle"), icon: "Network", locations: ["workspace", "explorer"], Component: AgentDashboard });
  // One session only; opened from that session (composer pill, Command Center, /dashboard), in the right sidebar.
  client.addAgentPanel({ id: SESSION_PANEL, title: messages.message("session.title"), icon: "Network", locations: ["explorer", "workspace"], Component: SessionDashboard });
  client.addWorkspacePanel({ id: "team", title: messages.message("panelTitle"), icon: "Users", locations: ["workspace"], Component: TeamPanel });
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
  // Paseo 0.16: pick a team in a new agent's own draft composer, and that agent becomes its lead.
  const removeDraftTeam = contributeDraftTeam(client);
  // Paseo 0.16: a badge on the sidebar's workspace rows that run a team.
  const removeTeamBadge = contributeTeamBadge(client);
  const removeSessionAccess = contributeSessionAccess(client);
  return () => {
    removeDraftTeam();
    removeTeamBadge();
    removeSessionAccess();
  };
}
