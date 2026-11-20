// The Team and Team mode controls in Paseo's own composers: a new agent's draft, and the New workspace screen's first
// agent. Picking a team makes the new agent its lead (see server/draft.ts); a preset also picks the preset's lead model.
import { useComposer, useTranslation, type PluginClientContext } from "@getpaseo/plugin/client";
import { Select } from "@getpaseo/plugin/client/ui";
import { DRAFT_TEAM, draftChoiceValue, draftTeamFor, draftTeamOf, type DraftTeam } from "../shared/draft-lead";
import { TEAM_MODES, type TeamMode } from "../shared/modes";
import { messages } from "./i18n";
import { usePresets } from "./Presets";

/** The draft's team: none, the workspace's own team, or a global preset. */
function DraftTeamSelect() {
  const composer = useComposer();
  const { t, locale } = useTranslation(messages);
  const settings = usePresets();
  if (composer.context === "agent") return null;
  const presets = settings.status === "ready" ? settings.values.presets : [];
  const choice = draftTeamOf(composer.agent.metadata);
  const value = draftChoiceValue(choice);
  const options = [
    { value: "none", label: t("draft.none"), description: t("draft.noneHint") },
    // A New workspace has no team yet, so only a preset can give it one.
    ...(composer.context === "draft" ? [{ value: "workspace", label: t("draft.workspace"), description: t("draft.workspaceHint") }] : []),
    ...presets.map((preset) => ({
      value: `preset:${preset.id}`,
      label: t("draft.preset", { name: preset.name }),
      description: [t(`mode.${preset.mode}`), `${preset.orchestrator.provider}/${preset.orchestrator.model}`, preset.description.trim()].filter(Boolean).join(" · "),
    })),
  ];
  // A choice whose preset was deleted still shows, so the user sees it and can change it.
  if (!options.some((option) => option.value === value)) options.push({ value, label: value, description: "" });
  return (
    <Select
      title={t("draft.team")}
      icon="Users"
      value={value}
      options={options}
      onValueChange={async ({ value: next }) => {
        const updated: DraftTeam | null = draftTeamFor(next, choice, locale);
        await composer.setMetadata({ [DRAFT_TEAM]: updated });
        // A preset leads on its own model; the user can still change it afterwards.
        const preset = updated?.source === "preset" ? presets.find((entry) => entry.id === updated.presetId) : undefined;
        if (!preset) return;
        if (composer.agent.provider !== preset.orchestrator.provider) await composer.setProvider(preset.orchestrator.provider).catch(() => undefined);
        await composer.setModel(preset.orchestrator.model).catch(() => undefined);
      }}
    />
  );
}

/** The session's collaboration mode for a draft that leads a team; the team's own mode by default. */
function DraftModeSelect() {
  const composer = useComposer();
  const { t } = useTranslation(messages);
  if (composer.context === "agent") return null;
  const choice = draftTeamOf(composer.agent.metadata);
  if (!choice) return null;
  return (
    <Select
      title={t("draft.mode")}
      icon="Workflow"
      value={choice.mode ?? "file"}
      options={[{ value: "file", label: t("draft.modeTeamFile") }, ...TEAM_MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`), description: t(`mode.${mode}Hint`) }))]}
      onValueChange={({ value }) => {
        const { mode: _old, ...rest } = choice;
        return composer.setMetadata({ [DRAFT_TEAM]: value === "file" ? rest : { ...rest, mode: value as TeamMode } });
      }}
    />
  );
}

/** Whether the members of a draft that leads a team work without asking; they ask first unless the person picks otherwise. */
function DraftUnattendedSelect() {
  const composer = useComposer();
  const { t } = useTranslation(messages);
  if (composer.context === "agent") return null;
  const choice = draftTeamOf(composer.agent.metadata);
  if (!choice) return null;
  return (
    <Select
      title={t("unattended.draftTitle")}
      icon={choice.unattended ? "ShieldAlert" : "ShieldCheck"}
      value={choice.unattended ? "on" : "ask"}
      options={[
        { value: "ask", label: t("unattended.draftAsk"), description: t("unattended.draftAskHint") },
        { value: "on", label: t("unattended.draftOn"), description: t("unattended.draftOnHint") },
      ]}
      onValueChange={({ value }) => {
        const { unattended: _old, ...rest } = choice;
        return composer.setMetadata({ [DRAFT_TEAM]: value === "on" ? { ...rest, unattended: true } : rest });
      }}
    />
  );
}

export function contributeDraftTeam(client: PluginClientContext): () => void {
  // Apps older than 0.16 have no composer items.
  if (typeof client.addComposerItem !== "function") return () => {};
  const removeTeam = client.addComposerItem({ id: "team", Component: DraftTeamSelect });
  const removeMode = client.addComposerItem({ id: "team-mode", Component: DraftModeSelect });
  const removeUnattended = client.addComposerItem({ id: "team-members", Component: DraftUnattendedSelect });
  return () => {
    removeTeam();
    removeMode();
    removeUnattended();
  };
}
