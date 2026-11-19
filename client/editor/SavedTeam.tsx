// The team as its file has it (the current-team view): the lead and its roles as a tree, the candidates, and the actions
// that work on the file: Apply again and Reset session.
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import type { Team } from "../../shared/team";
import { Badge, Card, roleTone, Tile, type Kit } from "../kit";
import { useT } from "./common";
import { LinkButton, ProviderMark } from "./controls";

function ModelLine({ k, provider, model, icons }: { k: Kit; provider: string; model: string; icons: ReadonlyMap<string, string | undefined> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
      <ProviderMark k={k} provider={provider} icons={icons} size={20} />
      <Text style={{ color: k.c.mutedFg, fontSize: 12, fontFamily: "Menlo", flexShrink: 1 }} numberOfLines={1}>
        {model}
      </Text>
    </View>
  );
}

/** The lead and its roles: side by side when there is room, stacked when not. */
export function TeamMap({ k, team, icons }: { k: Kit; team: Team; icons: ReadonlyMap<string, string | undefined> }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const stacked = k.compact || width < 560;
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "center", gap: stacked ? 12 : 0 }}>
      <View style={{ gap: 8, minWidth: 0, padding: 10, borderRadius: k.radius, borderWidth: 1, borderColor: k.c.border, borderLeftWidth: 4, borderLeftColor: k.c.primary, backgroundColor: k.c.muted, ...(stacked ? {} : { width: 200 }) }}>
        <Text style={{ color: k.c.primary, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{t("review.orchestrator")}</Text>
        <Text style={{ color: k.c.fg, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
          {team.orchestrator.workspace}
        </Text>
        <ModelLine k={k} provider={team.orchestrator.provider} model={team.orchestrator.model} icons={icons} />
      </View>
      {!stacked && team.roles.length > 0 ? <View style={{ width: 20, height: 2, backgroundColor: k.c.border }} /> : null}
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, marginLeft: stacked ? 12 : 0 }}>
        {team.roles.map((role, index) => (
          <View key={role.name} style={{ flexDirection: "row", alignItems: "stretch" }}>
            <View style={{ width: 18 }}>
              <View style={{ position: "absolute", left: 0, top: index === 0 ? "50%" : 0, bottom: index === team.roles.length - 1 ? "50%" : 0, width: 2, backgroundColor: k.c.border }} />
              <View style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, backgroundColor: k.c.border }} />
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, padding: 8, borderRadius: k.radius, borderWidth: 1, borderColor: k.c.border, backgroundColor: k.c.bg }}>
                <Tile k={k} tone={roleTone(index)} size={22} letter={(role.name[0] ?? "?").toUpperCase()} />
                <Text style={{ color: k.c.fg, fontSize: 13, fontWeight: "700", minWidth: 72, maxWidth: "100%", flexShrink: 1 }} numberOfLines={1}>
                  {role.name}
                </Text>
                <ModelLine k={k} provider={role.provider} model={role.model} icons={icons} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, minWidth: 0, flexShrink: 1 }}>
                  {(role.folders.length ? role.folders.slice(0, 3) : [t("current.noFolderLimit")]).map((folder, at) => (
                    <View key={at} style={{ borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: k.c.muted, maxWidth: "100%" }}>
                      <Text style={{ color: k.c.mutedFg, fontSize: 11, fontFamily: role.folders.length ? "Menlo" : undefined }} numberOfLines={1}>
                        {folder}
                      </Text>
                    </View>
                  ))}
                  {role.folders.length > 3 ? (
                    <View style={{ borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: k.c.muted }}>
                      <Text style={{ color: k.c.mutedFg, fontSize: 11 }}>{t("current.moreFolders", { count: role.folders.length - 3 })}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The saved team's card: its file, whether the editor differs from it, the map, and the actions that use the file. */
export function SavedTeam({ k, team, file, dirty, icons, actions, children }: { k: Kit; team: Team; file: string | null; dirty: boolean; icons: ReadonlyMap<string, string | undefined>; actions: ReactNode; children?: ReactNode }) {
  const { t } = useT();
  const [showMap, setShowMap] = useState(true);
  return (
    <Card k={k} style={{ gap: 12, padding: 14, borderRadius: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Tile k={k} icon="FileCheck" tone={dirty ? k.c.warn : k.c.ok} size={30} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={k.t.h3}>{t("editorUi.savedTeam.title")}</Text>
          {file ? (
            <Text style={{ color: k.c.mutedFg, fontSize: 11.5, fontFamily: "Menlo" }} numberOfLines={1}>
              {file}
            </Text>
          ) : null}
        </View>
        <Badge k={k} icon={dirty ? "CircleDot" : "Check"} tone={dirty ? k.c.warn : k.c.ok} label={dirty ? t("editorUi.savedTeam.changed") : t("editorUi.savedTeam.upToDate")} />
      </View>
      {dirty ? <Text style={k.t.muted}>{t("editorUi.savedTeam.changedHint")}</Text> : null}
      <LinkButton k={k} icon={showMap ? "ChevronUp" : "ChevronDown"} label={showMap ? t("editorUi.savedTeam.hideMap") : t("editorUi.savedTeam.showMap")} onPress={() => setShowMap((value) => !value)} />
      {showMap ? (
        <View style={{ gap: 10 }}>
          <TeamMap k={k} team={team} icons={icons} />
          {team.candidates.length ? (
            <View style={{ gap: 6 }}>
              <Text style={k.t.label}>{t("candidates.title")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {team.candidates.map((candidate) => (
                  <View key={candidate.name} style={{ gap: 4, minWidth: 160, flexShrink: 1, padding: 8, borderRadius: k.radius, borderWidth: 1, borderStyle: "dashed", borderColor: withAlpha(k.c.fg, 0.18), backgroundColor: k.c.bg }}>
                    <Text style={{ color: k.c.fg, fontSize: 12.5, fontWeight: "700", fontFamily: "Menlo" }} numberOfLines={1}>
                      @{candidate.name}
                    </Text>
                    <ModelLine k={k} provider={candidate.provider} model={candidate.model} icons={icons} />
                    {candidate.notes ? (
                      <Text style={{ color: k.c.mutedFg, fontSize: 11.5, lineHeight: 16 }} numberOfLines={3}>
                        {candidate.notes}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{actions}</View>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
        <View style={{ paddingTop: 2 }}>
          <Icon name="Info" size={12} color={k.c.mutedFg} />
        </View>
        <Text style={[k.t.tiny, { flex: 1 }]}>{t("current.restartHint")}</Text>
      </View>
      {children}
    </Card>
  );
}
