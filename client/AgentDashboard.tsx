import type { PluginAgentPanelProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTabState, useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import { withAlpha } from "../shared/color";
import { buildAgentForest, canArchive, canDismiss, dismissibleIds, sessionForest, sessionMembers, sessionRootOf, titleParts, type AgentNode } from "../shared/agent-tree";
import { agentLanguage } from "../shared/cleanup";
import { DASHBOARD_DENSITIES, DEFAULT_DENSITY, densityLayout, type DashboardDensityLayout } from "../shared/dashboard-density";
import { TEAM_MODES, type TeamMode } from "../shared/modes";
import { teamRosterRpc, teamSessionModeRpc, teamSessionRpc } from "../shared/rpc";
import { applySubagentUpdate, mergeSubagents, subagentAgents, subagentsFromTimeline, type ProviderSubagent } from "../shared/subagents";
import { messages } from "./i18n";
import { AgentAvatar, Button, Callout, Dot, Empty, Segmented, Spinner, Tile, useKit, type Kit } from "./kit";
import { COMPONENT_PAGES, ComponentDetail, ModeSwitch, PartTabs, pagesOf, RunOverview, SessionTabs, useSessionDetail, type ComponentPage, type SessionTab } from "./RunComponents";

const stateSchema = z.object({
  showClosed: z.boolean(),
  dismissed: z.array(z.string()).catch([]),
  density: z.enum(DASHBOARD_DENSITIES).catch(DEFAULT_DENSITY),
  /** "agents" for the agents tab; otherwise the part of the session's run whose page the overview shows (null: the first). */
  page: z.string().nullable().catch(null),
});
const DEFAULT_STATE = { showClosed: false, dismissed: [] as string[], density: DEFAULT_DENSITY, page: null as string | null };

/** A packet's position along its cycle, offset per child. */
type Phase = ReturnType<(typeof Animated)["modulo"]>;
type TimeoutFn = typeof setTimeout;
type Timer = ReturnType<TimeoutFn>;

type TreeProps = {
  node: AgentNode;
  k: Kit;
  compact: boolean;
  layout: DashboardDensityLayout;
  icons: Map<string, string | undefined>;
  flow: Animated.Value;
  glow: Animated.Value;
  packet: Animated.Value;
  phase?: Phase;
  open?: (id: string) => void;
  caption: (node: AgentNode) => string;
  waitingLabel: string;
  hideLabel: string;
  dismiss?: (id: string) => void;
  archive: { label: string; errorLabel: string; pending: boolean; errorId: string | null; run: (id: string) => void };
  subagentLabel: (count: number) => string;
  expandedSubagents: Record<string, boolean>;
  toggleSubagents: (id: string) => void;
};

function shortModel(model: string): string {
  const base = (model.split("/").pop() ?? model).replace(/-\d{8}$/, "");
  return base.replace(/^claude-/, "");
}

/** The agent's client, badged with its model's vendor. */
function Logo({ node, icons, k, size }: { node: AgentNode; icons: TreeProps["icons"]; k: Kit; size: number }) {
  return <AgentAvatar k={k} provider={node.agent.provider} model={node.model} size={size} icons={icons} />;
}

/** The agent's state on its card: waiting, a pulsing dot while it runs, or a tinted mark for attention and done. */
function StatusMark({ node, k, flow, waitingLabel, layout }: Pick<TreeProps, "node" | "k" | "flow" | "waitingLabel" | "layout">) {
  if (node.waiting)
    return <Text style={{ color: k.c.mutedFg, fontSize: layout.captionFontSize, lineHeight: layout.autoWidth ? 12 : undefined, fontWeight: "700" }}>{waitingLabel}</Text>;
  if (!node.badge) return null;
  if (node.badge === "running") {
    const dotSize = layout.showChips ? 8 : layout.autoWidth ? 6 : 7;
    return <Animated.View style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: k.c.warn, opacity: flow.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 1, 0.45] }) }} />;
  }
  const size = layout.showChips ? 17 : layout.autoWidth ? 13 : 15;
  const tone = node.badge === "attention" ? k.c.bad : k.c.ok;
  return (
    <View style={{ width: size, height: size, borderRadius: Math.ceil(size / 2), backgroundColor: withAlpha(tone, 0.2), borderWidth: 1, borderColor: withAlpha(tone, 0.5), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: tone, fontSize: layout.showChips ? 10 : layout.autoWidth ? 8 : 9, fontWeight: "800", lineHeight: layout.showChips ? 13 : layout.autoWidth ? 10 : 11 }}>{node.badge === "attention" ? "!" : "✓"}</Text>
    </View>
  );
}

/** A small pill on a detailed card: the model, the effort, the mode. */
function CardChip({ k, label, fontSize, accent, faded }: { k: Kit; label: string; fontSize: number; accent?: boolean; faded?: boolean }) {
  return (
    <View style={{ backgroundColor: accent ? withAlpha(k.c.primary, 0.14) : k.c.muted, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, maxWidth: "100%", opacity: faded ? 0.55 : 1 }}>
      <Text numberOfLines={1} style={{ color: accent ? k.c.primary : k.c.mutedFg, fontSize, fontWeight: accent ? "600" : "500" }}>
        {label}
      </Text>
    </View>
  );
}

function Card(
  props: TreeProps & {
    root?: boolean;
    collapseRoot?: boolean;
    subagentCount?: number;
    subagentCountLabel?: string;
    subagentsExpanded?: boolean;
    onToggleSubagents?: () => void;
  },
) {
  const { node, k, compact, layout, open, caption, flow, glow, icons, root, collapseRoot, phase, waitingLabel, subagentCount = 0, subagentCountLabel, subagentsExpanded = false, onToggleSubagents } = props;
  const collapsed = Boolean(root && collapseRoot);
  const subagentPill =
    !collapsed && subagentCount > 0 && onToggleSubagents ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={subagentCountLabel}
        accessibilityState={{ expanded: subagentsExpanded }}
        onPress={onToggleSubagents}
        style={{ backgroundColor: subagentsExpanded ? k.c.primary : withAlpha(k.c.primary, 0.14), borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: withAlpha(k.c.primary, 0.5) }}
      >
        <Text style={{ color: subagentsExpanded ? k.c.primaryFg : k.c.primary, fontSize: layout.captionFontSize, lineHeight: 12, fontWeight: "700" }}>+{subagentCount}</Text>
      </Pressable>
    ) : null;

  const briefLabel = node.role || node.title;
  const title = titleParts(node.title);
  const titleContent = (fontSize: number) => (
    <>
      {title.name}
      {title.id !== null ? <Text style={{ color: withAlpha(k.c.mutedFg, 0.7), fontSize: Math.round(fontSize * 0.85), fontWeight: "500" }}>{" " + title.id}</Text> : null}
    </>
  );
  const briefBadgeSpace = node.waiting ? 42 : node.badge === "running" ? 10 : node.badge ? 17 : 0;
  const briefTitleMaxWidth = layout.maxWidth - (layout.padding + 2) * 2 - 2 - layout.logoSize - layout.gap - briefBadgeSpace;
  const showBriefModel = Boolean(node.model && briefLabel.length < 11);
  const status = <StatusMark node={node} k={k} flow={flow} waitingLabel={waitingLabel} layout={layout} />;

  const content = layout.autoWidth ? (
    collapsed ? (
      <>
        <Logo node={node} icons={icons} k={k} size={layout.logoSize} />
        {status}
      </>
    ) : (
      <>
        <Logo node={node} icons={icons} k={k} size={layout.logoSize} />
        <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: briefTitleMaxWidth, color: k.c.fg, fontSize: layout.titleFontSize, lineHeight: 14, fontWeight: "700" }}>
          {node.role ? briefLabel : titleContent(layout.titleFontSize)}
        </Text>
        {showBriefModel && node.model ? (
          <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, color: k.c.mutedFg, fontSize: layout.captionFontSize, lineHeight: 12 }}>
            {shortModel(node.model)}
          </Text>
        ) : null}
        <View style={{ flexShrink: 0 }}>{status}</View>
      </>
    )
  ) : !layout.showChips ? (
    collapsed ? (
      <>
        <Logo node={node} icons={icons} k={k} size={layout.logoSize} />
        {node.model ? (
          <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: layout.captionFontSize, textAlign: "center", maxWidth: "100%" }}>
            {shortModel(node.model)}
          </Text>
        ) : null}
        <View style={{ position: "absolute", right: 4, top: 4 }}>{status}</View>
      </>
    ) : (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: layout.gap }}>
          <Logo node={node} icons={icons} k={k} size={layout.logoSize} />
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: layout.titleFontSize, fontWeight: "700" }}>
            {titleContent(layout.titleFontSize)}
          </Text>
          {status}
        </View>
        {[node.model, layout.showMode ? node.mode : null].some(Boolean) ? (
          <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: layout.captionFontSize }}>
            {[node.model, layout.showMode ? node.mode : null].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </>
    )
  ) : collapsed ? (
    <>
      <Logo node={node} icons={icons} k={k} size={layout.logoSize} />
      {node.model ? (
        <Text numberOfLines={2} style={{ color: k.c.mutedFg, fontSize: layout.captionFontSize, textAlign: "center", maxWidth: "100%" }}>
          {node.model}
        </Text>
      ) : null}
      <View style={{ position: "absolute", right: 6, top: 6 }}>{status}</View>
    </>
  ) : (
    <>
      <Logo node={node} icons={icons} k={k} size={layout.logoSize} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        {layout.showCaption ? (
          <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: layout.captionFontSize, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", paddingRight: 18 }}>
            {caption(node)}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: layout.titleFontSize, fontWeight: "700" }}>
          {titleContent(layout.titleFontSize)}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
          {node.model ? <CardChip k={k} label={node.model} fontSize={layout.captionFontSize} /> : null}
          {layout.showEffort && node.effort ? <CardChip k={k} label={node.effort} fontSize={layout.captionFontSize} faded={node.effortDefault} /> : null}
          {layout.showMode && node.mode ? <CardChip k={k} label={node.mode} fontSize={layout.captionFontSize} accent /> : null}
        </View>
      </View>
      <View style={{ position: "absolute", right: 9, top: 9 }}>{status}</View>
    </>
  );

  const fixedWidth = collapsed ? layout.collapsedRootWidth : compact ? (root ? layout.rootWidth.compact : layout.childWidth.compact) : root ? layout.rootWidth.regular : layout.childWidth.regular;

  const style = {
    ...(layout.autoWidth && !collapsed
      ? { minWidth: layout.minWidth, maxWidth: layout.maxWidth, paddingHorizontal: layout.padding + 2, paddingVertical: layout.paddingVertical }
      : { width: fixedWidth, paddingHorizontal: collapsed ? layout.collapsedPadding : layout.padding, paddingVertical: collapsed ? layout.collapsedPadding : layout.paddingVertical }),
    minHeight: layout.minHeight,
    flexDirection: layout.autoWidth ? ("row" as const) : collapsed ? ("column" as const) : layout.showChips ? ("row" as const) : ("column" as const),
    alignItems: layout.autoWidth ? ("center" as const) : collapsed ? ("center" as const) : undefined,
    justifyContent: collapsed ? ("center" as const) : !layout.autoWidth && !layout.showChips ? ("center" as const) : undefined,
    gap: collapsed ? layout.collapsedGap : !layout.autoWidth && !layout.showChips ? 3 : layout.gap,
    borderWidth: 1,
    borderStyle: !layout.showChips && node.waiting ? ("dashed" as const) : undefined,
    borderColor: node.live ? k.c.bad : node.delegating ? k.c.warn : root ? withAlpha(k.c.primary, 0.75) : k.c.border,
    borderRadius: layout.borderRadius,
    backgroundColor: k.c.card,
    shadowColor: node.live ? k.c.bad : "#000",
    shadowOpacity: node.live ? layout.glowOpacity : 0.05,
    shadowRadius: node.live ? layout.glowRadius : 2,
    shadowOffset: { width: 0, height: node.live ? 0 : 1 },
    // A role with no session yet: dimmed, and nothing to open.
    opacity: node.waiting ? 0.45 : node.kind === "subagent" ? 0.85 : 1,
  };
  const hideButton =
    props.dismiss && canDismiss(node) ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.hideLabel}
        onPress={(event) => {
          event.stopPropagation();
          props.dismiss?.(node.agent.id);
        }}
        style={{ position: "absolute", top: -7, left: -7, width: 16, height: 16, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: k.c.card, borderWidth: 1, borderColor: k.c.border }}
      >
        <Icon name="X" size={10} color={k.c.mutedFg} />
      </Pressable>
    ) : null;
  const archiving = props.archive;
  const archiveButton = canArchive(node) ? (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={archiving.label}
        disabled={archiving.pending}
        onPress={(event) => {
          event.stopPropagation();
          archiving.run(node.agent.id);
        }}
        style={{ position: "absolute", bottom: -9, right: 6, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: k.c.border, backgroundColor: k.c.card, opacity: archiving.pending ? 0.5 : 1 }}
      >
        <Icon name="Archive" size={10} color={k.c.mutedFg} />
        <Text style={{ color: k.c.mutedFg, fontSize: 10.5, lineHeight: 13, fontWeight: "500" }}>{archiving.label}</Text>
      </Pressable>
      {archiving.errorId === node.agent.id ? (
        <Text numberOfLines={1} style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, color: k.c.bad, fontSize: 11 }}>
          {archiving.errorLabel}
        </Text>
      ) : null}
    </>
  ) : null;
  const card =
    open && !node.waiting && node.kind !== "subagent" ? (
      <Pressable accessibilityRole="button" accessibilityLabel={node.title} onPress={() => open(node.agent.id)} style={({ pressed }) => [style, pressed ? { opacity: 0.85 } : null]}>
        {content}
        {hideButton}
        {archiveButton}
      </Pressable>
    ) : (
      <View accessibilityLabel={node.title} style={style}>
        {content}
        {hideButton}
        {archiveButton}
      </View>
    );
  if (!node.live) {
    return subagentPill ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {card}
        {subagentPill}
      </View>
    ) : (
      card
    );
  }
  const peak = (layout.arrival + 1) / 2;
  const ping = phase?.interpolate({ inputRange: [0, layout.arrival, peak, 1], outputRange: [1, 1, layout.arrivalFlash.scale, 1] }) ?? 1;
  const flash = phase?.interpolate({ inputRange: [0, layout.arrival, peak, 1], outputRange: [0, 0, layout.arrivalFlash.opacity, 0] }) ?? 0;
  const flashInset = layout.autoWidth ? -1 : -2;
  const glowTone = withAlpha(k.c.bad, 0.7);
  const liveCard = (
    <Animated.View style={{ transform: [{ scale: ping }] }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -1,
          bottom: -1,
          left: -1,
          right: -1,
          borderRadius: layout.borderRadius,
          borderWidth: 1,
          borderColor: glowTone,
          backgroundColor: glowTone,
          shadowColor: k.c.bad,
          shadowOpacity: layout.arrivalFlash.opacity,
          shadowRadius: Math.max(2, layout.glowRadius * 0.6),
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
          opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [layout.glowOpacity * 0.32, layout.glowOpacity * 1.28] }),
          transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + (layout.arrivalFlash.scale - 1) * (2 / 3)] }) }],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: flashInset,
          bottom: flashInset,
          left: flashInset,
          right: flashInset,
          borderRadius: layout.borderRadius,
          backgroundColor: glowTone,
          shadowColor: k.c.bad,
          shadowOpacity: Math.min(1, layout.glowOpacity * 5.6),
          shadowRadius: layout.glowRadius * 1.4,
          elevation: 8,
          opacity: flash,
        }}
      />
      {card}
    </Animated.View>
  );
  return subagentPill ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {liveCard}
      {subagentPill}
    </View>
  ) : (
    liveCard
  );
}

function Dashes({ k, flow, layout, vertical = false, reverse = false }: { k: Kit; flow: Animated.Value; layout: DashboardDensityLayout; vertical?: boolean; reverse?: boolean }) {
  const [length, setLength] = useState(0);
  const step = layout.dashLength + layout.dashGap;
  const count = Math.ceil(length / step) + 2;
  const offset = flow.interpolate({ inputRange: [0, 1], outputRange: reverse ? [step, 0] : [0, step] });
  return (
    <View pointerEvents="none" onLayout={(event) => setLength(vertical ? event.nativeEvent.layout.height : event.nativeEvent.layout.width)} style={{ flex: 1, overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", flexDirection: vertical ? "column" : "row", ...(vertical ? { top: -step } : { left: -step }), transform: [vertical ? { translateY: offset } : { translateX: offset }] }}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ width: vertical ? 2 : layout.dashLength, height: vertical ? layout.dashLength : 2, marginBottom: vertical ? layout.dashGap : 0, marginRight: vertical ? 0 : layout.dashGap, borderRadius: 1, backgroundColor: k.c.bad }} />
        ))}
      </Animated.View>
    </View>
  );
}

const TREE_PAD_X = 16;

function treeDepth(node: AgentNode, collapseSubagents: boolean, expandedSubagents: Record<string, boolean>): number {
  const children = collapseSubagents && !expandedSubagents[node.agent.id] ? node.children.filter((child) => child.kind !== "subagent") : node.children;
  if (!children.length) return 0;
  return 1 + Math.max(...children.map((child) => treeDepth(child, collapseSubagents, expandedSubagents)));
}

function expandedTreeWidth(node: AgentNode, compact: boolean, layout: DashboardDensityLayout, expandedSubagents: Record<string, boolean>): number {
  const rootWidth = compact ? layout.rootWidth.compact : layout.rootWidth.regular;
  const childWidth = compact ? layout.childWidth.compact : layout.childWidth.regular;
  return rootWidth + treeDepth(node, layout.collapseSubagents, expandedSubagents) * (layout.stem + layout.branch + childWidth);
}

function CommandPacket({ phase, junction, center, k, layout }: { phase: Phase; junction: number; center: number; k: Kit; layout: DashboardDensityLayout }) {
  const { stem, branch, arrival, signalDotSize, glowRadius } = layout;
  const distance = stem + Math.abs(center - junction) + branch;
  const first = (arrival * stem) / distance;
  const second = (arrival * (stem + Math.abs(center - junction))) / distance;
  const input = second > first ? [0, first, second, arrival, 1] : [0, first, arrival, 1];
  const x = second > first ? [0, stem, stem, stem + branch, stem + branch] : [0, stem, stem + branch, stem + branch];
  const y = second > first ? [junction, junction, center, center, center] : [junction, junction, center, center];
  const half = Math.floor(signalDotSize / 2);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: -half,
        top: -half,
        width: signalDotSize,
        height: signalDotSize,
        borderRadius: Math.ceil(signalDotSize / 2),
        backgroundColor: k.c.fg,
        shadowColor: k.c.bad,
        shadowOpacity: 1,
        shadowRadius: Math.max(2, Math.round(glowRadius * 0.6)),
        shadowOffset: { width: 0, height: 0 },
        elevation: 5,
        opacity: phase.interpolate({ inputRange: [0, 0.02, arrival, arrival + 0.01, 1], outputRange: [0, 1, 1, 0, 0] }),
        transform: [{ translateX: phase.interpolate({ inputRange: input, outputRange: x }) }, { translateY: phase.interpolate({ inputRange: input, outputRange: y }) }],
      }}
    />
  );
}

function Connector({ k, flow, layout, junction, children, centers, phases }: { k: Kit; flow: Animated.Value; layout: DashboardDensityLayout; junction: number; children: AgentNode[]; centers: Record<string, number>; phases: Record<string, Phase> }) {
  const { stem, branch } = layout;
  const positioned = children.filter((child) => centers[child.agent.id] !== undefined);
  if (!positioned.length) return null;
  const ys = positioned.map((child) => centers[child.agent.id]!);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: stem + branch }}>
      {max > min && <View style={{ position: "absolute", left: stem, top: min + 8, height: Math.max(0, max - min - 16), borderLeftWidth: 1, borderColor: k.c.border }} />}
      {positioned.map((child) => {
        const center = centers[child.agent.id]!;
        const delta = center - junction;
        const straight = Math.abs(delta) < 1 || positioned.length === 1;
        const radius = Math.min(8, Math.abs(delta));
        const above = delta < 0;
        return (
          <View key={child.agent.id} style={{ position: "absolute", left: stem, top: 0, bottom: 0, width: branch }}>
            {straight ? (
              <View style={{ position: "absolute", left: 0, right: 0, top: center, borderTopWidth: 1, borderColor: k.c.border, borderStyle: child.waiting ? "dashed" : "solid" }} />
            ) : (
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: above ? center : center - radius,
                  height: radius,
                  borderLeftWidth: 1,
                  borderColor: k.c.border,
                  borderStyle: child.waiting ? "dashed" : "solid",
                  ...(above ? { borderTopWidth: 1, borderTopLeftRadius: radius } : { borderBottomWidth: 1, borderBottomLeftRadius: radius }),
                }}
              />
            )}
            {child.live && (
              <>
                {Math.abs(delta) > 0 && (
                  <View style={{ position: "absolute", left: 0, top: Math.min(center, junction), height: Math.abs(delta), width: 2 }}>
                    <Dashes k={k} flow={flow} layout={layout} vertical reverse={above} />
                  </View>
                )}
                <View style={{ position: "absolute", left: 0, right: 0, top: center, height: 2 }}>
                  <Dashes k={k} flow={flow} layout={layout} />
                </View>
              </>
            )}
          </View>
        );
      })}
      {positioned.some((child) => child.live) && (
        <View style={{ position: "absolute", left: 0, top: junction, width: stem, height: 2 }}>
          <Dashes k={k} flow={flow} layout={layout} />
        </View>
      )}
      {positioned
        .filter((child) => child.live)
        .map((child) => (
          <CommandPacket key={child.agent.id} phase={phases[child.agent.id]!} junction={junction} center={centers[child.agent.id]!} k={k} layout={layout} />
        ))}
    </View>
  );
}

function Tree(props: TreeProps & { root?: boolean; collapseRoot?: boolean }) {
  const { node, k, flow, packet, layout, subagentLabel, expandedSubagents, toggleSubagents } = props;
  const subagents = useMemo(() => node.children.filter((child) => child.kind === "subagent"), [node.children]);
  const collapseSubagents = layout.collapseSubagents && subagents.length > 0;
  const subagentsExpanded = Boolean(expandedSubagents[node.agent.id]);
  const visibleChildren = useMemo(() => (collapseSubagents && !subagentsExpanded ? node.children.filter((child) => child.kind !== "subagent") : node.children), [collapseSubagents, subagentsExpanded, node.children]);
  const [height, setHeight] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = new Set(visibleChildren.map((child) => child.agent.id));
    setHeights((previous) => {
      const entries = Object.entries(previous).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    });
  }, [visibleChildren]);
  const centers: Record<string, number> = {};
  let offset = 0;
  let measured = true;
  for (const child of visibleChildren) {
    const rowHeight = heights[child.agent.id];
    if (rowHeight === undefined) measured = false;
    if (measured && rowHeight !== undefined) {
      centers[child.agent.id] = offset + rowHeight / 2;
      offset += rowHeight;
    }
  }
  const childKey = JSON.stringify(visibleChildren.map((child) => child.agent.id));
  const phases = useMemo(() => {
    const ids: string[] = JSON.parse(childKey);
    return Object.fromEntries(ids.map((id, index) => [id, Animated.modulo(Animated.add(packet, index / Math.max(1, ids.length)), 1)]));
  }, [childKey, packet]);
  const rowPadY = layout.autoWidth ? 3 : layout.showChips ? 6 : 4;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Card
        {...props}
        subagentCount={collapseSubagents ? subagents.length : 0}
        subagentCountLabel={collapseSubagents ? subagentLabel(subagents.length) : undefined}
        subagentsExpanded={subagentsExpanded}
        onToggleSubagents={collapseSubagents ? () => toggleSubagents(node.agent.id) : undefined}
      />
      {visibleChildren.length > 0 && (
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: "50%", width: layout.stem, height: 1, backgroundColor: k.c.border }} />
          <Connector k={k} flow={flow} layout={layout} junction={height / 2} children={visibleChildren} centers={centers} phases={phases} />
          {visibleChildren.map((child) => (
            <View
              key={child.agent.id}
              onLayout={(event) => {
                const rowHeight = event.nativeEvent.layout.height;
                setHeights((previous) => (previous[child.agent.id] === rowHeight ? previous : { ...previous, [child.agent.id]: rowHeight }));
              }}
              style={{ paddingLeft: layout.stem + layout.branch, paddingVertical: rowPadY }}
            >
              <Tree {...props} root={false} collapseRoot={false} node={child} phase={phases[child.agent.id]} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AnimationAnchor({ value }: { value: Animated.Value }) {
  const opacity = useMemo(() => value.interpolate({ inputRange: [0, 1], outputRange: [0, 0] }), [value]);
  return <Animated.View pointerEvents="none" style={{ position: "absolute", width: 0, height: 0, opacity }} />;
}

type DashboardProps = Pick<PluginWorkspacePanelProps, "theme" | "layout" | "navigation" | "workspaceId" | "tab"> & {
  /** The session the dashboard was opened from. */
  sessionAgentId: string;
};

/** One session: the agent it was opened from, the agents above and below it, and its collaboration run. */
export function SessionDashboard(props: PluginAgentPanelProps) {
  return <Dashboard {...props} sessionAgentId={props.params.agentId} />;
}

/** An on/off switch with its label on the left. */
function Toggle({ k, label, value, onChange }: { k: Kit; label: string; value: boolean; onChange(value: boolean): void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: k.c.mutedFg, fontSize: 12, fontWeight: "500" }}>{label}</Text>
      <View style={{ width: 32, height: 18, borderRadius: 9, justifyContent: "center", paddingHorizontal: 2, backgroundColor: value ? k.c.primary : k.c.muted, borderWidth: 1, borderColor: value ? k.c.primary : k.c.border }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: value ? k.c.primaryFg : k.c.mutedFg, alignSelf: value ? "flex-end" : "flex-start" }} />
      </View>
    </Pressable>
  );
}

function Dashboard(props: DashboardProps) {
  const paseo = usePaseo();
  const client = useQueryClient();
  const { t } = useTranslation(messages);
  const k = useKit(props.theme, props.layout.compact);
  const [state, setState] = useTabState(props.tab, stateSchema, DEFAULT_STATE);
  const sessionId = props.sessionAgentId;
  const archived = useMutation({
    mutationFn: (id: string) => paseo.agents.ref(id).archive(),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["dashboard", "agents"] }),
  });
  const [live, setLive] = useState<Record<string, ProviderSubagent>>({});
  const flow = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const packet = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(packet, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
    animation.start();
    return () => animation.stop();
  }, [packet]);
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [glow]);
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(flow, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== "web" }));
    animation.start();
    return () => animation.stop();
  }, [flow]);
  useEffect(() => {
    const timers = new Set<Timer>();
    const coalesce = (fn: () => void) => {
      let timer: Timer | null = null;
      return () => {
        if (timer !== null) return;
        timer = setTimeout(() => {
          timers.delete(timer!);
          timer = null;
          fn();
        }, 1000);
        timers.add(timer);
      };
    };
    const invalidate = (key: string) => void client.invalidateQueries({ queryKey: ["dashboard", key] }, { cancelRefetch: false });
    const refreshAgents = coalesce(() => {
      invalidate("agents");
      invalidate("session");
    });
    const refreshWorkspaces = coalesce(() => {
      invalidate("workspaces");
      invalidate("roster");
    });
    const refreshProviders = coalesce(() => invalidate("providers"));
    const off = [paseo.agents.subscribe(refreshAgents), paseo.workspaces.subscribe(refreshWorkspaces), paseo.projects.subscribe(refreshWorkspaces), paseo.providers.subscribe(refreshProviders)];
    const events = paseo.observeEvents(["agent.provider_subagents.update"]);
    events.subscribe({
      snapshot() {},
      update(message) {
        if (message.type === "agent.provider_subagents.update") setLive((current) => applySubagentUpdate(current, message.payload));
      },
    });
    let active = true;
    const releases: Array<() => void> = [];
    void paseo.agents
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        if (active)
          releases.push(() => {
            void subscription.release();
          });
        else void subscription.release();
      })
      .catch(() => {});
    void paseo.workspaces
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        if (active)
          releases.push(() => {
            void subscription.release();
          });
        else void subscription.release();
      })
      .catch(() => {});
    return () => {
      active = false;
      timers.forEach(clearTimeout);
      void events.release();
      off.forEach((f) => f());
      releases.forEach((f) => f());
    };
  }, [paseo, client]);
  const agents = useQuery({
    queryKey: ["dashboard", "agents", state.showClosed],
    queryFn: () => paseo.agents.list(state.showClosed ? { filter: { includeArchived: true } } : {}),
  });
  const workspaces = useQuery({
    queryKey: ["dashboard", "workspaces"],
    queryFn: () => paseo.workspaces.list(),
  });
  const readRoster = useRpc(teamRosterRpc);
  const roster = useQuery({
    queryKey: ["dashboard", "roster", props.workspaceId],
    queryFn: () => readRoster({ workspaceId: props.workspaceId }),
  });
  const providers = useQuery({
    queryKey: ["dashboard", "providers"],
    queryFn: () => paseo.providers.snapshot(),
  });
  const defaultEfforts = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const entry of providers.data?.entries ?? []) {
      for (const model of entry.models ?? []) {
        if (model.defaultThinkingOptionId) defaults[`${entry.provider}/${model.id}`] = model.defaultThinkingOptionId;
      }
    }
    return defaults;
  }, [providers.data]);
  const workspaceIds = useMemo(() => {
    const entries = workspaces.data?.entries ?? [];
    const projectId = entries.find((w) => w.id === props.workspaceId)?.projectId;
    return projectId ? entries.filter((w) => w.projectId === projectId).map((w) => w.id) : [];
  }, [workspaces.data, props.workspaceId]);
  // Sub-agents are read from each of the session's agents' timelines, so only the shown session costs requests.
  const unarchivedIds = useMemo(() => {
    const raw = (agents.data?.entries ?? []).map((entry) => entry.agent);
    const scope = sessionMembers(raw, sessionRootOf(raw, sessionId));
    const project = new Set(workspaceIds);
    return raw.filter((agent) => scope.has(agent.id) && project.has(agent.workspaceId ?? "") && !agent.archivedAt).map((agent) => agent.id);
  }, [agents.data, workspaceIds, sessionId]);
  const subagents = useQuery({
    queryKey: ["dashboard", "subagents", unarchivedIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        unarchivedIds.map(async (id) => {
          const page = await paseo.agents.ref(id).timeline.refetch({ direction: "tail", limit: 200 });
          return subagentsFromTimeline(id, page.entries);
        }),
      );
      return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    },
  });
  const allAgents = useMemo(() => {
    const parentAgents = agents.data?.entries.map((entry) => entry.agent) ?? [];
    const merged = mergeSubagents(subagents.data ?? [], live);
    return [...parentAgents, ...subagentAgents(merged, parentAgents)];
  }, [agents.data, subagents.data, live]);
  const fullForest = useMemo(() => buildAgentForest(allAgents, workspaceIds, { ...state, defaultEfforts, roster: roster.data?.teams }), [allAgents, workspaceIds, state, defaultEfforts, roster.data]);
  const forest = useMemo(() => sessionForest(fullForest, allAgents, sessionId), [fullForest, allAgents, sessionId]);
  const sessionRoot = useMemo(() => sessionRootOf(allAgents, sessionId), [allAgents, sessionId]);
  const readSession = useRpc(teamSessionRpc);
  const session = useQuery({
    queryKey: ["dashboard", "session", sessionRoot],
    queryFn: () => readSession({ agentId: sessionRoot! }),
    enabled: sessionRoot !== null,
    refetchInterval: (query) => (query.state.data?.run?.status === "active" || query.state.data?.pendingBrief ? 3000 : false),
  });
  const switchMode = useRpc(teamSessionModeRpc);
  const modeSwitch = useMutation({
    mutationFn: (mode: TeamMode) => switchMode({ agentId: session.data?.leadAgentId ?? sessionRoot!, mode }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["dashboard", "session"] }),
  });
  const rosterModes = useMemo(() => new Map((roster.data?.teams ?? []).map((team) => [team.orchestratorWorkspaceId, team.mode])), [roster.data]);
  const closedIds = dismissibleIds(forest);
  // A team lead's session gets two tabs: the run's report (with a page per part of the mode) and its agents.
  const teamSession = sessionRoot !== null && !!session.data?.leadAgentId;
  const detail = useSessionDetail(teamSession ? sessionRoot : null);
  const [refreshing, setRefreshing] = useState(false);
  const tabMode = session.data?.run?.mode ?? (session.data?.effective === "delegation" || session.data?.locked === "delegation" ? "delegation" : "team");
  const pages = pagesOf(tabMode);
  const tab: SessionTab = !teamSession ? "agents" : state.page === "agents" ? "agents" : "overview";
  const part: ComponentPage = state.page && (pages as readonly string[]).includes(state.page) ? (state.page as ComponentPage) : pages[0]!;
  // Back on the overview, the part that was open before opens again.
  const lastPart = useRef<ComponentPage | null>(null);
  if (tab === "overview") lastPart.current = part;
  const openTab = (next: SessionTab) => setState({ ...state, page: next === "agents" ? "agents" : next === "overview" ? lastPart.current : next });
  // The overview scrolls to the part's page when it is opened from the diagram and the page is below the fold.
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewport = useRef(0);
  const pagesY = useRef(0);
  const openPart = (next: ComponentPage, reveal: boolean) => {
    setState({ ...state, page: next });
    if (reveal && pagesY.current - scrollY.current > viewport.current - 160) scroller.current?.scrollTo({ y: Math.max(0, pagesY.current - 8), animated: true });
  };
  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([client.invalidateQueries({ queryKey: ["dashboard", "session"] }), client.invalidateQueries({ queryKey: ["dashboard", "session-detail"] })]);
    setRefreshing(false);
  };
  const icons = useMemo(() => new Map((providers.data?.entries ?? []).map((p) => [p.provider, p.iconSvg])), [providers.data]);
  const pad = props.layout.compact ? 16 : 24;
  const [panelWidth, setPanelWidth] = useState(0);
  const [expandedSubagents, setExpandedSubagents] = useState<Record<string, boolean>>({});
  const toggleSubagents = (id: string) => setExpandedSubagents((current) => ({ ...current, [id]: !current[id] }));
  const layout = useMemo(() => densityLayout(state.density), [state.density]);
  const widestTree = useMemo(() => forest.trees.reduce((max, node) => Math.max(max, expandedTreeWidth(node, props.layout.compact, layout, expandedSubagents)), 0), [forest.trees, props.layout.compact, layout, expandedSubagents]);
  const collapseRoot = panelWidth > 0 && widestTree > panelWidth - (pad + TREE_PAD_X) * 2;
  const treeProps = {
    k,
    compact: props.layout.compact,
    layout,
    icons,
    flow,
    glow,
    packet,
    open: props.navigation ? (id: string) => props.navigation?.openAgent({ agentId: id }) : undefined,
    caption: (node: AgentNode) =>
      node.role ||
      (node.kind === "orchestrator"
        ? (() => {
            const mode = (node.agent.id === session.data?.leadAgentId ? session.data?.effective : null) ?? rosterModes.get(node.agent.workspaceId ?? null);
            return mode && (TEAM_MODES as readonly string[]).includes(mode) ? `${t("orchestrator")} · ${t(`mode.${mode as TeamMode}`)}` : t("orchestrator");
          })()
        : node.kind === "planner"
          ? t("planner")
          : node.kind === "subagent"
            ? node.agent.subagentType
              ? `${t("subagent")} · ${node.agent.subagentType}`
              : t("subagent")
            : node.agent.provider),
    waitingLabel: t("waiting"),
    hideLabel: t("hideAgent"),
    archive: {
      label: t("archiveAgent"),
      errorLabel: t("archiveFailed"),
      pending: archived.isPending,
      errorId: archived.isError ? (archived.variables ?? null) : null,
      run: (id: string) => archived.mutate(id),
    },
    dismiss: state.showClosed ? (id: string) => setState({ ...state, dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id] }) : undefined,
    subagentLabel: (count: number) => t("subagentCount", { count }),
    expandedSubagents,
    toggleSubagents,
  };
  const leadNode = teamSession ? allAgents.find((agent) => agent.id === session.data?.leadAgentId) : undefined;
  const leadStatus = leadNode?.status;
  const statusTone = leadStatus === "running" ? k.c.warn : leadStatus === "error" ? k.c.bad : leadStatus === "idle" ? k.c.ok : k.c.mutedFg;
  const runtimes = useMemo(() => Object.fromEntries(allAgents.map((agent) => [agent.id, { provider: agent.provider, model: agent.model ?? null }])), [allAgents]);
  const run = session.data?.run ?? null;
  const fullRun = detail.data?.run && run && detail.data.run.id === run.id ? detail.data.run : null;
  const modeError = modeSwitch.error ? String(modeSwitch.error) : modeSwitch.data && !modeSwitch.data.ok ? modeSwitch.data.errors.join("; ") : null;
  return (
    <View style={{ flex: 1, backgroundColor: k.c.bg }}>
      <AnimationAnchor value={flow} />
      <AnimationAnchor value={glow} />
      <AnimationAnchor value={packet} />
      <View style={{ paddingHorizontal: pad, paddingTop: 14, paddingBottom: teamSession ? 0 : 12, gap: 12, borderBottomWidth: teamSession ? 0 : 1, borderColor: k.c.border }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1, minWidth: 0 }}>
            <Tile k={k} icon={teamSession ? "Users" : "Network"} size={32} />
            <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={[k.t.h2, { fontSize: 16 }]}>
                {t("session.title")}
              </Text>
              {teamSession ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Dot tone={statusTone} live={leadStatus === "running"} size={7} />
                  <Text numberOfLines={1} style={[k.t.tiny, { flexShrink: 1 }]}>
                    {t("orchestrator")}
                    {leadNode?.model ? ` · ${shortModel(leadNode.model)}` : ""}
                    {session.data?.effective ? ` · ${t(`mode.${session.data.effective}`)}` : ""}
                  </Text>
                  {session.data?.locked ? <Icon name="Lock" size={11} color={k.c.mutedFg} /> : null}
                </View>
              ) : null}
            </View>
          </View>
          {tab === "agents" ? (
            <View accessibilityLabel={t("density.label")} style={{ marginLeft: "auto" }}>
              <Segmented k={k} value={state.density} options={DASHBOARD_DENSITIES.map((option) => ({ value: option, label: t(`density.${option}`) }))} onChange={(density) => setState({ ...state, density })} />
            </View>
          ) : null}
        </View>
        {teamSession ? <SessionTabs mode={tabMode} tab={tab} run={run} pending={!!session.data?.pendingBrief} colors={props.theme.colors} theme={props.theme} compact={props.layout.compact} t={t} parts={false} onOpen={openTab} /> : null}
      </View>
      {tab === "agents" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: pad, paddingTop: 12, gap: 8 }}>
          {state.showClosed && state.dismissed.length > 0 ? <Button k={k} size="sm" variant="ghost" icon="Eye" label={t("restoreHidden", { count: state.dismissed.length })} onPress={() => setState({ ...state, dismissed: [] })} /> : null}
          {state.showClosed && closedIds.length > 0 ? <Button k={k} size="sm" variant="ghost" icon="EyeOff" label={t("hideAllClosed", { count: closedIds.length })} onPress={() => setState({ ...state, dismissed: [...new Set([...state.dismissed, ...closedIds])] })} /> : null}
          <View style={{ marginLeft: 4 }}>
            <Toggle k={k} label={t("showClosed")} value={state.showClosed} onChange={(showClosed) => setState({ ...state, showClosed })} />
          </View>
        </View>
      ) : null}
      {tab === "overview" && sessionRoot ? (
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: pad, gap: 16 }}
          scrollEventThrottle={64}
          onScroll={(event) => {
            scrollY.current = event.nativeEvent.contentOffset.y;
          }}
          onLayout={(event) => {
            viewport.current = event.nativeEvent.layout.height;
          }}
        >
          {session.data?.leadAgentId && session.data.configured && session.data.effective ? (
            <ModeSwitch k={k} t={t} effective={session.data.effective} locked={session.data.locked} override={session.data.override} busy={modeSwitch.isPending} error={modeError} onSwitch={(mode) => modeSwitch.mutate(mode)} />
          ) : null}
          {run || session.data?.pendingBrief ? (
            <>
              <RunOverview
                run={run}
                roles={session.data?.roles ?? []}
                pending={session.data?.pendingBrief ?? null}
                leadAgentId={session.data?.leadAgentId ?? null}
                colors={props.theme.colors}
                theme={props.theme}
                compact={props.layout.compact}
                width={undefined}
                t={t}
                openAgent={treeProps.open}
                onOpen={(next) => openPart(next, true)}
                detail={fullRun}
                page={part}
                leadStatus={leadStatus ?? null}
                language={leadNode ? (agentLanguage(leadNode) ?? "en") : null}
                runtimes={runtimes}
                updatedAt={Math.max(session.dataUpdatedAt, detail.dataUpdatedAt) || undefined}
                refreshing={refreshing}
                onRefresh={() => void refresh()}
              />
              <View
                onLayout={(event) => {
                  pagesY.current = event.nativeEvent.layout.y;
                }}
                style={{ gap: 14, marginTop: 4 }}
              >
                <PartTabs mode={tabMode} page={part} events={fullRun?.events ?? run?.events ?? []} pending={!!session.data?.pendingBrief} colors={props.theme.colors} theme={props.theme} compact={props.layout.compact} t={t} onOpen={(next) => openPart(next, false)} />
                <ComponentDetail page={(COMPONENT_PAGES as readonly string[]).includes(part) ? part : "flow"} sessionAgentId={sessionRoot} colors={props.theme.colors} theme={props.theme} compact={props.layout.compact} t={t} openAgent={treeProps.open} />
              </View>
            </>
          ) : session.isLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Spinner k={k} />
            </View>
          ) : (
            <Empty k={k} icon="Users">
              {t("session.noRun")}
            </Empty>
          )}
        </ScrollView>
      ) : (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}>
          <ScrollView style={{ flexGrow: 1, flexShrink: 0 }} contentContainerStyle={{ padding: pad, gap: 24 }}>
            {agents.isLoading || workspaces.isLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <Spinner k={k} />
              </View>
            ) : agents.error || workspaces.error ? (
              <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
                <Text style={{ color: k.c.bad, fontSize: 12 }}>{t("dashboardError")}</Text>
              </Callout>
            ) : !forest.trees.length && !forest.solo.length ? (
              <Empty k={k} icon="Network">
                {t("emptySession")}
              </Empty>
            ) : (
              <>
                <View style={{ paddingHorizontal: TREE_PAD_X, paddingVertical: 12, gap: 26, alignItems: "flex-start" }}>
                  {forest.trees.map((node) => (
                    <Tree key={node.agent.id} {...treeProps} node={node} root collapseRoot={collapseRoot} />
                  ))}
                </View>
                {forest.solo.length > 0 && (
                  <View style={{ gap: 12, width: panelWidth > 0 ? Math.max(0, panelWidth - pad * 2) : undefined }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon name="Bot" size={13} color={k.c.mutedFg} />
                      <Text style={k.t.label}>{t("soloAgents")}</Text>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {forest.solo.map((node) => (
                        <Card key={node.agent.id} {...treeProps} node={node} />
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}
