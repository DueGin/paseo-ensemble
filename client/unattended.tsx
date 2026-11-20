// The choice to let a team's members work without asking. Off by default: members keep their provider's permission
// prompts. On: they start in their provider's full-access mode and the plugin approves their tool requests. Every way
// of starting a team shows it, so the person starting the team makes the choice before any member starts.
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../shared/color";
import { messages } from "./i18n";
import type { Kit } from "./kit";

export function UnattendedChoice({ k, value, onChange, disabled }: { k: Kit; value: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  const { t } = useTranslation(messages);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={t("unattended.label")}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 11, borderRadius: k.radius, borderWidth: 1, borderColor: value ? withAlpha(k.c.warn, 0.6) : k.c.border, backgroundColor: value ? withAlpha(k.c.warn, 0.08) : k.c.card, opacity: disabled ? 0.55 : 1 }}
    >
      <View style={{ width: 18, height: 18, marginTop: 1, borderRadius: 5, borderWidth: 1.5, borderColor: value ? k.c.warn : k.c.mutedFg, backgroundColor: value ? k.c.warn : "transparent", alignItems: "center", justifyContent: "center" }}>
        {value ? <Icon name="Check" size={12} color={k.c.card} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={k.t.strong}>{t("unattended.label")}</Text>
        <Text style={k.t.muted}>{t(value ? "unattended.on" : "unattended.off")}</Text>
      </View>
      <Icon name={value ? "ShieldAlert" : "ShieldCheck"} size={15} color={value ? k.c.warn : k.c.mutedFg} />
    </Pressable>
  );
}
