// Starts a session with the team as it is in the editor: the user's request (optional), where the lead runs (this
// workspace, or a new workspace of the project), the mode for this session and the agents' language.
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import { TEAM_MODES, type TeamMode } from "../../shared/modes";
import { taskWorkspaceTitle } from "../../shared/presets";
import type { Team } from "../../shared/team";
import { Button, Callout, Segmented, type Kit } from "../kit";
import { useT } from "./common";
import { UnattendedChoice } from "../unattended";
import { Slot, TextField } from "./controls";
import { languageOptions, Radio, type LanguageChoice } from "./sections";
import type { Check } from "./validate";

export type Where = "here" | "new";

export interface StartChoice {
  request: string;
  where: Where;
  /** The new workspace's title; empty: taken from the request. */
  title: string;
  mode: TeamMode;
  language: LanguageChoice;
  /** The person lets members work without asking. */
  unattended: boolean;
}

function WhereOption({ k, icon, title, sub, on, onPress }: { k: Kit; icon: string; title: string; sub: string; on: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      onPress={onPress}
      style={{ flexGrow: 1, flexBasis: 220, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: on ? 9 : 10, paddingHorizontal: on ? 11 : 12, borderRadius: 10, borderWidth: on ? 2 : 1, borderColor: on ? k.c.primary : k.c.border, backgroundColor: on ? withAlpha(k.c.primary, 0.06) : k.c.card, minWidth: 0 }}
    >
      <Icon name={icon} size={15} color={on ? k.c.primary : k.c.mutedFg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: k.c.fg, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: k.c.mutedFg, fontSize: 11.5 }} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      <Radio k={k} on={on} />
    </Pressable>
  );
}

export function StartDialog({ k, open, team, check, here, project, toolsOff, busy, errors, onClose, onStart }: { k: Kit; open: boolean; team: Team; check: Check; here: string | null; project: string; toolsOff: boolean; busy: boolean; errors: readonly string[]; onClose(): void; onStart(choice: StartChoice): void }) {
  const { t } = useT();
  const [request, setRequest] = useState("");
  const [where, setWhere] = useState<Where>("here");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<TeamMode>(team.mode);
  const [language, setLanguage] = useState<LanguageChoice>(team.language ?? "auto");
  // Off every time the dialog opens: members work without asking only when the person ticks it for this start.
  const [unattended, setUnattended] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRequest("");
    setWhere("here");
    setTitle("");
    setMode(team.mode);
    setLanguage(team.language ?? "auto");
    setUnattended(false);
  }, [open]);
  const name = team.orchestrator.workspace.trim() || t("editorUi.untitled");
  // Like Apply before it, a team with any problem (schema, provider catalog, another team's workspace) doesn't start.
  const ready = !!check.team && check.errors === 0 && !busy && !toolsOff;
  const start = () => {
    if (ready) onStart({ request, where, title, mode, language, unattended });
  };
  return (
    <Modal title={t("editorUi.start")} open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Modal.Content>
        <View style={{ gap: 16 }}>
          <Text style={k.t.muted}>{t("editorUi.startModal.subtitle", { team: name })}</Text>
          {check.errors ? (
            <Callout k={k} tone={k.c.bad} icon="CircleAlert">
              <Text style={k.t.small}>{t("editorUi.startModal.invalid", { count: check.errors })}</Text>
            </Callout>
          ) : null}
          {toolsOff ? (
            <Callout k={k} tone={k.c.warn} icon="TriangleAlert">
              <Text style={k.t.small}>{t("toolsOff")}</Text>
            </Callout>
          ) : null}

          <Slot k={k} label={t("editorUi.startModal.request")}>
            <TextField k={k} multiline minHeight={96} autoFocus value={request} placeholder={t("editorUi.startModal.requestPlaceholder")} onChangeText={setRequest} />
          </Slot>

          <Slot k={k} label={t("editorUi.startModal.where")}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <WhereOption
                k={k}
                icon="Monitor"
                title={here !== null ? t("editorUi.startModal.here") : t("editorUi.startModal.named", { workspace: name })}
                sub={here !== null ? here : t("editorUi.startModal.namedSub")}
                on={where === "here"}
                onPress={() => setWhere("here")}
              />
              <WhereOption k={k} icon="FolderPlus" title={t("editorUi.startModal.newWorkspace")} sub={t("editorUi.startModal.newWorkspaceSub", { project })} on={where === "new"} onPress={() => setWhere("new")} />
            </View>
          </Slot>
          {where === "new" ? (
            <Slot k={k} label={t("editorUi.startModal.workspaceTitle")}>
              <TextField k={k} value={title} placeholder={t("editorUi.startModal.workspaceTitlePlaceholder", { title: taskWorkspaceTitle(request, name) })} onChangeText={setTitle} />
            </Slot>
          ) : null}

          <Slot k={k} label={t("editorUi.startModal.mode")}>
            <Segmented<TeamMode> k={k} stretch value={mode} options={TEAM_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))} onChange={setMode} />
          </Slot>
          <Slot k={k} label={t("editorUi.startModal.language")} hint={t("editorUi.startModal.languageNote")}>
            <Segmented<LanguageChoice> k={k} stretch value={language} options={languageOptions(t)} onChange={setLanguage} />
          </Slot>
          <UnattendedChoice k={k} value={unattended} onChange={setUnattended} />

          {errors.length ? (
            <Callout k={k} tone={k.c.bad} icon="CircleAlert">
              <View style={{ gap: 3 }}>
                {errors.map((error) => (
                  <Text key={error} style={k.t.small}>
                    {t("editorUi.startModal.failed", { error })}
                  </Text>
                ))}
              </View>
            </Callout>
          ) : null}

          <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: k.c.border }}>
            <Button k={k} label={t("review.cancel")} disabled={busy} onPress={onClose} />
            <Button k={k} variant="primary" icon="Play" label={t("editorUi.startModal.go")} busy={busy} disabled={!ready} onPress={start} />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
