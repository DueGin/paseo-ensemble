// The Agent team panel of a workspace: the team editor (client/editor/), plus the older form controls the presets
// library still builds on (styles, Button, SelectHost, ModelPicker, ModePicker, LanguagePicker, CandidateEditor, TeamModel).
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { languageFromLocale, PROMPT_LANGUAGES, TEAM_MODES, type PromptLanguage, type TeamMode } from "../shared/modes";
import { providerIcon } from "../shared/provider-icons";
import { candidateHandle, type Candidate } from "../shared/team";
import type { ProviderInfo } from "../shared/validate";
import { LANGUAGE_NAMES } from "./editor/common";
import { TeamEditor } from "./editor/Editor";
import { PickerHost, useSelect, type PickerLook } from "./editor/picker";
import { messages } from "./i18n";

export { PROJECT_TEAMS_KEY, type Target } from "./editor/common";
export { TeamEditor, type Applied, type TeamEditorProps } from "./editor/Editor";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export function styles(colors: Colors, compact: boolean) {
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    body: { padding: compact ? 12 : 20, gap: 12 },
    title: { color: colors.foreground, fontSize: 16, fontWeight: "600" as const },
    text: { color: colors.foreground },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    danger: { color: colors.statusDanger, fontSize: 12 },
    success: { color: colors.statusSuccess },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 6, backgroundColor: colors.surface1 },
    orchestratorCard: {
      borderTopWidth: 1,
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderLeftWidth: 6,
      borderTopColor: colors.border,
      borderRightColor: colors.border,
      borderBottomColor: colors.border,
      borderLeftColor: colors.accent,
      borderRadius: 8,
      padding: 10,
      gap: 6,
      backgroundColor: colors.surface2,
    },
    orchestratorLabel: { color: colors.accent, fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
    roleGroupWrap: { flexDirection: "row" as const, paddingLeft: 2, gap: 20 },
    roleConnector: { width: 2, borderRadius: 1, backgroundColor: colors.accent, opacity: 0.4 },
    roleGroup: { flex: 1, minWidth: 0, gap: 10 },
    roleRow: { flexDirection: "row" as const, alignItems: "stretch" as const, gap: 10 },
    roleCard: { flex: 1, minWidth: 0 },
    roleSpacer: { flex: 1, minWidth: 0 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, color: colors.foreground, backgroundColor: colors.surface0 },
    row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
    button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: colors.accent },
    buttonText: { color: colors.accentForeground, fontWeight: "600" as const },
    secondary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
    select: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 },
    option: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 },
    optionActive: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface2 },
    optionOn: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accent },
    optionOnActive: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.foreground, backgroundColor: colors.accent },
  };
}

type MakeStyles = typeof styles;
export type Styles = ReturnType<MakeStyles>;

export function Button({ s, label, onPress, disabled, secondary }: { s: Styles; label: string; onPress(): void; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[secondary ? s.secondary : s.button, disabled ? { opacity: 0.5 } : null]}>
      <Text style={secondary ? s.text : s.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Select({ s, label, options, value, onChange }: { s: Styles; label: string; options: readonly string[]; value: string; onChange(value: string): void }) {
  const openSelect = useSelect();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={() => openSelect({ label, options, value, onChange })} style={s.select}>
      <Text style={s.text}>{value || "—"}</Text>
      <Text style={s.muted}>▾</Text>
    </Pressable>
  );
}

/** Hosts the searchable picker that Select opens, for everything rendered inside it. */
export function SelectHost({ s, children }: { s: Styles; children: ReactNode }) {
  const look = useMemo<PickerLook>(
    () => ({
      input: s.input,
      muted: s.muted,
      row: (selected, focused) => (selected ? (focused ? s.optionOnActive : s.optionOn) : focused ? s.optionActive : s.option),
      rowText: (selected) => (selected ? s.buttonText : s.text),
      check: (selected) => (selected ? <Text style={s.buttonText}>✓</Text> : null),
    }),
    [s],
  );
  return <PickerHost look={look}>{children}</PickerHost>;
}

/** Provider and model pickers limited to what this host can run. */
export function ModelPicker({ s, catalog, provider, model, onChange }: { s: Styles; catalog: readonly ProviderInfo[]; provider: string; model: string; onChange(next: { provider: string; model: string }): void }) {
  const { t } = useTranslation(messages);
  const ready = catalog.filter((entry) => entry.ready);
  const models = ready.find((entry) => entry.id === provider)?.models.map((entry) => entry.id) ?? [];
  return (
    <View style={s.row}>
      <Text style={s.muted}>{t("role.providerAndModel")}</Text>
      <Select
        s={s}
        label={t("role.provider")}
        options={ready.map((entry) => entry.id)}
        value={provider}
        onChange={(next) => {
          if (next !== provider) onChange({ provider: next, model: ready.find((entry) => entry.id === next)?.models[0]?.id ?? "" });
        }}
      />
      <Select s={s} label={t("role.model")} options={models} value={model} onChange={(next) => onChange({ provider, model: next })} />
    </View>
  );
}

/** The team's collaboration mode: fixed team or delegation, or auto to let the orchestrator pick per request. */
export function ModePicker({ s, colors, mode, onChange }: { s: Styles; colors: Colors; mode: TeamMode; onChange?(mode: TeamMode): void }) {
  const { t } = useTranslation(messages);
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Text style={s.muted}>{t("mode.label")}</Text>
        {TEAM_MODES.map((option) => {
          const selected = option === mode;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`${t("mode.label")}: ${t(`mode.${option}`)}`}
              accessibilityState={{ selected }}
              disabled={!onChange}
              onPress={() => onChange?.(option)}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : colors.surface0, opacity: !onChange && !selected ? 0.6 : 1 }}
            >
              <Text style={{ color: selected ? colors.accentForeground : colors.foreground, fontWeight: selected ? "700" : "500", fontSize: 12 }}>{t(`mode.${option}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.muted}>{t(`mode.${mode}Hint`)}</Text>
    </View>
  );
}

/** The agents' language: their instructions, replies and board posts. Unset means the app's language. */
export function LanguagePicker({ s, colors, language, onChange }: { s: Styles; colors: Colors; language: PromptLanguage | undefined; onChange?(language: PromptLanguage): void }) {
  const { t, locale } = useTranslation(messages);
  const current = language ?? languageFromLocale(locale);
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Text style={s.muted}>{t("review.language")}</Text>
        {PROMPT_LANGUAGES.map((option) => {
          const selected = option === current;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`${t("review.language")}: ${LANGUAGE_NAMES[option]}`}
              accessibilityState={{ selected }}
              disabled={!onChange}
              onPress={() => onChange?.(option)}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : colors.surface0, opacity: !onChange && !selected ? 0.6 : 1 }}
            >
              <Text style={{ color: selected ? colors.accentForeground : colors.foreground, fontWeight: selected ? "700" : "500", fontSize: 12 }}>{LANGUAGE_NAMES[option]}</Text>
            </Pressable>
          );
        })}
      </View>
      {onChange ? <Text style={s.muted}>{t("review.languageHint")}</Text> : null}
    </View>
  );
}

/** One model of the preset pool: an optional handle (derived from the model when empty) and a description of what it is good at and must not do. */
export function CandidateEditor({ s, candidate, catalog, onChange, onRemove }: { s: Styles; candidate: Candidate; catalog: readonly ProviderInfo[]; onChange(candidate: Candidate): void; onRemove(): void }) {
  const { t } = useTranslation(messages);
  return (
    <View style={[s.card, s.roleCard]}>
      <ModelPicker s={s} catalog={catalog} provider={candidate.provider} model={candidate.model} onChange={(next) => onChange({ ...candidate, ...next })} />
      <View style={{ gap: 4 }}>
        <Text style={s.muted}>{t("candidates.notesLabel")}</Text>
        <TextInput style={[s.input, { minHeight: 84, textAlignVertical: "top" }]} value={candidate.notes} placeholder={t("candidates.notes")} multiline onChangeText={(notes) => onChange({ ...candidate, notes })} />
      </View>
      <View style={s.row}>
        <TextInput style={[s.input, { flex: 1, minWidth: 0 }]} value={candidate.name} placeholder={t("candidates.name", { handle: candidateHandle(candidate.model) })} onChangeText={(name) => onChange({ ...candidate, name })} />
        <Button s={s} secondary label={t("candidates.remove")} onPress={onRemove} />
      </View>
    </View>
  );
}

export function TeamModel({ provider, model, colors, icons }: { provider: string; model: string; colors: Colors; icons: Map<string, string | undefined> }) {
  const icon = providerIcon(provider, icons.get(provider));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
      <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
        {icon.kind === "svg" ? <Icon icon={{ svg: icon.svg }} size={14} color={colors.foreground} /> : <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>{icon.letter}</Text>}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 }}>{model}</Text>
    </View>
  );
}

/** The workspace's Agent team panel: the team editor for the workspace's team. */
export function TeamPanel({ workspaceId, ...props }: PluginWorkspacePanelProps) {
  return <TeamEditor {...props} target={{ workspaceId }} />;
}
