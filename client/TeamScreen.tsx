// The Agent teams screen: every project's teams (open, reconnect, delete) and the global presets every project can start
// from (create, edit, rename, copy into a project, delete, start a task). `params.project` opens a new team for that project.
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { withAlpha } from "../shared/color";
import { teamDeleteRpc, teamReconnectRpc, teamRestoreRpc } from "../shared/rpc";
import { messages } from "./i18n";
import { Badge, Button, Callout, Card, Chip, Empty, MODE_LOOK, SectionHeader, Spinner, StatTile, T, Tile, useKit, type Kit } from "./kit";
import { PresetsSection, StartFromPresetDialog, usePresets } from "./Presets";
import { PROJECTS_KEY, runtimeText, TEAM_KEY, useProjectTeams, type ProjectTeam, type ProjectTeams } from "./side/data";
import { LANGUAGE_NAMES } from "./side/preset-card";
import type { Translate } from "./side/run-parts";
import { TeamEditor } from "./TeamPanel";

export const SCREEN_ID = "team";

type RestoreRpc = typeof teamRestoreRpc;
type Restored = Extract<RpcOutput<RestoreRpc>, { ok: true }>;

export function TeamSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const { t } = useTranslation(messages);
  return <SidebarRow icon="Users" label={t("commandTitle")} active={currentScreen?.screenId === SCREEN_ID} onPress={() => openScreen({ screenId: SCREEN_ID })} />;
}

interface TeamActions {
  busy: { reconnect: boolean; delete: boolean };
  reconnecting: string | null;
  confirming: string | null;
  setReconnecting(key: string | null): void;
  setConfirming(key: string | null): void;
  reconnect(input: { projectId: string; file: string; workspaceId: string }): void;
  restore(input: { projectId: string; file: string }): void;
  remove(input: { projectId: string; file: string }): void;
  restoreProblem(projectId: string, file: string): string[];
}

/** One team of a project: its workspace, mode, lead and size, and Open (or Reconnect) and Delete. */
function TeamRow({ k, t, project, team, actions, openTeamPanel }: { k: Kit; t: Translate; project: ProjectTeams; team: ProjectTeam; actions: TeamActions; openTeamPanel?: (workspaceId: string) => void }) {
  const look = MODE_LOOK[team.mode];
  const key = `${project.id}:${team.file}`;
  const occupied = new Set(project.teams.map((entry) => entry.workspaceId).filter((id) => id != null));
  const free = project.workspaces.filter((workspace) => !occupied.has(workspace.id));
  const problems = actions.restoreProblem(project.id, team.file);
  return (
    <Card k={k} tone={team.workspaceId ? look.tone : k.c.warn} style={{ gap: 8, padding: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Tile k={k} icon={look.icon} tone={look.tone} size={28} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <T k={k} v="strong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {team.orchestratorWorkspace}
            </T>
            <Badge k={k} label={t(`mode.${team.mode}`)} tone={look.tone} />
            {team.language ? <T k={k} v="tiny">{LANGUAGE_NAMES[team.language]}</T> : null}
          </View>
          <T k={k} v="tiny" numberOfLines={1}>
            {[`${t("screen.lead")} ${runtimeText(team.orchestrator.provider, team.orchestrator.model)}`, t("screen.roles", { count: team.roles }), ...(team.candidates ? [t("screen.candidates", { count: team.candidates })] : [])].join(" · ")}
          </T>
        </View>
      </View>
      {team.goal ? (
        <T k={k} v="small" numberOfLines={2}>
          {team.goal}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <T k={k} v="tiny" numberOfLines={1} style={{ flex: 1, minWidth: 0, fontFamily: "Menlo" }}>
          {team.file}
        </T>
        {!team.workspaceId ? <Badge k={k} label={t("screen.workspaceMissing")} tone={k.c.warn} icon="Unlink" /> : null}
      </View>
      {actions.reconnecting === key && !team.workspaceId ? (
        <Card k={k} inset style={{ gap: 8 }}>
          <T k={k} v="small">{t("screen.reconnectPick")}</T>
          {free.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {free.map((workspace) => (
                <Chip key={workspace.id} k={k} icon="Folder" label={workspace.title} onPress={actions.busy.reconnect ? undefined : () => actions.reconnect({ projectId: project.id, file: team.file, workspaceId: workspace.id })} />
              ))}
            </View>
          ) : (
            <T k={k} v="muted">{t("screen.noWorkspaceToPick")}</T>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Button k={k} icon="Plus" label={t("screen.startNewWorkspace")} size="sm" busy={actions.busy.reconnect} onPress={() => actions.restore({ projectId: project.id, file: team.file })} />
            <Button k={k} variant="ghost" label={t("review.cancel")} size="sm" disabled={actions.busy.reconnect} onPress={() => actions.setReconnecting(null)} />
          </View>
          {actions.busy.reconnect ? <T k={k} v="tiny">{t("result.applying")}</T> : null}
          {problems.map((problem) => (
            <T key={problem} k={k} v="tiny" style={{ color: k.c.bad }}>
              {problem}
            </T>
          ))}
        </Card>
      ) : actions.confirming === key ? (
        <Callout k={k} tone={k.c.bad} icon="Trash2">
          <View style={{ gap: 8 }}>
            <T k={k} v="small">{t("screen.deleteConfirm", { file: team.file })}</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Button k={k} variant="danger" label={t("screen.deleteYes")} size="sm" busy={actions.busy.delete} onPress={() => actions.remove({ projectId: project.id, file: team.file })} />
              <Button k={k} variant="ghost" label={t("review.cancel")} size="sm" disabled={actions.busy.delete} onPress={() => actions.setConfirming(null)} />
            </View>
          </View>
        </Callout>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {team.workspaceId ? (
            <Button k={k} variant="primary" icon="ArrowUpRight" label={t("screen.openTeam")} size="sm" disabled={!openTeamPanel} onPress={() => openTeamPanel?.(team.workspaceId!)} />
          ) : (
            <Button k={k} icon="Link" label={t("screen.reconnect")} size="sm" disabled={actions.busy.reconnect} onPress={() => actions.setReconnecting(key)} />
          )}
          <View style={{ flex: 1 }} />
          <Button k={k} variant="ghost" icon="Trash2" label={t("screen.deleteTeam")} size="sm" disabled={actions.busy.delete} onPress={() => actions.setConfirming(key)} />
        </View>
      )}
    </Card>
  );
}

/** A project: its name and folder, its teams, and New team / New task from preset. */
function ProjectCard({ k, t, project, presets, actions, openTeamPanel, onNewTeam, onStartFromPreset }: { k: Kit; t: Translate; project: ProjectTeams; presets: number; actions: TeamActions; openTeamPanel?: (workspaceId: string) => void; onNewTeam(): void; onStartFromPreset(): void }) {
  return (
    <Card k={k} style={{ flex: 1, minWidth: 0, padding: 0, gap: 0, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: withAlpha(k.c.primary, 0.07), borderBottomWidth: 1, borderBottomColor: k.c.border }}>
        <Tile k={k} icon="Folder" size={32} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T k={k} v="h3" numberOfLines={1} style={{ fontSize: 15 }}>
            {project.name}
          </T>
          <T k={k} v="tiny" numberOfLines={1} style={{ fontFamily: "Menlo" }}>
            {project.root}
          </T>
        </View>
        <Badge k={k} label={t("sideUi.screen.teamCount", { count: project.teams.length })} icon="Users" />
      </View>
      <View style={{ padding: 10, gap: 8 }}>
        {project.errors.length ? (
          <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
            {project.errors.map((error) => (
              <T key={error} k={k} v="tiny" style={{ color: k.c.fg }}>
                {error}
              </T>
            ))}
          </Callout>
        ) : null}
        {!project.teams.length ? (
          <Empty k={k} icon="Users">
            {t("screen.noTeams")}
          </Empty>
        ) : null}
        {project.teams.map((team) => (
          <TeamRow key={team.file} k={k} t={t} project={project} team={team} actions={actions} openTeamPanel={openTeamPanel} />
        ))}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
          <Button k={k} icon="Plus" label={t("screen.newTeam")} size="sm" onPress={onNewTeam} />
          {presets ? <Button k={k} icon="Play" label={t("presets.start")} size="sm" onPress={onStartFromPreset} /> : null}
        </View>
      </View>
    </Card>
  );
}

/** Browse every project's agent teams, open an existing team's panel, or create a new team. */
export function TeamScreen({ theme, layout, navigation, params, openTeamPanel }: PluginScreenProps & { openTeamPanel?: (workspaceId: string) => void }) {
  const k = useKit(theme, layout.compact);
  const { t, locale } = useTranslation(messages);
  const projects = useProjectTeams();
  const [listWidth, setListWidth] = useState(0);
  const columns = layout.compact || listWidth < 720 ? 1 : listWidth < 1120 ? 2 : 3;
  const toast = useToast();
  // The project a new team is being made for; the side panel opens the screen with `params.project`.
  const [projectId, setProjectId] = useState((params?.project ?? null) as string | null);
  useEffect(() => {
    if (params?.project) setProjectId(params.project);
  }, [params?.project]);
  const queryClient = useQueryClient();
  const remove = useRpc(teamDeleteRpc);
  const reconnect = useRpc(teamReconnectRpc);
  const restore = useRpc(teamRestoreRpc);
  // The team row waiting for a second press, keyed by project and file.
  const [confirming, setConfirming] = useState(null as string | null);
  const [reconnecting, setReconnecting] = useState(null as string | null);
  const invalidateTeams = () => {
    void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    void queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "agents"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "roster"] });
  };
  const deleted = useMutation({
    mutationFn: (team: { projectId: string; file: string }) => remove(team),
    onSuccess: (result) => {
      if (result.failures.length) toast.error(t("screen.deleteFailed", { failure: result.failures.join("; ") }));
      if (result.fileFailures.length) toast.error(t("screen.deleteFileFailed", { failure: result.fileFailures.join("; ") }));
      setConfirming(null);
      invalidateTeams();
    },
    onError: (error) => toast.error(String(error)),
  });
  const reconnected = useMutation({
    mutationFn: (input: { projectId: string; file: string; workspaceId: string }) => reconnect(input),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.errors.join("; "));
        return;
      }
      setReconnecting(null);
      invalidateTeams();
    },
    onError: (error) => toast.error(String(error)),
  });
  const openApplied = (result: Restored) => {
    if (result.cleanup.length) toast.error(t("result.cleanupFailed", { failure: result.cleanup.join("; ") }));
    navigation?.openWorkspace({ workspaceId: result.workspaces[0]!.id });
  };
  const restored = useMutation({
    mutationFn: (input: { projectId: string; file: string }) => restore({ ...input, locale }),
    onSuccess: (result) => {
      if (!result.ok) return;
      setReconnecting(null);
      invalidateTeams();
      openApplied(result);
    },
  });
  const presetSettings = usePresets();
  const presets = presetSettings.status === "ready" ? presetSettings.values.presets : [];
  const [startingFor, setStartingFor] = useState(null as string | null);
  const actions: TeamActions = {
    busy: { reconnect: reconnected.isPending || restored.isPending, delete: deleted.isPending },
    reconnecting,
    confirming,
    setReconnecting: (key) => {
      restored.reset();
      setReconnecting(key);
    },
    setConfirming,
    reconnect: (input) => reconnected.mutate(input),
    restore: (input) => restored.mutate(input),
    remove: (input) => deleted.mutate(input),
    restoreProblem: (project, file) =>
      restored.variables?.projectId === project && restored.variables.file === file ? [...(restored.error ? [String(restored.error)] : []), ...(restored.data && !restored.data.ok ? restored.data.errors : [])] : [],
  };

  const pad = layout.compact ? 12 : 24;
  if (projectId) {
    const project = projects.data?.find((entry) => entry.id === projectId);
    return (
      <View style={{ flex: 1, backgroundColor: k.c.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: pad, paddingTop: pad, paddingBottom: 4 }}>
          <Button k={k} variant="ghost" icon="ArrowLeft" label={t("screen.back")} onPress={() => setProjectId(null)} />
          {project ? (
            <T k={k} v="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {project.name}
            </T>
          ) : null}
        </View>
        <TeamEditor theme={theme} layout={layout} navigation={navigation} target={{ projectId }} onApplied={openApplied} />
      </View>
    );
  }

  const list = projects.data ?? [];
  const teamCount = list.reduce((sum, project) => sum + project.teams.length, 0);
  const missing = list.reduce((sum, project) => sum + project.teams.filter((team) => !team.workspaceId).length, 0);
  const rows: ProjectTeams[][] = [];
  for (let index = 0; index < list.length; index += columns) rows.push(list.slice(index, index + columns));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: k.c.bg }} contentContainerStyle={{ padding: pad, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Tile k={k} icon="Users" size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <T k={k} v="h1">
            {t("screen.title")}
          </T>
          <T k={k} v="muted">{t("screen.subtitle")}</T>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatTile k={k} label={t("sideUi.screen.projects")} value={projects.data ? String(list.length) : "–"} />
        <StatTile k={k} label={t("sideUi.screen.teams")} value={projects.data ? String(teamCount) : "–"} hint={missing ? t("sideUi.screen.missing", { count: missing }) : undefined} />
        <StatTile k={k} label={t("sideUi.screen.presets")} value={presetSettings.status === "ready" ? String(presets.length) : "–"} />
      </View>

      <PresetsSection colors={theme.colors} compact={layout.compact} projects={list} />
      <StartFromPresetDialog
        colors={theme.colors}
        compact={layout.compact}
        project={list.find((project) => project.id === startingFor) ?? null}
        presets={presets}
        onClose={() => setStartingFor(null)}
        onStarted={(result) => {
          setStartingFor(null);
          invalidateTeams();
          if (navigation) navigation.openAgent({ agentId: result.orchestratorAgentId });
          else openTeamPanel?.(result.workspaceId);
        }}
      />

      <View style={{ gap: 12 }}>
        <SectionHeader k={k} icon="FolderOpen" title={t("sideUi.screen.projects")} subtitle={t("sideUi.screen.projectsHint")} count={projects.data ? list.length : undefined} />
        {projects.isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Spinner k={k} />
            <T k={k} v="muted">{t("loading")}</T>
          </View>
        ) : null}
        {projects.error ? (
          <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
            <T k={k} v="small">{String(projects.error)}</T>
          </Callout>
        ) : null}
        {projects.data && !list.length ? <Empty k={k} icon="Folder">{t("sideUi.screen.noProjects")}</Empty> : null}
        <View
          style={{ gap: 12 }}
          onLayout={(event) => {
            const width = Math.round(event.nativeEvent.layout.width);
            setListWidth((current) => (current === width ? current : width));
          }}
        >
          {rows.map((row) => (
            <View key={row[0]!.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              {row.map((project) => (
                <ProjectCard key={project.id} k={k} t={t} project={project} presets={presets.length} actions={actions} openTeamPanel={openTeamPanel} onNewTeam={() => setProjectId(project.id)} onStartFromPreset={() => setStartingFor(project.id)} />
              ))}
              {Array.from({ length: columns - row.length }, (_, index) => (
                <View key={`spacer-${index}`} style={{ flex: 1, minWidth: 0 }} />
              ))}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
