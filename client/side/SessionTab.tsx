// The side panel's Session tab: one of the workspace's team sessions (picked from its leads), its lead, its collaboration
// mode (switchable until auto settles), its members, and its latest run as party chips and the mode's parts. A part
// opens the session dashboard.
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { TEAM_MODES, type TeamMode } from "../../shared/modes";
import { teamSessionModeRpc, teamSessionRpc } from "../../shared/rpc";
import { AgentAvatar, Badge, Button, Callout, Card, Dot, Empty, MODE_LOOK, PART, Segmented, Spinner, stateTone, T, Tile, type Kit } from "../kit";
import { agentState, leadFile, leadMembers, runtimeText, SESSIONS_KEY, sessionKey, teamLabel, type Agent, type MemberRow, type WorkspaceTeam } from "./data";
import type { ProviderIcons } from "./model-select";
import { agoText, LIVE_MS, PartCards, PartyChips, useNow, type Translate } from "./run-parts";

const AGENT_STATES = ["working", "idle", "attention", "failed", "starting", "ended"] as const;

/** A run's or an agent's state in words. */
export function stateText(state: string, t: Translate): string {
  if (state === "done") return t("session.state.done");
  if (state === "retired") return t("session.retired");
  return (AGENT_STATES as readonly string[]).includes(state) ? t(`sideUi.state.${state as (typeof AGENT_STATES)[number]}`) : state;
}

/** What the picker calls a session: team · workspace · state · age. */
function sessionText(lead: Agent, workspace: WorkspaceTeam | undefined, now: number, t: Translate): string {
  const title = workspace?.workspace ?? "";
  const team = teamLabel(workspace?.team, leadFile(lead) ?? workspace?.file, title);
  const parts = [team, ...(title && title.toLowerCase() !== team.toLowerCase() ? [title] : []), stateText(agentState(lead), t), agoText(lead.createdAt, now, t)];
  return parts.filter(Boolean).join(" · ");
}

function SessionPicker({ k, t, leads, current, workspace, now, onSelect }: { k: Kit; t: Translate; leads: readonly Agent[]; current: Agent; workspace: WorkspaceTeam | undefined; now: number; onSelect(id: string): void }) {
  const [open, setOpen] = useState(false);
  const several = leads.length > 1;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("sideUi.session.pick")}
        accessibilityState={{ expanded: open, disabled: !several }}
        disabled={!several}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34, paddingHorizontal: 10, borderRadius: k.radius, borderWidth: 1, borderColor: open ? k.c.primary : k.c.border, backgroundColor: pressed ? k.c.muted : k.c.card })}
      >
        <Dot tone={stateTone(k, agentState(current))} live={agentState(current) === "working"} />
        <T k={k} v="small" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {sessionText(current, workspace, now, t)}
        </T>
        {several ? <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color={k.c.mutedFg} /> : null}
      </Pressable>
      {open ? (
        <Card k={k} style={{ padding: 4, gap: 2 }}>
          {leads.map((lead) => {
            const on = lead.id === current.id;
            return (
              <Pressable
                key={lead.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setOpen(false);
                  onSelect(lead.id);
                }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: k.radius - 3, backgroundColor: on ? k.c.muted : pressed ? k.c.muted : "transparent" })}
              >
                <Dot tone={stateTone(k, agentState(lead))} live={agentState(lead) === "working"} />
                <T k={k} v="small" numberOfLines={1} style={{ flex: 1, minWidth: 0, fontWeight: on ? "600" : "400" }}>
                  {sessionText(lead, workspace, now, t)}
                </T>
                {on ? <Icon name="Check" size={13} color={k.c.primary} /> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

function MemberRowCard({ k, t, member, icons, openAgent }: { k: Kit; t: Translate; member: MemberRow; icons: ProviderIcons; openAgent?: (id: string) => void }) {
  const state = member.retired ? "retired" : member.state;
  const press = member.open && openAgent ? () => openAgent(member.agentId) : undefined;
  return (
    <Card k={k} onPress={press} label={member.title} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, paddingHorizontal: 10, opacity: member.retired ? 0.6 : 1 }}>
      <View>
        {member.provider ? <AgentAvatar k={k} provider={member.provider} model={member.model} icons={icons} size={24} /> : <Tile k={k} icon="Bot" size={24} />}
        <View style={{ position: "absolute", left: -2, top: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: k.c.card, alignItems: "center", justifyContent: "center" }}>
          <Dot tone={stateTone(k, state)} live={member.live} size={7} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T k={k} v="strong" numberOfLines={1}>
          {member.title}
        </T>
        <T k={k} v="tiny" numberOfLines={1}>
          {[member.role && !member.title.toLowerCase().startsWith(member.role.toLowerCase()) ? member.role : null, runtimeText(member.provider, member.model)].filter(Boolean).join(" · ") || "—"}
        </T>
      </View>
      <T k={k} v="tiny">
        {stateText(state, t)}
      </T>
      {press ? <Icon name="MessageSquare" size={13} color={k.c.mutedFg} /> : null}
    </Card>
  );
}

function ModeSwitch({ k, t, leadAgentId, info }: { k: Kit; t: Translate; leadAgentId: string; info: { configured: TeamMode | null; override: TeamMode | null; locked: "team" | "delegation" | null; effective: TeamMode } }) {
  const switchMode = useRpc(teamSessionModeRpc);
  const queryClient = useQueryClient();
  const switched = useMutation({
    mutationFn: (mode: TeamMode) => switchMode({ agentId: leadAgentId, mode }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
  const failure = switched.error ? String(switched.error) : switched.data && !switched.data.ok ? switched.data.errors.join("; ") : null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T k={k} v="label" style={{ flex: 1 }}>
          {t("mode.label")}
        </T>
        {info.locked ? <Badge k={k} label={t("sideUi.session.locked")} tone={k.c.warn} icon="Lock" /> : info.override === null ? <T k={k} v="tiny">{t("mode.fromFile")}</T> : null}
      </View>
      <Segmented<TeamMode>
        k={k}
        stretch
        value={info.effective}
        disabled={info.locked !== null || switched.isPending}
        onChange={(mode) => {
          if (mode !== info.effective) switched.mutate(mode);
        }}
        options={TEAM_MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`) }))}
      />
      <T k={k} v="tiny">
        {info.locked ? t("mode.lockedHint", { mode: t(`mode.${info.locked}`) }) : t(`mode.${info.effective}Hint`)}
      </T>
      {failure ? (
        <T k={k} v="tiny" style={{ color: k.c.bad }}>
          {t("mode.switchFailed", { error: failure })}
        </T>
      ) : null}
    </View>
  );
}

export function SessionTab({ k, t, workspace, leads, agents, icons, selected, onSelect, onStart, openAgent, openDashboard }: { k: Kit; t: Translate; workspace: WorkspaceTeam | undefined; leads: readonly Agent[]; agents: readonly Agent[]; icons: ProviderIcons; selected: string | null; onSelect(id: string): void; onStart(): void; openAgent?: (agentId: string) => void; openDashboard?: (agentId: string) => void }) {
  const now = useNow();
  const current = leads.find((lead) => lead.id === selected) ?? leads[0] ?? null;
  const readSession = useRpc(teamSessionRpc);
  const session = useQuery({
    queryKey: sessionKey(current?.id ?? null),
    queryFn: () => readSession({ agentId: current!.id }),
    enabled: current !== null,
    refetchInterval: (query) => (query.state.data?.run?.status === "active" || query.state.data?.pendingBrief ? 3000 : 15_000),
  });
  if (!current) {
    return (
      <View style={{ gap: 10 }}>
        <Empty k={k} icon="Users">
          {t("sideUi.session.none")}
        </Empty>
        <Button k={k} variant="primary" icon="Play" label={t("sideUi.session.start")} block onPress={onStart} />
      </View>
    );
  }
  const info = session.data;
  const run = info?.run ?? null;
  const pending = info?.pendingBrief ?? null;
  const leadId = info?.leadAgentId ?? current.id;
  const state = agentState(current);
  const file = leadFile(current) ?? workspace?.file ?? null;
  const members = leadMembers(agents, current.id, run);
  const live = run ? run.events.some((event) => now - Date.parse(event.at) < LIVE_MS) : false;
  const dashboard = openDashboard ? () => openDashboard(leadId) : undefined;
  return (
    <View style={{ gap: 14 }}>
      <SessionPicker k={k} t={t} leads={leads} current={current} workspace={workspace} now={now} onSelect={onSelect} />

      <Card k={k} style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View>
            <AgentAvatar k={k} provider={current.provider ?? ""} model={current.model} icons={icons} size={28} />
            <View style={{ position: "absolute", left: -3, top: -3, width: 13, height: 13, borderRadius: 7, backgroundColor: k.c.card, alignItems: "center", justifyContent: "center" }}>
              <Icon name="Crown" size={9} color={k.c.primary} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T k={k} v="h3" numberOfLines={1}>
              {teamLabel(workspace?.team, file, workspace?.workspace ?? current.title ?? "")}
            </T>
            <T k={k} v="tiny" numberOfLines={2}>
              {[t("screen.lead"), runtimeText(current.provider, current.model), file ?? t("sideUi.session.noFile")].filter(Boolean).join(" · ")}
            </T>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Badge k={k} label={stateText(state, t)} tone={stateTone(k, state)} />
            {openAgent ? <Button k={k} icon="MessageSquare" variant="ghost" size="sm" accessibilityLabel={t("sideUi.session.openLead")} onPress={() => openAgent(current.id)} /> : null}
          </View>
        </View>
        {info?.leadAgentId && info.effective ? <ModeSwitch k={k} t={t} leadAgentId={info.leadAgentId} info={{ configured: info.configured, override: info.override, locked: info.locked, effective: info.effective }} /> : session.isLoading ? <Spinner k={k} /> : null}
        {info?.leadAgentId ? (
          // What the person who started the session chose for the members' permissions; fixed for the session.
          <Badge k={k} icon={info.unattended ? "ShieldAlert" : "ShieldCheck"} tone={info.unattended ? k.c.warn : undefined} label={t(info.unattended ? "unattended.badgeOn" : "unattended.badgeOff")} />
        ) : null}
        {session.error ? (
          <T k={k} v="tiny" style={{ color: k.c.bad }}>
            {String(session.error)}
          </T>
        ) : null}
      </Card>

      {pending ? (
        <Callout k={k} tone={PART.brief} icon="FileText">
          <Pressable accessibilityRole="button" disabled={!dashboard} onPress={dashboard} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T k={k} v="strong" style={{ flex: 1 }}>
                {t("flow.brief.pendingTitle")}
              </T>
              <Dot tone={PART.brief} live />
            </View>
            <T k={k} v="small" numberOfLines={3}>
              {pending.title} · {pending.goal}
            </T>
            <T k={k} v="tiny">
              {t("flow.brief.roles")}: {pending.roles.join(", ") || "—"} · {t("flow.brief.plannedTasks")}: {pending.tasks}
            </T>
            <T k={k} v="tiny">
              {t("flow.brief.pendingHint")}
            </T>
          </Pressable>
          {openAgent ? (
            <View style={{ paddingTop: 8 }}>
              <Button k={k} icon="MessageSquare" label={t("sideUi.session.openLead")} size="sm" onPress={() => openAgent(current.id)} />
            </View>
          ) : null}
        </Callout>
      ) : null}

      <View style={{ gap: 6 }}>
        <T k={k} v="label">
          {t("sideUi.session.members")} · {members.length}
        </T>
        {members.length ? members.map((member) => <MemberRowCard key={member.agentId} k={k} t={t} member={member} icons={icons} openAgent={openAgent} />) : <T k={k} v="muted">{t("sideUi.session.noMembers")}</T>}
      </View>

      {run ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T k={k} v="label" style={{ flex: 1 }}>
              {t("flow.title")}
            </T>
            {live ? <Badge k={k} label={t("flow.live")} tone={k.c.ok} icon="Radio" /> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Badge k={k} label={t(`mode.${run.mode}`)} tone={MODE_LOOK[run.mode].tone} icon={MODE_LOOK[run.mode].icon} />
            <Badge k={k} label={run.status === "active" ? t("session.status.active") : t("session.status.closed")} tone={run.status === "active" ? k.c.primary : undefined} />
            <T k={k} v="tiny">
              {run.mode === "team" ? t("session.round", { round: run.round, rounds: run.rounds }) : t("session.batch", { round: run.round })}
            </T>
          </View>
          {run.title ? (
            <T k={k} v="strong" numberOfLines={2}>
              {run.title}
            </T>
          ) : null}
          <PartyChips k={k} t={t} run={run} leadAgentId={leadId} leadState={state} now={now} openAgent={openAgent} />
          <PartCards k={k} t={t} run={run} pending={pending} now={now} onOpen={dashboard ? () => dashboard() : undefined} />
        </View>
      ) : !pending && !session.isLoading ? (
        <T k={k} v="muted">{t("session.noRun")}</T>
      ) : null}

      {dashboard ? <Button k={k} icon="Network" label={t("cards.open")} block onPress={dashboard} /> : null}
    </View>
  );
}
