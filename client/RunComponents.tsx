// The session report on the dashboard, in the look of Ensemble for Orca's run report: the run's header and members, the
// data-flow diagram (who writes into which part of the mode, and what each part hands to whom) with the latest flows,
// the tabs of the mode's parts and a page per part. The pieces live in ./report; this file is what the dashboard uses.
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { componentsOf, type RunComponent } from "../shared/flow";
import { Callout, makeKit, Spinner, Tabs, type Kit } from "./kit";
import { COMPONENT_ICON, COMPONENT_PAGES, EventRow, LEAD_TONE, LinkText, pageIcon, pageName, pageTone, Panel, SectionTitle, EmptyLine, useNow, useWidth, type ComponentPage, type DetailRun, type RunView, type SessionInfo, type Tr } from "./report/common";
import { useSessionDetail } from "./report/data";
import { FlowDiagram } from "./report/diagram";
import { Members, PendingIntake, RunHeader, type Runtime } from "./report/header";
import { ComponentBody } from "./report/pages";

export { agoText, COMPONENT_COLOR, COMPONENT_PAGES, describeEvent, durationText, useNow, type ComponentPage } from "./report/common";
export { useSessionDetail } from "./report/data";
export { ModeSwitch } from "./report/mode-switch";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

/** The kit for a theme, or for bare theme colors. */
function useReportKit(theme: PluginTheme | undefined, colors: Colors, compact: boolean | undefined): Kit {
  return useMemo(() => makeKit(theme ?? { colors }, compact ?? false), [theme, colors, compact]);
}

/** Underlined tabs that scroll sideways when they don't fit, with the rule under them across the full width. */
function ScrollTabs<V extends string>({ k, value, tabs, onChange }: { k: Kit; value: V; tabs: readonly { value: V; label: string; icon?: string; count?: number | null; tone?: string; dot?: boolean }[]; onChange(value: V): void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1 }}>
        <Tabs k={k} value={value} tabs={tabs} onChange={onChange} />
      </View>
    </ScrollView>
  );
}

/** A tab of the session dashboard: the overview, the agents, a part of the mode, or the whole data flow. */
export type SessionTab = "overview" | "agents" | ComponentPage;

/** The session dashboard's tabs: overview and agents, then (unless `parts` is false) the mode's parts and the whole data flow. */
export function SessionTabs({ mode, tab, run, pending, colors, t, onOpen, parts = true, theme, compact }: { mode: RunView["mode"]; tab: SessionTab; run: RunView | null; pending: boolean; colors: Colors; t: Tr; onOpen(tab: SessionTab): void; parts?: boolean; theme?: PluginTheme; compact?: boolean }) {
  const k = useReportKit(theme, colors, compact);
  const count = (component: RunComponent): number | null => {
    if (!run) return null;
    if (component === "tasks" || component === "split") return run.tasks.length || null;
    if (component === "board") return run.postCount || null;
    if (component === "claims") return run.claims.length || null;
    if (component === "contexts" || component === "reports") return run.members.length || null;
    return null;
  };
  const tabs: { value: SessionTab; label: string; icon: string; tone?: string; count?: number | null; dot?: boolean }[] = [
    { value: "overview", label: t("session.tabs.overview"), icon: "LayoutDashboard" },
    { value: "agents", label: t("session.tabs.agents"), icon: "Network" },
    ...(parts
      ? [
          ...componentsOf(mode).map((component) => ({ value: component, label: pageName(component, mode, t), icon: COMPONENT_ICON[component], tone: pageTone(component), count: count(component), dot: component === "brief" && pending })),
          { value: "flow" as const, label: t("flow.title"), icon: "Activity", tone: pageTone("flow"), count: run?.events.length || null },
        ]
      : []),
  ];
  return <ScrollTabs k={k} value={tab} tabs={tabs} onChange={onOpen} />;
}

/** The tabs of the mode's parts and the whole data flow under the diagram, each with its number of flows. */
export function PartTabs({ mode, page, events, pending, colors, t, onOpen, theme, compact }: { mode: RunView["mode"]; page: ComponentPage; events: readonly { component: RunComponent }[]; pending: boolean; colors: Colors; t: Tr; onOpen(page: ComponentPage): void; theme?: PluginTheme; compact?: boolean }) {
  const k = useReportKit(theme, colors, compact);
  const pages: ComponentPage[] = [...componentsOf(mode), "flow"];
  const tabs = pages.map((entry) => ({ value: entry, label: pageName(entry, mode, t), icon: pageIcon(entry), tone: pageTone(entry), count: entry === "flow" ? events.length : events.filter((event) => event.component === entry).length, dot: entry === "brief" && pending }));
  return <ScrollTabs k={k} value={page} tabs={tabs} onChange={onOpen} />;
}

/** The parts a page can show for a mode: the mode's own and the whole data flow. */
export const pagesOf = (mode: RunView["mode"]): ComponentPage[] => [...componentsOf(mode), "flow"];

function RecentFlows({ k, t, run, total, now, onOpen }: { k: Kit; t: Tr; run: RunView; total: number; now: number; onOpen(page: ComponentPage): void }) {
  const latest = [...run.events].reverse().slice(0, 12);
  return (
    <View style={{ gap: 6, minWidth: 0 }}>
      <SectionTitle k={k} icon="Activity">
        {t("flow.recent")}
      </SectionTitle>
      {latest.length ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 2, paddingRight: 4 }}>
          {latest.map((event) => (
            <EventRow key={event.seq} k={k} t={t} event={event} members={run.members} mode={run.mode} now={now} onPress={() => onOpen(event.component)} />
          ))}
        </ScrollView>
      ) : (
        <EmptyLine k={k}>{t("flow.none")}</EmptyLine>
      )}
      {total > latest.length ? <LinkText k={k} arrow label={t("flow.viewAll", { count: total })} onPress={() => onOpen("flow")} /> : null}
    </View>
  );
}

/**
 * The run on the dashboard: its header (title, mode, state, round, facts), its members, and the data-flow diagram with
 * the mode's parts and the latest flows. `detail` (the full run) adds why this mode, the members' models and the number
 * of all flows; `page` marks the part whose page is open below.
 */
export function RunOverview({
  run,
  roles,
  pending,
  leadAgentId,
  colors,
  width,
  t,
  openAgent,
  onOpen,
  theme,
  compact,
  detail,
  page,
  leadStatus,
  language,
  runtimes,
  updatedAt,
  refreshing,
  onRefresh,
}: {
  run: RunView | null;
  roles: SessionInfo["roles"];
  pending: SessionInfo["pendingBrief"];
  leadAgentId: string | null;
  colors: Colors;
  width: number | undefined;
  t: Tr;
  openAgent?: (id: string) => void;
  onOpen(page: ComponentPage): void;
  theme?: PluginTheme;
  compact?: boolean;
  detail?: DetailRun | null;
  page?: ComponentPage | null;
  /** The lead agent's status ("running", "idle", "error", …), for its dot. */
  leadStatus?: string | null;
  /** The language the lead works in ("en", "zh"). */
  language?: string | null;
  /** Provider and model per agent id, for members the full run doesn't name them for. */
  runtimes?: Readonly<Record<string, Runtime | undefined>>;
  /** When the run was last read, for "updated just now". */
  updatedAt?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const k = useReportKit(theme, colors, compact);
  const now = useNow();
  const intake = pending && (!run || run.status === "closed") ? <PendingIntake k={k} t={t} pending={pending} onOpen={() => onOpen("brief")} /> : null;
  if (!run) return intake ? <View style={{ width }}>{intake}</View> : null;
  const full = detail && detail.id === run.id ? detail : null;
  const leadTone = leadStatus === "running" ? k.c.warn : leadStatus === "error" ? k.c.bad : leadStatus === "idle" ? k.c.ok : LEAD_TONE;
  const runtimeOf = (agentId: string): Runtime => {
    const member = full?.members.find((entry) => entry.agentId === agentId);
    return { provider: member?.provider ?? runtimes?.[agentId]?.provider ?? null, model: member?.model ?? runtimes?.[agentId]?.model ?? null };
  };
  return (
    <View style={{ gap: 16, width }}>
      <RunHeader
        k={k}
        t={t}
        run={run}
        now={now}
        reason={full?.reason || undefined}
        lead={{ tone: leadTone, live: leadStatus === "running", onPress: leadAgentId && openAgent ? () => openAgent(leadAgentId) : undefined }}
        language={language}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
      {intake}
      <Members k={k} t={t} members={run.members} runtimeOf={runtimeOf} openAgent={openAgent} roles={roles} />
      <Panel k={k} style={{ paddingHorizontal: k.compact ? 12 : 16, paddingTop: 14, paddingBottom: 16 }}>
        <FlowDiagram
          k={k}
          t={t}
          run={run}
          pending={pending}
          now={now}
          leadAgentId={leadAgentId}
          selected={page ?? null}
          onOpen={onOpen}
          openAgent={openAgent}
          aside={<RecentFlows k={k} t={t} run={run} total={full?.events.length ?? run.events.length} now={now} onOpen={onOpen} />}
        />
      </Panel>
    </View>
  );
}

/** One part of the session's run, full size: what it is, its content, who uses it and its history. */
export function ComponentDetail({ page, sessionAgentId, colors, t, theme, compact, openAgent }: { page: ComponentPage; sessionAgentId: string; colors: Colors; t: Tr; theme?: PluginTheme; compact?: boolean; openAgent?: (id: string) => void }) {
  const k = useReportKit(theme, colors, compact);
  const detail = useSessionDetail(sessionAgentId);
  const now = useNow();
  const [width, onLayout] = useWidth();
  const wide = width >= 760;
  return (
    <View onLayout={onLayout} style={{ gap: 14, minWidth: 0 }}>
      {detail.isLoading ? (
        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <Spinner k={k} />
        </View>
      ) : detail.error ? (
        <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
          <Text style={{ color: k.c.bad, fontSize: 12 }}>{String(detail.error)}</Text>
        </Callout>
      ) : detail.data ? (
        <ComponentBody k={k} t={t} page={(COMPONENT_PAGES as readonly string[]).includes(page) ? page : "flow"} run={detail.data.run} pending={detail.data.pendingBrief} now={now} wide={wide} openAgent={openAgent} />
      ) : null}
    </View>
  );
}
