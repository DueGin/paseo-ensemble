// The team editor's cards: the collaboration modes, the agent language, a fixed role and a candidate.
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import { MODE_SPECS, TEAM_MODES, type PromptLanguage, type TeamMode } from "../../shared/modes";
import { candidateHandle, type Candidate, type Role } from "../../shared/team";
import type { ProviderInfo } from "../../shared/validate";
import { AgentAvatar, Card, MODE_LOOK, PART, roleTone, Segmented, Tile, type Kit } from "../kit";
import { LANGUAGE_NAMES, useT, type Translate } from "./common";
import { Anchor, FieldIssues, FolderChips, Grid, hasError, LinkButton, RuntimeEditor, Slot, TextField, ToolButton, useIssues } from "./controls";

const MODE_FACETS = { auto: ["perRequest", "locked"], team: ["intake", "shared"], delegation: ["isolated", "reports"], none: ["solo"] } as const;

/** The mode hint without its "Team (MA-08):" lead-in, which the card already shows. */
function modeHint(t: Translate, mode: TeamMode): string {
  const trimmed = t(`mode.${mode}Hint`).replace(/^[^:：]{1,32}[:：]\s*/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

const modePattern = (mode: TeamMode) => (mode === "auto" ? `${MODE_SPECS.team.pattern} · ${MODE_SPECS.delegation.pattern}` : mode === "none" ? "" : MODE_SPECS[mode].pattern);

/** The radio mark of a selectable card. */
export function Radio({ k, on }: { k: Kit; on: boolean }) {
  return (
    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: on ? k.c.primary : withAlpha(k.c.fg, 0.25), backgroundColor: on ? k.c.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
      {on ? <Icon name="Check" size={11} color={k.c.primaryFg} /> : null}
    </View>
  );
}

function Facet({ k, label, tone }: { k: Kit; label: string; tone?: string }) {
  return (
    <View style={{ paddingHorizontal: 7, borderRadius: 6, backgroundColor: tone ? withAlpha(tone, 0.14) : k.c.muted }}>
      <Text style={{ color: tone ?? k.c.mutedFg, fontSize: 11, lineHeight: 18, fontWeight: tone ? "700" : "500", ...(tone ? { fontFamily: "Menlo" } : {}) }}>{label}</Text>
    </View>
  );
}

/** The four collaboration modes as cards: icon, description, the pattern and what it means; the chosen one is checked. */
export function ModeCards({ k, value, onChange }: { k: Kit; value: TeamMode; onChange(mode: TeamMode): void }) {
  const { t } = useT();
  return (
    <Anchor field="mode">
      <Grid min={200} gap={10} columns={(width) => (width >= 860 ? 4 : width >= 420 ? 2 : 1)}>
        {TEAM_MODES.map((mode) => {
          const on = value === mode;
          const look = MODE_LOOK[mode];
          const pattern = modePattern(mode);
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${t("mode.label")}: ${t(`mode.${mode}`)}`}
              onPress={() => onChange(mode)}
              style={({ pressed }) => ({
                flexGrow: 1,
                gap: 9,
                padding: on ? 13 : 14,
                borderRadius: 12,
                borderWidth: on ? 2 : 1,
                borderColor: on ? k.c.primary : pressed ? withAlpha(k.c.primary, 0.45) : k.c.border,
                backgroundColor: on ? withAlpha(k.c.primary, 0.06) : k.c.card,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Tile k={k} icon={look.icon} tone={look.tone} size={30} />
                <Text style={{ flex: 1, color: k.c.fg, fontSize: 14, fontWeight: "700" }} numberOfLines={1}>
                  {t(`mode.${mode}`)}
                </Text>
                <Radio k={k} on={on} />
              </View>
              <Text style={{ flexGrow: 1, color: k.c.mutedFg, fontSize: 12, lineHeight: 18 }}>{modeHint(t, mode)}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                {pattern ? <Facet k={k} label={pattern} tone={look.tone} /> : null}
                {MODE_FACETS[mode].map((facet) => (
                  <Facet key={facet} k={k} label={t(`editorUi.facet.${facet}`)} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </Grid>
    </Anchor>
  );
}

export type LanguageChoice = "auto" | PromptLanguage;

export function languageOptions(t: Translate): { value: LanguageChoice; label: string }[] {
  return [
    { value: "auto", label: t("editorUi.languageAuto") },
    { value: "zh", label: LANGUAGE_NAMES.zh },
    { value: "en", label: LANGUAGE_NAMES.en },
  ];
}

/** The agents' language: the app's (unset), Chinese or English. */
export function LanguageRow({ k, value, onChange }: { k: Kit; value: PromptLanguage | undefined; onChange(language: PromptLanguage | undefined): void }) {
  const { t } = useT();
  return (
    <Anchor field="language" style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", rowGap: 10, columnGap: 18, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: k.c.border, borderRadius: 12, backgroundColor: k.c.card }}>
        <View style={{ flexGrow: 1, flexBasis: 220, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Icon name="Languages" size={14} color={k.c.mutedFg} />
            <Text style={{ color: k.c.fg, fontSize: 13, fontWeight: "600" }}>{t("editorUi.section.language")}</Text>
          </View>
          <Text style={{ color: k.c.mutedFg, fontSize: 11.5, lineHeight: 16 }}>{t("editorUi.section.languageHint")}</Text>
        </View>
        <Segmented<LanguageChoice> k={k} value={value ?? "auto"} options={languageOptions(t)} onChange={(choice) => onChange(choice === "auto" ? undefined : choice)} />
      </View>
    </Anchor>
  );
}

/** A fixed role: its letter, name, tools, provider and model, folders and instructions. */
export function RoleCard({ k, role, index, catalog, icons, autoFocus, onChange, onDuplicate, onRemove, onEditInstructions }: { k: Kit; role: Role; index: number; catalog: readonly ProviderInfo[]; icons: ReadonlyMap<string, string | undefined>; autoFocus?: boolean; onChange(role: Role, group: string): void; onDuplicate(): void; onRemove(): void; onEditInstructions(): void }) {
  const { t } = useT();
  const field = `roles.${index}`;
  const nameIssues = useIssues(`${field}.name`);
  const folderIssues = useIssues(`${field}.folders`);
  const tone = roleTone(index);
  return (
    <Anchor field={field} style={{ flexGrow: 1 }}>
      <Card k={k} tone={tone} style={{ flexGrow: 1, gap: 12, padding: 14, paddingBottom: 16, borderRadius: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AgentAvatar k={k} provider={role.provider} model={role.model} icons={icons} size={32} />
          <Anchor field={`${field}.name`} style={{ flex: 1 }}>
            <TextField k={k} variant="title" value={role.name} placeholder={t("editorUi.role.namePlaceholder")} accessibilityLabel={t("editorUi.role.name")} invalid={hasError(nameIssues)} autoFocus={autoFocus} selectTextOnFocus={autoFocus} autoCapitalize="none" onChangeText={(name) => onChange({ ...role, name }, `${field}.name`)} />
          </Anchor>
          <View style={{ flexDirection: "row", gap: 1 }}>
            <ToolButton k={k} icon="Copy" label={t("editorUi.role.duplicate")} onPress={onDuplicate} />
            <ToolButton k={k} icon="Trash2" label={t("editorUi.role.remove")} danger onPress={onRemove} />
          </View>
        </View>
        <FieldIssues k={k} field={`${field}.name`} />
        <RuntimeEditor k={k} catalog={catalog} icons={icons} provider={role.provider} model={role.model} field={field} onChange={(next, group) => onChange({ ...role, ...next }, group)} />
        <Slot k={k} field={`${field}.folders`} label={t("editorUi.role.folders")} hint={t("editorUi.role.foldersHint")}>
          <FolderChips k={k} folders={role.folders} tone={tone} invalid={hasError(folderIssues)} onChange={(folders) => onChange({ ...role, folders }, `${field}.folders`)} />
        </Slot>
        <Slot k={k} field={`${field}.instructions`} label={t("editorUi.role.instructions")} aside={<LinkButton k={k} icon="Sparkles" label={t("role.improveWithAi")} onPress={onEditInstructions} />}>
          <TextField k={k} multiline minHeight={84} value={role.instructions} placeholder={t("editorUi.role.instructionsPlaceholder")} accessibilityLabel={t("editorUi.role.instructions")} onChangeText={(instructions) => onChange({ ...role, instructions }, `${field}.instructions`)} />
        </Slot>
      </Card>
    </Anchor>
  );
}

/** A candidate: its @handle (from the model when empty), tools, provider and model, and the description the lead goes by. */
export function CandidateCard({ k, candidate, index, catalog, icons, autoFocus, onChange, onDuplicate, onRemove }: { k: Kit; candidate: Candidate; index: number; catalog: readonly ProviderInfo[]; icons: ReadonlyMap<string, string | undefined>; autoFocus?: boolean; onChange(candidate: Candidate, group: string): void; onDuplicate(): void; onRemove(): void }) {
  const { t } = useT();
  const field = `candidates.${index}`;
  const nameIssues = useIssues(`${field}.name`);
  const handle = candidateHandle(candidate.model);
  return (
    <Anchor field={field} style={{ flexGrow: 1 }}>
      <Card k={k} style={{ flexGrow: 1, gap: 12, padding: 14, paddingBottom: 16, borderRadius: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AgentAvatar k={k} provider={candidate.provider} model={candidate.model} icons={icons} size={32} />
          <Anchor field={`${field}.name`} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
            <View pointerEvents="none" style={{ position: "absolute", left: 9, zIndex: 1 }}>
              <Text style={{ color: k.c.mutedFg, fontFamily: "Menlo", fontSize: 13 }}>@</Text>
            </View>
            <TextField k={k} variant="title" mono style={{ flex: 1, paddingLeft: 22, fontSize: 13 }} value={candidate.name} placeholder={handle} accessibilityLabel={t("editorUi.candidate.handle")} invalid={hasError(nameIssues)} autoFocus={autoFocus} autoCapitalize="none" onChangeText={(name) => onChange({ ...candidate, name }, `${field}.name`)} />
          </Anchor>
          <View style={{ flexDirection: "row", gap: 1 }}>
            <ToolButton k={k} icon="Copy" label={t("editorUi.candidate.duplicate")} onPress={onDuplicate} />
            <ToolButton k={k} icon="Trash2" label={t("editorUi.candidate.remove")} danger onPress={onRemove} />
          </View>
        </View>
        <FieldIssues k={k} field={`${field}.name`} />
        {!candidate.name.trim() ? <Text style={{ color: k.c.mutedFg, fontSize: 11.5, lineHeight: 16, marginTop: -6 }}>{t("editorUi.candidate.handleHint", { handle })}</Text> : null}
        <RuntimeEditor k={k} catalog={catalog} icons={icons} provider={candidate.provider} model={candidate.model} field={field} onChange={(next, group) => onChange({ ...candidate, ...next }, group)} />
        <Slot
          k={k}
          field={`${field}.notes`}
          label={t("editorUi.candidate.notes")}
          aside={!candidate.notes.trim() ? <LinkButton k={k} icon="Sparkles" label={t("editorUi.candidate.useTemplate")} onPress={() => onChange({ ...candidate, notes: t("candidates.notes") }, `${field}.notes`)} /> : null}
        >
          <TextField k={k} multiline minHeight={76} value={candidate.notes} placeholder={t("candidates.notes")} accessibilityLabel={t("editorUi.candidate.notes")} onChangeText={(notes) => onChange({ ...candidate, notes }, `${field}.notes`)} />
        </Slot>
      </Card>
    </Anchor>
  );
}
