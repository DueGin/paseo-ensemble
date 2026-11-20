// Model choice for the preset editor in the kit's style: a field showing the provider's mark and `provider/model` that opens
// a searchable list of what this host can run, grouped by provider; and a candidate member's card built on it.
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import { candidateHandle, type Candidate } from "../../shared/team";
import type { ProviderInfo } from "../../shared/validate";
import { messages } from "../i18n";
import { AgentAvatar, Button, Card, ClientMark, Field, Input, T, type Kit } from "../kit";

export type ProviderIcons = Map<string, string | undefined>;

/** The provider's (client's) mark on a small muted square. */
export function ProviderMark({ k, provider, icons, size = 20 }: { k: Kit; provider: string; icons: ProviderIcons; size?: number }) {
  return <ClientMark k={k} provider={provider} icons={icons} size={size} />;
}

/** A model shown as its client's avatar, badged with the model's vendor, and `provider/model`. */
export function ModelLine({ k, provider, model, icons }: { k: Kit; provider: string; model: string; icons: ProviderIcons }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
      <AgentAvatar k={k} provider={provider} model={model} icons={icons} size={20} />
      <T k={k} v="small" numberOfLines={1} style={{ flexShrink: 1, color: k.c.mutedFg }}>
        {model ? `${provider}/${model}` : provider}
      </T>
    </View>
  );
}

/** Picks a provider and model among the ready ones. */
export function ModelSelect({ k, catalog, icons, provider, model, title, onChange }: { k: Kit; catalog: readonly ProviderInfo[]; icons: ProviderIcons; provider: string; model: string; title: string; onChange(next: { provider: string; model: string }): void }) {
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ready = catalog.filter((entry) => entry.ready);
  const needle = query.trim().toLowerCase();
  const groups = ready
    .map((entry) => ({ provider: entry.id, models: entry.models.filter((option) => !needle || `${entry.id}/${option.id} ${option.label}`.toLowerCase().includes(needle)) }))
    .filter((group) => group.models.length);
  const any = ready.some((entry) => entry.models.length);
  const set = provider && model;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${set ? `${provider}/${model}` : "—"}`}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingHorizontal: 9, paddingVertical: 5, borderRadius: k.radius - 2, borderWidth: 1, borderColor: set ? k.c.border : k.c.bad, backgroundColor: pressed ? k.c.muted : k.c.bg })}
      >
        {provider ? <AgentAvatar k={k} provider={provider} model={model} icons={icons} size={20} /> : null}
        <T k={k} v="small" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {set ? `${provider}/${model}` : "—"}
        </T>
        <Icon name="ChevronsUpDown" size={13} color={k.c.mutedFg} />
      </Pressable>
      <Modal title={title} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <Input k={k} value={query} onChangeText={setQuery} placeholder={t("role.searchPlaceholder")} autoFocus />
          {!groups.length ? <T k={k} v="muted">{t(any ? "role.noMatches" : "role.noOptions")}</T> : null}
          {groups.map((group) => (
            <View key={group.provider} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <ProviderMark k={k} provider={group.provider} icons={icons} size={16} />
                <T k={k} v="label">
                  {group.provider}
                </T>
              </View>
              {group.models.map((option) => {
                const on = group.provider === provider && option.id === model;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${group.provider}/${option.id}`}
                    onPress={() => {
                      setOpen(false);
                      onChange({ provider: group.provider, model: option.id });
                    }}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: k.radius - 2, borderWidth: 1, borderColor: on ? k.c.primary : k.c.border, backgroundColor: on ? withAlpha(k.c.primary, 0.12) : pressed ? k.c.muted : k.c.card })}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T k={k} v="strong" numberOfLines={1}>
                        {option.label || option.id}
                      </T>
                      {option.label && option.label !== option.id ? (
                        <T k={k} v="tiny" numberOfLines={1}>
                          {option.id}
                        </T>
                      ) : null}
                    </View>
                    {on ? <Icon name="Check" size={14} color={k.c.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Modal.Content>
      </Modal>
    </>
  );
}

/** One model of a preset's pool: its model, an optional handle (taken from the model when empty) and its description. */
export function CandidateEditor({ k, candidate, catalog, icons, onChange, onRemove }: { k: Kit; candidate: Candidate; catalog: readonly ProviderInfo[]; icons: ProviderIcons; onChange(candidate: Candidate): void; onRemove(): void }) {
  const { t } = useTranslation(messages);
  return (
    <Card k={k} inset style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ModelSelect k={k} catalog={catalog} icons={icons} provider={candidate.provider} model={candidate.model} title={t("role.providerAndModel")} onChange={(next) => onChange({ ...candidate, ...next })} />
        </View>
        <Button k={k} icon="Trash2" variant="ghost" size="sm" accessibilityLabel={t("candidates.remove")} onPress={onRemove} />
      </View>
      <Input k={k} value={candidate.name} placeholder={t("candidates.name", { handle: candidateHandle(candidate.model) })} onChangeText={(name) => onChange({ ...candidate, name })} />
      <Field k={k} label={t("candidates.notesLabel")}>
        <Input k={k} value={candidate.notes} placeholder={t("candidates.notes")} multiline minHeight={72} onChangeText={(notes) => onChange({ ...candidate, notes })} />
      </Field>
    </Card>
  );
}
