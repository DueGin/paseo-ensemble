// Global team presets on the Agent teams screen: list, create, edit and delete them, and start a new task in a project
// from one. Presets are host settings, so every client and project of the host sees the same list.
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings, useTranslation } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { newCandidate } from "../shared/draft";
import { languageFromLocale, type TeamMode } from "../shared/modes";
import { namedCandidates, newPresetId, presetProblems, presetsSettings, presetToTeam, taskWorkspaceTitle, type Preset } from "../shared/presets";
import { teamPresetStartRpc, type teamProjectsRpc } from "../shared/rpc";
import { catalogFrom, validateTeam, type ProviderEntry, type ProviderInfo } from "../shared/validate";
import { messages } from "./i18n";
import { Button, CandidateEditor, LanguagePicker, ModelPicker, ModePicker, SelectHost, TeamModel, type Styles } from "./TeamPanel";

type Colors = PluginScreenProps["theme"]["colors"];
type Project = RpcOutput<typeof teamProjectsRpc>[number];

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

function Chip({ label, selected, colors, onPress }: { label: string; selected: boolean; colors: Colors; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : colors.surface0 }}>
      <Text style={{ color: selected ? colors.accentForeground : colors.foreground, fontSize: 12, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
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
function PresetEditor({ s, colors, catalog, draft, onChange, onSave, onCancel, saving, error }: { s: Styles; colors: Colors; catalog: readonly ProviderInfo[]; draft: Preset; onChange(next: Preset): void; onSave(): void; onCancel(): void; saving: boolean; error: string | null }) {
  const { t } = useTranslation(messages);
  const problems = presetProblems(draft);
  const hostProblems = problems.length ? [] : validateTeam(presetToTeam({ ...draft, candidates: namedCandidates(draft.candidates) }, "check"), catalog);
  return (
    <SelectHost s={s}>
      <View style={[s.card, { gap: 10 }]}>
        <TextInput style={s.input} value={draft.name} placeholder={t("presets.name")} onChangeText={(name) => onChange({ ...draft, name })} />
        <TextInput style={s.input} value={draft.description} placeholder={t("presets.description")} multiline onChangeText={(description) => onChange({ ...draft, description })} />
        <ModePicker s={s} colors={colors} mode={draft.mode} onChange={(mode) => onChange({ ...draft, mode })} />
        <LanguagePicker s={s} colors={colors} language={draft.language} onChange={(language) => onChange({ ...draft, language })} />
        <View style={s.orchestratorCard}>
          <Text style={s.orchestratorLabel}>{t("presets.orchestrator")}</Text>
          <ModelPicker s={s} catalog={catalog} provider={draft.orchestrator.provider} model={draft.orchestrator.model} onChange={(next) => onChange({ ...draft, orchestrator: next })} />
        </View>
        <View style={{ gap: 2 }}>
          <Text style={s.title}>{t("candidates.title")}</Text>
          <Text style={s.muted}>{t("candidates.hint")}</Text>
        </View>
        {draft.candidates.map((candidate, index) => (
          <CandidateEditor
            key={index}
            s={s}
            candidate={candidate}
            catalog={catalog}
            onChange={(next) => onChange({ ...draft, candidates: draft.candidates.map((entry, at) => (at === index ? next : entry)) })}
            onRemove={() => onChange({ ...draft, candidates: draft.candidates.filter((_, at) => at !== index) })}
          />
        ))}
        <View style={s.row}>
          <Button s={s} secondary label={t("candidates.add")} onPress={() => onChange({ ...draft, candidates: [...draft.candidates, newCandidate(catalog, draft.candidates.map((entry) => entry.name))] })} />
        </View>
        {problems.map((problem) => <Text key={problem} style={s.danger}>{t(`presets.problems.${problem as "name"}`)}</Text>)}
        {hostProblems.map((problem) => <Text key={problem.target + problem.message} style={s.danger}>{problem.target}: {problem.message}</Text>)}
        {error ? <Text style={s.danger}>{t("presets.saveFailed", { error })}</Text> : null}
        <View style={s.row}>
          <Button s={s} label={t("presets.save")} disabled={problems.length > 0 || saving} onPress={onSave} />
          <Button s={s} secondary label={t("review.cancel")} disabled={saving} onPress={onCancel} />
          {saving ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
      </View>
    </SelectHost>
  );
}

/** The global preset library: list, create, edit, delete. */
export function PresetsSection({ s, colors }: { s: Styles; colors: Colors }) {
  const { t, locale } = useTranslation(messages);
  const settings = usePresets();
  const { catalog, icons } = useCatalog();
  // The draft keeps the revision it was opened on, so a save never overwrites a newer change from another client.
  const [editing, setEditing] = useState<{ draft: Preset; revision: string; isNew: boolean } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  if (settings.status === "loading") return <Text style={s.muted}>{t("loading")}</Text>;
  if (settings.status !== "ready") return <Text style={s.danger}>{t("presets.loadFailed", { error: settings.error })}</Text>;
  const presets = settings.values.presets;
  const save = async () => {
    if (!editing) return;
    const preset = { ...editing.draft, name: editing.draft.name.trim(), candidates: namedCandidates(editing.draft.candidates), updatedAt: new Date().toISOString() };
    const next = editing.isNew ? [...presets, preset] : presets.map((entry) => (entry.id === preset.id ? preset : entry));
    if (await settings.save({ presets: next }, editing.revision)) setEditing(null);
  };
  return (
    <View style={[s.card, { gap: 10 }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[s.text, { fontSize: 17, fontWeight: "700" }]}>{t("presets.title")}</Text>
          <Text style={s.muted}>{t("presets.hint")}</Text>
        </View>
        {!editing ? <Button s={s} label={`+ ${t("presets.new")}`} onPress={() => setEditing({ draft: blankPreset(catalog, locale), revision: settings.revision, isNew: true })} /> : null}
      </View>
      {editing ? (
        <PresetEditor s={s} colors={colors} catalog={catalog} draft={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onSave={() => void save()} onCancel={() => setEditing(null)} saving={settings.saving} error={settings.saveError} />
      ) : null}
      {!presets.length && !editing ? <Text style={s.muted}>{t("presets.none")}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {presets.map((preset) => (
          <View key={preset.id} style={[s.card, { minWidth: 240, flexBasis: 300, flexGrow: 1, backgroundColor: colors.surface2, gap: 6 }]}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={[s.text, { flex: 1, minWidth: 0, fontWeight: "700", fontSize: 14 }]}>{preset.name}</Text>
              <Text style={s.muted}>{t(`mode.${preset.mode}`)} · {(preset.language ?? languageFromLocale(locale)) === "zh" ? "中文" : "English"}</Text>
            </View>
            {preset.description ? <Text style={s.muted} numberOfLines={2}>{preset.description}</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={s.muted}>{t("presets.orchestrator")}</Text>
              <TeamModel provider={preset.orchestrator.provider} model={preset.orchestrator.model} colors={colors} icons={icons} />
            </View>
            <View style={{ gap: 6 }}>
              {preset.candidates.map((candidate) => (
                <View key={candidate.name} style={{ gap: 2, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[s.text, { fontSize: 12, fontWeight: "600" }]}>{candidate.name}</Text>
                    <TeamModel provider={candidate.provider} model={candidate.model} colors={colors} icons={icons} />
                  </View>
                  {candidate.notes.trim() ? <Text style={[s.muted, { fontSize: 11 }]} numberOfLines={3}>{candidate.notes.trim()}</Text> : null}
                </View>
              ))}
            </View>
            {confirming === preset.id ? (
              <View style={{ gap: 6 }}>
                <Text style={s.text}>{t("presets.deleteConfirm", { name: preset.name })}</Text>
                <View style={s.row}>
                  <Button s={s} label={t("presets.deleteYes")} disabled={settings.saving} onPress={() => void settings.save({ presets: presets.filter((entry) => entry.id !== preset.id) }, settings.revision).then((saved) => { if (saved) setConfirming(null); })} />
                  <Button s={s} secondary label={t("review.cancel")} onPress={() => setConfirming(null)} />
                </View>
              </View>
            ) : (
              <View style={s.row}>
                <Button s={s} secondary label={t("presets.edit")} disabled={editing !== null} onPress={() => setEditing({ draft: preset, revision: settings.revision, isNew: false })} />
                <Button s={s} secondary label={t("presets.delete")} disabled={editing !== null} onPress={() => setConfirming(preset.id)} />
              </View>
            )}
          </View>
        ))}
      </View>
      {settings.saveError && !editing ? <Text style={s.danger}>{t("presets.saveFailed", { error: settings.saveError })}</Text> : null}
    </View>
  );
}

/** Starts a new task in a project from a preset: pick it, describe the work, pick or name the workspace. */
export function StartFromPresetDialog({ s, colors, project, presets, onClose, onStarted }: { s: Styles; colors: Colors; project: Project | null; presets: readonly Preset[]; onClose(): void; onStarted(result: Extract<RpcOutput<typeof teamPresetStartRpc>, { ok: true }>): void }) {
  const { t, locale } = useTranslation(messages);
  const start = useRpc(teamPresetStartRpc);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [mode, setMode] = useState<TeamMode>("auto");
  const [request, setRequest] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
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
  const occupied = new Set((project?.teams ?? []).map((team) => team.workspaceId).filter((id): id is string => id !== null));
  const free = (project?.workspaces ?? []).filter((workspace) => !occupied.has(workspace.id));
  return (
    <Modal title={project ? t("presets.startTitle", { project: project.name }) : ""} open={project !== null} onOpenChange={(open) => { if (!open && !started.isPending) onClose(); }}>
      <Modal.Content>
        {project ? (
          <View style={{ gap: 10 }}>
            <Text style={s.muted}>{t("presets.pick")}</Text>
            <View style={s.row}>
              {presets.map((entry) => <Chip key={entry.id} label={entry.name} selected={entry.id === presetId} colors={colors} onPress={() => { setPresetId(entry.id); setMode(entry.mode); }} />)}
            </View>
            {preset ? <Text style={s.muted}>{preset.candidates.map((candidate) => `${candidate.name} (${candidate.model})`).join(" · ")}</Text> : null}
            <ModePicker s={s} colors={colors} mode={mode} onChange={setMode} />
            <TextInput style={[s.input, { minHeight: 90, textAlignVertical: "top" }]} value={request} placeholder={t("presets.request")} multiline onChangeText={setRequest} />
            <Text style={s.muted}>{t("presets.workspace")}</Text>
            <View style={s.row}>
              <Chip label={t("presets.newWorkspace")} selected={workspaceId === null} colors={colors} onPress={() => setWorkspaceId(null)} />
              {free.map((workspace) => <Chip key={workspace.id} label={workspace.title} selected={workspaceId === workspace.id} colors={colors} onPress={() => setWorkspaceId(workspace.id)} />)}
            </View>
            {workspaceId === null ? (
              <TextInput style={s.input} value={title} placeholder={`${t("presets.workspaceName")}: ${taskWorkspaceTitle(request, preset?.name ?? "task")}`} onChangeText={setTitle} />
            ) : null}
            {started.data && !started.data.ok ? started.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
            {started.error ? <Text style={s.danger}>{String(started.error)}</Text> : null}
            <View style={s.row}>
              <Button s={s} label={t("presets.startButton")} disabled={!preset || started.isPending} onPress={() => started.mutate()} />
              <Button s={s} secondary label={t("review.cancel")} disabled={started.isPending} onPress={onClose} />
              {started.isPending ? <><ActivityIndicator color={colors.accent} /><Text style={s.muted}>{t("presets.starting")}</Text></> : null}
            </View>
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
