// A run's data flow in the narrow side panel: who takes part (chips) and the mode's parts as compact cards, each with its
// status line, the task board's progress and its latest event. Text comes from the dashboard's own strings (`flow.*`).
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import { componentsOf, type RunComponent } from "../../shared/flow";
import type { messages } from "../i18n";
import { Card, Dot, PART, Progress, stateTone, T, Tile, type Kit } from "../kit";
import type { RunView, SessionInfo } from "./data";

type Resource = typeof messages.resources.en;
type Translation = typeof useTranslation<Resource>;
export type Translate = ReturnType<Translation>["t"];
type FlowEvent = RunView["events"][number];
type Member = { agentId: string; title: string };

/** A flow this recent counts as live. */
export const LIVE_MS = 30_000;

export const PART_ICON: Record<RunComponent, string> = {
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

/** The time now, refreshed every few seconds so "2 min ago" stays current. */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function agoText(at: string, now: number, t: Translate): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 5) return t("flow.ago.now");
  if (seconds < 60) return t("flow.ago.seconds", { count: seconds });
  if (seconds < 3600) return t("flow.ago.minutes", { count: Math.round(seconds / 60) });
  return t("flow.ago.hours", { count: Math.round(seconds / 3600) });
}

export function partName(component: RunComponent, mode: RunView["mode"], t: Translate): string {
  return component === "tasks" && mode === "delegation" ? t("flow.delegationTasks") : t(`flow.component.${component}`);
}

export function partyName(party: string, members: readonly Member[], t: Translate): string {
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

export function describeEvent(event: FlowEvent, members: readonly Member[], t: Translate): string {
  // A post addressed to its own author has nowhere else to go.
  const targets = event.to.length && !(event.to.length === 1 && event.to[0] === event.from) ? event.to : [];
  const to = targets.map((party) => partyName(party, members, t)).join(", ");
  return t(eventKey(event), { from: partyName(event.from, members, t), to: to || t("flow.lead"), subject: event.subject, note: event.note });
}

/** One line on where a part stands. */
export function partSummary(component: RunComponent, run: RunView, pending: SessionInfo["pendingBrief"], t: Translate): string {
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

/** A part of the mode: tile, name, status line, the task board's progress, and its latest event. Pressing it opens the dashboard. */
export function PartCard({ k, t, component, run, pending, now, onOpen }: { k: Kit; t: Translate; component: RunComponent; run: RunView; pending: SessionInfo["pendingBrief"]; now: number; onOpen?: () => void }) {
  const tone = PART[component];
  const last = [...run.events].reverse().find((event) => event.component === component);
  const live = !!last && now - Date.parse(last.at) < LIVE_MS;
  const total = run.tasks.filter((task) => task.state !== "dropped").length;
  const done = run.tasks.filter((task) => task.state === "done").length;
  const progress = (component === "tasks" || component === "split") && total > 0;
  const name = partName(component, run.mode, t);
  return (
    <Card k={k} tone={tone} onPress={onOpen} label={`${name}: ${t("flow.details")}`} style={{ padding: 10, gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tile k={k} icon={PART_ICON[component]} tone={tone} size={24} />
        <T k={k} v="strong" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {name}
        </T>
        {live ? <Dot tone={tone} live /> : null}
        {onOpen ? <Icon name="ChevronRight" size={14} color={k.c.mutedFg} /> : null}
      </View>
      <T k={k} v="muted" numberOfLines={1}>
        {partSummary(component, run, pending, t)}
      </T>
      {progress ? <Progress k={k} value={done / total} tone={tone} /> : null}
      {last ? (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <T k={k} v="small" numberOfLines={1} style={{ flex: 1, minWidth: 0, opacity: 0.85 }}>
            {describeEvent(last, run.members, t)}
          </T>
          <T k={k} v="tiny">
            {agoText(last.at, now, t)}
          </T>
        </View>
      ) : null}
    </Card>
  );
}

/** The parts of the run's mode, as cards. */
export function PartCards({ k, t, run, pending, now, onOpen }: { k: Kit; t: Translate; run: RunView; pending: SessionInfo["pendingBrief"]; now: number; onOpen?: (component: RunComponent) => void }) {
  return (
    <View style={{ gap: 6 }}>
      {componentsOf(run.mode).map((component) => (
        <PartCard key={component} k={k} t={t} component={component} run={run} pending={pending} now={now} onOpen={onOpen ? () => onOpen(component) : undefined} />
      ))}
    </View>
  );
}

/** Who takes part in the run's latest flows: the user when it took part, the lead, the members, the plugin when it wrote. */
export function runParties(run: RunView, window = 18): string[] {
  const recent = run.events.slice(-window);
  const touched = (id: string) => recent.some((event) => event.from === id || event.to.includes(id));
  return [
    ...(touched("user") ? ["user"] : []),
    "lead",
    ...run.members.filter((member) => !member.retired || touched(member.agentId)).map((member) => member.agentId),
    ...(recent.some((event) => event.from === "plugin" && event.direction === "in") ? ["plugin"] : []),
  ];
}

/** The parties as chips with a state dot; pressing one opens its agent. */
export function PartyChips({ k, t, run, leadAgentId, leadState, now, openAgent }: { k: Kit; t: Translate; run: RunView; leadAgentId: string | null; leadState: string; now: number; openAgent?: (agentId: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {runParties(run).map((party) => {
        const member = run.members.find((entry) => entry.agentId === party);
        const id = party === "lead" ? leadAgentId : member?.agentId ?? null;
        const state = party === "lead" ? leadState : member ? (member.retired ? "retired" : member.state) : "";
        const tone = party === "lead" ? k.c.primary : member ? stateTone(k, state) : k.c.mutedFg;
        const live = run.events.some((event) => (event.from === party || event.to.includes(party)) && now - Date.parse(event.at) < LIVE_MS);
        const lead = party === "lead";
        return (
          <Pressable
            key={party}
            accessibilityRole="button"
            accessibilityLabel={partyName(party, run.members, t)}
            disabled={!id || !openAgent}
            onPress={() => id && openAgent?.(id)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 26, maxWidth: "100%", paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: lead ? withAlpha(k.c.primary, 0.6) : k.c.border, backgroundColor: lead ? withAlpha(k.c.primary, 0.14) : k.c.card, opacity: member?.retired ? 0.55 : pressed ? 0.85 : 1 })}
          >
            <Dot tone={tone} live={live || state === "working"} size={7} />
            <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 12, fontWeight: lead ? "700" : "500", flexShrink: 1 }}>
              {partyName(party, run.members, t)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
