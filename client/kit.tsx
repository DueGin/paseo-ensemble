// The plugin's design kit: the look of Ensemble for Orca, in React Native and Paseo's theme. Every surface (the team
// editor, the session report, the side panel, the teams screen, the cards in a lead's chat) builds from these, so they
// read as one product. Colors come from the theme: cards are surface1, insets surface2, the primary color is the
// theme's accent, states use its status colors; the per-part colors (brief, tasks, …) and role tones are fixed hues
// that read on light and dark themes alike.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { withAlpha } from "../shared/color";

/** The kit for one theme and layout: the colors and the shared styles. Make it once per surface with `useKit`. */
export interface Kit {
  compact: boolean;
  c: {
    bg: string;
    card: string;
    muted: string;
    border: string;
    fg: string;
    mutedFg: string;
    primary: string;
    primaryFg: string;
    ok: string;
    warn: string;
    bad: string;
    info: string;
  };
  t: {
    h1: TextStyle;
    h2: TextStyle;
    h3: TextStyle;
    body: TextStyle;
    small: TextStyle;
    tiny: TextStyle;
    muted: TextStyle;
    label: TextStyle;
    mono: TextStyle;
    strong: TextStyle;
  };
  radius: number;
}

export function makeKit(theme: PluginTheme, compact: boolean): Kit {
  const colors = theme.colors;
  const c = {
    bg: colors.surface0,
    card: colors.surface1,
    muted: colors.surface2,
    border: colors.border,
    fg: colors.foreground,
    mutedFg: colors.foregroundMuted,
    primary: colors.accent,
    primaryFg: colors.accentForeground,
    ok: colors.statusSuccess,
    warn: colors.statusWarning,
    bad: colors.statusDanger,
    info: "#3e8ef7",
  };
  const mono = { fontFamily: "Menlo", fontSize: 12 } as const;
  return {
    compact,
    c,
    radius: 10,
    t: {
      h1: { color: c.fg, fontSize: compact ? 20 : 24, fontWeight: "700", letterSpacing: -0.2 },
      h2: { color: c.fg, fontSize: 15, fontWeight: "700" },
      h3: { color: c.fg, fontSize: 13, fontWeight: "600" },
      body: { color: c.fg, fontSize: 13, lineHeight: 19 },
      small: { color: c.fg, fontSize: 12, lineHeight: 17 },
      tiny: { color: c.mutedFg, fontSize: 11, lineHeight: 15 },
      muted: { color: c.mutedFg, fontSize: 12, lineHeight: 17 },
      label: { color: c.mutedFg, fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
      mono: { ...mono, color: c.fg },
      strong: { color: c.fg, fontSize: 13, fontWeight: "600" },
    },
  };
}

export function useKit(theme: PluginTheme, compact: boolean): Kit {
  return useMemo(() => makeKit(theme, compact), [theme, compact]);
}

// ----- Fixed hues

/** The parts of a collaboration mode, as the session report colors them. */
export const PART = {
  brief: "#a78bfa",
  tasks: "#60a5fa",
  plans: "#f5a524",
  board: "#34d399",
  claims: "#f472b6",
  split: "#818cf8",
  contexts: "#84cc16",
  reports: "#22d3ee",
  summary: "#e879f9",
} as const;

/** The modes' colors and icons (Lucide names). */
export const MODE_LOOK = {
  auto: { tone: "#e879f9", icon: "Sparkles" },
  team: { tone: "#34d399", icon: "Users" },
  delegation: { tone: "#818cf8", icon: "Split" },
  none: { tone: "#94a3b8", icon: "Bot" },
} as const;

/** Colors for roles and members, by their order in the team. */
export const ROLE_TONES = ["#60a5fa", "#34d399", "#f5a524", "#f472b6", "#a78bfa", "#22d3ee", "#818cf8", "#84cc16"] as const;
export const roleTone = (index: number): string => ROLE_TONES[((index % ROLE_TONES.length) + ROLE_TONES.length) % ROLE_TONES.length]!;

/** A member's or run's state as a color: working, needs attention, done, failed, idle. */
export function stateTone(k: Kit, state: string): string {
  if (/attention|blocked|waiting|pending/i.test(state)) return k.c.warn;
  if (/fail|error/i.test(state)) return k.c.bad;
  if (/work|running|active|live/i.test(state)) return k.c.primary;
  if (/done|complete|succeed|idle|ready/i.test(state)) return k.c.ok;
  return k.c.mutedFg;
}

// ----- Text

export function T({ k, v = "body", style, numberOfLines, children, selectable }: { k: Kit; v?: keyof Kit["t"]; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean; children: ReactNode }) {
  return (
    <Text style={[k.t[v], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  );
}

// ----- Surfaces

/** A card: the theme's raised surface with a border. `tone` draws a colored edge on its left; `onPress` makes it a button. */
export function Card({ k, children, tone, inset, onPress, selected, style, label }: { k: Kit; children: ReactNode; tone?: string; inset?: boolean; onPress?: () => void; selected?: boolean; style?: StyleProp<ViewStyle>; label?: string }) {
  const base: ViewStyle = {
    backgroundColor: inset ? k.c.muted : k.c.card,
    borderWidth: 1,
    borderColor: selected ? k.c.primary : inset ? "transparent" : k.c.border,
    borderRadius: k.radius,
    padding: 12,
    gap: 6,
    minWidth: 0,
    ...(tone ? { borderLeftWidth: 3, borderLeftColor: tone } : {}),
    ...(selected ? { backgroundColor: withAlpha(k.c.primary, 0.08) } : {}),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [base, pressed ? { opacity: 0.85 } : null, style]}>
      {children}
    </Pressable>
  );
}

/** An icon on a tinted square, the kit's mark for a section, a part or a member. */
export function Tile({ k, icon, tone, size = 26, letter }: { k: Kit; icon?: string; tone?: string; size?: number; letter?: string }) {
  const color = tone ?? k.c.primary;
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), backgroundColor: withAlpha(color, 0.18), alignItems: "center", justifyContent: "center" }}>
      {letter ? <Text style={{ color, fontSize: Math.round(size * 0.5), fontWeight: "700" }}>{letter}</Text> : <Icon name={icon ?? "Circle"} size={Math.round(size * 0.58)} color={color} />}
    </View>
  );
}

/** A small tinted pill: a mode, a state, a count. */
export function Badge({ k, label, tone, icon }: { k: Kit; label: ReactNode; tone?: string; icon?: string }) {
  const color = tone ?? k.c.mutedFg;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 999, backgroundColor: withAlpha(color, 0.16), alignSelf: "flex-start" }}>
      {icon ? <Icon name={icon} size={11} color={color} /> : null}
      <Text style={{ color, fontSize: 11, fontWeight: "600" }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A status dot; `live` pulses. */
export function Dot({ tone, live, size = 8 }: { tone: string; live?: boolean; size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: false }), Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: false })]));
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tone, opacity: live ? pulse : 1 }} />;
}

/** A tinted note: info, a warning, an error. */
export function Callout({ k, tone, icon, children }: { k: Kit; tone?: string; icon?: string; children: ReactNode }) {
  const color = tone ?? k.c.primary;
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: k.radius, borderWidth: 1, borderColor: withAlpha(color, 0.45), backgroundColor: withAlpha(color, 0.1) }}>
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

/** A section's head: its tile, title, one line on what it is for, and an action on the right. */
export function SectionHeader({ k, icon, tone, title, subtitle, count, right }: { k: Kit; icon: string; tone?: string; title: string; subtitle?: string; count?: number; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <Tile k={k} icon={icon} tone={tone} size={32} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T k={k} v="h2">
            {title}
          </T>
          {count !== undefined ? <Badge k={k} label={String(count)} /> : null}
        </View>
        {subtitle ? <T k={k} v="muted">{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

/** A labelled number: the session report's header figures. */
export function StatTile({ k, label, value, hint, tone, progress }: { k: Kit; label: string; value: string; hint?: string; tone?: string; progress?: number }) {
  return (
    <View style={{ flex: 1, minWidth: 120, gap: 4, padding: 12, borderRadius: k.radius, backgroundColor: k.c.muted }}>
      <T k={k} v="label">
        {label}
      </T>
      <Text style={{ color: k.c.fg, fontSize: 20, fontWeight: "700" }} numberOfLines={1}>
        {value}
      </Text>
      {progress !== undefined ? <Progress k={k} value={progress} tone={tone} /> : null}
      {hint ? <T k={k} v="tiny">{hint}</T> : null}
    </View>
  );
}

export function Progress({ k, value, tone }: { k: Kit; value: number; tone?: string }) {
  const width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` as const;
  return (
    <View style={{ height: 4, borderRadius: 4, backgroundColor: withAlpha(k.c.mutedFg, 0.2), overflow: "hidden" }}>
      <View style={{ height: 4, width, backgroundColor: tone ?? k.c.primary }} />
    </View>
  );
}

export function Empty({ k, icon, children }: { k: Kit; icon?: string; children: ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 22, paddingHorizontal: 12 }}>
      {icon ? <Icon name={icon} size={20} color={k.c.mutedFg} /> : null}
      <T k={k} v="muted" style={{ textAlign: "center" }}>
        {children}
      </T>
    </View>
  );
}

export function Spinner({ k }: { k: Kit }) {
  return <ActivityIndicator size="small" color={k.c.primary} />;
}

export function Separator({ k }: { k: Kit }) {
  return <View style={{ height: 1, backgroundColor: k.c.border, marginVertical: 4 }} />;
}

/** A key cap, for shortcuts. */
export function Kbd({ k, children }: { k: Kit; children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: k.c.border, backgroundColor: k.c.muted }}>
      <Text style={{ color: k.c.mutedFg, fontSize: 11, fontFamily: "Menlo" }}>{children}</Text>
    </View>
  );
}

// ----- Controls

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ k, label, icon, variant = "secondary", size = "md", onPress, disabled, block, busy, accessibilityLabel }: { k: Kit; label?: string; icon?: string; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; onPress(): void; disabled?: boolean; block?: boolean; busy?: boolean; accessibilityLabel?: string }) {
  const height = size === "sm" ? 26 : size === "lg" ? 36 : 30;
  const fg = variant === "primary" ? k.c.primaryFg : variant === "danger" ? k.c.bad : k.c.fg;
  const bg = variant === "primary" ? k.c.primary : variant === "ghost" ? "transparent" : k.c.muted;
  const border = variant === "primary" || variant === "ghost" ? "transparent" : k.c.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height,
        minWidth: label ? undefined : height,
        paddingHorizontal: label ? (size === "sm" ? 9 : size === "lg" ? 16 : 12) : 0,
        borderRadius: k.radius - 2,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: pressed && variant !== "primary" ? withAlpha(k.c.fg, 0.08) : bg,
        opacity: disabled ? 0.5 : pressed ? 0.88 : 1,
        alignSelf: block ? "stretch" : "flex-start",
      })}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={size === "sm" ? 13 : 14} color={fg} /> : null}
      {label ? (
        <Text style={{ color: fg, fontSize: size === "sm" ? 12 : size === "lg" ? 14 : 13, fontWeight: "600" }} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A segmented control: one of a few choices, on a muted track. `equal` (with `stretch`) gives every option the same width, for a tab bar. */
export function Segmented<V extends string>({ k, value, options, onChange, stretch, equal, disabled }: { k: Kit; value: V; options: readonly { value: V; label: string; icon?: string }[]; onChange(value: V): void; stretch?: boolean; equal?: boolean; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", padding: 2, gap: 2, borderRadius: k.radius, backgroundColor: k.c.muted, borderWidth: 1, borderColor: k.c.border, alignSelf: stretch ? "stretch" : "flex-start" }}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            // Stretched (a narrow panel): options share the spare width on top of their own, so a long label keeps its
            // room, and they shorten only when the labels don't fit at all.
            style={{ flexGrow: stretch ? 1 : undefined, flexShrink: stretch ? 1 : undefined, flexBasis: stretch && equal ? 0 : "auto", minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: stretch ? 4 : 10, paddingVertical: 5, borderRadius: k.radius - 3, backgroundColor: on ? k.c.card : "transparent", opacity: disabled && !on ? 0.55 : 1 }}
          >
            {option.icon ? <Icon name={option.icon} size={13} color={on ? k.c.fg : k.c.mutedFg} /> : null}
            <Text style={{ color: on ? k.c.fg : k.c.mutedFg, fontSize: 12, fontWeight: on ? "600" : "500", flexShrink: 1 }} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Underlined tabs with an optional icon, count and dot each; scrolls sideways when narrow (wrap it in a horizontal ScrollView). */
export function Tabs<V extends string>({ k, value, tabs, onChange }: { k: Kit; value: V; tabs: readonly { value: V; label: string; icon?: string; count?: number | null; tone?: string; dot?: boolean }[]; onChange(value: V): void }) {
  return (
    <View style={{ flexDirection: "row", gap: 2, borderBottomWidth: 1, borderBottomColor: k.c.border }}>
      {tabs.map((tab) => {
        const on = tab.value === value;
        return (
          <Pressable key={tab.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(tab.value)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: on ? (tab.tone ?? k.c.primary) : "transparent", marginBottom: -1 }}>
            {tab.icon ? <Icon name={tab.icon} size={14} color={on ? (tab.tone ?? k.c.fg) : k.c.mutedFg} /> : null}
            <Text style={{ color: on ? k.c.fg : k.c.mutedFg, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
              {tab.label}
            </Text>
            {tab.count !== undefined && tab.count !== null ? <Badge k={k} label={String(tab.count)} tone={on ? tab.tone : undefined} /> : null}
            {tab.dot ? <Dot tone={tab.tone ?? k.c.warn} live /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small pill toggle, for filters and data-flow parties. */
export function Chip({ k, label, on, tone, onPress, icon }: { k: Kit; label: string; on?: boolean; tone?: string; onPress?: () => void; icon?: string }) {
  const color = tone ?? k.c.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} disabled={!onPress} style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: on ? color : k.c.border, backgroundColor: on ? withAlpha(color, 0.16) : k.c.card }}>
      {icon ? <Icon name={icon} size={12} color={on ? color : k.c.mutedFg} /> : null}
      <Text style={{ color: k.c.fg, fontSize: 12, fontWeight: on ? "600" : "500" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A labelled field: label above, hint below. */
export function Field({ k, label, hint, children, style }: { k: Kit; label: string; hint?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 4, minWidth: 0 }, style]}>
      <T k={k} v="label">
        {label}
      </T>
      {children}
      {hint ? <T k={k} v="tiny">{hint}</T> : null}
    </View>
  );
}

/** A text input in the kit's style; `multiline` grows with its text. */
export function Input({ k, value, onChangeText, placeholder, multiline, mono, invalid, autoFocus, accessibilityLabel, onSubmitEditing, minHeight, editable = true, big }: { k: Kit; value: string; onChangeText(value: string): void; placeholder?: string; multiline?: boolean; mono?: boolean; invalid?: boolean; autoFocus?: boolean; accessibilityLabel?: string; onSubmitEditing?: () => void; minHeight?: number; editable?: boolean; big?: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={withAlpha(k.c.mutedFg, 0.8)}
      multiline={multiline}
      autoFocus={autoFocus}
      editable={editable}
      accessibilityLabel={accessibilityLabel ?? placeholder}
      onSubmitEditing={onSubmitEditing}
      style={{
        color: k.c.fg,
        fontSize: big ? 22 : 13,
        fontWeight: big ? "700" : "400",
        ...(mono ? { fontFamily: "Menlo", fontSize: 12 } : {}),
        borderWidth: big ? 0 : 1,
        borderColor: invalid ? k.c.bad : k.c.border,
        backgroundColor: big ? "transparent" : k.c.bg,
        borderRadius: k.radius - 2,
        paddingHorizontal: big ? 0 : 9,
        paddingVertical: big ? 2 : 6,
        minHeight: multiline ? (minHeight ?? 64) : undefined,
        textAlignVertical: multiline ? "top" : "center",
      }}
    />
  );
}
