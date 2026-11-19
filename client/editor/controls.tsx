// Inputs the team editor is built from, on top of the kit: a select that opens the searchable picker, the provider/model
// pair, folder chips, text fields with an invalid state, card tools, a measured grid, and the per-field problems with
// anchors the status list scrolls to.
import { Icon } from "@getpaseo/plugin/client/ui";
import { Children, createContext, forwardRef, useContext, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { withAlpha } from "../../shared/color";
import { providerIcon } from "../../shared/provider-icons";
import type { ProviderInfo } from "../../shared/validate";
import type { Kit } from "../kit";
import { useT } from "./common";
import { useSelect, type PickerLook } from "./picker";
import type { Issue } from "./validate";

// ----- Problems and anchors

/** The problems per field, for every input below the editor. */
export const IssuesContext = createContext<(field: string) => Issue[]>(() => []);

export function useIssues(field: string): Issue[] {
  return useContext(IssuesContext)(field);
}

export const hasError = (issues: readonly Issue[]) => issues.some((issue) => issue.level === "error");

export function FieldIssues({ k, field }: { k: Kit; field: string }) {
  const issues = useIssues(field);
  if (!issues.length) return null;
  return (
    <View style={{ gap: 3 }}>
      {issues.map((issue, index) => {
        const tone = issue.level === "error" ? k.c.bad : k.c.warn;
        return (
          <View key={index} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
            <View style={{ paddingTop: 2 }}>
              <Icon name={issue.level === "error" ? "CircleAlert" : "Info"} size={12} color={tone} />
            </View>
            <Text style={{ color: tone, fontSize: 12, lineHeight: 17, flex: 1 }}>{issue.message}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Where the status list can scroll to: each anchor registers its view by field, and the one jumped to flashes. */
export const AnchorContext = createContext<{ register(field: string, node: View | null): void; flash: string | null; warn: string }>({ register: () => {}, flash: null, warn: "#e5a50a" });

export function Anchor({ field, children, style }: { field: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const anchors = useContext(AnchorContext);
  return (
    <View ref={(node) => anchors.register(field, node)} collapsable={false} style={style}>
      {children}
      {anchors.flash === field ? <View pointerEvents="none" style={{ position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderRadius: 12, borderWidth: 2, borderColor: withAlpha(anchors.warn, 0.75), backgroundColor: withAlpha(anchors.warn, 0.06) }} /> : null}
    </View>
  );
}

/** A labelled field that the problem list can jump to: label (and an action on its right), the input, its problems, a hint. */
export function Slot({ k, field, label, hint, aside, children, style }: { k: Kit; field?: string; label?: string; hint?: string; aside?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const body = (
    <View style={{ gap: 5, minWidth: 0 }}>
      {label || aside ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 16 }}>
          {label ? <Text style={k.t.label}>{label}</Text> : <View />}
          {aside}
        </View>
      ) : null}
      {children}
      {field ? <FieldIssues k={k} field={field} /> : null}
      {hint ? <Text style={{ color: k.c.mutedFg, fontSize: 11.5, lineHeight: 16 }}>{hint}</Text> : null}
    </View>
  );
  return field ? <Anchor field={field} style={[{ minWidth: 0 }, style]}>{body}</Anchor> : <View style={[{ minWidth: 0 }, style]}>{body}</View>;
}

// ----- Inputs

type FieldVariant = "box" | "bare" | "title" | "hero";

/** A text input: boxed, or borderless until focused (`bare`, the card names' `title`, the overview's `hero`). */
export const TextField = forwardRef<TextInput, Omit<TextInputProps, "style"> & { k: Kit; mono?: boolean; invalid?: boolean; minHeight?: number; variant?: FieldVariant; style?: StyleProp<TextStyle> }>(function TextField({ k, mono, invalid, minHeight, variant = "box", style, multiline, onFocus, onBlur, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  const boxed = variant === "box";
  const size = variant === "hero" ? (k.compact ? 22 : 28) : variant === "title" ? 14 : mono ? 12.5 : 13;
  const border = invalid ? k.c.bad : focused ? k.c.primary : boxed ? k.c.border : "transparent";
  const base: TextStyle = {
    color: k.c.fg,
    fontSize: size,
    fontWeight: variant === "hero" ? "800" : variant === "title" ? "600" : "400",
    letterSpacing: variant === "hero" ? -0.4 : undefined,
    ...(mono ? { fontFamily: "Menlo" } : {}),
    borderWidth: 1,
    borderColor: border,
    backgroundColor: boxed || focused ? k.c.bg : invalid ? withAlpha(k.c.bad, 0.06) : "transparent",
    borderRadius: variant === "hero" ? 9 : 8,
    paddingHorizontal: variant === "hero" ? 9 : variant === "box" ? 10 : 8,
    paddingVertical: multiline ? 8 : variant === "hero" ? 3 : 6,
    minHeight: multiline ? (minHeight ?? 64) : variant === "title" ? 32 : undefined,
    lineHeight: multiline ? 19 : undefined,
    textAlignVertical: multiline ? "top" : "center",
  };
  return (
    <TextInput
      ref={ref}
      multiline={multiline}
      placeholderTextColor={withAlpha(k.c.mutedFg, 0.8)}
      autoCorrect={false}
      spellCheck={false}
      {...rest}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[base, style]}
    />
  );
});

/** The kit's look for the searchable picker. */
export function kitPickerLook(k: Kit): PickerLook {
  return {
    input: { color: k.c.fg, fontSize: 13, borderWidth: 1, borderColor: k.c.border, backgroundColor: k.c.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
    placeholderColor: withAlpha(k.c.mutedFg, 0.8),
    muted: k.t.muted,
    row: (selected, focused) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 7, borderWidth: 1, borderColor: focused ? k.c.border : "transparent", backgroundColor: focused ? k.c.muted : selected ? withAlpha(k.c.primary, 0.08) : "transparent" }),
    rowText: (selected) => ({ color: selected ? k.c.primary : k.c.fg, fontFamily: "Menlo", fontSize: 12.5, fontWeight: selected ? "600" : "400", flexShrink: 1 }),
    check: (selected) => (selected ? <Icon name="Check" size={13} color={k.c.primary} /> : null),
  };
}

/** A select in the editor's style; pressing it opens the searchable picker of the nearest host. */
export function SelectField({ k, label, value, options, onChange, invalid, leading, placeholder }: { k: Kit; label: string; value: string; options: readonly string[]; onChange(value: string): void; invalid?: boolean; leading?: ReactNode; placeholder?: string }) {
  const openSelect = useSelect();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value || placeholder || ""}`}
      onPress={() => openSelect({ label, options, value, onChange })}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, height: 32, paddingLeft: 10, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: invalid ? k.c.bad : k.c.border, backgroundColor: pressed ? k.c.muted : k.c.bg, minWidth: 0 })}
    >
      {leading}
      <Text style={{ flex: 1, color: value ? k.c.fg : k.c.mutedFg, fontFamily: "Menlo", fontSize: 12.5 }} numberOfLines={1}>
        {value || placeholder || "—"}
      </Text>
      <Icon name="ChevronDown" size={13} color={k.c.mutedFg} />
    </Pressable>
  );
}

/** A provider's mark: its logo, else its initial. */
export function ProviderMark({ k, provider, icons, size = 18 }: { k: Kit; provider: string; icons: ReadonlyMap<string, string | undefined>; size?: number }) {
  const icon = providerIcon(provider, icons.get(provider));
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: k.c.muted, alignItems: "center", justifyContent: "center" }}>
      {icon.kind === "svg" ? <Icon icon={{ svg: icon.svg }} size={Math.round(size * 0.62)} color={k.c.fg} /> : <Text style={{ color: k.c.fg, fontWeight: "700", fontSize: Math.round(size * 0.55) }}>{icon.letter}</Text>}
    </View>
  );
}

/** Provider and model, limited to what this host can run; a provider change picks its first model. */
export function RuntimeEditor({ k, catalog, icons, provider, model, field, onChange }: { k: Kit; catalog: readonly ProviderInfo[]; icons: ReadonlyMap<string, string | undefined>; provider: string; model: string; field: string; onChange(next: { provider: string; model: string }, group: string): void }) {
  const { t } = useT();
  const ready = catalog.filter((entry) => entry.ready);
  const models = ready.find((entry) => entry.id === provider)?.models.map((entry) => entry.id) ?? [];
  const providerIssues = useIssues(`${field}.provider`);
  const modelIssues = useIssues(`${field}.model`);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Slot k={k} field={`${field}.provider`} label={t("editorUi.runtime.provider")} style={{ flexGrow: 1, flexBasis: 140 }}>
        <SelectField
          k={k}
          label={t("editorUi.runtime.provider")}
          value={provider}
          placeholder={t("editorUi.runtime.pick")}
          options={ready.map((entry) => entry.id)}
          invalid={hasError(providerIssues)}
          leading={provider ? <ProviderMark k={k} provider={provider} icons={icons} /> : null}
          onChange={(next) => {
            if (next !== provider) onChange({ provider: next, model: ready.find((entry) => entry.id === next)?.models[0]?.id ?? "" }, `${field}.provider`);
          }}
        />
      </Slot>
      <Slot k={k} field={`${field}.model`} label={t("editorUi.runtime.model")} style={{ flexGrow: 1.4, flexBasis: 180 }}>
        <SelectField k={k} label={t("editorUi.runtime.model")} value={model} placeholder={t("editorUi.runtime.pick")} options={models} invalid={hasError(modelIssues)} onChange={(next) => onChange({ provider, model: next }, `${field}.model`)} />
      </Slot>
    </View>
  );
}

/** Folders as removable chips, with an input that adds on Enter or a comma. */
export function FolderChips({ k, folders, onChange, invalid, tone }: { k: Kit; folders: readonly string[]; onChange(folders: string[]): void; invalid?: boolean; tone?: string }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const color = tone ?? k.c.primary;
  const add = (raw: string) => {
    const parts = raw.split(/[,，\n]/).map((part) => part.trim()).filter(Boolean);
    const next = [...folders];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    if (next.length !== folders.length) onChange(next);
    setText("");
  };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, minHeight: 34, paddingVertical: 4, paddingHorizontal: 6, borderWidth: 1, borderColor: invalid ? k.c.bad : focused ? k.c.primary : k.c.border, borderRadius: 8, backgroundColor: k.c.bg }}>
      {folders.map((folder, index) => (
        <View key={`${folder}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingLeft: 8, paddingRight: 3, borderRadius: 6, maxWidth: "100%", backgroundColor: withAlpha(color, 0.11), borderWidth: 1, borderColor: withAlpha(color, 0.26) }}>
          <Icon name="Folder" size={12} color={color} />
          <Text style={{ color: k.c.fg, fontFamily: "Menlo", fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
            {folder}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("editorUi.role.removeFolder", { folder })} hitSlop={4} onPress={() => onChange(folders.filter((_, at) => at !== index))} style={({ pressed }) => ({ width: 18, height: 18, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? withAlpha(k.c.bad, 0.15) : "transparent" })}>
            <Icon name="X" size={11} color={k.c.mutedFg} />
          </Pressable>
        </View>
      ))}
      <TextInput
        value={text}
        placeholder={folders.length ? t("editorUi.role.folderMore") : t("editorUi.role.folderPlaceholder")}
        placeholderTextColor={withAlpha(k.c.mutedFg, 0.8)}
        accessibilityLabel={t("editorUi.role.folders")}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        submitBehavior="submit"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (text.trim()) add(text);
        }}
        onChangeText={(value) => {
          if (/[,，\n]/.test(value)) add(value);
          else setText(value);
        }}
        onSubmitEditing={() => add(text)}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Backspace" && !text && folders.length) onChange(folders.slice(0, -1));
        }}
        style={{ flexGrow: 1, flexBasis: 140, minWidth: 0, height: 24, paddingHorizontal: 4, paddingVertical: 0, color: k.c.fg, fontFamily: "Menlo", fontSize: 12.5 }}
      />
    </View>
  );
}

// ----- Buttons

/** A small icon button for card tools and undo/redo. */
export function ToolButton({ k, icon, label, onPress, danger, disabled }: { k: Kit; icon: string; label: string; onPress(): void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={3}
      style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? (danger ? withAlpha(k.c.bad, 0.13) : k.c.muted) : "transparent", opacity: disabled ? 0.35 : 1 })}
    >
      <Icon name={icon} size={14} color={danger ? withAlpha(k.c.bad, 0.85) : k.c.mutedFg} />
    </Pressable>
  );
}

/** A text action in the primary color, for a field's corner. */
export function LinkButton({ k, icon, label, onPress, disabled }: { k: Kit; icon?: string; label: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}>
      {icon ? <Icon name={icon} size={12} color={k.c.primary} /> : null}
      <Text style={{ color: k.c.primary, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** A dashed full-width button under a list of cards. */
export function AddCard({ k, label, onPress }: { k: Kit; label: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 42, marginTop: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: pressed ? k.c.primary : withAlpha(k.c.fg, 0.16), borderRadius: 12, backgroundColor: pressed ? withAlpha(k.c.primary, 0.05) : "transparent" })}
    >
      <Icon name="Plus" size={15} color={k.c.mutedFg} />
      <Text style={{ color: k.c.mutedFg, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** A dashed box for an empty list: an icon, a sentence and an action. */
export function EmptyBlock({ k, icon, text, action }: { k: Kit; icon: string; text: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderStyle: "dashed", borderColor: withAlpha(k.c.fg, 0.14), borderRadius: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: k.c.muted, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={k.c.mutedFg} />
      </View>
      <Text style={{ flexGrow: 1, flexBasis: 180, color: k.c.mutedFg, fontSize: 13, lineHeight: 19 }}>{text}</Text>
      {action}
    </View>
  );
}

/** A pill with an icon: the overview's summary of the team. */
export function Fact({ k, icon, label, mono }: { k: Kit; icon: string; label: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: k.c.muted, maxWidth: "100%" }}>
      <Icon name={icon} size={13} color={withAlpha(k.c.fg, 0.65)} />
      <Text style={{ color: k.c.mutedFg, fontSize: 12, fontWeight: "500", flexShrink: 1, ...(mono ? { fontFamily: "Menlo" } : {}) }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ----- Layout

/** Children in equal columns, as many as fit `min` wide (at most `max`); every row's cards share its tallest height. */
export function Grid({ min, max = 4, gap = 12, columns: fixed, children }: { min: number; max?: number; gap?: number; columns?: (width: number) => number; children: ReactNode }) {
  const [width, setWidth] = useState(0);
  const items = Children.toArray(children);
  const columns = Math.max(1, Math.min(max, fixed ? fixed(width) : Math.floor((width + gap) / (min + gap))));
  const rows: ReactNode[][] = [];
  for (let at = 0; at < items.length; at += columns) rows.push(items.slice(at, at + columns));
  return (
    <View
      style={{ gap }}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width);
        setWidth((current) => (current === next ? current : next));
      }}
    >
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", alignItems: "stretch", gap }}>
          {row.map((item, at) => (
            <View key={at} style={{ flex: 1, minWidth: 0 }}>
              {item}
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, spacer) => (
            <View key={`spacer-${spacer}`} style={{ flex: 1, minWidth: 0 }} />
          ))}
        </View>
      ))}
    </View>
  );
}
