// Global team presets on the Agent teams screen: list, create, edit, rename, copy into a project and delete them, and start
// a new task in a project from one. Presets are host settings, so every client and project of the host sees the same list.
import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings, useTranslation } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { newCandidate } from "../shared/draft";
import { languageFromLocale, PROMPT_LANGUAGES, TEAM_MODES, type TeamMode } from "../shared/modes";
import { namedCandidates, newPresetId, presetProblems, presetsSettings, presetToTeam, taskWorkspaceTitle, type Preset } from "../shared/presets";
import { teamLegacyPresetsRpc, teamPresetStartRpc } from "../shared/rpc";
import { catalogFrom, validateTeam, type ProviderEntry, type ProviderInfo } from "../shared/validate";
import { messages } from "./i18n";
import { Badge, Button, Callout, Card, Chip, Empty, Field, Input, makeKit, MODE_LOOK, PART, SectionHeader, Segmented, Spinner, T, Tile, type Kit } from "./kit";
import { copyWorkspace, freeWorkspaces, relativeTo, runtimeText, type ProjectTeams as Project } from "./side/data";
import { CandidateEditor, ModelSelect, type ProviderIcons } from "./side/model-select";
import { LANGUAGE_NAMES, PresetCard, useCopyPreset, usePresetLibrary } from "./side/preset-card";

type Colors = PluginScreenProps["theme"]["colors"];
type PresetStartRpc = typeof teamPresetStartRpc;
type PresetStarted = Extract<RpcOutput<PresetStartRpc>, { ok: true }>;
type Draft = { draft: Preset; revision: string; isNew: boolean };
type Copying = { presetId: string; projectId: string };

/** The kit for surfaces that are handed the theme's colors. */
function useColorsKit(colors: Colors, compact: boolean): Kit {
  return useMemo(() => makeKit({ colors } as PluginTheme, compact), [colors, compact]);
}

/** The host's providers and models, for editing presets outside any project. */
export function useCatalog(): { catalog: ProviderInfo[]; icons: Map<string, string | undefined> } {
  const paseo = usePaseo();
  const providers = useQuery({ queryKey: ["dashboard", "providers"], queryFn: () => paseo.providers.snapshot() });
  return useMemo(() => ({
    catalog: catalogFrom((providers.data?.entries ?? []) as unknown as ProviderEntry[]),
    icons: new Map((providers.data?.entries ?? []).map((entry) => [entry.provider, entry.iconSvg])),
  }), [providers.data]);
}

export function usePresets() {
  return useSettings(presetsSettings);
}

function blankPreset(catalog: readonly ProviderInfo[], locale: string): Preset {
  const claude = catalog.find((entry) => entry.ready && entry.id === "claude") ?? catalog.find((entry) => entry.ready);
  return {
    id: newPresetId(),
    name: "",
    description: "",
    mode: "auto",
    language: languageFromLocale(locale),
    orchestrator: { provider: claude?.id ?? "", model: claude?.models[0]?.id ?? "" },
    candidates: [newCandidate(catalog, [])],
    updatedAt: "",
  };
}

/** Edits one preset draft; the caller saves it. */
function PresetEditor({ k, catalog, icons, draft, isNew, onChange, onSave, onCancel, saving, error }: { k: Kit; catalog: readonly ProviderInfo[]; icons: ProviderIcons; draft: Preset; isNew: boolean; onChange(next: Preset): void; onSave(): void; onCancel(): void; saving: boolean; error: string | null }) {
  const { t, locale } = useTranslation(messages);
  const problems = presetProblems(draft);
  const hostProblems = problems.length ? [] : validateTeam(presetToTeam({ ...draft, candidates: namedCandidates(draft.candidates) }, "check"), catalog);
  return (
    <Card k={k} selected style={{ gap: 14, padding: k.compact ? 12 : 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Tile k={k} icon={isNew ? "Plus" : "Pencil"} tone={PART.plans} size={28} />
        <T k={k} v="h2" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {isNew ? t("presets.new") : draft.name.trim() || t("presets.edit")}
        </T>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Field k={k} label={t("presets.name")} style={{ flexGrow: 1, flexBasis: 240 }}>
          <Input k={k} value={draft.name} placeholder={t("presets.name")} invalid={!draft.name.trim()} onChangeText={(name) => onChange({ ...draft, name })} />
        </Field>
        <Field k={k} label={t("presets.orchestrator")} style={{ flexGrow: 1, flexBasis: 240 }}>
          <ModelSelect k={k} catalog={catalog} icons={icons} provider={draft.orchestrator.provider} model={draft.orchestrator.model} title={t("presets.orchestrator")} onChange={(orchestrator) => onChange({ ...draft, orchestrator })} />
        </Field>
      </View>
      <Field k={k} label={t("presets.description")}>
        <Input k={k} value={draft.description} placeholder={t("presets.description")} multiline minHeight={52} onChangeText={(description) => onChange({ ...draft, description })} />
      </Field>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Field k={k} label={t("mode.label")} hint={t(`mode.${draft.mode}Hint`)} style={{ flexGrow: 2, flexBasis: 300 }}>
          <Segmented<TeamMode> k={k} stretch value={draft.mode} onChange={(mode) => onChange({ ...draft, mode })} options={TEAM_MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`), icon: MODE_LOOK[mode].icon }))} />
        </Field>
        <Field k={k} label={t("review.language")} hint={t("review.languageHint")} style={{ flexGrow: 1, flexBasis: 200 }}>
          <Segmented k={k} stretch value={draft.language ?? languageFromLocale(locale)} onChange={(language) => onChange({ ...draft, language })} options={PROMPT_LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_NAMES[language] }))} />
        </Field>
      </View>
      <View style={{ gap: 10 }}>
        <SectionHeader k={k} icon="Users" tone={PART.board} title={t("candidates.title")} subtitle={t("candidates.hint")} count={draft.candidates.length} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {draft.candidates.map((candidate, index) => (
            <View key={index} style={{ flexGrow: 1, flexBasis: 260, minWidth: 0 }}>
              <CandidateEditor
                k={k}
                candidate={candidate}
                catalog={catalog}
                icons={icons}
                onChange={(next) => onChange({ ...draft, candidates: draft.candidates.map((entry, at) => (at === index ? next : entry)) })}
                onRemove={() => onChange({ ...draft, candidates: draft.candidates.filter((_, at) => at !== index) })}
              />
            </View>
          ))}
        </View>
        <Button k={k} icon="Plus" label={t("candidates.add")} size="sm" onPress={() => onChange({ ...draft, candidates: [...draft.candidates, newCandidate(catalog, draft.candidates.map((entry) => entry.name))] })} />
      </View>
      {problems.length || hostProblems.length ? (
        <Callout k={k} tone={problems.length ? k.c.warn : k.c.bad} icon="TriangleAlert">
          {problems.map((problem) => (
            <T key={problem} k={k} v="small">
              {t(`presets.problems.${problem as "name"}`)}
            </T>
          ))}
          {hostProblems.map((problem) => (
            <T key={problem.target + problem.message} k={k} v="small">
              {problem.target}: {problem.message}
            </T>
          ))}
        </Callout>
      ) : null}
      {error ? (
        <T k={k} v="small" style={{ color: k.c.bad }}>
          {t("presets.saveFailed", { error })}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button k={k} variant="primary" icon="Check" label={t("presets.save")} busy={saving} disabled={problems.length > 0} onPress={onSave} />
        <Button k={k} variant="ghost" label={t("review.cancel")} disabled={saving} onPress={onCancel} />
      </View>
    </Card>
  );
}

/** The global preset library: list, create, edit, rename, copy into a project, delete; and the one-time legacy import. */
export function PresetsSection({ colors, compact = false, projects = [] }: { /** Unused; kept for older callers. */ s?: unknown; colors: Colors; compact?: boolean; projects?: readonly Project[] }) {
  const k = useColorsKit(colors, compact);
  const { t, locale } = useTranslation(messages);
  const toast = useToast();
  const library = usePresetLibrary();
  const settings = library.settings;
  const { catalog, icons } = useCatalog();
  // The draft keeps the revision it was opened on, so a save never overwrites a newer change from another client.
  const [editing, setEditing] = useState(null as Draft | null);
  const readLegacy = useRpc(teamLegacyPresetsRpc);
  const legacy = useQuery({ queryKey: ["workspace-agents", "legacy-presets"], queryFn: () => readLegacy({}), staleTime: Infinity });
  const [copying, setCopying] = useState(null as Copying | null);
  const copied = useCopyPreset((file) => {
    const project = projects.find((entry) => entry.id === copying?.projectId);
    toast.show(t("sideUi.presets.copied", { file: project ? relativeTo(project.root, file) : file }), { variant: "success" });
  });
  const copyError = copied.error ? String(copied.error) : copied.data && !copied.data.ok ? copied.data.errors.join("; ") : null;

  if (settings.status === "loading") {
    return (
      <Card k={k}>
        <Spinner k={k} />
      </Card>
    );
  }
  if (settings.status !== "ready") {
    return (
      <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
        <T k={k} v="small">{t("presets.loadFailed", { error: settings.error })}</T>
      </Callout>
    );
  }
  const presets = library.presets;
  const save = async () => {
    if (!editing) return;
    const preset = { ...editing.draft, name: editing.draft.name.trim(), candidates: namedCandidates(editing.draft.candidates), updatedAt: new Date().toISOString() };
    const next = editing.isNew ? [...presets, preset] : presets.map((entry) => (entry.id === preset.id ? preset : entry));
    if (await settings.save({ presets: next }, editing.revision)) setEditing(null);
  };
  const copyInto = (preset: Preset, projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    // A team of its own, for a workspace named after the preset that no workspace or team of the project uses yet.
    const workspace = copyWorkspace(preset.name, [...project.workspaces.map((entry) => entry.title), ...project.teams.map((team) => team.orchestratorWorkspace)], null);
    setCopying({ presetId: preset.id, projectId });
    copied.mutate({ preset, target: { projectId }, workspace });
  };
  return (
    <Card k={k} style={{ gap: 14, padding: compact ? 12 : 16 }}>
      <SectionHeader
        k={k}
        icon="Layers"
        tone={PART.plans}
        title={t("presets.title")}
        subtitle={t("presets.hint")}
        count={presets.length}
        right={!editing ? <Button k={k} variant="primary" icon="Plus" label={compact ? undefined : t("presets.new")} accessibilityLabel={t("presets.new")} onPress={() => setEditing({ draft: blankPreset(catalog, locale), revision: settings.revision, isNew: true })} /> : null}
      />
      {editing ? (
        <PresetEditor k={k} catalog={catalog} icons={icons} draft={editing.draft} isNew={editing.isNew} onChange={(draft) => setEditing({ ...editing, draft })} onSave={() => void save()} onCancel={() => setEditing(null)} saving={settings.saving} error={settings.saveError} />
      ) : null}
      {!presets.length && !editing && legacy.data?.presets.length ? (
        <Callout k={k} icon="Import">
          <View style={{ gap: 8 }}>
            <T k={k} v="small">{t("presets.importLegacy", { count: legacy.data.presets.length })}</T>
            <Button k={k} variant="primary" size="sm" label={t("presets.importButton")} busy={settings.saving} onPress={() => void settings.save({ presets: legacy.data!.presets }, settings.revision)} />
          </View>
        </Callout>
      ) : null}
      {!presets.length && !editing ? (
        <Empty k={k} icon="Layers">
          {t("presets.none")}
        </Empty>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {presets.map((preset) => (
          <View key={preset.id} style={{ flexGrow: 1, flexBasis: 300, minWidth: compact ? 0 : 260 }}>
            <PresetCard
              k={k}
              preset={preset}
              icons={icons}
              detailed
              disabled={editing !== null}
              saving={settings.saving}
              saveError={settings.saveError}
              onEdit={() => setEditing({ draft: preset, revision: settings.revision, isNew: false })}
              onRename={(name) => library.rename(preset.id, name)}
              onDelete={() => library.remove(preset.id)}
              copy={{
                targets: projects.map((project) => ({ id: project.id, label: project.name })),
                busy: copied.isPending && copying?.presetId === preset.id,
                error: copying?.presetId === preset.id ? copyError : null,
                run: (projectId) => projectId && copyInto(preset, projectId),
              }}
            />
          </View>
        ))}
      </View>
      {settings.saveError && !editing ? (
        <T k={k} v="small" style={{ color: k.c.bad }}>
          {t("presets.saveFailed", { error: settings.saveError })}
        </T>
      ) : null}
    </Card>
  );
}

/** Starts a new task in a project from a preset: pick it, describe the work, pick or name the workspace. */
export function StartFromPresetDialog({ colors, compact = false, project, presets, onClose, onStarted }: { /** Unused; kept for older callers. */ s?: unknown; colors: Colors; compact?: boolean; project: Project | null; presets: readonly Preset[]; onClose(): void; onStarted(result: PresetStarted): void }) {
  const k = useColorsKit(colors, compact);
  const { t, locale } = useTranslation(messages);
  const start = useRpc(teamPresetStartRpc);
  const [presetId, setPresetId] = useState(null as string | null);
  const [mode, setMode] = useState("auto" as TeamMode);
  const [request, setRequest] = useState("");
  const [workspaceId, setWorkspaceId] = useState(null as string | null);
  const [title, setTitle] = useState("");
  const preset = presets.find((entry) => entry.id === presetId) ?? null;
  useEffect(() => {
    // A fresh dialog for each project; the first preset is picked, with its own mode.
    const first = presets[0] ?? null;
    setPresetId(first?.id ?? null);
    setMode(first?.mode ?? "auto");
    setRequest("");
    setWorkspaceId(null);
    setTitle("");
  }, [project?.id]);
  const started = useMutation({
    mutationFn: () => start({ projectId: project!.id, presetId: presetId!, request, mode, locale, workspace: workspaceId ? { workspaceId } : { title } }),
    onSuccess: (result) => {
      if (result.ok) onStarted(result);
    },
  });
  const free = project ? freeWorkspaces(project) : [];
  const errors = started.error ? [String(started.error)] : started.data && !started.data.ok ? started.data.errors : [];
  return (
    <Modal title={project ? t("presets.startTitle", { project: project.name }) : ""} open={project !== null} onOpenChange={(open) => { if (!open && !started.isPending) onClose(); }}>
      <Modal.Content>
        {project ? (
          <View style={{ gap: 14 }}>
            <Field k={k} label={t("presets.pick")}>
              <View style={{ gap: 6 }}>
                {presets.map((entry) => {
                  const look = MODE_LOOK[entry.mode];
                  return (
                    <Card key={entry.id} k={k} selected={entry.id === presetId} label={entry.name} onPress={() => { setPresetId(entry.id); setMode(entry.mode); }} style={{ gap: 3, paddingVertical: 9 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Tile k={k} icon="Layers" tone={look.tone} size={22} />
                        <T k={k} v="strong" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                          {entry.name}
                        </T>
                        <Badge k={k} label={t(`mode.${entry.mode}`)} tone={look.tone} />
                      </View>
                      <T k={k} v="tiny" numberOfLines={1}>
                        {t("screen.lead")} {runtimeText(entry.orchestrator.provider, entry.orchestrator.model)} · {entry.candidates.map((candidate) => candidate.name).join(", ")}
                      </T>
                    </Card>
                  );
                })}
              </View>
            </Field>
            <Field k={k} label={t("mode.label")} hint={t(`mode.${mode}Hint`)}>
              <Segmented<TeamMode> k={k} stretch value={mode} onChange={setMode} options={TEAM_MODES.map((entry) => ({ value: entry, label: t(`mode.${entry}`) }))} />
            </Field>
            <Field k={k} label={t("sideUi.start.request")} hint={t("sideUi.start.requestHint")}>
              <Input k={k} value={request} placeholder={t("presets.request")} multiline minHeight={90} onChangeText={setRequest} />
            </Field>
            <Field k={k} label={t("presets.workspace")}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Chip k={k} icon="Plus" label={t("presets.newWorkspace")} on={workspaceId === null} onPress={() => setWorkspaceId(null)} />
                {free.map((workspace) => (
                  <Chip key={workspace.id} k={k} icon="Folder" label={workspace.title} on={workspaceId === workspace.id} onPress={() => setWorkspaceId(workspace.id)} />
                ))}
              </View>
              {workspaceId === null ? (
                <View style={{ paddingTop: 4 }}>
                  <Input k={k} value={title} placeholder={`${t("presets.workspaceName")}: ${taskWorkspaceTitle(request, preset?.name ?? "task")}`} onChangeText={setTitle} />
                </View>
              ) : null}
            </Field>
            {errors.length ? (
              <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
                {errors.map((error) => (
                  <T key={error} k={k} v="small">
                    {error}
                  </T>
                ))}
              </Callout>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Button k={k} variant="primary" icon="Play" label={started.isPending ? t("presets.starting") : t("presets.startButton")} busy={started.isPending} disabled={!preset} onPress={() => started.mutate()} />
              <Button k={k} variant="ghost" label={t("review.cancel")} disabled={started.isPending} onPress={onClose} />
            </View>
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
