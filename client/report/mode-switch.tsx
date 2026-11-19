// The collaboration mode of a lead's session, on top of its report: Auto, Team, Delegation or None, with a lock once auto
// has settled on a mode for the session, and a line on what the current mode does.
import { useState } from "react";
import { Text, View } from "react-native";
import { TEAM_MODES, type CollabMode, type TeamMode } from "../../shared/modes";
import { Badge, Callout, Card, MODE_LOOK, Segmented, Spinner, Tile, type Kit } from "../kit";
import type { Tr } from "./common";

export function ModeSwitch({ k, t, effective, locked, override, busy, error, onSwitch }: { k: Kit; t: Tr; effective: TeamMode; locked: CollabMode | null; override: TeamMode | null; busy: boolean; error: string | null; onSwitch(mode: TeamMode): void }) {
  const look = MODE_LOOK[effective];
  // A narrow panel (the sidebar) stretches the switch over its width and keeps the labels without icons.
  const [width, setWidth] = useState(0);
  const narrow = k.compact || (width > 0 && width < 460);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <Card k={k} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Tile k={k} icon={look.icon} tone={look.tone} size={26} />
          <Text style={k.t.strong}>{t("mode.label")}</Text>
        </View>
        <View style={narrow ? { width: "100%" } : undefined}>
          <Segmented
            k={k}
            value={effective}
            stretch={narrow}
            disabled={locked !== null}
            // Icons only when there is room: a narrow sidebar keeps the four labels.
            options={TEAM_MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`), ...(narrow ? {} : { icon: MODE_LOOK[mode].icon }) }))}
            onChange={(mode) => {
              if (!busy && locked === null && mode !== effective) onSwitch(mode);
            }}
          />
        </View>
        {locked ? <Badge k={k} tone={k.c.warn} icon="Lock" label={t("reportUi.locked")} /> : override === null ? <Text style={k.t.tiny}>{t("mode.fromFile")}</Text> : null}
        {busy ? <Spinner k={k} /> : null}
      </View>
      <Text style={k.t.muted}>{locked ? t("mode.lockedHint", { mode: t(`mode.${locked}`) }) : t(`mode.${effective}Hint`)}</Text>
      {error ? (
        <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
          <Text style={{ color: k.c.bad, fontSize: 12 }}>{t("mode.switchFailed", { error })}</Text>
        </Callout>
      ) : null}
    </Card>
    </View>
  );
}
