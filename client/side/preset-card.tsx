// A global preset as a card, for the side panel's Teams tab and the Agent teams screen: name, mode, lead, candidates, and its
// actions: copy it into a project as a team file, rename it in place, delete it after a confirmation (and, on the screen,
// edit it). Presets are host settings (`presetsSettings`); renames keep names unique regardless of case.
import { useRpc, useSettings, useTranslation } from "@getpaseo/plugin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { languageFromLocale } from "../../shared/modes";
import { presetsSettings, presetToTeam, type Preset } from "../../shared/presets";
import { teamSaveRpc } from "../../shared/rpc";
import { messages } from "../i18n";
import { Badge, Button, Callout, Card, Chip, Input, MODE_LOOK, T, Tile, type Kit } from "../kit";
import { PROJECTS_KEY, renameProblem, TEAM_KEY } from "./data";
import { ModelLine, type ProviderIcons } from "./model-select";

export const LANGUAGE_NAMES = { zh: "中文", en: "English" } as const;

/** Why an edit was refused, or null when it went through. */
type Problem = string | null;
type Saved = boolean;

/** The preset library and the edits made from a card: rename and delete. */
export function usePresetLibrary() {
  const { t } = useTranslation(messages);
  const settings = useSettings(presetsSettings);
  const presets = settings.status === "ready" ? settings.values.presets : [];
  /** Null when renamed; otherwise why not ("" when the save itself failed, see `settings.saveError`). */
  const rename = async (id: string, name: string): Promise<Problem> => {
    if (settings.status !== "ready") return "";
    const next = name.trim();
    const refused = renameProblem(presets, id, next);
    if (refused === "empty") return t("presets.problems.name");
    if (refused === "taken") return t("sideUi.presets.renameTaken", { name: next });
    if (presets.find((preset) => preset.id === id)?.name === next) return null;
    const saved = await settings.save({ presets: presets.map((preset) => (preset.id === id ? { ...preset, name: next, updatedAt: new Date().toISOString() } : preset)) }, settings.revision);
    return saved ? null : "";
  };
  const remove = async (id: string): Promise<Saved> => {
    if (settings.status !== "ready") return false;
    return settings.save({ presets: presets.filter((preset) => preset.id !== id) }, settings.revision);
  };
  return { settings, presets, rename, remove };
}

/** Writes a preset into a project as a team file whose lead runs in `workspace`; nothing starts. */
export function useCopyPreset(onSaved?: (file: string) => void) {
  const save = useRpc(teamSaveRpc);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ preset, target, workspace }: { preset: Preset; target: { workspaceId: string } | { projectId: string }; workspace: string }) => save({ ...target, team: presetToTeam(preset, workspace) }),
    onSuccess: (result) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      void queryClient.invalidateQueries({ queryKey: TEAM_KEY });
      onSaved?.(result.file);
    },
  });
}

export interface CopyAction {
  /** Projects to pick from; without them the card copies into the one project it knows. */
  targets?: readonly { id: string; label: string }[];
  busy: boolean;
  /** The last copy's problem, shown on the card that asked for it. */
  error: string | null;
  run(targetId?: string): void;
}

/** A preset with its mode, lead and candidates, and its actions. `detailed` lists each candidate with its description. */
export function PresetCard({ k, preset, icons, detailed, disabled, saving, saveError, copy, onEdit, onRename, onDelete }: { k: Kit; preset: Preset; icons: ProviderIcons; detailed?: boolean; disabled?: boolean; saving: boolean; saveError: string | null; copy?: CopyAction; onEdit?: () => void; onRename(name: string): Promise<Problem>; onDelete(): Promise<Saved> }) {
  const { t, locale } = useTranslation(messages);
  const [step, setStep] = useState<"idle" | "rename" | "delete" | "copy">("idle");
  const [name, setName] = useState(preset.name);
  const [problem, setProblem] = useState(null as Problem);
  const look = MODE_LOOK[preset.mode];
  const language = preset.language ?? languageFromLocale(locale);
  const confirmRename = () => {
    void onRename(name).then((result) => {
      if (result === null) {
        setStep("idle");
        setProblem(null);
      } else setProblem(result || saveError || t("sideUi.presets.saveFailed"));
    });
  };
  const startCopy = () => {
    if (copy?.targets && copy.targets.length !== 1) setStep("copy");
    else copy?.run(copy.targets?.[0]?.id);
  };
  return (
    <Card k={k} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tile k={k} icon="Layers" tone={look.tone} size={detailed ? 28 : 24} />
        <T k={k} v={detailed ? "h3" : "strong"} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {preset.name}
        </T>
        <Badge k={k} label={t(`mode.${preset.mode}`)} tone={look.tone} icon={look.icon} />
      </View>
      {preset.description.trim() ? (
        <T k={k} v="muted" numberOfLines={2}>
          {preset.description.trim()}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <T k={k} v="tiny">
          {t("screen.lead")}
        </T>
        <ModelLine k={k} provider={preset.orchestrator.provider} model={preset.orchestrator.model} icons={icons} />
        <T k={k} v="tiny" style={{ marginLeft: "auto" }}>
          {LANGUAGE_NAMES[language]}
        </T>
      </View>
      {detailed ? (
        <View style={{ gap: 6 }}>
          {preset.candidates.map((candidate) => (
            <Card key={candidate.name} k={k} inset style={{ padding: 8, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                <T k={k} v="strong" numberOfLines={1} style={{ flexShrink: 0, maxWidth: "45%" }}>
                  {candidate.name}
                </T>
                <ModelLine k={k} provider={candidate.provider} model={candidate.model} icons={icons} />
              </View>
              {candidate.notes.trim() ? (
                <T k={k} v="tiny" numberOfLines={3}>
                  {candidate.notes.trim()}
                </T>
              ) : null}
            </Card>
          ))}
        </View>
      ) : (
        <T k={k} v="tiny" numberOfLines={2}>
          {t("screen.candidates", { count: preset.candidates.length })}: {preset.candidates.map((candidate) => candidate.name).join(", ")}
        </T>
      )}
      {step === "rename" ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Input
                k={k}
                value={name}
                autoFocus
                placeholder={t("presets.name")}
                accessibilityLabel={t("presets.name")}
                invalid={!!problem}
                onChangeText={(next) => {
                  setName(next);
                  setProblem(null);
                }}
                onSubmitEditing={confirmRename}
              />
            </View>
            <Button k={k} icon="Check" variant="primary" size="sm" busy={saving} disabled={!name.trim()} accessibilityLabel={t("sideUi.presets.renameSave")} onPress={confirmRename} />
            <Button k={k} icon="X" variant="ghost" size="sm" accessibilityLabel={t("review.cancel")} onPress={() => { setStep("idle"); setProblem(null); }} />
          </View>
          {problem ? (
            <T k={k} v="tiny" style={{ color: k.c.bad }}>
              {problem}
            </T>
          ) : null}
        </View>
      ) : step === "delete" ? (
        <Callout k={k} tone={k.c.bad} icon="Trash2">
          <View style={{ gap: 8 }}>
            <T k={k} v="small">
              {t("presets.deleteConfirm", { name: preset.name })}
            </T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Button k={k} label={t("presets.deleteYes")} variant="danger" size="sm" busy={saving} onPress={() => void onDelete().then((done) => { if (done) setStep("idle"); else setProblem(saveError || t("sideUi.presets.saveFailed")); })} />
              <Button k={k} label={t("review.cancel")} variant="ghost" size="sm" onPress={() => { setStep("idle"); setProblem(null); }} />
            </View>
            {problem ? (
              <T k={k} v="tiny" style={{ color: k.c.bad }}>
                {problem}
              </T>
            ) : null}
          </View>
        </Callout>
      ) : step === "copy" && copy?.targets ? (
        <Card k={k} inset style={{ gap: 8 }}>
          <T k={k} v="small">
            {t("sideUi.presets.copyPick")}
          </T>
          {copy.targets.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {copy.targets.map((target) => (
                <Chip key={target.id} k={k} icon="Folder" label={target.label} onPress={copy.busy ? undefined : () => { setStep("idle"); copy.run(target.id); }} />
              ))}
            </View>
          ) : (
            <T k={k} v="muted">{t("sideUi.presets.noProjects")}</T>
          )}
          <Button k={k} label={t("review.cancel")} variant="ghost" size="sm" onPress={() => setStep("idle")} />
        </Card>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {copy ? <Button k={k} icon="Copy" label={t("sideUi.presets.copy")} size="sm" busy={copy.busy} disabled={disabled} onPress={startCopy} /> : null}
          {onEdit ? <Button k={k} icon="Pencil" label={t("presets.edit")} size="sm" disabled={disabled} onPress={onEdit} /> : null}
          <View style={{ flex: 1 }} />
          <Button k={k} icon="PenLine" variant="ghost" size="sm" label={detailed ? t("sideUi.presets.rename") : undefined} accessibilityLabel={t("sideUi.presets.rename")} disabled={disabled} onPress={() => { setName(preset.name); setProblem(null); setStep("rename"); }} />
          <Button k={k} icon="Trash2" variant="ghost" size="sm" label={detailed ? t("presets.delete") : undefined} accessibilityLabel={t("presets.delete")} disabled={disabled} onPress={() => { setProblem(null); setStep("delete"); }} />
        </View>
      )}
      {copy?.error && step === "idle" ? (
        <T k={k} v="tiny" style={{ color: k.c.bad }}>
          {copy.error}
        </T>
      ) : null}
    </Card>
  );
}
