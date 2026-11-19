// What every part of the session report shares: the run's types, the parts' names, icons and colors, how a flow event
// reads, times and durations, the tones of members, tasks and plans, and the small widgets the report is built from
// (section titles, panels, fields, long text, party tags, event rows, usage bars and history). The look follows Ensemble
// for Orca's run report, drawn with React Native and the kit.
import type { RpcOutput } from "@getpaseo/plugin";
import type { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Children, isValidElement, useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View, type LayoutChangeEvent, type PressableStateCallbackType, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { withAlpha } from "../../shared/color";
import { flowTotals, RUN_COMPONENTS, type RunComponent } from "../../shared/flow";
import type { CollabMode } from "../../shared/modes";
import type { teamSessionDetailRpc, teamSessionRpc } from "../../shared/rpc";
import type { messages } from "../i18n";
import { Dot, PART, type Kit } from "../kit";

type SessionRpc = typeof teamSessionRpc;
type DetailRpc = typeof teamSessionDetailRpc;
type English = typeof messages.resources.en;
type UseTranslation = typeof useTranslation<English>;
export type SessionInfo = RpcOutput<SessionRpc>;
export type RunView = NonNullable<SessionInfo["run"]>;
export type FlowEvent = RunView["events"][number];
export type Detail = RpcOutput<DetailRpc>;
export type DetailRun = NonNullable<Detail["run"]>;
export type Tr = ReturnType<UseTranslation>["t"];
export type Member = { agentId: string; title: string };
type MemberState = RunView["members"][number]["state"];
type TaskState = RunView["tasks"][number]["state"];
type PlanStatus = NonNullable<RunView["tasks"][number]["plan"]>;

/** A page of the report: one part of the mode, or the whole data flow. */
export type ComponentPage = RunComponent | "flow";
export const COMPONENT_PAGES: readonly ComponentPage[] = [...RUN_COMPONENTS, "flow"];

/** A flow this recent is drawn moving. */
export const LIVE_MS = 30_000;

export const COMPONENT_COLOR: Record<RunComponent, string> = { ...PART };
/** The whole data flow's hue, and the lead's. */
export const FLOW_TONE = "#5eaefc";
export const LEAD_TONE = "#8f9bff";

export const COMPONENT_ICON: Record<RunComponent, string> = {
  brief: "FileText",
  tasks: "SquareKanban",
  plans: "ClipboardCheck",
  board: "MessagesSquare",
  claims: "FileLock",
  split: "Split",
  contexts: "Boxes",
  reports: "Inbox",
  summary: "GitMerge",
};
export const pageIcon = (page: ComponentPage) => (page === "flow" ? "Activity" : COMPONENT_ICON[page]);
export const pageTone = (page: ComponentPage) => (page === "flow" ? FLOW_TONE : PART[page]);

// ----- Colors

type Rgb = [number, number, number];
function parseColor(color: string): Rgb | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value = hex[1]!.length === 3 ? [...hex[1]!].map((digit) => digit + digit).join("") : hex[1]!;
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** `a` blended into `b` by `weight`; colors it can't read come back as `a`. */
export function mix(a: string, b: string, weight: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return `rgb(${x.map((value, index) => Math.round(value * weight + y[index]! * (1 - weight))).join(", ")})`;
}

export function isLight(k: Kit): boolean {
  const card = parseColor(k.c.card);
  return card ? (0.2126 * card[0] + 0.7152 * card[1] + 0.0722 * card[2]) / 255 > 0.55 : false;
}

/** Text in a part's or a state's color, pulled toward the foreground so it stays readable on light themes. */
export const ink = (k: Kit, color: string) => mix(color, k.c.fg, isLight(k) ? 0.58 : 0.72);

/** A member's color and whether its dot pulses. */
export function memberTone(k: Kit, member: { state: MemberState; retired: boolean }): { tone: string; live: boolean } {
  if (member.retired) return { tone: k.c.mutedFg, live: false };
  if (member.state === "working") return { tone: k.c.warn, live: true };
  if (member.state === "done") return { tone: k.c.ok, live: false };
  return { tone: k.c.bad, live: false };
}
export const memberStateText = (member: { state: MemberState; retired: boolean }, t: Tr) => (member.retired ? t("session.retired") : t(`session.state.${member.state}`));

export const taskTone = (k: Kit, state: TaskState) => (state === "todo" ? PART.tasks : state === "doing" ? k.c.warn : state === "done" ? k.c.ok : k.c.mutedFg);
export const planTone = (k: Kit, status: PlanStatus) => (status === "pending" ? PART.plans : status === "approved" ? k.c.ok : k.c.bad);
export const planLabel = (status: PlanStatus, t: Tr) => (status === "pending" ? t("flow.plans.pending") : status === "approved" ? t("flow.plans.approved") : t("flow.plans.rejected"));
export const planBadge = (status: PlanStatus, t: Tr) => (status === "pending" ? t("session.planPending") : status === "approved" ? t("session.planApproved") : t("session.planRejected"));

export const hovered = (state: PressableStateCallbackType) => (state as { hovered?: boolean }).hovered === true;

// ----- Time

/** The time now, refreshed every few seconds so "12s ago" and live flows stay current. */
export function useNow(intervalMs = 3000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function durationText(ms: number, t: Tr): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (!Number.isFinite(seconds)) return "–";
  if (seconds < 60) return t("flow.duration.seconds", { count: seconds });
  if (seconds < 600) return t("flow.duration.minutes", { count: Math.round(seconds / 6) / 10 });
  if (seconds < 3600) return t("flow.duration.minutes", { count: Math.round(seconds / 60) });
  return t("flow.duration.hours", { count: Math.round(seconds / 360) / 10 });
}

export function agoText(at: string, now: number, t: Tr): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 5) return t("flow.ago.now");
  if (seconds < 60) return t("flow.ago.seconds", { count: seconds });
  if (seconds < 3600) return t("flow.ago.minutes", { count: Math.round(seconds / 60) });
  if (seconds < 48 * 3600) return t("flow.ago.hours", { count: Math.round(seconds / 3600) });
  return t("reportUi.daysAgo", { count: Math.round(seconds / 86400) });
}

/** A date and time short enough for the header: "11/16, 18:46". */
export function timeText(at: string, t: Tr): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const pad = (value: number) => String(value).padStart(2, "0");
  return t("reportUi.dateTime", { month: date.getMonth() + 1, day: date.getDate(), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` });
}

// ----- Words

export function partyName(party: string, members: readonly Member[], t: Tr): string {
  if (party === "lead") return t("flow.lead");
  if (party === "user") return t("flow.user");
  if (party === "plugin") return t("flow.plugin");
  return members.find((member) => member.agentId === party)?.title ?? party;
}

function eventKey(event: FlowEvent) {
  if (event.component === "brief" && event.action === "deliver") return "flow.event.briefDeliver" as const;
  if (event.component === "plans" && event.action === "notify") return "flow.event.plansNotify" as const;
  if (event.component === "claims" && event.action === "claim") return "flow.event.fileClaim" as const;
  if (event.component === "claims" && event.action === "release") return "flow.event.fileRelease" as const;
  if (event.component === "split" && event.action === "add") return "flow.event.packetAdd" as const;
  if (event.component === "split" && event.action === "assign") return "flow.event.packetAssign" as const;
  if (event.component === "summary" && event.action === "deliver") return "flow.event.summaryDeliver" as const;
  return `flow.event.${event.action}` as const;
}

/** Events whose sentence already quotes the note. */
const NOTE_IN_TEXT: ReadonlySet<FlowEvent["action"]> = new Set(["warn", "start"] as const);

export function describeEvent(event: FlowEvent, members: readonly Member[], t: Tr): string {
  // A post addressed to its own author has nowhere else to go.
  const targets = event.to.length && !(event.to.length === 1 && event.to[0] === event.from) ? event.to : [];
  const to = targets.map((party) => partyName(party, members, t)).join(", ");
  return t(eventKey(event), { from: partyName(event.from, members, t), to: to || t("flow.lead"), subject: event.subject, note: event.note });
}

export const componentName = (component: RunComponent, mode: CollabMode, t: Tr) => (component === "tasks" && mode === "delegation" ? t("flow.delegationTasks") : t(`flow.component.${component}`));
export const pageName = (page: ComponentPage, mode: CollabMode, t: Tr) => (page === "flow" ? t("flow.allTitle") : componentName(page, mode, t));
export const aboutText = (page: ComponentPage, mode: CollabMode, t: Tr) => (page === "flow" ? t("flow.hint") : page === "tasks" && mode === "delegation" ? t("flow.about.delegationTasks") : t(`flow.about.${page}`));

/** One line on how a part stands right now. */
export function summaryOf(component: RunComponent, run: RunView, pending: SessionInfo["pendingBrief"], t: Tr): string {
  const count = (state: string) => run.tasks.filter((task) => task.state === state).length;
  switch (component) {
    case "brief":
      return run.brief ? t("flow.summary.briefConfirmed", { count: run.brief.acceptance.length }) : pending ? t("flow.summary.briefPending") : t("flow.summary.briefNone");
    case "tasks":
      return run.tasks.length ? t("flow.summary.tasks", { doing: count("doing"), todo: count("todo"), done: count("done") }) : t("flow.summary.tasksEmpty");
    case "plans": {
      const plans = run.tasks.filter((task) => task.plan);
      if (!run.planApproval && !plans.length) return t("flow.summary.plansOff");
      return t("flow.summary.plans", { pending: plans.filter((task) => task.plan === "pending").length, approved: plans.filter((task) => task.plan === "approved").length, rejected: plans.filter((task) => task.plan === "rejected").length });
    }
    case "board":
      return t("flow.summary.board", { count: run.postCount });
    case "claims":
      return run.claims.length ? t("flow.summary.claims", { count: run.claims.length }) : t("flow.summary.claimsNone");
    case "reports":
      return t("flow.summary.reports", { done: run.members.filter((member) => member.state === "done" || member.state === "failed").length, total: run.members.length });
    case "split": {
      const warnings = run.batches.reduce((sum, batch) => sum + batch.warnings, 0);
      const text = t("flow.summary.split", { batches: run.batches.length, packets: run.batches.reduce((sum, batch) => sum + batch.packets, 0) || run.tasks.length });
      return warnings ? `${text} · ${t("flow.summary.splitWarn", { count: warnings })}` : text;
    }
    case "contexts":
      return t("flow.summary.contexts", { count: run.members.length, working: run.members.filter((member) => member.state === "working" || member.state === "attention").length });
    case "summary": {
      const last = run.batches.at(-1);
      if (last?.summarized) return t("flow.summary.summarized", { round: last.round });
      return last && run.members.length && run.members.every((member) => member.state === "done" || member.state === "failed") ? t("flow.summary.summaryWaiting") : t("flow.summary.summaryNone");
    }
  }
}

// ----- Layout

/** The view's width, kept current as it resizes: spread the handler on the view to measure. */
export function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  }, []);
  return [width, onLayout];
}

/** Children in equal columns at least `min` wide, as many as fit. */
export function Grid({ min, gap = 12, children }: { min: number; gap?: number; children: ReactNode }) {
  const [width, onLayout] = useWidth();
  const items = Children.toArray(children);
  const columns = width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : 1;
  const itemWidth = width > 0 ? Math.floor((width - gap * (columns - 1)) / columns) : undefined;
  return (
    <View onLayout={onLayout} style={{ flexDirection: "row", flexWrap: "wrap", gap, minWidth: 0 }}>
      {items.map((child, index) => (
        <View key={isValidElement(child) && child.key !== null ? child.key : index} style={{ width: itemWidth ?? "100%", minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// ----- Widgets

/** A compact uppercase heading with an icon, and something on its right. */
export function SectionTitle({ k, icon, children, right }: { k: Kit; icon?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 }}>
      {icon ? <Icon name={icon} size={13} color={k.c.mutedFg} /> : null}
      <Text style={[k.t.label, { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** A bordered card; `edge` draws a 3px bar in `tone` on its top or left. */
export function Panel({ k, children, tone, edge, style }: { k: Kit; children: ReactNode; tone?: string; edge?: "top" | "left"; style?: StyleProp<ViewStyle> }) {
  const bar: ViewStyle = tone && edge === "top" ? { borderTopWidth: 3, borderTopColor: tone } : tone && edge === "left" ? { borderLeftWidth: 3, borderLeftColor: tone } : {};
  return <View style={[{ backgroundColor: k.c.card, borderWidth: 1, borderColor: k.c.border, borderRadius: k.radius, padding: 12, gap: 10, minWidth: 0 }, bar, style]}>{children}</View>;
}

export const bodyText = (k: Kit): TextStyle => ({ color: k.c.fg, fontSize: 12.5, lineHeight: 19 });

export function FieldLabel({ k, children, icon, tone }: { k: Kit; children: ReactNode; icon?: string; tone?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {icon ? <Icon name={icon} size={12} color={tone ?? k.c.mutedFg} /> : null}
      <Text style={{ color: k.c.mutedFg, fontSize: 11, fontWeight: "600", letterSpacing: 0.2 }}>{children}</Text>
    </View>
  );
}

/** A labelled block of text. */
export function Field({ k, label, children, mono }: { k: Kit; label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <View style={{ gap: 3, minWidth: 0 }}>
      <FieldLabel k={k}>{label}</FieldLabel>
      {typeof children === "string" ? (
        <Text selectable style={[bodyText(k), mono ? { fontFamily: "Menlo", fontSize: 12 } : null]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export function Bullets({ k, items, tone }: { k: Kit; items: readonly string[]; tone?: string }) {
  return (
    <View style={{ gap: 4 }}>
      {items.map((item, index) => (
        <View key={index} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 7, backgroundColor: tone ?? k.c.mutedFg }} />
          <Text selectable style={[bodyText(k), { flex: 1, minWidth: 0 }]}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A link-styled button: a label in the primary color and an optional arrow. */
export function LinkText({ k, label, onPress, arrow, center }: { k: Kit; label: string; onPress(): void; arrow?: boolean; center?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2, alignSelf: center ? "center" : "flex-start", opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: k.c.primary, fontSize: 12, fontWeight: "600" }}>{label}</Text>
      {arrow ? <Icon name="ArrowRight" size={12} color={k.c.primary} /> : null}
    </Pressable>
  );
}

/** Long text, clamped until opened. */
export function LongText({ k, t, text, lines = 6, style }: { k: Kit; t: Tr; text: string; lines?: number; style?: StyleProp<TextStyle> }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 90 || text.split("\n").length > lines;
  return (
    <View style={{ gap: 2, alignItems: "flex-start", alignSelf: "stretch", minWidth: 0 }}>
      <Text selectable numberOfLines={!open && long ? lines : undefined} style={[bodyText(k), { alignSelf: "stretch" }, style]}>
        {text}
      </Text>
      {long ? <LinkText k={k} label={open ? t("reportUi.showLess") : t("reportUi.showMore")} onPress={() => setOpen((value) => !value)} /> : null}
    </View>
  );
}

/** A party's name with its state dot; with `onPress` it opens the agent. */
export function PartyTag({ k, name, tone, live, onPress, label }: { k: Kit; name: string; tone?: string; live?: boolean; onPress?: () => void; label?: string }) {
  const body = (
    <>
      <Dot tone={tone ?? k.c.mutedFg} live={live} size={7} />
      <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 12, fontWeight: "600", flexShrink: 1 }}>
        {name}
      </Text>
    </>
  );
  if (!onPress) return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `${name}: ${label}` : name}
      onPress={onPress}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1, paddingHorizontal: 5, paddingVertical: 1, marginHorizontal: -5, borderRadius: 5, backgroundColor: hovered(state) || state.pressed ? k.c.muted : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

/** A task or packet id, in mono on a tint. */
export function IdPill({ k, id, tone, small }: { k: Kit; id: string; tone?: string; small?: boolean }) {
  const color = tone ?? PART.tasks;
  return (
    <View style={{ paddingHorizontal: small ? 5 : 6, paddingVertical: 1, borderRadius: 5, backgroundColor: withAlpha(color, 0.14), alignSelf: "flex-start" }}>
      <Text style={{ color: ink(k, color), fontFamily: "Menlo", fontSize: small ? 10 : 11, fontWeight: "700" }}>{id}</Text>
    </View>
  );
}

/** A role, outlined; "anyone" gets a dashed outline. */
export function RolePill({ k, role, t }: { k: Kit; role: string | null; t: Tr }) {
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: k.c.border, borderStyle: role ? "solid" : "dashed", maxWidth: 140 }}>
      <Text numberOfLines={1} style={{ color: role ? k.c.fg : k.c.mutedFg, fontSize: 11, fontWeight: "600" }}>
        {role ?? t("session.anyone")}
      </Text>
    </View>
  );
}

export function CountPill({ k, count, tone }: { k: Kit; count: number; tone?: string }) {
  return (
    <View style={{ minWidth: 20, height: 18, paddingHorizontal: 6, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: tone ? withAlpha(tone, 0.18) : k.c.muted }}>
      <Text style={{ color: tone ? ink(k, tone) : k.c.mutedFg, fontSize: 11, fontWeight: "700" }}>{count}</Text>
    </View>
  );
}

/** A status dot that sits on the corner of a tile. */
export function CornerDot({ k, tone, live }: { k: Kit; tone: string; live?: boolean }) {
  return (
    <View style={{ position: "absolute", right: -3, bottom: -3, width: 12, height: 12, borderRadius: 6, backgroundColor: k.c.card, alignItems: "center", justifyContent: "center" }}>
      <Dot tone={tone} live={live} size={8} />
    </View>
  );
}

/** A pulsing "live" mark: a dot and, with a label, the word. */
export function LivePill({ k, label }: { k: Kit; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Dot tone={k.c.ok} live size={7} />
      <Text style={{ color: ink(k, k.c.ok), fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

/** Small label-and-value pairs in a row. */
export function Facts({ k, items }: { k: Kit; items: readonly (readonly [string, ReactNode] | null | false)[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 22, rowGap: 10 }}>
      {items
        .filter((item): item is readonly [string, ReactNode] => !!item)
        .map(([label, value], index) => (
          <View key={index} style={{ gap: 2, minWidth: 0, maxWidth: "100%" }}>
            <FieldLabel k={k}>{label}</FieldLabel>
            {typeof value === "string" ? <Text style={{ color: k.c.fg, fontSize: 12.5 }}>{value}</Text> : value}
          </View>
        ))}
    </View>
  );
}

export function FileChips({ k, files }: { k: Kit; files: readonly string[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
      {files.map((file) => (
        <View key={file} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: k.c.muted, maxWidth: "100%" }}>
          <Icon name="File" size={11} color={k.c.mutedFg} />
          <Text numberOfLines={1} selectable style={{ color: k.c.fg, fontFamily: "Menlo", fontSize: 11, flexShrink: 1 }}>
            {file}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A number with its label and a bar in `tone` along its top. */
export function Stat({ k, value, label, tone }: { k: Kit; value: string; label: string; tone?: string }) {
  return (
    <View style={{ gap: 2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: k.radius, borderWidth: 1, borderColor: k.c.border, borderTopWidth: 2, borderTopColor: tone ?? FLOW_TONE, backgroundColor: k.c.card, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 19, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: 11, fontWeight: "600" }}>
        {label}
      </Text>
    </View>
  );
}

export function EmptyLine({ k, children }: { k: Kit; children: ReactNode }) {
  return <Text style={{ color: k.c.mutedFg, fontSize: 12 }}>{children}</Text>;
}

/** One step of the data flow: the part's color bar, what happened, when, and its note (tap to read it all). */
export function EventRow({ k, t, event, members, mode, now, onPress, showComponent = true }: { k: Kit; t: Tr; event: FlowEvent; members: readonly Member[]; mode: CollabMode; now: number; onPress?: () => void; showComponent?: boolean }) {
  const [open, setOpen] = useState(false);
  const color = PART[event.component];
  const note = NOTE_IN_TEXT.has(event.action) ? "" : event.note;
  // With a place to go, the row opens it; otherwise it opens itself, so a long post or result can be read in full.
  const press = onPress ?? (note ? () => setOpen((current) => !current) : undefined);
  return (
    <Pressable
      accessibilityRole={press ? "button" : undefined}
      disabled={!press}
      onPress={press}
      style={(state) => ({ flexDirection: "row", gap: 9, alignItems: "stretch", paddingVertical: 5, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 6, backgroundColor: press && (hovered(state) || state.pressed) ? k.c.muted : "transparent" })}
    >
      <View style={{ width: 3, borderRadius: 2, backgroundColor: color, opacity: 0.9 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Text style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 12, lineHeight: 17 }}>
            {showComponent ? <Text style={{ color: ink(k, color), fontWeight: "700" }}>{componentName(event.component, mode, t)}</Text> : null}
            {showComponent ? " · " : null}
            {describeEvent(event, members, t)}
            {event.count > 1 ? <Text style={{ color: k.c.mutedFg, fontSize: 11, fontWeight: "700" }}>{`  ×${event.count}`}</Text> : null}
          </Text>
          <Text style={{ color: k.c.mutedFg, fontSize: 10.5, lineHeight: 17 }}>{agoText(event.at, now, t)}</Text>
        </View>
        {note ? (
          <Text selectable={open} numberOfLines={open ? undefined : 2} style={{ color: k.c.mutedFg, fontSize: 11.5, lineHeight: 16 }}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Per party: how much it wrote into the part and received from it over the whole run. */
export function Usage({ k, t, events, members, tone }: { k: Kit; t: Tr; events: readonly FlowEvent[]; members: readonly Member[]; tone?: string }) {
  const totals = [...flowTotals(events)].map(([party, row]) => {
    const cells = [...row.values()];
    return { party, wrote: cells.reduce((sum, cell) => sum + cell.in, 0), got: cells.reduce((sum, cell) => sum + cell.out, 0) };
  });
  totals.sort((a, b) => b.wrote + b.got - (a.wrote + a.got));
  const max = Math.max(1, ...totals.map((row) => Math.max(row.wrote, row.got)));
  const bar = (value: number, color: string, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
      <View style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 3, backgroundColor: withAlpha(k.c.fg, 0.06), overflow: "hidden" }}>
        <View style={{ height: 6, borderRadius: 3, width: `${value ? Math.max(3, (value / max) * 100) : 0}%`, backgroundColor: color }} />
      </View>
      <Text numberOfLines={1} style={{ width: 84, color: k.c.mutedFg, fontSize: 10.5, opacity: value ? 1 : 0.55 }}>
        {label}
      </Text>
    </View>
  );
  return (
    <Panel k={k}>
      <SectionTitle k={k} icon="Users">
        {t("flow.usage")}
      </SectionTitle>
      {!totals.length ? <EmptyLine k={k}>{t("flow.none")}</EmptyLine> : null}
      <View style={{ gap: 9 }}>
        {totals.map((row) => (
          <View key={row.party} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text numberOfLines={1} style={{ width: "30%", maxWidth: 120, minWidth: 70, color: k.c.fg, fontSize: 12, fontWeight: "600" }}>
              {partyName(row.party, members, t)}
            </Text>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              {bar(row.wrote, tone ?? FLOW_TONE, `→ ${t("flow.wrote", { count: row.wrote })}`)}
              {bar(row.got, withAlpha(k.c.ok, 0.8), `← ${t("flow.got", { count: row.got })}`)}
            </View>
          </View>
        ))}
      </View>
    </Panel>
  );
}

/** The part's events, newest first; the first `limit`, then all on request. */
export function History({ k, t, events, members, mode, now, title, showComponent = true, limit = 30 }: { k: Kit; t: Tr; events: readonly FlowEvent[]; members: readonly Member[]; mode: CollabMode; now: number; title?: string; showComponent?: boolean; limit?: number }) {
  const [all, setAll] = useState(false);
  const newest = [...events].reverse();
  const shown = all ? newest : newest.slice(0, limit);
  return (
    <Panel k={k}>
      <SectionTitle k={k} icon="Clock" right={<Text style={k.t.tiny}>{newest.length}</Text>}>
        {title ?? t("flow.history")}
      </SectionTitle>
      {!shown.length ? <EmptyLine k={k}>{t("flow.none")}</EmptyLine> : null}
      <View style={{ gap: 2 }}>
        {shown.map((event) => (
          <EventRow key={event.seq} k={k} t={t} event={event} members={members} mode={mode} now={now} showComponent={showComponent} />
        ))}
      </View>
      {!all && newest.length > shown.length ? <LinkText k={k} label={t("flow.viewAll", { count: newest.length })} onPress={() => setAll(true)} /> : null}
    </Panel>
  );
}
