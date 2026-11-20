// The data-flow diagram: who takes part on the left, the mode's parts on the right, and the latest flows between them as
// curves (an arrowhead shows where the data goes; a moving dot, a flow of the last 30 seconds). With room, the latest
// flows list sits in a column on the right; otherwise below. Narrow, the participants stack as chips above the part
// cards and no curves are drawn. Curves are made of short rotated views, so no native drawing library is needed.
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { withAlpha } from "../../shared/color";
import { componentsOf, type RunComponent } from "../../shared/flow";
import { AgentAvatar, Dot, PART, Tile, type Kit } from "../kit";
import { centred, stack, type Box } from "./flow-layout";
import { agoText, COMPONENT_ICON, componentName, describeEvent, hovered, LEAD_TONE, LIVE_MS, LivePill, memberStateText, memberTone, partyName, summaryOf, useWidth, type ComponentPage, type FlowEvent, type RunView, type SessionInfo, type Tr } from "./common";

type Link = { party: string; component: RunComponent; direction: "in" | "out"; count: number; live: boolean };
type Point = { x: number; y: number };

/** Flows among the latest events, per party, part and direction. */
function linksOf(events: readonly FlowEvent[], parties: { has(party: string): boolean }, now: number): Link[] {
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

/** The parties to draw: the user when it took part lately, the lead, the members, and the plugin when it wrote lately. */
function partiesOf(run: RunView, recent: readonly FlowEvent[]): string[] {
  const members = run.members.filter((member) => !member.retired || recent.some((event) => event.from === member.agentId || event.to.includes(member.agentId)));
  return [
    ...(recent.some((event) => event.from === "user" || event.to.includes("user")) ? ["user"] : []),
    "lead",
    ...members.map((member) => member.agentId),
    // The plugin only shows when it wrote into a part itself; what it hands out is drawn from the part.
    ...(recent.some((event) => event.from === "plugin" && event.direction === "in") ? ["plugin"] : []),
  ];
}

const partyIcon = (party: string) => (party === "user" ? "User" : party === "lead" ? "Crown" : party === "plugin" ? "Plug" : "Bot");

function usePacket(): Animated.Value {
  const packet = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(packet, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
    animation.start();
    return () => animation.stop();
  }, [packet]);
  return packet;
}

/** Points along a cubic Bézier curve. */
function bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index++) {
    const s = index / steps;
    const u = 1 - s;
    const a = u * u * u;
    const b = 3 * u * u * s;
    const c = 3 * u * s * s;
    const d = s * s * s;
    points.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return points;
}

/** One flow: a curve from where the data comes from to where it goes, its arrowhead, and a moving dot when live. */
function FlowCurve({ k, from, to, color, live, dim, hot, count, direction, packet }: { k: Kit; from: Point; to: Point; color: string; live: boolean; dim: boolean; hot: boolean; count: number; direction: "in" | "out"; packet: Animated.Value }) {
  const dir = Math.sign(to.x - from.x) || 1;
  const endX = to.x - 6 * dir;
  const bend = (endX - from.x) / 2;
  const points = useMemo(() => bezier(from, { x: from.x + bend, y: from.y }, { x: endX - bend, y: to.y }, { x: endX, y: to.y }, 18), [from.x, from.y, to.y, endX, bend]);
  const stroke = Math.min(3.2, 1.2 + Math.log2(Math.max(1, count)) * 0.45);
  const opacity = dim ? 0.12 : hot ? 1 : live ? 0.9 : 0.42;
  const input = points.map((_, index) => index / (points.length - 1));
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, opacity }}>
        {points.slice(1).map((point, index) => {
          const previous = points[index]!;
          const dx = point.x - previous.x;
          const dy = point.y - previous.y;
          const length = Math.hypot(dx, dy) + 0.8;
          return (
            <View
              key={index}
              style={{ position: "absolute", left: (previous.x + point.x) / 2 - length / 2, top: (previous.y + point.y) / 2 - stroke / 2, width: length, height: stroke, borderRadius: stroke / 2, backgroundColor: color, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }}
            />
          );
        })}
        <View
          style={{
            position: "absolute",
            top: to.y - 4,
            width: 0,
            height: 0,
            borderTopWidth: 4,
            borderBottomWidth: 4,
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            ...(dir > 0 ? { left: endX - 1, borderLeftWidth: 7, borderLeftColor: color } : { left: to.x - 1, borderRightWidth: 7, borderRightColor: color }),
          }}
        />
      </View>
      {live && !dim ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: color,
            shadowColor: color,
            shadowOpacity: 0.9,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 0 },
            transform: [{ translateX: packet.interpolate({ inputRange: input, outputRange: points.map((point) => point.x - 3.5) }) }, { translateY: packet.interpolate({ inputRange: input, outputRange: points.map((point) => point.y - 3.5) }) }],
          }}
        />
      ) : null}
      {hot ? (
        <View pointerEvents="none" style={{ position: "absolute", left: (from.x + to.x) / 2 - 18, top: (from.y + to.y) / 2 - 16, width: 36, alignItems: "center" }}>
          <Text style={{ color: k.c.fg, fontSize: 10.5, fontWeight: "700", paddingHorizontal: 4, borderRadius: 4, backgroundColor: k.c.card }}>
            {direction === "in" ? "→" : "←"} {count}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/** A part of the mode: its tile and name, how it stands, its latest event and when. */
function ComponentCard({ k, t, component, run, pending, now, live, selected, dim, onOpen, onHover, onLayout }: { k: Kit; t: Tr; component: RunComponent; run: RunView; pending: SessionInfo["pendingBrief"]; now: number; live: boolean; selected: boolean; dim: boolean; onOpen(): void; onHover(on: boolean): void; onLayout?: (event: LayoutChangeEvent) => void }) {
  const last = [...run.events].reverse().find((event) => event.component === component);
  const tone = PART[component];
  const total = run.tasks.filter((task) => task.state !== "dropped").length;
  const progress = (component === "tasks" || component === "split") && total > 0;
  const done = run.tasks.filter((task) => task.state === "done").length;
  const name = componentName(component, run.mode, t);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${t("flow.details")}`}
      accessibilityState={{ selected }}
      onPress={onOpen}
      onHoverIn={() => onHover(true)}
      onHoverOut={() => onHover(false)}
      onLayout={onLayout}
      style={(state) => ({
        gap: 5,
        paddingHorizontal: 11,
        paddingVertical: 9,
        borderRadius: k.radius,
        borderWidth: 1,
        borderColor: selected ? tone : live ? withAlpha(tone, 0.6) : hovered(state) ? withAlpha(tone, 0.55) : k.c.border,
        backgroundColor: selected ? withAlpha(tone, 0.08) : k.c.card,
        opacity: dim ? 0.45 : state.pressed ? 0.9 : 1,
        minWidth: 0,
        ...(selected || live ? { shadowColor: tone, shadowOpacity: selected ? 0.55 : 0.3, shadowRadius: selected ? 2 : 6, shadowOffset: { width: 0, height: 0 } } : {}),
      })}
    >
      <View style={{ position: "absolute", left: -1, top: 8, bottom: 8, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: tone, opacity: 0.9 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tile k={k} icon={COMPONENT_ICON[component]} tone={tone} size={24} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 13, fontWeight: "700" }}>
          {name}
        </Text>
        {live ? <Dot tone={tone} live size={7} /> : null}
        <Icon name="ChevronRight" size={14} color={k.c.mutedFg} />
      </View>
      <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: 11.5 }}>
        {summaryOf(component, run, pending, t)}
      </Text>
      {progress ? (
        <View style={{ height: 3, borderRadius: 2, backgroundColor: k.c.muted, overflow: "hidden" }}>
          <View style={{ width: `${Math.round((done / total) * 100)}%`, height: 3, borderRadius: 2, backgroundColor: tone }} />
        </View>
      ) : null}
      {last ? (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: withAlpha(k.c.fg, 0.85), fontSize: 11.5 }}>
            {describeEvent(last, run.members, t)}
          </Text>
          <Text style={{ color: k.c.mutedFg, fontSize: 10.5 }}>{agoText(last.at, now, t)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export interface DiagramProps {
  k: Kit;
  t: Tr;
  run: RunView;
  pending: SessionInfo["pendingBrief"];
  now: number;
  /** The lead's agent, to open it. */
  leadAgentId: string | null;
  /** The part whose page is open below. */
  selected?: ComponentPage | null;
  onOpen(page: ComponentPage): void;
  openAgent?: (id: string) => void;
  /** The latest flows: a column on the right when there is room, else below. */
  aside?: ReactNode;
  /** Events to draw lines for: the latest this many. */
  window?: number;
  /** A member's client and model, for its avatar. */
  runtimeOf?: (agentId: string) => { provider: string | null; model: string | null };
}

/** The gap between the participants, and between the part cards. */
const ROW_GAP = 8;

export function FlowDiagram({ k, t, run, pending, now, leadAgentId, selected, onOpen, openAgent, aside, window: span = 24, runtimeOf }: DiagramProps) {
  const packet = usePacket();
  const [width, onLayout] = useWidth();
  const stacked = width > 0 && width < 520;
  const withAside = !!aside && width >= 900;
  const components = componentsOf(run.mode);
  const recent = useMemo(() => run.events.slice(-span), [run.events, span]);
  const parties = partiesOf(run, recent);
  const links = linksOf(recent, new Set(parties), now);
  const liveComponents = new Set(links.filter((link) => link.live).map((link) => link.component));
  const [hot, setHot] = useState(null as string | null);
  // Heights only: positions come from them (see flow-layout.ts), since onLayout misses an element that only moves.
  const [partyHeight, setPartyHeight] = useState<Record<string, number>>({});
  const [cardHeight, setCardHeight] = useState<Record<string, number>>({});
  // The row's own height: the latest flows beside it can stretch it taller than either column.
  const [gridHeight, setGridHeight] = useState(0);

  const stateOf = (party: string) => {
    const member = run.members.find((entry) => entry.agentId === party);
    if (!member) return { tone: party === "lead" ? LEAD_TONE : k.c.mutedFg, live: false, text: "", role: "" };
    return { ...memberTone(k, member), text: memberStateText(member, t), role: member.role };
  };
  const openId = (party: string) => (party === "lead" ? leadAgentId : run.members.some((member) => member.agentId === party) ? party : null);
  const partyDim = (party: string) => hot !== null && hot !== party && !links.some((link) => link.party === party && link.component === hot);
  const cardDim = (component: RunComponent) => hot !== null && hot !== component && !links.some((link) => link.component === component && link.party === hot);
  const measureHeight = (set: typeof setPartyHeight, key: string) => (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    set((current) => (current[key] === height ? current : { ...current, [key]: height }));
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={k.t.label}>{t("flow.title")}</Text>
      {liveComponents.size ? <LivePill k={k} label={t("flow.live")} /> : null}
    </View>
  );
  const card = (component: RunComponent, measure: boolean) => (
    <ComponentCard
      key={component}
      k={k}
      t={t}
      component={component}
      run={run}
      pending={pending}
      now={now}
      live={liveComponents.has(component)}
      selected={selected === component}
      dim={cardDim(component)}
      onOpen={() => onOpen(component)}
      onHover={(on) => setHot(on ? component : null)}
      onLayout={measure ? measureHeight(setCardHeight, component) : undefined}
    />
  );

  if (stacked) {
    return (
      <View onLayout={onLayout} style={{ gap: 10 }}>
        {header}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {parties.map((party) => {
            const state = stateOf(party);
            const id = openId(party);
            return (
              <Pressable
                key={party}
                accessibilityRole="button"
                disabled={!id || !openAgent}
                onPress={() => id && openAgent?.(id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: party === "lead" ? withAlpha(LEAD_TONE, 0.45) : k.c.border, backgroundColor: withAlpha(k.c.fg, 0.04), maxWidth: "100%" }}
              >
                <Dot tone={state.tone} live={state.live} size={7} />
                <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 12, fontWeight: party === "lead" ? "700" : "500", flexShrink: 1 }}>
                  {partyName(party, run.members, t)}
                </Text>
                {links.some((link) => link.party === party && link.live) ? <Dot tone={k.c.ok} live size={6} /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={{ gap: 7 }}>{components.map((component) => card(component, false))}</View>
        {aside ? <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: k.c.border }}>{aside}</View> : null}
      </View>
    );
  }

  const left = withAside ? 210 : Math.max(130, Math.min(210, Math.round(width * 0.25)));
  const gap = withAside ? Math.max(90, Math.min(160, Math.round(width * 0.1))) : Math.max(70, Math.min(150, Math.round(width * 0.14)));
  const cardsWidth = withAside ? Math.max(280, Math.min(400, Math.round(width * 0.3))) : undefined;

  // Each card and participant spreads its lines over its own height, ordered by where the other end sits.
  const lines: { link: Link; from: Point; to: Point }[] = [];
  const partyStack = stack(parties, partyHeight, ROW_GAP);
  const cardStack = stack(components, cardHeight, ROW_GAP);
  const placed = partyStack && cardStack ? centred(partyStack, cardStack, gridHeight) : null;
  const partyAt = (party: string): Box | undefined => placed?.left[party];
  const cardAt = (component: string): Box | undefined => placed?.right[component];
  const ready = links.filter((link) => partyAt(link.party) && cardAt(link.component));
  const mid = (box: Box) => (box.top + box.bottom) / 2;
  const spread = (box: Box, index: number, total: number) => {
    if (total <= 1) return mid(box);
    const pad = Math.min(12, (box.bottom - box.top) / 4);
    return box.top + pad + ((box.bottom - box.top - pad * 2) * index) / (total - 1);
  };
  const order = (a: Link, b: Link) => a.direction.localeCompare(b.direction);
  const atParty = new Map<string, Link[]>();
  const atCard = new Map<string, Link[]>();
  for (const link of ready) {
    atParty.set(link.party, [...(atParty.get(link.party) ?? []), link]);
    atCard.set(link.component, [...(atCard.get(link.component) ?? []), link]);
  }
  for (const list of atParty.values()) list.sort((a, b) => mid(cardAt(a.component)!) - mid(cardAt(b.component)!) || order(a, b));
  for (const list of atCard.values()) list.sort((a, b) => mid(partyAt(a.party)!) - mid(partyAt(b.party)!) || order(a, b));
  const x1 = left + 6;
  const x2 = left + gap - 6;
  for (const link of ready) {
    const fromList = atParty.get(link.party)!;
    const toList = atCard.get(link.component)!;
    const party = { x: x1, y: spread(partyAt(link.party)!, fromList.indexOf(link), fromList.length) };
    const part = { x: x2, y: spread(cardAt(link.component)!, toList.indexOf(link), toList.length) };
    lines.push(link.direction === "in" ? { link, from: party, to: part } : { link, from: part, to: party });
  }

  const grid = (
    <View onLayout={(event) => setGridHeight(event.nativeEvent.layout.height)} style={{ flexDirection: "row", alignItems: "center", ...(withAside ? { width: left + gap + cardsWidth! } : { flex: 1, minWidth: 0 }) }}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        {lines.map(({ link, from, to }) => {
          const isHot = hot !== null && (hot === link.party || hot === link.component);
          return <FlowCurve key={`${link.party}|${link.component}|${link.direction}`} k={k} from={from} to={to} color={PART[link.component]} live={link.live} dim={hot !== null && !isHot} hot={isHot} count={link.count} direction={link.direction} packet={packet} />;
        })}
      </View>
      <View style={{ width: left, gap: ROW_GAP }}>
        {parties.map((party) => {
          const state = stateOf(party);
          const id = openId(party);
          const member = run.members.find((entry) => entry.agentId === party);
          const lead = party === "lead";
          return (
            <Pressable
              key={party}
              accessibilityRole="button"
              accessibilityLabel={id && openAgent ? `${partyName(party, run.members, t)}: ${t("reportUi.openAgent")}` : partyName(party, run.members, t)}
              disabled={!id || !openAgent}
              onPress={() => id && openAgent?.(id)}
              onHoverIn={() => setHot(party)}
              onHoverOut={() => setHot(null)}
              onLayout={measureHeight(setPartyHeight, party)}
              style={(pressable) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 9,
                paddingVertical: 7,
                borderRadius: k.radius,
                borderWidth: 1,
                borderColor: lead ? withAlpha(LEAD_TONE, 0.5) : hovered(pressable) && id && openAgent ? withAlpha(k.c.fg, 0.28) : k.c.border,
                backgroundColor: hovered(pressable) && id && openAgent ? k.c.card : withAlpha(k.c.fg, 0.04),
                opacity: partyDim(party) ? 0.4 : member?.retired ? 0.55 : 1,
              })}
            >
              {member && runtimeOf?.(party).provider ? (
                <AgentAvatar k={k} provider={runtimeOf(party).provider!} model={runtimeOf(party).model} size={26} />
              ) : (
                <Tile k={k} icon={partyIcon(party)} tone={lead ? LEAD_TONE : state.tone} size={26} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 12.5, fontWeight: lead ? "800" : "600" }}>
                  {partyName(party, run.members, t)}
                </Text>
                {member ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Dot tone={state.tone} live={state.live} size={6} />
                    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.mutedFg, fontSize: 10.5 }}>
                      {state.role.toLowerCase() === (member.title ?? "").toLowerCase() ? state.text : `${state.role} · ${state.text}`}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ width: gap }} />
      <View style={{ gap: ROW_GAP, minWidth: 0, ...(withAside ? { width: cardsWidth } : { flex: 1 }) }}>
        {components.map((component) => card(component, true))}
      </View>
    </View>
  );

  return (
    <View onLayout={onLayout} style={{ gap: 8 }}>
      {header}
      <Text style={{ color: k.c.mutedFg, fontSize: 11.5, lineHeight: 16, maxWidth: 780 }}>{t("flow.hint")}</Text>
      <View style={{ flexDirection: "row", alignItems: "stretch", marginTop: 4 }}>
        {grid}
        {withAside ? <View style={{ flex: 1, minWidth: 0, marginLeft: 20, paddingLeft: 20, borderLeftWidth: 1, borderLeftColor: k.c.border }}>{aside}</View> : null}
      </View>
      {!withAside && aside ? <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: k.c.border }}>{aside}</View> : null}
    </View>
  );
}
