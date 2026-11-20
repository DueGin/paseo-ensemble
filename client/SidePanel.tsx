// Ensemble in Paseo's right sidebar: the workspace's team sessions (mode, members, the run's data flow), starting a session,
// and the project's teams and the global presets. Three tabs under a header with the project and workspace.
//
// Registered by index.client.tsx as a workspace panel in the explorer (right sidebar). Paseo gives a panel no way to open
// other panels or screens itself, so the registration passes the client's:
//
//   client.addWorkspacePanel({
//     id: "ensemble", title: messages.message("panelTitle"), icon: "Users", locations: ["explorer"],
//     Component: (props) => <SidePanel {...props} openPanel={(id, options) => client.openPanel(id, options)} openScreen={(input) => client.openScreen(input)} />,
//   });
import type { PluginClientOpenPanelOptions, PluginOpenScreenInput, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useTabState, useTranslation } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { z } from "zod";
import { messages } from "./i18n";
import { Button, Callout, Segmented, Spinner, T, Tile, useKit } from "./kit";
import { SESSION_PANEL } from "./session-access";
import { PROJECTS_KEY, SIDE_KEY, TEAM_KEY, useAgents, useProjectTeams, useWorkspaceTeam, workspaceLeads } from "./side/data";
import { usePresetLibrary } from "./side/preset-card";
import { SessionTab } from "./side/SessionTab";
import { StartTab } from "./side/StartTab";
import { TeamsTab } from "./side/TeamsTab";

/** The id the side panel is registered under. */
export const SIDE_PANEL_ID = "ensemble";
/** The team editor's workspace panel. */
const TEAM_EDITOR_PANEL = "team";
/** The Agent teams screen (see TeamScreen.tsx); `params.project` opens a new team for that project. */
const TEAMS_SCREEN = "team";

export interface SidePanelProps extends PluginWorkspacePanelProps {
  /** `client.openPanel`: opens the team editor (`team`) and a session's dashboard (`session-dashboard`). Without it those buttons hide. */
  openPanel?: (id: string, options: PluginClientOpenPanelOptions) => void;
  /** `client.openScreen`: opens the Agent teams screen to manage presets, or to create a team in a new workspace of the project. */
  openScreen?: (input: PluginOpenScreenInput) => void;
}

const TABS = ["session", "start", "teams"] as const;
type Tab = (typeof TABS)[number];
const stateSchema = z.object({ tab: z.enum(TABS).nullable().catch(null), session: z.string().nullable().catch(null) });

export function SidePanel({ workspaceId, theme, navigation, tab: panelTab, openPanel, openScreen }: SidePanelProps) {
  const k = useKit(theme, true);
  const { t } = useTranslation(messages);
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const [state, setState] = useTabState(panelTab, stateSchema, { tab: null, session: null });
  const workspace = useWorkspaceTeam(workspaceId);
  const projects = useProjectTeams();
  const agents = useAgents();
  const library = usePresetLibrary();
  const providers = useQuery({ queryKey: ["dashboard", "providers"], queryFn: () => paseo.providers.snapshot() });
  const icons = useMemo(() => new Map((providers.data?.entries ?? []).map((entry) => [entry.provider, entry.iconSvg])), [providers.data]);
  const leads = useMemo(() => workspaceLeads(agents.data ?? [], workspaceId), [agents.data, workspaceId]);
  const project = projects.data?.find((entry) => entry.id === workspace.data?.project.id) ?? null;

  // A workspace without a team session opens on Start, until a tab is picked.
  const tab: Tab = state.tab ?? (agents.data && !leads.length ? "start" : "session");
  const setTab = (next: Tab) => setState({ ...state, tab: next });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: SIDE_KEY });
    void queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    void library.settings.reload();
  };
  const openAgent = navigation ? (agentId: string) => navigation.openAgent({ agentId }) : undefined;
  const openDashboard = openPanel ? (agentId: string) => openPanel(SESSION_PANEL, { workspaceId, agentId, location: "explorer" }) : undefined;
  const openTeamEditor = openPanel ? (id: string) => openPanel(TEAM_EDITOR_PANEL, { workspaceId: id }) : undefined;
  const createInProject = openScreen ? (projectId: string) => openScreen({ screenId: TEAMS_SCREEN, params: { project: projectId } }) : undefined;
  const managePresets = openScreen ? () => openScreen({ screenId: TEAMS_SCREEN }) : undefined;

  const data = workspace.data;
  const subtitle = data ? [data.project.name, data.workspace].filter(Boolean).join(" · ") : "";
  return (
    <View style={{ flex: 1, backgroundColor: k.c.bg }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: k.c.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Tile k={k} icon="Users" size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T k={k} v="h2" numberOfLines={1}>
              {t("panelTitle")}
            </T>
            {subtitle ? (
              <T k={k} v="tiny" numberOfLines={1}>
                {subtitle}
              </T>
            ) : null}
          </View>
          <Button k={k} icon="RefreshCw" variant="ghost" size="sm" accessibilityLabel={t("sideUi.refresh")} onPress={refresh} />
        </View>
        <Segmented<Tab>
          k={k}
          stretch
          equal
          value={tab}
          onChange={setTab}
          options={[
            { value: "session", label: t("sideUi.tabs.session") },
            { value: "start", label: t("sideUi.tabs.start") },
            { value: "teams", label: t("sideUi.tabs.teams") },
          ]}
        />
      </View>
      {!data ? (
        <View style={{ padding: 16, gap: 10 }}>
          {workspace.error ? (
            <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
              <View style={{ gap: 8 }}>
                <T k={k} v="small">{t("sideUi.loadFailed", { error: String(workspace.error) })}</T>
                <Button k={k} icon="RefreshCw" size="sm" label={t("sideUi.retry")} onPress={refresh} />
              </View>
            </Callout>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Spinner k={k} />
              <T k={k} v="muted">{t("loading")}</T>
            </View>
          )}
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {tab === "session" ? (
            agents.isLoading ? (
              <Spinner k={k} />
            ) : (
              <SessionTab
                k={k}
                t={t}
                workspace={data}
                leads={leads}
                agents={agents.data ?? []}
                icons={icons}
                selected={state.session}
                onSelect={(session) => setState({ ...state, session })}
                onStart={() => setTab("start")}
                openAgent={openAgent}
                openDashboard={openDashboard}
              />
            )
          ) : null}
          {tab === "start" ? (
            <StartTab
              k={k}
              t={t}
              workspaceId={workspaceId}
              workspace={data}
              presets={library.presets}
              onStarted={(agentId, startedIn) => {
                refresh();
                if (startedIn === workspaceId) setState({ tab: "session", session: agentId });
                openAgent?.(agentId);
              }}
            />
          ) : null}
          {tab === "teams" ? (
            <TeamsTab
              k={k}
              t={t}
              workspaceId={workspaceId}
              workspace={data}
              project={project}
              projectLoading={projects.isLoading}
              icons={icons}
              openTeamEditor={openTeamEditor}
              createInProject={createInProject}
              managePresets={managePresets}
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
