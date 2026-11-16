// The collaboration components of a session's run on the dashboard: a data-flow diagram (who writes into which part of the
// mode, and what each part hands to whom), the latest flows, and a detail page per component.
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Loading } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { withAlpha } from "../shared/color";
import { componentsOf, flowTotals, RUN_COMPONENTS, type RunComponent } from "../shared/flow";
import { teamSessionDetailRpc, type teamSessionRpc } from "../shared/rpc";
import { messages } from "./i18n";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type SessionInfo = RpcOutput<typeof teamSessionRpc>;
type RunView = NonNullable<SessionInfo["run"]>;
type FlowEvent = RunView["events"][number];
type Detail = RpcOutput<typeof teamSessionDetailRpc>;
type DetailRun = NonNullable<Detail["run"]>;
type T = ReturnType<typeof useTranslation<typeof messages.resources.en>>["t"];
type Member = { agentId: string; title: string };

/** A page of the dashboard: one component, or the whole data flow. */
export type ComponentPage = RunComponent | "flow";
export const COMPONENT_PAGES: readonly ComponentPage[] = [...RUN_COMPONENTS, "flow"];

const AMBER = "#ffb347";
const RED = "#ff5a5f";
/** A flow this recent is drawn moving. */
const LIVE_MS = 30_000;

export const COMPONENT_COLOR: Record<RunComponent, string> = {
  brief: "#a78bfa",
  tasks: "#60a5fa",
  plans: "#f5a524",
  board: "#34d399",
  claims: "#f472b6",
  split: "#818cf8",
  contexts: "#a3e635",
  reports: "#22d3ee",
  summary: "#e879f9",
};
const COMPONENT_ICON: Record<RunComponent, string> = {
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

/** The time now, refreshed every few seconds so "12s ago" and live flows stay current. */
export function useNow(intervalMs = 3000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function usePacket(): Animated.Value {
  const packet = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(packet, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
    animation.start();
    return () => animation.stop();
  }, [packet]);
  return packet;
}

export function durationText(ms: number, t: T): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("flow.duration.seconds", { count: seconds });
  if (seconds < 600) return t("flow.duration.minutes", { count: Math.round(seconds / 6) / 10 });
  if (seconds < 3600) return t("flow.duration.minutes", { count: Math.round(seconds / 60) });
  return t("flow.duration.hours", { count: Math.round(seconds / 360) / 10 });
}

export function agoText(at: string, now: number, t: T): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 5) return t("flow.ago.now");
  if (seconds < 60) return t("flow.ago.seconds", { count: seconds });
  if (seconds < 3600) return t("flow.ago.minutes", { count: Math.round(seconds / 60) });
  return t("flow.ago.hours", { count: Math.round(seconds / 3600) });
}

function partyName(party: string, members: readonly Member[], t: T): string {
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

export function describeEvent(event: FlowEvent, members: readonly Member[], t: T): string {
  // A post addressed to its own author has nowhere else to go.
  const targets = event.to.length && !(event.to.length === 1 && event.to[0] === event.from) ? event.to : [];
  const to = targets.map((party) => partyName(party, members, t)).join(", ");
  return t(eventKey(event), { from: partyName(event.from, members, t), to: to || t("flow.lead"), subject: event.subject, note: event.note });
}

const componentName = (component: RunComponent, mode: RunView["mode"], t: T) => (component === "tasks" && mode === "delegation" ? t("flow.delegationTasks") : t(`flow.component.${component}`));

function ComponentIcon({ component, size = 22 }: { component: RunComponent; size?: number }) {
  const color = COMPONENT_COLOR[component];
  return (
    <View style={{ width: size, height: size, borderRadius: 6, backgroundColor: withAlpha(color, 0.18), alignItems: "center", justifyContent: "center" }}>
      <Icon name={COMPONENT_ICON[component]} size={Math.round(size * 0.62)} color={color} />
    </View>
  );
}

function LiveDot({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }} />;
}

/** A tab of the session dashboard: the overview, the agents, a component of the mode, or the whole data flow. */
export type SessionTab = "overview" | "agents" | ComponentPage;

/** The session dashboard's tabs: overview and agents, then the mode's components and the whole data flow. */
export function SessionTabs({ mode, tab, run, pending, colors, t, onOpen }: { mode: RunView["mode"]; tab: SessionTab; run: RunView | null; pending: boolean; colors: Colors; t: T; onOpen(tab: SessionTab): void }) {
  const count = (component: RunComponent): number | null => {
    if (!run) return null;
    if (component === "tasks" || component === "split") return run.tasks.length || null;
    if (component === "board") return run.postCount || null;
    if (component === "claims") return run.claims.length || null;
    if (component === "contexts" || component === "reports") return run.members.length || null;
    return null;
  };
  const tabs: { id: SessionTab; label: string; icon: string; color?: string; badge?: number | null; dot?: boolean }[] = [
    { id: "overview", label: t("session.tabs.overview"), icon: "LayoutDashboard" },
    { id: "agents", label: t("session.tabs.agents"), icon: "Network" },
    ...componentsOf(mode).map((component) => ({ id: component, label: componentName(component, mode, t), icon: COMPONENT_ICON[component], color: COMPONENT_COLOR[component], badge: count(component), dot: component === "brief" && pending })),
    { id: "flow", label: t("flow.title"), icon: "Activity", badge: run?.events.length || null },
  ];
  return (
    <View style={{ borderBottomWidth: 1, borderColor: colors.border }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2 }}>
      {tabs.map((entry) => {
        const selected = entry.id === tab;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onOpen(entry.id)}
            style={(state) => ({ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 7, marginBottom: -1, borderBottomWidth: 2, borderColor: selected ? entry.color ?? colors.accent : "transparent", backgroundColor: (state as { hovered?: boolean }).hovered && !selected ? colors.surface1 : "transparent", borderTopLeftRadius: 6, borderTopRightRadius: 6 })}
          >
            <Icon name={entry.icon} size={13} color={selected ? entry.color ?? colors.foreground : colors.foregroundMuted} />
            <Text numberOfLines={1} style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: selected ? "700" : "500" }}>{entry.label}</Text>
            {entry.badge ? <Text style={{ color: colors.foregroundMuted, fontSize: 10, paddingHorizontal: 5, borderRadius: 8, backgroundColor: colors.surface2, fontVariant: ["tabular-nums"] }}>{entry.badge}</Text> : null}
            {entry.dot ? <LiveDot color={COMPONENT_COLOR.brief} /> : null}
          </Pressable>
        );
      })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The overview: diagram, cards and the latest flows

type Link = { party: string; component: RunComponent; direction: "in" | "out"; count: number; live: boolean };

/** Flows among the latest events, per party, component and direction. */
function linksOf(events: readonly FlowEvent[], parties: ReadonlySet<string>, now: number): Link[] {
  const links = new Map<string, Link>();
  for (const event of events) {
    const ends = event.direction === "in" ? [event.from] : event.to;
    for (const party of ends.filter((end) => parties.has(end))) {
      const key = `${party}|${event.component}|${event.direction}`;
      const link = links.get(key);
      const live = now - Date.parse(event.at) < LIVE_MS;
      links.set(key, { party, component: event.component, direction: event.direction, count: (link?.count ?? 0) + event.count, live: (link?.live ?? false) || live });
    }
  }
  return [...links.values()];
}

function FlowLine({ y1, y2, width, color, live, direction, packet }: { y1: number; y2: number; width: number; color: string; live: boolean; direction: "in" | "out"; packet: Animated.Value }) {
  const dy = y2 - y1;
  const length = Math.hypot(width, dy);
  const angle = Math.atan2(dy, width);
  const forward = direction === "in";
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: width / 2 - length / 2, top: (y1 + y2) / 2 - 4, width: length, height: 8, transform: [{ rotate: `${angle}rad` }] }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 3.25, height: live ? 1.5 : 1, backgroundColor: withAlpha(color, live ? 0.85 : 0.4) }} />
      {/* The arrowhead points to where the data goes: into the component, or out to the agent. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          ...(forward ? { right: 0, borderLeftWidth: 7, borderLeftColor: withAlpha(color, live ? 0.95 : 0.55) } : { left: 0, borderRightWidth: 7, borderRightColor: withAlpha(color, live ? 0.95 : 0.55) }),
          borderTopWidth: 4,
          borderBottomWidth: 4,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          width: 0,
          height: 0,
        }}
      />
      {live ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 1,
            left: -3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
            shadowColor: color,
            shadowOpacity: 0.9,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 0 },
            transform: [{ translateX: packet.interpolate({ inputRange: [0, 1], outputRange: forward ? [0, length] : [length, 0] }) }],
          }}
        />
      ) : null}
    </View>
  );
}

function summaryOf(component: RunComponent, run: RunView, pending: SessionInfo["pendingBrief"], t: T): string {
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

function ComponentCard({ component, run, pending, colors, t, now, live, onOpen, onLayout }: { component: RunComponent; run: RunView; pending: SessionInfo["pendingBrief"]; colors: Colors; t: T; now: number; live: boolean; onOpen(): void; onLayout(center: number): void }) {
  const last = [...run.events].reverse().find((event) => event.component === component);
  const color = COMPONENT_COLOR[component];
  const total = run.tasks.filter((task) => task.state !== "dropped").length;
  const progress = (component === "tasks" || component === "split") && total > 0;
  const done = run.tasks.filter((task) => task.state === "done").length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${componentName(component, run.mode, t)}: ${t("flow.details")}`}
      onPress={onOpen}
      onLayout={(event) => onLayout(event.nativeEvent.layout.y + event.nativeEvent.layout.height / 2)}
      style={(state) => ({ gap: 4, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: live ? withAlpha(color, 0.7) : colors.border, backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.surface2 : colors.surface1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <ComponentIcon component={component} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{componentName(component, run.mode, t)}</Text>
        {live ? <LiveDot color={color} /> : null}
        <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{summaryOf(component, run, pending, t)}</Text>
      {progress ? (
        <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" }}>
          <View style={{ width: `${Math.round((done / total) * 100)}%`, height: 3, backgroundColor: color }} />
        </View>
      ) : null}
      {last ? (
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11, opacity: 0.85 }}>
          {describeEvent(last, run.members, t)} · <Text style={{ color: colors.foregroundMuted }}>{agoText(last.at, now, t)}</Text>
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Participants on the left, the mode's components on the right, and the latest flows between them. */
function FlowDiagram({ run, pending, leadAgentId, colors, t, now, onOpen, openAgent }: { run: RunView; pending: SessionInfo["pendingBrief"]; leadAgentId: string | null; colors: Colors; t: T; now: number; onOpen(page: ComponentPage): void; openAgent?: (id: string) => void }) {
  const packet = usePacket();
  const [width, setWidth] = useState(0);
  const [partyY, setPartyY] = useState<Record<string, number>>({});
  const [componentY, setComponentY] = useState<Record<string, number>>({});
  const components = componentsOf(run.mode);
  const recent = run.events.slice(-18);
  const members = run.members.filter((member) => !member.retired || recent.some((event) => event.from === member.agentId || event.to.includes(member.agentId)));
  const parties = [
    ...(recent.some((event) => event.from === "user" || event.to.includes("user")) ? ["user"] : []),
    "lead",
    ...members.map((member) => member.agentId),
    // The plugin only shows when it wrote into a part itself; what it hands out is drawn from the part.
    ...(recent.some((event) => event.from === "plugin" && event.direction === "in") ? ["plugin"] : []),
  ];
  const links = linksOf(recent, new Set(parties), now);
  // A narrow panel stacks the participants above the components; a wide one draws the flows between two columns.
  const stacked = width > 0 && width < 440;
  const left = Math.max(92, Math.min(170, Math.round(width * 0.3)));
  const gap = Math.max(40, Math.min(96, Math.round(width * 0.16)));
  const liveComponents = new Set(links.filter((link) => link.live).map((link) => link.component));
  const stateColor = (party: string) => {
    const member = run.members.find((entry) => entry.agentId === party);
    if (!member) return party === "lead" ? colors.accent : colors.foregroundMuted;
    return member.state === "working" ? AMBER : member.state === "done" ? colors.statusSuccess : member.state === "attention" || member.state === "failed" ? RED : colors.foregroundMuted;
  };
  const partyChips = parties.map((party) => {
    const member = run.members.find((entry) => entry.agentId === party);
    const id = party === "lead" ? leadAgentId : member?.agentId;
    return (
      <Pressable
        key={party}
        accessibilityRole="button"
        disabled={!id || !openAgent}
        onPress={() => id && openAgent?.(id)}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, maxWidth: "100%" }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stateColor(party) }} />
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11, fontWeight: party === "lead" ? "700" : "500" }}>{partyName(party, run.members, t)}</Text>
      </Pressable>
    );
  });
  // Both layouts measure their width, so the diagram follows the panel when it is resized either way.
  const measure = (event: { nativeEvent: { layout: { width: number } } }) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  };
  if (stacked) {
    return (
      <View style={{ gap: 6 }} onLayout={measure}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>{t("flow.title")}</Text>
          {links.some((link) => link.live) ? <Text style={{ color: colors.statusSuccess, fontSize: 10 }}>● {t("flow.live")}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{partyChips}</View>
        {components.map((component) => (
          <ComponentCard
            key={component}
            component={component}
            run={run}
            pending={pending}
            colors={colors}
            t={t}
            now={now}
            live={liveComponents.has(component)}
            onOpen={() => onOpen(component)}
            onLayout={() => undefined}
          />
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }} onLayout={measure}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>{t("flow.title")}</Text>
        {links.some((link) => link.live) ? <Text style={{ color: colors.statusSuccess, fontSize: 10 }}>● {t("flow.live")}</Text> : null}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("flow.hint")}</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: left, gap: 6 }}>
          {parties.map((party) => {
            const member = run.members.find((entry) => entry.agentId === party);
            const id = party === "lead" ? leadAgentId : member?.agentId;
            return (
              <Pressable
                key={party}
                accessibilityRole="button"
                disabled={!id || !openAgent}
                onPress={() => id && openAgent?.(id)}
                onLayout={(event) => {
                  const center = event.nativeEvent.layout.y + event.nativeEvent.layout.height / 2;
                  setPartyY((current) => (current[party] === center ? current : { ...current, [party]: center }));
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.surface2, opacity: member?.retired ? 0.55 : 1 }}
              >
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: stateColor(party) }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontWeight: party === "lead" ? "700" : "500" }}>{partyName(party, run.members, t)}</Text>
                  {member ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 10 }}>{member.retired ? t("session.retired") : t(`session.state.${member.state}`)}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={{ width: gap, alignSelf: "stretch" }}>
          {links.map((link) => {
            const y1 = partyY[link.party];
            const y2 = componentY[link.component];
            if (y1 === undefined || y2 === undefined) return null;
            // A party that both writes into and reads from a component gets two lines, side by side.
            const both = links.some((other) => other.party === link.party && other.component === link.component && other.direction !== link.direction);
            const shift = both ? (link.direction === "in" ? -3 : 3) : 0;
            return <FlowLine key={`${link.party}|${link.component}|${link.direction}`} y1={y1 + shift} y2={y2 + shift} width={gap} color={COMPONENT_COLOR[link.component]} live={link.live} direction={link.direction} packet={packet} />;
          })}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          {components.map((component) => (
            <ComponentCard
              key={component}
              component={component}
              run={run}
              pending={pending}
              colors={colors}
              t={t}
              now={now}
              live={liveComponents.has(component)}
              onOpen={() => onOpen(component)}
              onLayout={(center) => setComponentY((current) => (current[component] === center ? current : { ...current, [component]: center }))}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function EventRow({ event, members, mode, colors, t, now, onPress }: { event: FlowEvent; members: readonly Member[]; mode: RunView["mode"]; colors: Colors; t: T; now: number; onPress?: () => void }) {
  const [open, setOpen] = useState(false);
  const color = COMPONENT_COLOR[event.component];
  // With a place to go, the row opens it; otherwise it opens itself, so a long post or result can be read in full.
  const press = onPress ?? (event.note ? () => setOpen((current) => !current) : undefined);
  return (
    <Pressable accessibilityRole={press ? "button" : undefined} disabled={!press} onPress={press} style={{ flexDirection: "row", gap: 8, alignItems: "stretch" }}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: color }} />
      <View style={{ flex: 1, minWidth: 0, gap: 1, paddingVertical: 2 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "baseline" }}>
          <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12 }}>
            <Text style={{ color, fontWeight: "700" }}>{componentName(event.component, mode, t)}</Text> · {describeEvent(event, members, t)}{event.count > 1 ? ` ×${event.count}` : ""}
          </Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{agoText(event.at, now, t)}</Text>
        </View>
        {event.note ? <Text selectable={open} numberOfLines={open ? undefined : 2} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{event.note}</Text> : null}
      </View>
    </Pressable>
  );
}

function SectionTitle({ colors, children }: { colors: Colors; children: ReactNode }) {
  return <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>{children}</Text>;
}

const MODE_COLOR = { team: "#34d399", delegation: "#818cf8" } as const;

function Pill({ label, color, colors }: { label: string; color: string; colors: Colors }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: withAlpha(color, 0.45), backgroundColor: withAlpha(color, 0.12) }}>
      <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function StatTile({ label, value, hint, color, colors, progress }: { label: string; value: string; hint?: string; color: string; colors: Colors; progress?: number }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 96, minWidth: 96, gap: 2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surface2 }}>
      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
      {progress !== undefined ? (
        <View style={{ height: 3, borderRadius: 2, backgroundColor: withAlpha(color, 0.18), overflow: "hidden" }}>
          <View style={{ width: `${Math.round(progress * 100)}%`, height: 3, backgroundColor: color }} />
        </View>
      ) : null}
      {hint ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 10 }}>{hint}</Text> : null}
    </View>
  );
}

/** The run at a glance: its title, mode and state, and a row of numbers. */
function RunHeader({ run, colors, t, now }: { run: RunView; colors: Colors; t: T; now: number }) {
  const live = run.tasks.filter((task) => task.state !== "dropped");
  const done = live.filter((task) => task.state === "done").length;
  const active = run.members.filter((member) => !member.retired);
  const working = active.filter((member) => member.state === "working" || member.state === "attention").length;
  const elapsed = (run.status === "active" ? now : Date.parse(run.updatedAt)) - Date.parse(run.createdAt);
  const modeColor = MODE_COLOR[run.mode];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Pill label={`${t(`mode.${run.mode}`)} · ${run.mode === "team" ? "MA-08" : "MA-04"}`} color={modeColor} colors={colors} />
          <Pill label={run.status === "active" ? t("session.status.active") : t("session.status.closed")} color={run.status === "active" ? AMBER : colors.foregroundMuted} colors={colors} />
          <Pill label={run.mode === "team" ? t("session.round", { round: run.round, rounds: run.rounds }) : t("session.batch", { round: run.round })} color={colors.foregroundMuted} colors={colors} />
          {run.planApproval ? <Pill label={t("session.planApprovalOn")} color={COMPONENT_COLOR.plans} colors={colors} /> : null}
          <Text style={{ marginLeft: "auto", color: colors.foregroundMuted, fontSize: 11, fontFamily: Platform.OS === "web" ? "monospace" : undefined }}>{run.id}</Text>
        </View>
        <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>{run.title}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <StatTile label={run.mode === "team" ? t("session.stat.tasks") : t("session.stat.packets")} value={`${done}/${live.length}`} hint={t("session.stat.ofDone", { done, total: live.length })} color={COMPONENT_COLOR.tasks} colors={colors} progress={live.length ? done / live.length : 0} />
        <StatTile label={t("session.stat.members")} value={String(active.length)} hint={working ? t("session.stat.working", { count: working }) : t("session.stat.idle")} color={AMBER} colors={colors} />
        {run.mode === "team" ? (
          <StatTile label={t("session.stat.posts")} value={String(run.postCount)} hint={run.claims.length ? t("flow.summary.claims", { count: run.claims.length }) : t("flow.summary.claimsNone")} color={COMPONENT_COLOR.board} colors={colors} />
        ) : (
          <StatTile label={t("session.stat.batches")} value={String(run.batches.length)} hint={run.batches.at(-1)?.summarized ? t("flow.summary.summarized", { round: run.batches.at(-1)!.round }) : t("flow.summary.summaryNone")} color={COMPONENT_COLOR.split} colors={colors} />
        )}
        <StatTile label={t("session.stat.time")} value={durationText(elapsed, t)} hint={run.status === "active" ? t("session.stat.running") : t("session.stat.took")} color={colors.accent} colors={colors} />
      </View>
    </View>
  );
}

/** The run on the dashboard: its members, the data-flow diagram with the mode's components, and the latest flows. */
export function RunOverview({ run, roles, pending, leadAgentId, colors, width, t, openAgent, onOpen }: { run: RunView | null; roles: SessionInfo["roles"]; pending: SessionInfo["pendingBrief"]; leadAgentId: string | null; colors: Colors; width: number | undefined; t: T; openAgent?: (id: string) => void; onOpen(page: ComponentPage): void }) {
  const now = useNow();
  const card = { gap: 12, width, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: colors.surface1 } as const;
  const intake = pending && (!run || run.status === "closed") ? (
    <Pressable accessibilityRole="button" onPress={() => onOpen("brief")} style={{ gap: 4, padding: 10, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: COMPONENT_COLOR.brief, backgroundColor: withAlpha(COMPONENT_COLOR.brief, 0.08) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <ComponentIcon component="brief" />
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{t("flow.brief.pendingTitle")}</Text>
        <LiveDot color={COMPONENT_COLOR.brief} />
        <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
      </View>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 12 }}>{pending.title} · {pending.goal}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("flow.brief.roles")}: {pending.roles.join(", ")} · {t("flow.brief.plannedTasks")}: {pending.tasks}</Text>
    </Pressable>
  ) : null;
  if (!run) return intake ? <View style={card}>{intake}</View> : null;
  const latest = [...run.events].reverse().slice(0, 8);
  return (
    <View style={card}>
      <RunHeader run={run} colors={colors} t={t} now={now} />
      {intake}
      {roles.length ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("session.formedRoles")}: {roles.map((role) => `${role.name} → ${role.candidate} (${role.model})`).join(" · ")}</Text>
      ) : null}
      <FlowDiagram run={run} pending={pending} leadAgentId={leadAgentId} colors={colors} t={t} now={now} onOpen={onOpen} openAgent={openAgent} />
      <View style={{ gap: 6 }}>
        <SectionTitle colors={colors}>{t("flow.recent")}</SectionTitle>
        {latest.length ? latest.map((event) => <EventRow key={event.seq} event={event} members={run.members} mode={run.mode} colors={colors} t={t} now={now} onPress={() => onOpen(event.component)} />) : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.none")}</Text>}
        {run.events.length > latest.length ? (
          <Pressable accessibilityRole="button" onPress={() => onOpen("flow")} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>{t("flow.viewAll", { count: run.events.length })} →</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Detail pages

function Chip({ label, selected, colors, onPress, color }: { label: string; selected: boolean; colors: Colors; onPress(): void; color?: string }) {
  const accent = color ?? colors.accent;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: selected ? accent : colors.border, backgroundColor: selected ? withAlpha(accent, 0.2) : colors.surface1 }}>
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, colors, children }: { label: string; colors: Colors; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>{label}</Text>
      {typeof children === "string" ? <Text selectable style={{ color: colors.foreground, fontSize: 12 }}>{children}</Text> : children}
    </View>
  );
}

function List({ items, colors }: { items: readonly string[]; colors: Colors }) {
  return <View style={{ gap: 2 }}>{items.map((item, index) => <Text key={index} selectable style={{ color: colors.foreground, fontSize: 12 }}>• {item}</Text>)}</View>;
}

const box = (colors: Colors) => ({ gap: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }) as const;

/** Per party: how much it wrote into the component and received from it over the whole run. */
function Usage({ events, members, colors, t }: { events: readonly FlowEvent[]; members: readonly Member[]; colors: Colors; t: T }) {
  const totals = [...flowTotals(events)].map(([party, row]) => {
    const cells = [...row.values()];
    return { party, wrote: cells.reduce((sum, cell) => sum + cell.in, 0), got: cells.reduce((sum, cell) => sum + cell.out, 0) };
  });
  if (!totals.length) return null;
  const max = Math.max(...totals.map((row) => Math.max(row.wrote, row.got)), 1);
  return (
    <View style={box(colors)}>
      <SectionTitle colors={colors}>{t("flow.usage")}</SectionTitle>
      {totals.map((row) => (
        <View key={row.party} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ width: "34%", maxWidth: 140, color: colors.foreground, fontSize: 12 }}>{partyName(row.party, members, t)}</Text>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ height: 5, borderRadius: 3, width: `${Math.max(3, (row.wrote / max) * 100)}%`, backgroundColor: row.wrote ? colors.accent : colors.surface2 }} />
              </View>
              <Text numberOfLines={1} style={{ width: 82, color: colors.foregroundMuted, fontSize: 10 }}>→ {t("flow.wrote", { count: row.wrote })}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ height: 5, borderRadius: 3, width: `${Math.max(3, (row.got / max) * 100)}%`, backgroundColor: row.got ? colors.statusSuccess : colors.surface2 }} />
              </View>
              <Text numberOfLines={1} style={{ width: 82, color: colors.foregroundMuted, fontSize: 10 }}>← {t("flow.got", { count: row.got })}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function History({ events, members, mode, colors, t, now, title }: { events: readonly FlowEvent[]; members: readonly Member[]; mode: RunView["mode"]; colors: Colors; t: T; now: number; title?: string }) {
  const [all, setAll] = useState(false);
  const newest = [...events].reverse();
  const shown = all ? newest : newest.slice(0, 30);
  return (
    <View style={box(colors)}>
      <SectionTitle colors={colors}>{title ?? t("flow.history")}</SectionTitle>
      {shown.length ? shown.map((event) => <EventRow key={event.seq} event={event} members={members} mode={mode} colors={colors} t={t} now={now} />) : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.none")}</Text>}
      {!all && newest.length > shown.length ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} style={{ alignSelf: "flex-start", paddingVertical: 2 }}>
          <Text style={{ color: colors.accent, fontSize: 12 }}>{t("flow.viewAll", { count: newest.length })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const taskDot = (state: DetailRun["tasks"][number]["state"], colors: Colors) => (state === "doing" ? AMBER : state === "done" ? colors.statusSuccess : state === "dropped" ? colors.foregroundMuted : COMPONENT_COLOR.tasks);

const BOARD_COLUMNS = ["todo", "doing", "done", "dropped"] as const;
type BoardTask = DetailRun["tasks"][number];

/** A task on the board: id, title and who has it, with badges for what waits on it; tap for everything else. */
function TaskCard({ task, run, colors, t, now, expanded, onToggle }: { task: BoardTask; run: DetailRun; colors: Colors; t: T; now: number; expanded: boolean; onToggle(): void }) {
  const history = run.events.filter((event) => (event.component === "tasks" || event.component === "plans") && event.subject === task.id);
  const badges: { label: string; color: string }[] = [];
  if (task.waitingOn.length) badges.push({ label: t("session.waitsFor", { ids: task.waitingOn.join(", ") }), color: colors.foregroundMuted });
  if (task.plan) badges.push({ label: task.plan.status === "pending" ? t("session.planPending") : task.plan.status === "approved" ? t("session.planApproved") : t("session.planRejected"), color: task.plan.status === "approved" ? colors.statusSuccess : task.plan.status === "pending" ? COMPONENT_COLOR.plans : RED });
  if (task.feedback && task.state !== "done") badges.push({ label: t("session.sentBack"), color: RED });
  return (
    <View style={{ borderRadius: 8, borderWidth: 1, borderColor: expanded ? withAlpha(taskDot(task.state, colors), 0.6) : colors.border, backgroundColor: colors.surface1, opacity: task.state === "dropped" ? 0.6 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={{ gap: 5, padding: 9 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: taskDot(task.state, colors), fontSize: 11, fontWeight: "800", fontFamily: Platform.OS === "web" ? "monospace" : undefined }}>{task.id}</Text>
          {task.role ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 10, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: colors.surface2 }}>{task.role}</Text> : null}
          <View style={{ flex: 1 }} />
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={13} color={colors.foregroundMuted} />
        </View>
        <Text numberOfLines={expanded ? undefined : 3} style={{ color: colors.foreground, fontSize: 12, lineHeight: 17 }}>{task.title}</Text>
        {badges.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {badges.map((badge) => <Text key={badge.label} style={{ color: badge.color, fontSize: 10, fontWeight: "600", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: withAlpha(badge.color, 0.4) }}>{badge.label}</Text>)}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: task.ownerTitle ? withAlpha(AMBER, 0.2) : colors.surface2 }}>
            <Text style={{ color: colors.foreground, fontSize: 9, fontWeight: "700" }}>{(task.ownerTitle ?? "·").charAt(0).toUpperCase()}</Text>
          </View>
          <Text numberOfLines={1} style={{ flex: 1, color: colors.foregroundMuted, fontSize: 10 }}>{task.ownerTitle ?? t("session.anyone")}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{agoText(task.updatedAt, now, t)}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 8, paddingHorizontal: 9, paddingBottom: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
          {task.detail ? <Field label={t("flow.details")} colors={colors}>{task.detail}</Field> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            <Field label={t("flow.tasks.createdBy")} colors={colors}>{task.createdBy === "lead" ? t("flow.lead") : task.createdBy}</Field>
            {task.deps.length ? <Field label={t("flow.tasks.waitsFor")} colors={colors}>{task.deps.map((dep) => `${dep}${task.waitingOn.includes(dep) ? " ⏳" : " ✓"}`).join(", ")}</Field> : null}
          </View>
          {task.files.length ? <Field label={t("flow.tasks.files")} colors={colors}>{task.files.join(", ")}</Field> : null}
          {task.plan ? (
            <Field label={`${t("flow.tasks.plan")} · ${task.plan.status === "pending" ? t("flow.plans.pending") : task.plan.status === "approved" ? t("flow.plans.approved") : t("flow.plans.rejected")}`} colors={colors}>
              <View style={{ gap: 2 }}>
                <Text selectable style={{ color: colors.foreground, fontSize: 12 }}>{task.plan.text}</Text>
                {task.plan.feedback ? <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.lead")}: {task.plan.feedback}</Text> : null}
              </View>
            </Field>
          ) : null}
          {task.result ? <Field label={t("flow.tasks.result")} colors={colors}>{task.result}</Field> : null}
          {task.feedback ? <Field label={t("flow.tasks.feedback")} colors={colors}>{task.feedback}</Field> : null}
          {history.length ? (
            <Field label={t("flow.history")} colors={colors}>
              <View style={{ gap: 4 }}>{[...history].reverse().map((event) => <EventRow key={event.seq} event={event} members={run.members} mode={run.mode} colors={colors} t={t} now={now} />)}</View>
            </Field>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The shared task board as a Kanban: one column per state when there is room, stacked sections in a narrow panel. */
function TasksPage({ run, colors, t, now }: { run: DetailRun; colors: Colors; t: T; now: number }) {
  const [role, setRole] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(0);
  const roles = [...new Set(run.tasks.map((task) => task.role ?? ""))];
  const tasks = run.tasks.filter((task) => role === null || (task.role ?? "") === role);
  // Dropped tasks only get a column when there are any.
  const columns = BOARD_COLUMNS.filter((state) => state !== "dropped" || tasks.some((task) => task.state === "dropped"));
  const wide = width >= 620;
  const toggle = (id: string) => setOpen((current) => ({ ...current, [id]: !current[id] }));
  return (
    <View style={{ gap: 10 }} onLayout={(event) => {
      const next = Math.round(event.nativeEvent.layout.width);
      setWidth((current) => (current === next ? current : next));
    }}>
      {roles.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Chip label={`${t("flow.filterAll")} ${run.tasks.length}`} selected={role === null} colors={colors} color={COMPONENT_COLOR.tasks} onPress={() => setRole(null)} />
          {roles.map((entry) => <Chip key={entry} label={`${entry || t("session.anyone")} ${run.tasks.filter((task) => (task.role ?? "") === entry).length}`} selected={role === entry} colors={colors} color={COMPONENT_COLOR.tasks} onPress={() => setRole(entry)} />)}
        </View>
      ) : null}
      {!run.tasks.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.tasks.none")}</Text> : (
        <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-start" : "stretch", gap: wide ? 8 : 12 }}>
          {columns.map((state) => {
            const column = tasks.filter((task) => task.state === state);
            const color = taskDot(state, colors);
            return (
              <View key={state} style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: 6, padding: wide ? 6 : 0, borderRadius: 10, backgroundColor: wide ? withAlpha(color, 0.06) : "transparent" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                  <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700" }}>{t(`flow.tasks.filter.${state}`)}</Text>
                  <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{column.length}</Text>
                </View>
                {column.length ? column.map((task) => <TaskCard key={task.id} task={task} run={run} colors={colors} t={t} now={now} expanded={open[task.id] ?? false} onToggle={() => toggle(task.id)} />) : (
                  <Text style={{ color: colors.foregroundMuted, fontSize: 11, paddingHorizontal: 2, paddingVertical: 6 }}>—</Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function PlansPage({ run, colors, t }: { run: DetailRun; colors: Colors; t: T }) {
  const withPlans = run.tasks.filter((task) => task.plan);
  if (!run.planApproval && !withPlans.length) return <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.plans.off")}</Text>;
  if (!withPlans.length) return <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.plans.none")}</Text>;
  const order = { pending: 0, rejected: 1, approved: 2 } as const;
  return (
    <View style={{ gap: 8 }}>
      {[...withPlans].sort((a, b) => order[a.plan!.status] - order[b.plan!.status]).map((task) => {
        const plan = task.plan!;
        const color = plan.status === "pending" ? COMPONENT_COLOR.plans : plan.status === "approved" ? colors.statusSuccess : RED;
        return (
          <View key={task.id} style={[box(colors), { borderLeftWidth: 3, borderLeftColor: color }]}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}><Text style={{ fontWeight: "700" }}>{task.id}</Text> {task.title}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
              {[task.ownerTitle, plan.status === "pending" ? t("flow.plans.pending") : plan.status === "approved" ? t("flow.plans.approved") : t("flow.plans.rejected"), plan.status === "pending" ? null : plan.delivered ? t("flow.plans.delivered") : t("flow.plans.notDelivered")].filter(Boolean).join(" · ")}
            </Text>
            <Field label={t("flow.tasks.plan")} colors={colors}>{plan.text}</Field>
            {plan.feedback ? <Field label={t("flow.lead")} colors={colors}>{plan.feedback}</Field> : null}
          </View>
        );
      })}
    </View>
  );
}

const POST_COLOR = (kind: string, colors: Colors) => (kind === "finding" || kind === "question" ? AMBER : kind === "done" ? colors.statusSuccess : kind === "brief" ? COMPONENT_COLOR.brief : kind === "answer" ? COMPONENT_COLOR.board : colors.foregroundMuted);
const KNOWN_KINDS = ["brief", "update", "finding", "question", "answer", "done", "note"] as const;

/** The team board as a conversation: posts oldest first, grouped by round, the orchestrator's on the right. */
function BoardPage({ run, colors, t, now }: { run: DetailRun; colors: Colors; t: T; now: number }) {
  const kinds = [...new Set(run.posts.map((post) => post.kind))];
  const [kind, setKind] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const posts = run.posts.filter((post) => kind === null || post.kind === kind);
  const recipient = (to: string) => (to === "lead" ? t("flow.lead") : to);
  const last = run.posts.at(-1)?.seq ?? 0;
  const readers = [{ id: "lead", title: t("flow.lead"), readSeq: run.leadReadSeq }, ...run.members.filter((member) => !member.retired).map((member) => ({ id: member.agentId, title: member.title, readSeq: member.readSeq }))];
  const kindLabel = (value: string) => ((KNOWN_KINDS as readonly string[]).includes(value) ? t(`flow.board.kind.${value as (typeof KNOWN_KINDS)[number]}`) : value);
  return (
    <View style={{ gap: 10 }}>
      <View style={[box(colors), { gap: 8 }]}>
        <SectionTitle colors={colors}>{t("flow.board.inbox")}</SectionTitle>
        {readers.map((reader) => (
          <View key={reader.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ width: 120, color: colors.foreground, fontSize: 12, fontWeight: reader.id === "lead" ? "700" : "500" }}>{reader.title}</Text>
            <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" }}>
              <View style={{ width: `${last ? Math.round((Math.min(reader.readSeq, last) / last) * 100) : 0}%`, height: 5, backgroundColor: COMPONENT_COLOR.board }} />
            </View>
            <Text style={{ color: last > reader.readSeq ? AMBER : colors.foregroundMuted, fontSize: 10 }}>{last > reader.readSeq ? t("flow.board.unread", { count: last - reader.readSeq }) : t("flow.board.readUpTo", { seq: reader.readSeq })}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label={`${t("flow.filterAll")} ${run.posts.length}`} selected={kind === null} colors={colors} color={COMPONENT_COLOR.board} onPress={() => setKind(null)} />
        {kinds.map((entry) => <Chip key={entry} label={`${kindLabel(entry)} ${run.posts.filter((post) => post.kind === entry).length}`} selected={kind === entry} colors={colors} color={POST_COLOR(entry, colors)} onPress={() => setKind(entry)} />)}
      </View>
      {!posts.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.board.none")}</Text> : null}
      {posts.map((post, index) => {
        const lead = post.author === "lead";
        const author = lead ? t("flow.lead") : run.members.find((member) => member.agentId === post.agentId)?.title ?? post.author;
        const accent = POST_COLOR(post.kind, colors);
        const newRound = index === 0 || posts[index - 1]!.round !== post.round;
        return (
          <View key={post.seq} style={{ gap: 6 }}>
            {newRound ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                <Text style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 }}>{t("session.round", { round: post.round, rounds: run.rounds })}</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              </View>
            ) : null}
            <View style={{ flexDirection: lead ? "row-reverse" : "row", alignItems: "flex-start", gap: 8 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: lead ? withAlpha(colors.accent, 0.22) : withAlpha(accent, 0.2) }}>
                <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "800" }}>{author.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flexShrink: 1, maxWidth: "88%", gap: 4, padding: 10, borderRadius: 10, borderTopLeftRadius: lead ? 10 : 3, borderTopRightRadius: lead ? 3 : 10, borderWidth: 1, borderColor: withAlpha(accent, 0.35), backgroundColor: lead ? withAlpha(colors.accent, 0.08) : colors.surface1 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700" }}>{author}</Text>
                  <Text style={{ color: accent, fontSize: 10, fontWeight: "700", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: withAlpha(accent, 0.14) }}>{kindLabel(post.kind)}</Text>
                  {post.to.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>→ {post.to.map(recipient).join(", ")}</Text> : null}
                  <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>#{post.seq} · {agoText(post.at, now, t)}</Text>
                </View>
                <Text selectable numberOfLines={open[post.seq] || post.text.length < 420 ? undefined : 7} style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{post.text}</Text>
                {post.text.length >= 420 ? (
                  <Pressable accessibilityRole="button" onPress={() => setOpen((current) => ({ ...current, [post.seq]: !current[post.seq] }))} style={{ alignSelf: "flex-start" }}>
                    <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>{open[post.seq] ? t("flow.board.less") : t("flow.board.more")}</Text>
                  </Pressable>
                ) : null}
                {post.files.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: Platform.OS === "web" ? "monospace" : undefined }}>{post.files.join(", ")}</Text> : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ClaimsPage({ run, colors, t, now }: { run: DetailRun; colors: Colors; t: T; now: number }) {
  const holders = [...new Set(run.claims.map((claim) => claim.agentId))];
  if (!holders.length) return <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.claims.none")}</Text>;
  return (
    <View style={{ gap: 8 }}>
      {holders.map((holder) => (
        <View key={holder} style={box(colors)}>
          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{run.members.find((member) => member.agentId === holder)?.title ?? holder}</Text>
          {run.claims.filter((claim) => claim.agentId === holder).map((claim) => (
            <View key={claim.path} style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
              <Icon name="FileLock" size={12} color={COMPONENT_COLOR.claims} />
              <Text selectable style={{ flex: 1, color: colors.foreground, fontSize: 12, fontFamily: Platform.OS === "web" ? "monospace" : undefined }}>{claim.path}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>{t("flow.claims.since", { ago: agoText(claim.at, now, t) })}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const stateDot = (state: DetailRun["members"][number]["state"], colors: Colors) => (state === "working" ? AMBER : state === "done" ? colors.statusSuccess : state === "failed" || state === "attention" ? RED : colors.foregroundMuted);
const batchLabel = (batch: DetailRun["batches"][number], t: T) => (batch.followUp ? `${t("flow.split.batch", { round: batch.round })} · ${t("flow.split.followUp")}` : t("flow.split.batch", { round: batch.round }));
/** When a member's latest report came in, from the data flow. */
const reportAt = (run: DetailRun, agentId: string, after?: string) => [...run.events].reverse().find((event) => event.component === "reports" && event.action === "report" && event.from === agentId && (!after || event.at >= after))?.at;

/** Delegation, step 1: each split of a request into packets, with why delegation and the overlap check. */
function SplitPage({ run, colors, t, now }: { run: DetailRun; colors: Colors; t: T; now: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Runs from before splits were recorded show their packets as a task list.
  if (!run.batches.length) return run.tasks.length ? <TasksPage run={run} colors={colors} t={t} now={now} /> : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.split.none")}</Text>;
  return (
    <View style={{ gap: 8 }}>
      {[...run.batches].reverse().map((batch) => (
        <View key={batch.round} style={[box(colors), { borderLeftWidth: 3, borderLeftColor: COMPONENT_COLOR.split }]}>
          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{batchLabel(batch, t)} · <Text style={{ fontWeight: "500" }}>{batch.title}</Text></Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{agoText(batch.at, now, t)} · {t("flow.split.packets")} {batch.taskIds.length}</Text>
          {batch.reason ? <Field label={t("flow.split.reason")} colors={colors}>{batch.reason}</Field> : null}
          {batch.warnings.length ? (
            <Text style={{ color: AMBER, fontSize: 12 }}>⚠ {t("flow.split.overlap")}: {batch.warnings.join(", ")}</Text>
          ) : !batch.followUp && batch.taskIds.length > 1 ? (
            <Text style={{ color: colors.statusSuccess, fontSize: 12 }}>✓ {t("flow.split.disjoint")}</Text>
          ) : null}
          {batch.taskIds.map((id) => {
            const task = run.tasks.find((entry) => entry.id === id);
            if (!task) return null;
            const expanded = open[id] ?? false;
            return (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen((current) => ({ ...current, [id]: !expanded }))} style={{ gap: 4, padding: 8, borderRadius: 6, backgroundColor: colors.surface2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: taskDot(task.state, colors) }} />
                  <Text numberOfLines={expanded ? undefined : 1} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12 }}>
                    <Text style={{ fontWeight: "700" }}>{task.id}</Text> {task.role ?? t("session.anyone")} → {task.ownerTitle ?? "-"} · {t(`flow.tasks.filter.${task.state}`)}
                  </Text>
                  <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
                </View>
                {expanded ? (
                  <View style={{ gap: 6, paddingLeft: 14 }}>
                    <Text selectable style={{ color: colors.foreground, fontSize: 12 }}>{task.detail || task.title}</Text>
                    {task.result ? <Field label={t("flow.tasks.result")} colors={colors}>{task.result}</Field> : null}
                  </View>
                ) : <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 11, paddingLeft: 14 }}>{task.title}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Delegation, step 2: each sub-agent's own context, holding only the packets it was given. */
function ContextsPage({ run, colors, t }: { run: DetailRun; colors: Colors; t: T }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!run.members.length) return <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.contexts.none")}</Text>;
  const batchOf = (id: string) => run.batches.find((batch) => batch.taskIds.includes(id));
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.foreground, fontSize: 12, padding: 8, borderRadius: 6, backgroundColor: withAlpha(COMPONENT_COLOR.contexts, 0.12) }}>🔒 {t("flow.contexts.isolation")}</Text>
      {run.members.map((member) => {
        const contexts = run.events.filter((event) => event.component === "contexts" && event.to.includes(member.agentId) && (event.action === "start" || event.action === "continue"));
        const attention = run.events.filter((event) => event.component === "contexts" && event.action === "attention" && event.from === member.agentId).length;
        const packets = run.tasks.filter((task) => task.owner === member.agentId);
        return (
          <View key={member.agentId} style={[box(colors), { opacity: member.retired ? 0.6 : 1 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateDot(member.state, colors) }} />
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{member.title}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{member.retired ? t("session.retired") : t(`session.state.${member.state}`)}</Text>
            </View>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
              {[member.role, member.provider && member.model ? `${member.provider}/${member.model}` : null, contexts[0] ? (contexts[0].action === "continue" ? t("flow.contexts.continued") : t("flow.contexts.started")) : null, attention ? t("flow.contexts.attention", { count: attention }) : null].filter(Boolean).join(" · ")}
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>{t("flow.contexts.received")}</Text>
            {packets.map((task) => {
              const key = `${member.agentId}:${task.id}`;
              const expanded = open[key] ?? false;
              const batch = batchOf(task.id);
              return (
                <Pressable key={task.id} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen((current) => ({ ...current, [key]: !expanded }))} style={{ gap: 3, padding: 8, borderRadius: 6, backgroundColor: colors.surface2 }}>
                  <Text numberOfLines={expanded ? undefined : 1} style={{ color: colors.foreground, fontSize: 12 }}>
                    <Text style={{ fontWeight: "700" }}>{task.id}</Text>{batch ? ` · ${batchLabel(batch, t)}` : ""} · {task.title}
                  </Text>
                  {expanded ? <Text selectable style={{ color: colors.foreground, fontSize: 12 }}>{task.detail || task.title}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** Delegation, step 3: what each sub-agent reported back, and how long its packet took. */
function ReportsPage({ run, colors, t }: { run: DetailRun; colors: Colors; t: T }) {
  return (
    <View style={{ gap: 8 }}>
      {run.members.map((member) => {
        const at = reportAt(run, member.agentId, member.dispatchedAt);
        return (
          <View key={member.agentId} style={box(colors)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateDot(member.state, colors) }} />
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{member.title}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                {member.state === "working" || member.state === "attention" ? t("flow.reports.working") : member.collected ? t("flow.reports.collected") : t("flow.reports.waiting")}
                {at ? ` · ${t("flow.took", { time: durationText(Date.parse(at) - Date.parse(member.dispatchedAt), t) })}` : ""}
              </Text>
            </View>
            {member.task ? <Field label={t("flow.reports.task")} colors={colors}><Text selectable numberOfLines={6} style={{ color: colors.foreground, fontSize: 12 }}>{member.task}</Text></Field> : null}
            {member.result ? <Field label={t("flow.reports.result")} colors={colors}>{member.result}</Field> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Delegation, step 4: the lead's summary of each batch, how long the batch took, and its slowest packet. */
function SummaryPage({ run, colors, t, now }: { run: DetailRun; colors: Colors; t: T; now: number }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.foreground, fontSize: 12, padding: 8, borderRadius: 6, backgroundColor: withAlpha(AMBER, 0.12) }}>⚠ {t("flow.summaryPage.noCheck")}</Text>
      {!run.batches.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.summaryPage.none")}</Text> : null}
      {[...run.batches].reverse().map((batch) => {
        const owners = new Set(batch.taskIds.map((id) => run.tasks.find((task) => task.id === id)?.owner).filter((owner): owner is string => !!owner));
        const members = run.members.filter((member) => owners.has(member.agentId));
        const reported = members.filter((member) => member.state === "done" || member.state === "failed").length;
        const collected = members.filter((member) => member.collected).length;
        const timings = members.map((member) => ({ member, at: reportAt(run, member.agentId, batch.at) })).filter((entry): entry is { member: typeof members[number]; at: string } => !!entry.at);
        const slowest = timings.sort((a, b) => b.at.localeCompare(a.at))[0];
        return (
          <View key={batch.round} style={[box(colors), { borderLeftWidth: 3, borderLeftColor: COMPONENT_COLOR.summary }]}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{batchLabel(batch, t)} · <Text style={{ fontWeight: "500" }}>{batch.title}</Text></Text>
            <Text style={{ color: batch.summaryAt ? colors.statusSuccess : colors.foregroundMuted, fontSize: 12 }}>
              {batch.summaryAt ? t("flow.summaryPage.done", { ago: agoText(batch.summaryAt, now, t) }) : t("flow.summaryPage.waiting", { reported, total: members.length, collected })}
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
              {[batch.summaryAt ? t("flow.summaryPage.latency", { time: durationText(Date.parse(batch.summaryAt) - Date.parse(batch.at), t) }) : null, slowest ? t("flow.summaryPage.slowest", { member: slowest.member.title, time: durationText(Date.parse(slowest.at) - Date.parse(batch.at), t) }) : null].filter(Boolean).join(" · ")}
            </Text>
            {batch.summary ? <Text selectable style={{ color: colors.foreground, fontSize: 12 }}>{batch.summary}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function BriefPage({ detail, colors, t, now }: { detail: Detail; colors: Colors; t: T; now: number }) {
  const pending = detail.pendingBrief;
  const brief = detail.run?.brief ?? null;
  const fields = (value: { goal: string; requirements: string[]; acceptance: string[]; constraints: string[]; outOfScope: string[] }) => (
    <>
      <Field label={t("flow.brief.goal")} colors={colors}>{value.goal}</Field>
      {value.requirements.length ? <Field label={t("flow.brief.requirements")} colors={colors}><List items={value.requirements} colors={colors} /></Field> : null}
      {value.acceptance.length ? <Field label={t("flow.brief.acceptance")} colors={colors}><List items={value.acceptance} colors={colors} /></Field> : null}
      {value.constraints.length ? <Field label={t("flow.brief.constraints")} colors={colors}><List items={value.constraints} colors={colors} /></Field> : null}
      {value.outOfScope.length ? <Field label={t("flow.brief.outOfScope")} colors={colors}><List items={value.outOfScope} colors={colors} /></Field> : null}
    </>
  );
  return (
    <View style={{ gap: 8 }}>
      {pending && (!detail.run || detail.run.status === "closed") ? (
        <View style={[box(colors), { borderStyle: "dashed", borderColor: COMPONENT_COLOR.brief }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <LiveDot color={COMPONENT_COLOR.brief} />
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{t("flow.brief.pendingTitle")} · {agoText(pending.at, now, t)}</Text>
          </View>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("flow.brief.pendingHint")}</Text>
          <Text selectable style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{pending.brief.title}</Text>
          {fields(pending.brief)}
          <Field label={t("flow.brief.plannedTasks")} colors={colors}>
            <View style={{ gap: 2 }}>
              {pending.tasks.map((task, index) => <Text key={index} selectable style={{ color: colors.foreground, fontSize: 12 }}>{index + 1}. {task.title} ({task.role ?? t("session.anyone")}){task.after.length ? ` · ${t("session.waitsFor", { ids: task.after.join(", ") })}` : ""}</Text>)}
            </View>
          </Field>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("flow.brief.roles")}: {pending.roles.join(", ")} · {t("flow.brief.rounds")}: {pending.rounds}{pending.planApproval ? ` · ${t("flow.brief.planApproval")}` : ""}</Text>
        </View>
      ) : null}
      {brief ? (
        <View style={box(colors)}>
          <Text selectable style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{brief.title}</Text>
          {fields(brief)}
          {brief.userConfirmation ? <Field label={t("flow.brief.confirmation")} colors={colors}>{`“${brief.userConfirmation}”`}</Field> : null}
        </View>
      ) : !pending ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("flow.brief.none")}</Text> : null}
    </View>
  );
}

function FlowPage({ run, colors, t, now }: { run: DetailRun; colors: Colors; t: T; now: number }) {
  const [component, setComponent] = useState<RunComponent | null>(null);
  const components = componentsOf(run.mode);
  const events = run.events.filter((event) => component === null || event.component === component);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label={`${t("flow.filterAll")} ${run.events.length}`} selected={component === null} colors={colors} onPress={() => setComponent(null)} />
        {components.map((entry) => <Chip key={entry} label={`${componentName(entry, run.mode, t)} ${run.events.filter((event) => event.component === entry).length}`} selected={component === entry} colors={colors} color={COMPONENT_COLOR[entry]} onPress={() => setComponent(entry)} />)}
      </View>
      <Usage events={events} members={run.members} colors={colors} t={t} />
      <History events={events} members={run.members} mode={run.mode} colors={colors} t={t} now={now} title={t("flow.allTitle")} />
    </View>
  );
}

/** One component of the session's run, full size: what it is, who uses it, its content and its history. */
export function ComponentDetail({ page, sessionAgentId, colors, t }: { page: ComponentPage; sessionAgentId: string; colors: Colors; t: T }) {
  const readDetail = useRpc(teamSessionDetailRpc);
  const now = useNow();
  const detail = useQuery({
    queryKey: ["dashboard", "session-detail", sessionAgentId],
    queryFn: () => readDetail({ agentId: sessionAgentId }),
    refetchInterval: (query) => (query.state.data?.run?.status === "active" || query.state.data?.pendingBrief ? 3000 : false),
  });
  const run = detail.data?.run ?? null;
  const mode = run?.mode ?? "team";
  const title = page === "flow" ? t("flow.allTitle") : componentName(page, mode, t);
  const about = page === "flow" ? t("flow.hint") : page === "tasks" && mode === "delegation" ? t("flow.about.delegationTasks") : t(`flow.about.${page}`);
  const events = run ? run.events.filter((event) => page === "flow" || event.component === page) : [];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 10, backgroundColor: page === "flow" ? colors.surface1 : withAlpha(COMPONENT_COLOR[page], 0.08), borderWidth: 1, borderColor: page === "flow" ? colors.border : withAlpha(COMPONENT_COLOR[page], 0.3) }}>
        {page === "flow" ? <Icon name="Activity" size={22} color={colors.foreground} /> : <ComponentIcon component={page} size={30} />}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{title}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{about}</Text>
        </View>
      </View>
      {detail.isLoading ? <Loading /> : detail.error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{String(detail.error)}</Text> : !detail.data ? null : (
        <>
          {page === "brief" ? <BriefPage detail={detail.data} colors={colors} t={t} now={now} /> : null}
          {run && page === "tasks" ? <TasksPage run={run} colors={colors} t={t} now={now} /> : null}
          {run && page === "plans" ? <PlansPage run={run} colors={colors} t={t} /> : null}
          {run && page === "board" ? <BoardPage run={run} colors={colors} t={t} now={now} /> : null}
          {run && page === "claims" ? <ClaimsPage run={run} colors={colors} t={t} now={now} /> : null}
          {run && page === "split" ? <SplitPage run={run} colors={colors} t={t} now={now} /> : null}
          {run && page === "contexts" ? <ContextsPage run={run} colors={colors} t={t} /> : null}
          {run && page === "reports" ? <ReportsPage run={run} colors={colors} t={t} /> : null}
          {run && page === "summary" ? <SummaryPage run={run} colors={colors} t={t} now={now} /> : null}
          {run && page === "flow" ? <FlowPage run={run} colors={colors} t={t} now={now} /> : null}
          {run && page !== "flow" ? (
            <>
              <Usage events={events} members={run.members} colors={colors} t={t} />
              <History events={events} members={run.members} mode={run.mode} colors={colors} t={t} now={now} />
            </>
          ) : null}
          {!run && page !== "brief" ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("session.noRun")}</Text> : null}
        </>
      )}
    </View>
  );
}
