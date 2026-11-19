// The top of a session's run report: the run's title with its mode, state and round, when it was last read and a refresh
// button, a row of facts (run id, lead, language, times), why this mode, and a card per member that opens its agent.
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import { Badge, Button, Dot, MODE_LOOK, PART, Tile, type Kit } from "../kit";
import { agoText, CornerDot, durationText, EmptyLine, FieldLabel, Grid, hovered, ink, memberStateText, memberTone, PartyTag, SectionTitle, timeText, useWidth, type RunView, type SessionInfo, type Tr } from "./common";

type RunMember = RunView["members"][number];
export type Runtime = { provider: string | null; model: string | null };

/** The lead as the header shows it: its state's color, and how to open it. */
export interface LeadLook {
  tone: string;
  live: boolean;
  onPress?: () => void;
}

const languageName = (language: string, t: Tr) => (language === "en" || language === "zh" ? t(`reportUi.lang.${language}`) : language);

export function RunHeader({ k, t, run, now, reason, lead, language, updatedAt, refreshing, onRefresh }: { k: Kit; t: Tr; run: RunView; now: number; reason?: string; lead: LeadLook; language?: string | null; updatedAt?: number; refreshing?: boolean; onRefresh?: () => void }) {
  const [width, onLayout] = useWidth();
  // A phone, or a narrow side panel: the refresh row goes under the title.
  const narrow = k.compact || (width > 0 && width < 560);
  const active = run.status === "active";
  const end = active ? now : Date.parse(run.updatedAt);
  const tone = run.mode === "team" ? PART.tasks : PART.split;
  const facts: (readonly [string, ReactNode])[] = [
    [t("reportUi.runId"), <Text selectable numberOfLines={1} style={{ color: k.c.fg, fontFamily: "Menlo", fontSize: 12.5, fontWeight: "600" }}>{run.id}</Text>],
    [t("reportUi.lead"), <PartyTag k={k} name={t("flow.lead")} tone={lead.tone} live={lead.live} onPress={lead.onPress} label={t("reportUi.openAgent")} />],
    ...(language ? [[t("reportUi.language"), languageName(language, t)] as const] : []),
    [t("reportUi.created"), timeText(run.createdAt, t)],
    [t("reportUi.updated"), agoText(run.updatedAt, now, t)],
    [active ? t("reportUi.runningFor") : t("reportUi.lasted"), durationText(end - Date.parse(run.createdAt), t)],
  ];
  const rule = narrow ? 14 : 22;
  return (
    <View onLayout={onLayout} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: narrow ? "wrap" : "nowrap", alignItems: "flex-start", gap: narrow ? 12 : 14 }}>
        <View style={{ width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(tone, 0.16), borderWidth: 1, borderColor: withAlpha(tone, 0.3) }}>
          <Icon name={MODE_LOOK[run.mode].icon} size={20} color={tone} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text selectable numberOfLines={2} style={{ color: k.c.fg, fontSize: narrow ? 17 : 20, lineHeight: narrow ? 22 : 25, fontWeight: "700", letterSpacing: -0.2 }}>
            {run.title}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Badge k={k} tone={tone} label={`${t(`mode.${run.mode}`)} · ${run.mode === "team" ? "MA-08" : "MA-04"}`} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 20, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderColor: active ? withAlpha(k.c.warn, 0.45) : k.c.border }}>
              <Dot tone={active ? k.c.warn : k.c.mutedFg} live={active} size={7} />
              <Text style={{ color: active ? k.c.fg : k.c.mutedFg, fontSize: 11, fontWeight: "600" }}>{active ? t("session.status.active") : t("session.status.closed")}</Text>
            </View>
            <Badge k={k} label={run.mode === "team" ? t("session.round", { round: run.round, rounds: run.rounds }) : t("session.batch", { round: run.round })} />
            {run.planApproval ? <Badge k={k} tone={PART.plans} icon="ClipboardCheck" label={t("session.planApprovalOn")} /> : null}
          </View>
        </View>
        {onRefresh || updatedAt ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, ...(narrow ? { width: "100%", justifyContent: "space-between" } : {}) }}>
            {updatedAt ? <Text style={k.t.tiny}>{t("reportUi.refreshed", { ago: agoText(new Date(updatedAt).toISOString(), now, t) })}</Text> : <View />}
            {onRefresh ? <Button k={k} size="sm" icon="RefreshCw" label={t("reportUi.refresh")} onPress={onRefresh} busy={refreshing} /> : null}
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: k.c.border }}>
        {facts.map(([label, value], index) => (
          <View key={label} style={{ gap: 2, minWidth: 0, maxWidth: "100%", paddingRight: rule, marginRight: rule, borderRightWidth: index === facts.length - 1 ? 0 : 1, borderRightColor: withAlpha(k.c.fg, 0.1) }}>
            <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: 10.5, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }}>
              {label}
            </Text>
            {typeof value === "string" ? (
              <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 12.5, fontWeight: "500" }}>
                {value}
              </Text>
            ) : (
              value
            )}
          </View>
        ))}
      </View>
      {reason ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2 }}>
          <FieldLabel k={k}>{t("reportUi.reason")}</FieldLabel>
          <Text selectable style={{ color: k.c.fg, fontSize: 12.5, lineHeight: 18, flexShrink: 1 }}>
            {reason}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MemberCard({ k, t, member, runtime, onPress }: { k: Kit; t: Tr; member: RunMember; runtime: Runtime; onPress?: () => void }) {
  const { tone, live } = memberTone(k, member);
  const where = [runtime.provider, runtime.model].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${member.title}: ${t("reportUi.openAgent")}`}
      disabled={!onPress}
      onPress={onPress}
      style={(state) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 11,
        paddingVertical: 8,
        borderRadius: k.radius,
        borderWidth: 1,
        borderColor: hovered(state) ? withAlpha(k.c.fg, 0.28) : k.c.border,
        backgroundColor: hovered(state) || state.pressed ? k.c.muted : k.c.card,
        opacity: member.retired ? 0.55 : 1,
      })}
    >
      <View>
        <Tile k={k} icon="Bot" tone={tone} size={32} />
        <CornerDot k={k} tone={tone} live={live} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 12.5, fontWeight: "700" }}>
            {member.title}
          </Text>
          <Badge k={k} tone={tone} label={memberStateText(member, t)} />
          {onPress ? <Icon name="ArrowUpRight" size={12} color={k.c.mutedFg} /> : null}
        </View>
        <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: 11 }}>
          {member.role}
          {where ? <Text style={{ fontFamily: "Menlo", fontSize: 10.5 }}>{` · ${where}`}</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
}

/** The run's members as cards; pressing one opens its agent. */
export function Members({ k, t, members, runtimeOf, openAgent, roles }: { k: Kit; t: Tr; members: readonly RunMember[]; runtimeOf(agentId: string): Runtime; openAgent?: (id: string) => void; roles?: SessionInfo["roles"] }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionTitle k={k} icon="Users" right={<Text style={k.t.tiny}>{members.filter((member) => !member.retired).length}</Text>}>
        {t("reportUi.members")}
      </SectionTitle>
      {!members.length ? <EmptyLine k={k}>{t("reportUi.noMembers")}</EmptyLine> : null}
      {members.length ? (
        <Grid min={k.compact ? 10_000 : 260} gap={8}>
          {members.map((member) => (
            <MemberCard key={member.agentId} k={k} t={t} member={member} runtime={runtimeOf(member.agentId)} onPress={openAgent ? () => openAgent(member.agentId) : undefined} />
          ))}
        </Grid>
      ) : null}
      {roles?.length ? (
        <Text style={k.t.tiny}>
          {t("session.formedRoles")}: {roles.map((role) => `${role.name} → ${role.candidate} (${role.model})`).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

/** A brief shown to the user that waits for their confirmation; pressing it opens the brief. */
export function PendingIntake({ k, t, pending, onOpen }: { k: Kit; t: Tr; pending: NonNullable<SessionInfo["pendingBrief"]>; onOpen(): void }) {
  const tone = PART.brief;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={(state) => ({ gap: 5, padding: 12, borderRadius: k.radius, borderWidth: 1, borderStyle: "dashed", borderColor: tone, backgroundColor: withAlpha(tone, hovered(state) || state.pressed ? 0.12 : 0.07) })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <Tile k={k} icon="FileText" tone={tone} size={24} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 13, fontWeight: "700" }}>
          {t("flow.brief.pendingTitle")}
        </Text>
        <Dot tone={tone} live size={7} />
        <Icon name="ChevronRight" size={14} color={k.c.mutedFg} />
      </View>
      <Text numberOfLines={2} style={{ color: k.c.fg, fontSize: 12.5, lineHeight: 18 }}>
        <Text style={{ fontWeight: "700", color: ink(k, tone) }}>{pending.title}</Text> · {pending.goal}
      </Text>
      <Text style={k.t.tiny}>
        {t("flow.brief.roles")}: {pending.roles.join(", ")} · {t("flow.brief.plannedTasks")}: {pending.tasks}
      </Text>
    </Pressable>
  );
}
