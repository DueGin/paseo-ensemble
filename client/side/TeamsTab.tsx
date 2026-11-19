// The side panel's Teams tab: the project's team files (each opens in the team editor), creating a team, and the global
// presets with Copy to project, Rename and Delete.
import { useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { View } from "react-native";
import type { Preset } from "../../shared/presets";
import { Badge, Button, Callout, Card, Empty, MODE_LOOK, Separator, Spinner, T, Tile, type Kit } from "../kit";
import { copyWorkspace, relativeTo, runtimeText, type ProjectTeams, type WorkspaceTeam } from "./data";
import type { ProviderIcons } from "./model-select";
import { PresetCard, useCopyPreset, usePresetLibrary } from "./preset-card";
import type { Translate } from "./run-parts";

export function TeamsTab({ k, t, workspaceId, workspace, project, projectLoading, icons, openTeamEditor, createInProject, managePresets }: { k: Kit; t: Translate; workspaceId: string; workspace: WorkspaceTeam; project: ProjectTeams | null; projectLoading: boolean; icons: ProviderIcons; openTeamEditor?: (workspaceId: string) => void; createInProject?: (projectId: string) => void; managePresets?: () => void }) {
  const toast = useToast();
  const library = usePresetLibrary();
  const [copying, setCopying] = useState(null as string | null);
  const copied = useCopyPreset((file) => toast.show(t("sideUi.presets.copied", { file: relativeTo(workspace.project.root, file) }), { variant: "success" }));
  const copyError = copied.error ? String(copied.error) : copied.data && !copied.data.ok ? copied.data.errors.join("; ") : null;
  const teams = project?.teams ?? [];
  const errors = [...new Set([...(project?.errors ?? []), ...workspace.errors])];
  const here = workspace.workspace ?? "";
  // The preset becomes this workspace's team when it has none, else a team of its own for a workspace of the preset's name.
  const copyTitle = (preset: Preset) => copyWorkspace(preset.name, [...workspace.projectWorkspaces, ...workspace.takenWorkspaces], here ? { title: here, hasTeam: !!workspace.team } : null);
  const create = () => {
    if (workspace.team && createInProject) createInProject(workspace.project.id);
    else openTeamEditor?.(workspaceId);
  };
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T k={k} v="h3" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {t("sideUi.teams.projectTeams", { project: workspace.project.name })}
          </T>
          <Badge k={k} label={String(teams.length)} />
        </View>
        {errors.length ? (
          <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
            {errors.map((error) => (
              <T key={error} k={k} v="tiny" style={{ color: k.c.fg }}>
                {error}
              </T>
            ))}
          </Callout>
        ) : null}
        {projectLoading && !project ? <Spinner k={k} /> : null}
        {!projectLoading && !teams.length ? (
          <Empty k={k} icon="FileText">
            {t("sideUi.teams.none")}
          </Empty>
        ) : null}
        {teams.map((team) => {
          const look = MODE_LOOK[team.mode];
          const mine = team.workspaceId === workspaceId;
          const open = team.workspaceId && openTeamEditor ? () => openTeamEditor(team.workspaceId!) : undefined;
          return (
            <Card key={team.file} k={k} tone={team.workspaceId ? look.tone : k.c.warn} selected={mine} onPress={open} label={team.orchestratorWorkspace} style={{ gap: 4, paddingVertical: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Tile k={k} icon={look.icon} tone={look.tone} size={22} />
                <T k={k} v="strong" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                  {team.orchestratorWorkspace}
                </T>
                {mine ? <Badge k={k} label={t("sideUi.teams.thisWorkspace")} tone={k.c.primary} /> : null}
                <Badge k={k} label={t(`mode.${team.mode}`)} tone={look.tone} />
              </View>
              <T k={k} v="tiny" numberOfLines={1}>
                {[`${t("screen.lead")} ${runtimeText(team.orchestrator.provider, team.orchestrator.model)}`, t("screen.roles", { count: team.roles }), t("screen.candidates", { count: team.candidates })].join(" · ")}
              </T>
              <T k={k} v="tiny" numberOfLines={1} style={{ fontFamily: "Menlo" }}>
                {team.file}
              </T>
              {!team.workspaceId ? (
                <T k={k} v="tiny" style={{ color: k.c.warn }}>
                  {t("screen.workspaceMissing")}
                </T>
              ) : null}
            </Card>
          );
        })}
        {openTeamEditor ? (
          <View style={{ gap: 4 }}>
            <Button k={k} variant="primary" icon="Plus" label={t("sideUi.teams.create")} block onPress={create} />
            <T k={k} v="tiny">{workspace.team ? t("sideUi.teams.createElsewhere") : t("sideUi.teams.createHere")}</T>
          </View>
        ) : null}
      </View>

      <Separator k={k} />

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T k={k} v="h3" style={{ flex: 1 }}>
            {t("presets.title")}
          </T>
          <Badge k={k} label={String(library.presets.length)} />
          {managePresets ? <Button k={k} icon="Settings2" variant="ghost" size="sm" label={t("sideUi.presets.manage")} onPress={managePresets} /> : null}
        </View>
        <T k={k} v="tiny">{t("sideUi.presets.hint")}</T>
        {library.settings.status === "loading" ? <Spinner k={k} /> : null}
        {library.settings.status === "error" || library.settings.status === "invalid" ? (
          <T k={k} v="tiny" style={{ color: k.c.bad }}>
            {t("presets.loadFailed", { error: library.settings.error })}
          </T>
        ) : null}
        {library.settings.status === "ready" && !library.presets.length ? <T k={k} v="muted">{t("sideUi.presets.none")}</T> : null}
        {library.presets.map((preset) => (
          <PresetCard
            key={preset.id}
            k={k}
            preset={preset}
            icons={icons}
            saving={library.settings.saving}
            saveError={library.settings.saveError}
            onRename={(name) => library.rename(preset.id, name)}
            onDelete={() => library.remove(preset.id)}
            copy={{
              busy: copied.isPending && copying === preset.id,
              error: copying === preset.id ? copyError : null,
              run: () => {
                setCopying(preset.id);
                copied.mutate({ preset, target: { workspaceId }, workspace: copyTitle(preset) });
              },
            }}
          />
        ))}
      </View>
    </View>
  );
}
