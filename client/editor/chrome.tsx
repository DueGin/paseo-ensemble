// The editor's frame: the top bar (crumb, undo/redo, Save, the validation status, Save as preset, Start a session), the
// list of problems behind the status, and the section navigation of wide layouts.
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import type { Team } from "../../shared/team";
import { Badge, type Kit } from "../kit";
import { useT } from "./common";
import { ToolButton } from "./controls";
import { issuePlace, type Check, type SectionId } from "./validate";

export const SECTIONS: readonly { id: SectionId; icon: string }[] = [
  { id: "overview", icon: "FileText" },
  { id: "collab", icon: "Layers" },
  { id: "lead", icon: "Crown" },
  { id: "roles", icon: "Users" },
  { id: "candidates", icon: "Boxes" },
];

/** The bar over the editor: "Team › name" on the left, the actions on the right; it wraps on narrow layouts. */
export function TopBar({ k, title, unsaved, actions }: { k: Kit; title: string; unsaved?: boolean; actions?: ReactNode }) {
  const { t } = useT();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 8, columnGap: 14, minHeight: 52, paddingHorizontal: k.compact ? 12 : 20, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: k.c.border, backgroundColor: k.c.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: k.c.primary }}>
          <Icon name="Users" size={14} color={k.c.primaryFg} />
        </View>
        <Text style={{ color: k.c.mutedFg, fontSize: 13, fontWeight: "600" }}>{t("editorUi.kind")}</Text>
        <Icon name="ChevronRight" size={12} color={withAlpha(k.c.mutedFg, 0.6)} />
        <Text style={{ color: k.c.fg, fontSize: 13, fontWeight: "700", flexShrink: 1 }} numberOfLines={1}>
          {title}
        </Text>
        {unsaved ? <Badge k={k} label={t("editorUi.unsaved")} tone={k.c.warn} /> : null}
      </View>
      {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8, flexGrow: 1 }}>{actions}</View> : null}
    </View>
  );
}

/** Undo and redo, set apart from the other actions by a rule. */
export function UndoRedo({ k, canUndo, canRedo, onUndo, onRedo }: { k: Kit; canUndo: boolean; canRedo: boolean; onUndo(): void; onRedo(): void }) {
  const { t } = useT();
  return (
    <View style={{ flexDirection: "row", gap: 2, paddingRight: 8, borderRightWidth: 1, borderRightColor: k.c.border }}>
      <ToolButton k={k} icon="Undo2" label={t("review.undo")} disabled={!canUndo} onPress={onUndo} />
      <ToolButton k={k} icon="Redo2" label={t("review.redo")} disabled={!canRedo} onPress={onRedo} />
    </View>
  );
}

/** Green "Valid" or red "N problems", with the tips beside; pressing it lists them. */
export function StatusPill({ k, check, onPress }: { k: Kit; check: Check; onPress(): void }) {
  const { t } = useT();
  const tone = check.errors ? k.c.bad : k.c.ok;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("editorUi.checkTitle")}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: withAlpha(tone, 0.38), backgroundColor: withAlpha(tone, pressed ? 0.18 : 0.11) })}
    >
      <Icon name={check.errors ? "CircleAlert" : "Check"} size={13} color={tone} />
      <Text style={{ color: tone, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
        {check.errors ? t("editorUi.problems", { count: check.errors }) : t("editorUi.valid")}
      </Text>
      {check.warnings ? (
        <Text style={{ color: k.c.mutedFg, fontSize: 13, fontWeight: "500", paddingLeft: 7, borderLeftWidth: 1, borderLeftColor: withAlpha(tone, 0.3) }} numberOfLines={1}>
          {t("editorUi.tips", { count: check.warnings })}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Every problem and tip of the draft, problems first; pressing one goes to its field. */
export function IssuesDialog({ k, open, check, team, onClose, onJump }: { k: Kit; open: boolean; check: Check; team: Team; onClose(): void; onJump(field: string): void }) {
  const { t } = useT();
  const sorted = [...check.issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning"));
  return (
    <Modal title={t("editorUi.checkTitle")} open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <Badge k={k} icon={check.errors ? "CircleAlert" : "Check"} tone={check.errors ? k.c.bad : k.c.ok} label={check.errors ? t("editorUi.problems", { count: check.errors }) : t("editorUi.valid")} />
            {check.warnings ? <Badge k={k} icon="Info" tone={k.c.warn} label={t("editorUi.tips", { count: check.warnings })} /> : null}
            {sorted.length ? <Text style={k.t.tiny}>{t("editorUi.checkHint")}</Text> : null}
          </View>
          {sorted.length ? (
            <View style={{ gap: 2 }}>
              {sorted.map((issue, index) => (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  accessibilityLabel={`${issuePlace(team, issue.field, t)}: ${issue.message}`}
                  onPress={() => onJump(issue.field)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: pressed ? k.c.muted : "transparent" })}
                >
                  <View style={{ paddingTop: 2 }}>
                    <Icon name={issue.level === "error" ? "CircleAlert" : "Info"} size={13} color={issue.level === "error" ? k.c.bad : k.c.warn} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text style={{ color: k.c.mutedFg, fontSize: 11, fontWeight: "700", letterSpacing: 0.2 }}>{issuePlace(team, issue.field, t)}</Text>
                    <Text style={{ color: k.c.fg, fontSize: 12.5, lineHeight: 18 }}>{issue.message}</Text>
                  </View>
                  <View style={{ paddingTop: 3 }}>
                    <Icon name="ChevronRight" size={12} color={k.c.mutedFg} />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 8 }}>
              <Icon name="Check" size={14} color={k.c.ok} />
              <Text style={{ color: k.c.ok, fontSize: 13 }}>{t("editorUi.allGood")}</Text>
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** The sections of a wide editor; the one in view is highlighted, a section with problems shows how many. */
export function SectionNav({ k, active, counts, errors, onPick }: { k: Kit; active: SectionId; counts: Partial<Record<SectionId, number>>; errors: Partial<Record<SectionId, number>>; onPick(id: SectionId): void }) {
  const { t } = useT();
  return (
    <View accessibilityLabel={t("editorUi.nav.label")} style={{ gap: 2 }}>
      {SECTIONS.map((section) => {
        const on = active === section.id;
        const bad = errors[section.id] ?? 0;
        const count = counts[section.id];
        return (
          <Pressable
            key={section.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(`editorUi.nav.${section.id}`)}
            onPress={() => onPick(section.id)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 9, height: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: on ? withAlpha(k.c.primary, 0.13) : pressed ? k.c.muted : "transparent" })}
          >
            <Icon name={section.icon} size={14} color={on ? k.c.primary : k.c.mutedFg} />
            <Text style={{ flex: 1, color: on ? k.c.fg : k.c.mutedFg, fontSize: 13, fontWeight: on ? "700" : "500" }} numberOfLines={1}>
              {t(`editorUi.nav.${section.id}`)}
            </Text>
            {bad ? (
              <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: withAlpha(k.c.bad, 0.18), alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: k.c.bad, fontSize: 11, fontWeight: "700" }}>{bad}</Text>
              </View>
            ) : count !== undefined ? (
              <Text style={{ color: k.c.mutedFg, fontSize: 11 }}>{count}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
