// One page per part of a run, laid out for the width it gets: Kanban columns, a chat timeline and card grids when wide,
// stacked lists when narrow. Each part's page ends with who uses the part and its history (see ComponentBody).
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { withAlpha } from "../../shared/color";
import { componentsOf, flowTotals, type RunComponent } from "../../shared/flow";
import type { CollabMode } from "../../shared/modes";
import { Badge, Callout, Chip, Dot, Empty, PART, roleTone, Tile, type Kit } from "../kit";
import {
  aboutText, agoText, bodyText, Bullets, COMPONENT_ICON, componentName, CountPill, durationText, EmptyLine, EventRow, Facts, Field, FieldLabel, FileChips, Grid, History, hovered, IdPill, ink, isLight, LEAD_TONE, LinkText, LongText,
  memberStateText, memberTone, Panel, partyName, PartyTag, pageTone, planBadge, planLabel, planTone, RolePill, SectionTitle, Stat, taskTone, Usage,
  type ComponentPage, type Detail, type DetailRun, type Tr,
} from "./common";

type Task = DetailRun["tasks"][number];
type RunMember = DetailRun["members"][number];
type Batch = DetailRun["batches"][number];
type Brief = { requirements: string[]; acceptance: string[]; constraints: string[]; outOfScope: string[] };

interface PageProps {
  k: Kit;
  t: Tr;
  run: DetailRun;
  now: number;
  /** Room for columns: Kanban, the board beside its filters, two-column cards. */
  wide: boolean;
  openAgent?: (id: string) => void;
}

const TASK_COLUMNS = ["todo", "doing", "done", "dropped"] as const;
const memberOf = (run: DetailRun, agentId: string | null) => (agentId ? run.members.find((member) => member.agentId === agentId) : undefined);
const taskNumber = (task: Task) => Number(task.id.replace(/\D/g, "")) || 0;
const columnOrder = (state: Task["state"]) => (a: Task, b: Task) => {
  if (state === "todo") return a.waitingOn.length - b.waitingOn.length || taskNumber(a) - taskNumber(b);
  if (state === "done") return b.updatedAt.localeCompare(a.updatedAt);
  return taskNumber(a) - taskNumber(b);
};

/** A member as a name with its state dot, opening its agent. */
function MemberTag({ k, t, run, agentId, fallback, openAgent }: { k: Kit; t: Tr; run: DetailRun; agentId: string | null; fallback?: string | null; openAgent?: (id: string) => void }) {
  const member = memberOf(run, agentId);
  if (!member) return fallback ? <PartyTag k={k} name={agentId === "lead" ? t("flow.lead") : fallback} tone={agentId === "lead" ? LEAD_TONE : undefined} /> : null;
  const { tone, live } = memberTone(k, member);
  return <PartyTag k={k} name={member.title} tone={tone} live={live} onPress={openAgent ? () => openAgent(member.agentId) : undefined} label={t("reportUi.openAgent")} />;
}

/** The lead's verdict, set off with a bar in `tone`. */
function Verdict({ k, tone, children }: { k: Kit; tone: string; children: ReactNode }) {
  return <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, backgroundColor: k.c.muted, borderLeftWidth: 3, borderLeftColor: tone }}>{typeof children === "string" ? <Text selectable style={bodyText(k)}>{children}</Text> : children}</View>;
}

const CalloutText = ({ k, children, tone }: { k: Kit; children: ReactNode; tone?: string }) => <Text style={[bodyText(k), tone ? { color: ink(k, tone) } : null]}>{children}</Text>;

// ---------------------------------------------------------------------------------------------------------------------
// Team mode

function TaskDetail({ k, t, run, task, now, openAgent }: { k: Kit; t: Tr; run: DetailRun; task: Task; now: number; openAgent?: (id: string) => void }) {
  const history = run.events.filter((event) => (event.component === "tasks" || event.component === "plans" || event.component === "split") && event.subject === task.id);
  const plan = task.plan;
  return (
    <View style={{ gap: 14 }}>
      {task.detail && task.detail !== task.title ? (
        <Field k={k} label={t("flow.details")}>
          <LongText k={k} t={t} text={task.detail} lines={12} />
        </Field>
      ) : null}
      <Facts
        k={k}
        items={[
          [t("flow.tasks.role"), task.role ?? t("session.anyone")],
          [t("flow.tasks.owner"), task.ownerTitle ? <MemberTag k={k} t={t} run={run} agentId={task.owner} fallback={task.ownerTitle} openAgent={openAgent} /> : "–"],
          [t("flow.tasks.createdBy"), task.createdBy === "lead" ? t("flow.lead") : task.createdBy],
          task.deps.length > 0 && [
            t("flow.tasks.waitsFor"),
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {task.deps.map((dep) => {
                const tone = task.waitingOn.includes(dep) ? k.c.warn : k.c.ok;
                return (
                  <View key={dep} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Icon name={task.waitingOn.includes(dep) ? "Hourglass" : "Check"} size={11} color={tone} />
                    <Text style={{ color: ink(k, tone), fontFamily: "Menlo", fontSize: 11.5, fontWeight: "600" }}>{dep}</Text>
                  </View>
                );
              })}
            </View>,
          ],
        ]}
      />
      {task.files.length ? (
        <Field k={k} label={t("flow.tasks.files")}>
          <FileChips k={k} files={task.files} />
        </Field>
      ) : null}
      {plan ? (
        <View style={{ gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: k.radius, borderWidth: 1, borderColor: withAlpha(planTone(k, plan.status), 0.35), backgroundColor: withAlpha(planTone(k, plan.status), 0.05) }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <FieldLabel k={k}>{t("flow.tasks.plan")}</FieldLabel>
            <Badge k={k} tone={planTone(k, plan.status)} label={planLabel(plan.status, t)} />
            {plan.status !== "pending" ? <Text style={k.t.tiny}>{plan.delivered ? t("flow.plans.delivered") : t("flow.plans.notDelivered")}</Text> : null}
          </View>
          <LongText k={k} t={t} text={plan.text} lines={8} />
          {plan.feedback ? (
            <Verdict k={k} tone={planTone(k, plan.status)}>
              <Text selectable style={bodyText(k)}>
                <Text style={{ fontWeight: "700" }}>{t("flow.lead")}:</Text> {plan.feedback}
              </Text>
            </Verdict>
          ) : null}
        </View>
      ) : null}
      {task.result ? (
        <Field k={k} label={t("flow.tasks.result")}>
          <LongText k={k} t={t} text={task.result} lines={10} />
        </Field>
      ) : null}
      {task.feedback ? (
        <Callout k={k} tone={k.c.bad} icon="Undo2">
          <FieldLabel k={k}>{t("flow.tasks.feedback")}</FieldLabel>
          <Text selectable style={bodyText(k)}>
            {task.feedback}
          </Text>
        </Callout>
      ) : null}
      {history.length ? (
        <Field k={k} label={t("flow.history")}>
          <View style={{ gap: 2 }}>
            {[...history].reverse().map((event) => (
              <EventRow key={event.seq} k={k} t={t} event={event} members={run.members} mode={run.mode} now={now} />
            ))}
          </View>
        </Field>
      ) : null}
    </View>
  );
}

/** A task on the board: id, role, plan state, title, who has it and what waits; tap for everything else. */
function TaskCard({ k, t, run, task, now, selected, onSelect, openAgent }: { k: Kit; t: Tr; run: DetailRun; task: Task; now: number; selected: boolean; onSelect(): void; openAgent?: (id: string) => void }) {
  const tone = taskTone(k, task.state);
  const sentBack = task.feedback !== "" && task.state !== "done";
  const [hover, setHover] = useState(false);
  return (
    <View
      style={{
        borderRadius: k.radius,
        borderWidth: 1,
        borderColor: selected ? tone : hover ? withAlpha(tone, 0.5) : k.c.border,
        backgroundColor: k.c.card,
        opacity: task.state === "dropped" ? 0.62 : 1,
        ...(selected ? { shadowColor: tone, shadowOpacity: 0.5, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } } : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }),
      }}
    >
      <View style={{ position: "absolute", left: -1, top: 10, bottom: 10, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: tone }} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: selected }} onPress={onSelect} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={{ gap: 7, paddingHorizontal: 11, paddingVertical: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <IdPill k={k} id={task.id} tone={tone} />
          <RolePill k={k} t={t} role={task.role} />
          <View style={{ flex: 1 }} />
          {task.plan ? <Badge k={k} tone={planTone(k, task.plan.status)} label={planBadge(task.plan.status, t)} /> : null}
        </View>
        <Text numberOfLines={selected ? undefined : 3} style={{ color: k.c.fg, fontSize: 12.5, lineHeight: 18, fontWeight: "600", textDecorationLine: task.state === "dropped" ? "line-through" : "none" }}>
          {task.title}
        </Text>
        {task.ownerTitle || task.waitingOn.length || sentBack ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 6 }}>
            {task.ownerTitle ? <MemberTag k={k} t={t} run={run} agentId={task.owner} fallback={task.ownerTitle} openAgent={openAgent} /> : null}
            {task.waitingOn.length ? <Badge k={k} tone={k.c.warn} icon="Hourglass" label={t("session.waitsFor", { ids: task.waitingOn.join(", ") })} /> : null}
            {sentBack ? <Badge k={k} tone={k.c.bad} icon="Undo2" label={t("session.sentBack")} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.mutedFg, fontSize: 10.5 }}>
            {t("flow.tasks.updated", { ago: agoText(task.updatedAt, now, t) })}
          </Text>
          {task.files.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Icon name="File" size={11} color={k.c.mutedFg} />
              <Text style={{ color: k.c.mutedFg, fontSize: 10.5 }}>{task.files.length}</Text>
            </View>
          ) : null}
          {task.deps.length && !task.waitingOn.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 }}>
              <Icon name="Check" size={11} color={k.c.mutedFg} />
              <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: 10.5 }}>
                {task.deps.join(", ")}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {selected ? (
        <View style={{ marginHorizontal: 11, marginBottom: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: k.c.border }}>
          <TaskDetail k={k} t={t} run={run} task={task} now={now} openAgent={openAgent} />
        </View>
      ) : null}
    </View>
  );
}

function ColumnHead({ k, t, state, count, boxed }: { k: Kit; t: Tr; state: Task["state"]; count: number; boxed?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, ...(boxed ? { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: k.c.border } : { paddingHorizontal: 2, paddingTop: 4 }) }}>
      <Dot tone={taskTone(k, state)} />
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 12, fontWeight: "700" }}>
        {t(`session.taskState.${state}`)}
      </Text>
      <CountPill k={k} count={count} />
    </View>
  );
}

/** The shared task board: Kanban columns when wide, the same columns stacked when narrow. */
export function TasksPage({ k, t, run, now, wide, openAgent }: PageProps) {
  const [role, setRole] = useState(null as string | null);
  const [selected, setSelected] = useState(null as string | null);
  if (!run.tasks.length) return <Empty k={k} icon="SquareKanban">{t("flow.tasks.none")}</Empty>;
  const roles = [...new Set(run.tasks.map((task) => task.role ?? ""))];
  const tasks = run.tasks.filter((task) => role === null || (task.role ?? "") === role);
  const live = run.tasks.filter((task) => task.state !== "dropped");
  const done = live.filter((task) => task.state === "done").length;
  // Dropped tasks only get a column when there are any.
  const columns = TASK_COLUMNS.filter((state) => state !== "dropped" || tasks.some((task) => task.state === "dropped"));
  const listOf = (state: Task["state"]) => tasks.filter((task) => task.state === state).sort(columnOrder(state));
  const card = (task: Task) => <TaskCard key={task.id} k={k} t={t} run={run} task={task} now={now} selected={task.id === selected} onSelect={() => setSelected((value) => (value === task.id ? null : task.id))} openAgent={openAgent} />;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={k.t.strong}>{t("session.stat.ofDone", { done, total: live.length })}</Text>
          <View style={{ width: 160, height: 6, borderRadius: 3, backgroundColor: k.c.muted, overflow: "hidden" }}>
            <View style={{ height: 6, borderRadius: 3, width: `${live.length ? Math.round((done / live.length) * 100) : 0}%`, backgroundColor: k.c.ok }} />
          </View>
        </View>
        {roles.length > 1 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip k={k} label={t("flow.filterAll")} on={role === null} onPress={() => setRole(null)} />
            {roles.map((entry) => (
              <Chip key={entry} k={k} label={entry || t("session.anyone")} on={role === entry} tone={PART.tasks} onPress={() => setRole(role === entry ? null : entry)} />
            ))}
          </View>
        ) : null}
      </View>
      {wide ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          {columns.map((state) => {
            const list = listOf(state);
            return (
              <View key={state} style={{ flex: state === "dropped" ? 0.8 : 1, minWidth: 0, borderRadius: k.radius + 2, borderWidth: 1, borderColor: k.c.border, borderTopWidth: 3, borderTopColor: taskTone(k, state), backgroundColor: withAlpha(k.c.fg, 0.025), overflow: "hidden" }}>
                <ColumnHead k={k} t={t} state={state} count={list.length} boxed />
                <View style={{ gap: 8, padding: 10, minHeight: 64 }}>
                  {list.map(card)}
                  {!list.length ? (
                    <View style={{ paddingVertical: 14, borderRadius: k.radius, borderWidth: 1, borderStyle: "dashed", borderColor: k.c.border }}>
                      <Text style={{ color: k.c.mutedFg, fontSize: 12, textAlign: "center" }}>{t("reportUi.columnEmpty")}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        columns.map((state) => {
          const list = listOf(state);
          if (!list.length) return null;
          return (
            <View key={state} style={{ gap: 8 }}>
              <ColumnHead k={k} t={t} state={state} count={list.length} />
              {list.map(card)}
            </View>
          );
        })
      )}
    </View>
  );
}

export function PlansPage({ k, t, run, now, wide, openAgent }: PageProps) {
  const withPlans = run.tasks.filter((task) => task.plan);
  if (!run.planApproval && !withPlans.length) {
    return (
      <Callout k={k} tone={k.c.mutedFg} icon="Info">
        <CalloutText k={k}>{t("flow.plans.off")}</CalloutText>
      </Callout>
    );
  }
  if (!withPlans.length) return <Empty k={k} icon="ClipboardCheck">{t("flow.plans.none")}</Empty>;
  const order = { pending: 0, rejected: 1, approved: 2 } as const;
  const count = (status: keyof typeof order) => withPlans.filter((task) => task.plan!.status === status).length;
  return (
    <View style={{ gap: 12 }}>
      <Grid min={130} gap={10}>
        {(["pending", "rejected", "approved"] as const).map((status) => (
          <Stat key={status} k={k} value={String(count(status))} label={planLabel(status, t)} tone={planTone(k, status)} />
        ))}
      </Grid>
      <View style={{ gap: 10 }}>
        {[...withPlans]
          .sort((a, b) => order[a.plan!.status] - order[b.plan!.status] || taskNumber(a) - taskNumber(b))
          .map((task) => {
            const plan = task.plan!;
            const tone = planTone(k, plan.status);
            const split = wide && !!plan.feedback;
            return (
              <Panel key={task.id} k={k} tone={tone} edge="left" style={{ paddingHorizontal: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <IdPill k={k} id={task.id} />
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 13, fontWeight: "600" }}>
                    {task.title}
                  </Text>
                  <Badge k={k} tone={tone} label={planLabel(plan.status, t)} />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 6 }}>
                  {task.ownerTitle ? <MemberTag k={k} t={t} run={run} agentId={task.owner} fallback={task.ownerTitle} openAgent={openAgent} /> : null}
                  {plan.status !== "pending" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name={plan.delivered ? "Check" : "Clock"} size={11} color={plan.delivered ? k.c.ok : k.c.warn} />
                      <Text style={{ color: ink(k, plan.delivered ? k.c.ok : k.c.warn), fontSize: 11.5 }}>{plan.delivered ? t("flow.plans.delivered") : t("flow.plans.notDelivered")}</Text>
                    </View>
                  ) : null}
                  <Text style={{ color: k.c.mutedFg, fontSize: 11.5 }}>{t("flow.tasks.updated", { ago: agoText(task.updatedAt, now, t) })}</Text>
                </View>
                <View style={{ flexDirection: split ? "row" : "column", gap: split ? 16 : 10 }}>
                  <View style={{ flex: split ? 1 : undefined, minWidth: 0 }}>
                    <Field k={k} label={t("flow.tasks.plan")}>
                      <LongText k={k} t={t} text={plan.text} lines={wide ? 10 : 6} />
                    </Field>
                  </View>
                  {plan.feedback ? (
                    <View style={{ flex: split ? 1 : undefined, minWidth: 0 }}>
                      <Field k={k} label={t("flow.lead")}>
                        <Verdict k={k} tone={tone}>
                          {plan.feedback}
                        </Verdict>
                      </Field>
                    </View>
                  ) : null}
                </View>
              </Panel>
            );
          })}
      </View>
    </View>
  );
}

const KNOWN_KINDS = ["brief", "update", "finding", "question", "answer", "done", "note"] as const;
const kindTone = (k: Kit, kind: string): string => ({ brief: PART.brief, update: k.c.info, finding: k.c.warn, question: PART.plans, answer: PART.board, done: k.c.ok, note: k.c.mutedFg })[kind] ?? k.c.mutedFg;
const kindName = (kind: string, t: Tr) => ((KNOWN_KINDS as readonly string[]).includes(kind) ? t(`flow.board.kind.${kind as (typeof KNOWN_KINDS)[number]}`) : kind);
const initials = (name: string) => name.replace(/#.*$/, "").slice(0, 2).toUpperCase();

/** The team board as a conversation, oldest first and grouped by round, the lead's posts on the right, with each reader's progress on top. */
export function BoardPage({ k, t, run, now, wide, openAgent }: PageProps) {
  const [kind, setKind] = useState(null as string | null);
  const [earlier, setEarlier] = useState(false);
  const kinds = [...new Set(run.posts.map((post) => post.kind))];
  const filtered = run.posts.filter((post) => kind === null || post.kind === kind);
  const limit = 40;
  const posts = earlier ? filtered : filtered.slice(-limit);
  const last = run.posts.at(-1)?.seq ?? 0;
  const readers = [
    { id: "lead", title: t("flow.lead"), readSeq: run.leadReadSeq, inboxSeq: run.leadInboxSeq },
    ...run.members.filter((member) => !member.retired).map((member) => ({ id: member.agentId, title: member.title, readSeq: member.readSeq, inboxSeq: member.inboxSeq })),
  ];
  const authorTone = (agentId: string, author: string) => (author === "lead" ? LEAD_TONE : roleTone(Math.max(0, run.members.findIndex((member) => member.agentId === agentId))));

  const inbox = (
    <Panel k={k}>
      <SectionTitle k={k} icon="Inbox">
        {t("flow.board.inbox")}
      </SectionTitle>
      <Grid min={wide ? 220 : 10_000} gap={14}>
        {readers.map((reader) => {
          const read = last ? Math.min(reader.readSeq, last) / last : 0;
          const delivered = last ? Math.min(Math.max(reader.inboxSeq, reader.readSeq), last) / last : read;
          const unread = Math.max(0, last - reader.readSeq);
          return (
            <View key={reader.id} style={{ gap: 4, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                {reader.id === "lead" ? <PartyTag k={k} name={reader.title} tone={LEAD_TONE} /> : <MemberTag k={k} t={t} run={run} agentId={reader.id} openAgent={openAgent} />}
                {unread ? <Text style={{ color: ink(k, k.c.warn), fontSize: 11 }}>{t("flow.board.unread", { count: unread })}</Text> : <Icon name="Check" size={12} color={k.c.ok} />}
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: k.c.muted, overflow: "hidden" }}>
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(delivered * 100)}%`, borderRadius: 3, backgroundColor: withAlpha(PART.board, 0.35) }} />
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(read * 100)}%`, borderRadius: 3, backgroundColor: PART.board }} />
              </View>
              <Text numberOfLines={1} style={k.t.tiny}>
                {t("flow.board.readUpTo", { seq: reader.readSeq })} · {t("reportUi.deliveredUpTo", { seq: reader.inboxSeq })}
              </Text>
            </View>
          );
        })}
      </Grid>
    </Panel>
  );

  const filters = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <Chip k={k} label={`${t("flow.filterAll")} ${run.posts.length}`} on={kind === null} onPress={() => setKind(null)} />
      {kinds.map((entry) => (
        <Chip key={entry} k={k} label={`${kindName(entry, t)} ${run.posts.filter((post) => post.kind === entry).length}`} on={kind === entry} tone={kindTone(k, entry)} onPress={() => setKind(kind === entry ? null : entry)} />
      ))}
    </View>
  );

  const timeline = (
    <View style={{ gap: 10, minWidth: 0, ...(wide ? { paddingHorizontal: 18, paddingVertical: 14, borderRadius: k.radius + 2, borderWidth: 1, borderColor: k.c.border, backgroundColor: withAlpha(k.c.fg, 0.025) } : {}) }}>
      {!earlier && filtered.length > limit ? <LinkText k={k} center label={t("reportUi.showEarlier", { count: filtered.length - limit })} onPress={() => setEarlier(true)} /> : null}
      {!posts.length ? <Empty k={k} icon="MessagesSquare">{t("flow.board.none")}</Empty> : null}
      {posts.map((post, index) => {
        const lead = post.author === "lead";
        const brief = post.kind === "brief";
        const author = lead ? t("flow.lead") : run.members.find((member) => member.agentId === post.agentId)?.title ?? post.author;
        const newRound = index === 0 || posts[index - 1]!.round !== post.round;
        const tone = authorTone(post.agentId, post.author);
        const kTone = kindTone(k, post.kind);
        return (
          <View key={post.seq} style={{ gap: 10 }}>
            {newRound ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: index ? 6 : 0 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: k.c.border }} />
                <Text style={{ color: k.c.mutedFg, fontSize: 11, fontWeight: "600" }}>{run.mode === "team" ? t("session.round", { round: post.round, rounds: run.rounds }) : t("session.batch", { round: post.round })}</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: k.c.border }} />
              </View>
            ) : null}
            <View style={{ flexDirection: lead ? "row-reverse" : "row", alignItems: "flex-start", gap: 9, maxWidth: brief ? "100%" : "92%", alignSelf: lead ? "flex-end" : "flex-start" }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(tone, 0.2), borderWidth: 1, borderColor: withAlpha(tone, 0.35) }}>
                {lead ? <Icon name="Crown" size={13} color={ink(k, tone)} /> : <Text style={{ color: ink(k, tone), fontSize: 10.5, fontWeight: "800" }}>{initials(author)}</Text>}
              </View>
              <View
                style={{
                  flexShrink: 1,
                  minWidth: 0,
                  gap: 5,
                  paddingHorizontal: 12,
                  paddingTop: 8,
                  paddingBottom: 10,
                  borderRadius: 12,
                  borderTopLeftRadius: lead ? 12 : 4,
                  borderTopRightRadius: lead ? 4 : 12,
                  borderWidth: 1,
                  borderColor: lead ? withAlpha(LEAD_TONE, 0.3) : brief ? withAlpha(PART.brief, 0.45) : k.c.border,
                  backgroundColor: lead ? withAlpha(LEAD_TONE, 0.09) : brief ? withAlpha(PART.brief, 0.07) : k.c.card,
                }}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 7, rowGap: 3 }}>
                  <Text numberOfLines={1} style={{ color: k.c.fg, fontSize: 12, fontWeight: "700", maxWidth: 200 }}>
                    {author}
                  </Text>
                  <View style={{ height: 18, paddingHorizontal: 7, borderRadius: 999, justifyContent: "center", backgroundColor: withAlpha(kTone, 0.15) }}>
                    <Text style={{ color: ink(k, kTone), fontSize: 10.5, fontWeight: "700" }}>{kindName(post.kind, t)}</Text>
                  </View>
                  {post.to.length ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 }}>
                      <Icon name="Send" size={10} color={k.c.mutedFg} />
                      <Text numberOfLines={1} style={{ color: k.c.mutedFg, fontSize: 11.5, flexShrink: 1 }}>
                        {post.to.map((to) => partyName(to, run.members, t)).join(", ")}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={{ color: k.c.mutedFg, fontSize: 10.5 }}>
                    #{post.seq} · {agoText(post.at, now, t)}
                  </Text>
                </View>
                <LongText k={k} t={t} text={post.text} lines={brief ? 6 : 12} />
                {post.files.length ? <FileChips k={k} files={post.files} /> : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      {inbox}
      {filters}
      {timeline}
    </View>
  );
}

export function ClaimsPage({ k, t, run, now, openAgent }: PageProps) {
  const holders = [...new Set(run.claims.map((claim) => claim.agentId))];
  const refused = run.events.filter((event) => event.component === "claims" && event.action === "conflict").slice(-8).reverse();
  return (
    <View style={{ gap: 12 }}>
      {!holders.length ? <Empty k={k} icon="FileLock">{t("flow.claims.none")}</Empty> : null}
      {holders.length ? (
        <Grid min={300} gap={12}>
          {holders.map((holder) => {
            const member = memberOf(run, holder);
            const claims = run.claims.filter((claim) => claim.agentId === holder);
            const tasks = run.tasks.filter((task) => task.owner === holder && task.state === "doing");
            return (
              <Panel key={holder} k={k} tone={PART.claims} edge="top" style={{ gap: 9 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <MemberTag k={k} t={t} run={run} agentId={holder} fallback={claims[0]?.role ?? holder} openAgent={openAgent} />
                  <Text numberOfLines={1} style={[k.t.tiny, { flexShrink: 1 }]}>
                    {member?.role ?? claims[0]?.role} · {t("reportUi.paths", { count: claims.length })}
                  </Text>
                </View>
                <View style={{ gap: 5 }}>
                  {claims.map((claim) => {
                    const task = tasks.find((entry) => entry.files.includes(claim.path));
                    return (
                      <View key={claim.path} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: k.c.muted }}>
                        <Icon name="FileLock" size={13} color={PART.claims} />
                        <Text selectable numberOfLines={1} style={{ flex: 1, minWidth: 0, color: k.c.fg, fontFamily: "Menlo", fontSize: 12 }}>
                          {claim.path}
                        </Text>
                        {task ? <IdPill k={k} id={task.id} small /> : null}
                        <Text style={k.t.tiny}>{t("flow.claims.since", { ago: agoText(claim.at, now, t) })}</Text>
                      </View>
                    );
                  })}
                </View>
              </Panel>
            );
          })}
        </Grid>
      ) : null}
      {refused.length ? (
        <Panel k={k}>
          <SectionTitle k={k} icon="TriangleAlert">
            {t("reportUi.refused")}
          </SectionTitle>
          <View style={{ gap: 2 }}>
            {refused.map((event) => (
              <EventRow key={event.seq} k={k} t={t} event={event} members={run.members} mode={run.mode} now={now} showComponent={false} />
            ))}
          </View>
        </Panel>
      ) : null}
    </View>
  );
}

function BriefLists({ k, t, brief }: { k: Kit; t: Tr; brief: Brief }) {
  const sections = [
    ["flow.brief.requirements", brief.requirements, "Check"],
    ["flow.brief.acceptance", brief.acceptance, "CircleCheck"],
    ["flow.brief.constraints", brief.constraints, "Lock"],
    ["flow.brief.outOfScope", brief.outOfScope, "X"],
  ] as const;
  const shown = sections.filter(([, items]) => items.length);
  if (!shown.length) return null;
  return (
    <Grid min={280} gap={18}>
      {shown.map(([key, items, icon]) => (
        <View key={key} style={{ gap: 6, minWidth: 0 }}>
          <FieldLabel k={k} icon={icon} tone={PART.brief}>
            {t(key)} · {items.length}
          </FieldLabel>
          <Bullets k={k} items={items} tone={PART.brief} />
        </View>
      ))}
    </Grid>
  );
}

/** The confirmed brief, and the brief and task plan the lead showed the user while it waits for their confirmation. */
export function BriefPage({ k, t, run, pending, now, openAgent }: { k: Kit; t: Tr; run: DetailRun | null; pending: Detail["pendingBrief"]; now: number; openAgent?: (id: string) => void }) {
  const brief = run?.brief ?? null;
  const showPending = pending && (!run || run.status === "closed") ? pending : null;
  const sentTo = run ? [...new Set(run.events.filter((event) => event.component === "brief" && event.action === "deliver").flatMap((event) => event.to))] : [];
  const tone = PART.brief;
  return (
    <View style={{ gap: 12 }}>
      {showPending ? (
        <View style={{ gap: 10, padding: 14, borderRadius: k.radius + 2, borderWidth: 1, borderStyle: "dashed", borderColor: tone, backgroundColor: withAlpha(tone, 0.07) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Dot tone={tone} live size={8} />
            <Text style={{ flex: 1, minWidth: 0, color: k.c.fg, fontSize: 13, fontWeight: "700" }}>{t("flow.brief.pendingTitle")}</Text>
            <Text style={k.t.tiny}>{agoText(showPending.at, now, t)}</Text>
          </View>
          <Text style={k.t.tiny}>{t("flow.brief.pendingHint")}</Text>
          <Text selectable style={{ color: k.c.fg, fontSize: 14, fontWeight: "700" }}>
            {showPending.brief.title}
          </Text>
          <Field k={k} label={t("flow.brief.goal")}>
            {showPending.brief.goal}
          </Field>
          <BriefLists k={k} t={t} brief={showPending.brief} />
          {showPending.tasks.length ? (
            <Field k={k} label={t("flow.brief.plannedTasks")}>
              <View style={{ gap: 3 }}>
                {showPending.tasks.map((task, index) => (
                  <Text key={index} selectable style={bodyText(k)}>
                    {index + 1}. {task.title}{" "}
                    <Text style={{ color: k.c.mutedFg }}>
                      ({task.role ?? t("session.anyone")}){task.after.length ? ` · ${t("session.waitsFor", { ids: task.after.join(", ") })}` : ""}
                    </Text>
                  </Text>
                ))}
              </View>
            </Field>
          ) : null}
          <Text style={k.t.tiny}>
            {t("flow.brief.roles")}: {showPending.roles.join(", ")} · {t("flow.brief.rounds")}: {showPending.rounds}
            {showPending.planApproval ? ` · ${t("flow.brief.planApproval")}` : ""}
          </Text>
        </View>
      ) : null}
      {brief ? (
        <Panel k={k} tone={tone} edge="top" style={{ paddingHorizontal: k.compact ? 14 : 20, paddingVertical: k.compact ? 14 : 18, gap: 16, borderRadius: k.radius + 2 }}>
          <Text selectable style={{ color: k.c.fg, fontSize: 17, lineHeight: 22, fontWeight: "700", letterSpacing: -0.1 }}>
            {brief.title}
          </Text>
          <View style={{ gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: k.radius, backgroundColor: withAlpha(tone, 0.07) }}>
            <FieldLabel k={k}>{t("flow.brief.goal")}</FieldLabel>
            <Text selectable style={{ color: k.c.fg, fontSize: 13.5, lineHeight: 20 }}>
              {brief.goal}
            </Text>
          </View>
          <BriefLists k={k} t={t} brief={brief} />
          {brief.userConfirmation ? (
            <View style={{ gap: 3, paddingHorizontal: 12, paddingVertical: 6, borderLeftWidth: 3, borderLeftColor: tone }}>
              <FieldLabel k={k}>{t("flow.brief.confirmation")}</FieldLabel>
              <Text selectable style={[bodyText(k), { fontStyle: "italic" }]}>{`“${brief.userConfirmation}”`}</Text>
            </View>
          ) : null}
          {sentTo.length && run ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: k.c.border }}>
              <FieldLabel k={k}>{t("reportUi.briefSentTo")}</FieldLabel>
              {sentTo.map((party) => (
                <MemberTag key={party} k={k} t={t} run={run} agentId={party} fallback={partyName(party, run.members, t)} openAgent={openAgent} />
              ))}
            </View>
          ) : null}
        </Panel>
      ) : !showPending ? (
        <Empty k={k} icon="FileText">{t("flow.brief.none")}</Empty>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Delegation mode

const batchLabel = (batch: Batch, t: Tr) => (batch.followUp ? `${t("flow.split.batch", { round: batch.round })} · ${t("flow.split.followUp")}` : t("flow.split.batch", { round: batch.round }));
/** When a member's latest report came in, from the data flow. */
const reportAt = (run: DetailRun, agentId: string, after?: string) => [...run.events].reverse().find((event) => event.component === "reports" && event.action === "report" && event.from === agentId && (!after || event.at >= after))?.at;
/** The member's runtime: its provider and model, or what the plugin noted when it started the member's context. */
const runtimeOf = (run: DetailRun, member: RunMember) => {
  if (member.provider) return member.model ? `${member.provider}/${member.model}` : member.provider;
  return run.events.find((event) => event.component === "contexts" && event.action === "start" && event.to.includes(member.agentId))?.note || null;
};

function BatchNo({ k, tone, children }: { k: Kit; tone: string; children: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: withAlpha(tone, 0.15) }}>
      <Text numberOfLines={1} style={{ color: ink(k, tone), fontSize: 11, fontWeight: "700" }}>
        {children}
      </Text>
    </View>
  );
}

function PacketCard({ k, t, run, task, open, onToggle, openAgent }: { k: Kit; t: Tr; run: DetailRun; task: Task; open: boolean; onToggle(): void; openAgent?: (id: string) => void }) {
  const tone = taskTone(k, task.state);
  return (
    <View style={{ gap: 6, borderRadius: k.radius, borderWidth: 1, borderColor: open ? withAlpha(tone, 0.6) : k.c.border, backgroundColor: open ? k.c.card : withAlpha(k.c.fg, 0.03), minWidth: 0 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={(state) => ({ gap: 6, paddingHorizontal: 11, paddingTop: 10, paddingBottom: open ? 0 : 10, borderRadius: k.radius, backgroundColor: hovered(state) && !open ? withAlpha(k.c.fg, 0.03) : "transparent" })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <IdPill k={k} id={task.id} tone={tone} />
          {/* A member's title starts with its role, so the role shows on its own only while no one has the packet. */}
          {task.ownerTitle ? <MemberTag k={k} t={t} run={run} agentId={task.owner} fallback={task.ownerTitle} openAgent={openAgent} /> : <RolePill k={k} t={t} role={task.role} />}
          <View style={{ flex: 1 }} />
          <Badge k={k} tone={tone} label={t(`session.taskState.${task.state}`)} />
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={k.c.mutedFg} />
        </View>
        {!open ? (
          <Text numberOfLines={2} style={{ color: withAlpha(k.c.fg, 0.82), fontSize: 12, lineHeight: 17 }}>
            {task.title}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 10, paddingHorizontal: 11, paddingBottom: 11, paddingTop: 2 }}>
          <LongText k={k} t={t} text={task.detail || task.title} lines={14} />
          {task.result ? (
            <Field k={k} label={t("flow.tasks.result")}>
              <LongText k={k} t={t} text={task.result} lines={8} />
            </Field>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Delegation, step 1: each split of a request into packets, with why delegation and the overlap check. */
export function SplitPage(props: PageProps) {
  const { k, t, run, now, openAgent } = props;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Runs from before splits were recorded show their packets as a task list.
  if (!run.batches.length) return run.tasks.length ? <TasksPage {...props} /> : <Empty k={k} icon="Split">{t("flow.split.none")}</Empty>;
  return (
    <View style={{ gap: 14 }}>
      {[...run.batches].reverse().map((batch) => {
        const tasks = batch.taskIds.map((id) => run.tasks.find((task) => task.id === id)).filter((task): task is Task => !!task);
        const check = batch.warnings.length ? "warn" : !batch.followUp && tasks.length > 1 ? "ok" : null;
        return (
          <Panel key={`${batch.round}-${batch.at}`} k={k} tone={PART.split} edge="top" style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderRadius: k.radius + 2 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <BatchNo k={k} tone={PART.split}>
                {batchLabel(batch, t)}
              </BatchNo>
              <Text numberOfLines={2} style={{ flex: 1, minWidth: 160, color: k.c.fg, fontSize: 13.5, fontWeight: "600" }}>
                {batch.title}
              </Text>
              {check === "warn" ? <Badge k={k} tone={k.c.warn} icon="TriangleAlert" label={t("flow.split.overlap")} /> : null}
              {check === "ok" ? <Badge k={k} tone={k.c.ok} icon="Check" label={t("flow.split.disjoint")} /> : null}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name="Clock" size={11} color={k.c.mutedFg} />
                <Text style={{ color: k.c.mutedFg, fontSize: 11.5 }}>{agoText(batch.at, now, t)}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name="Boxes" size={11} color={k.c.mutedFg} />
                <Text style={{ color: k.c.mutedFg, fontSize: 11.5 }}>
                  {t("flow.split.packets")} {batch.taskIds.length}
                </Text>
              </View>
              <Text style={{ color: k.c.mutedFg, fontSize: 11.5 }}>{t("session.stat.ofDone", { done: tasks.filter((task) => task.state === "done").length, total: tasks.length })}</Text>
            </View>
            {batch.reason ? (
              <Field k={k} label={t("flow.split.reason")}>
                {batch.reason}
              </Field>
            ) : null}
            {batch.warnings.length ? (
              <Callout k={k} tone={k.c.warn} icon="TriangleAlert">
                <View style={{ gap: 4 }}>
                  <Text style={k.t.strong}>{t("flow.split.overlap")}</Text>
                  <Bullets k={k} items={batch.warnings} tone={k.c.warn} />
                </View>
              </Callout>
            ) : null}
            <Grid min={300} gap={10}>
              {tasks.map((task) => {
                const key = `${batch.round}:${task.id}`;
                return <PacketCard key={task.id} k={k} t={t} run={run} task={task} open={open[key] ?? false} onToggle={() => setOpen((current) => ({ ...current, [key]: !current[key] }))} openAgent={openAgent} />;
              })}
            </Grid>
          </Panel>
        );
      })}
    </View>
  );
}

/** Delegation, step 2: each sub-agent's own context, holding only the packets it was given. */
export function ContextsPage({ k, t, run, now, openAgent }: PageProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!run.members.length) return <Empty k={k} icon="Boxes">{t("flow.contexts.none")}</Empty>;
  const batchOf = (id: string) => run.batches.find((batch) => batch.taskIds.includes(id));
  return (
    <View style={{ gap: 12 }}>
      <Callout k={k} tone={PART.contexts} icon="Lock">
        <CalloutText k={k}>{t("flow.contexts.isolation")}</CalloutText>
      </Callout>
      <Grid min={340} gap={12}>
        {run.members.map((member) => {
          const contexts = run.events.filter((event) => event.component === "contexts" && event.to.includes(member.agentId) && (event.action === "start" || event.action === "continue"));
          const attention = run.events.filter((event) => event.component === "contexts" && event.action === "attention" && event.from === member.agentId).reduce((sum, event) => sum + event.count, 0);
          const packets = run.tasks.filter((task) => task.owner === member.agentId);
          const latest = contexts.at(-1);
          const runtime = runtimeOf(run, member);
          const { tone, live } = memberTone(k, member);
          const busy = member.state === "working" || member.state === "attention";
          return (
            <View key={member.agentId} style={{ gap: 11, paddingHorizontal: 14, paddingVertical: 12, borderRadius: k.radius + 2, borderWidth: 1, borderColor: k.c.border, backgroundColor: k.c.card, opacity: member.retired ? 0.6 : 1 }}>
              {/* The dashed inner frame: a context of its own. */}
              <View pointerEvents="none" style={{ position: "absolute", left: 4, top: 4, right: 4, bottom: 4, borderRadius: k.radius, borderWidth: 1, borderStyle: "dashed", borderColor: withAlpha(PART.contexts, 0.3) }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Tile k={k} icon="Bot" tone={tone} size={28} />
                <View style={{ flex: 1, minWidth: 0, gap: 1, alignItems: "flex-start" }}>
                  <PartyTag k={k} name={member.title} tone={tone} live={live} onPress={openAgent ? () => openAgent(member.agentId) : undefined} label={t("reportUi.openAgent")} />
                  <Text style={k.t.tiny}>{member.role}</Text>
                </View>
                <Badge k={k} tone={tone} label={memberStateText(member, t)} />
              </View>
              <Facts
                k={k}
                items={[
                  [t("reportUi.runtime"), runtime ? <Text style={{ color: k.c.fg, fontFamily: "Menlo", fontSize: 12 }}>{runtime}</Text> : <Text style={{ color: k.c.mutedFg, fontSize: 12.5 }}>{t("reportUi.unknown")}</Text>],
                  [t("reportUi.context"), latest ? (latest.action === "continue" ? t("flow.contexts.continued") : t("flow.contexts.started")) : "–"],
                  busy ? [t("reportUi.elapsed"), durationText(now - Date.parse(member.dispatchedAt), t)] : null,
                  attention > 0 && [t("reportUi.attention"), <Text style={{ color: ink(k, k.c.bad), fontSize: 12.5 }}>{t("reportUi.attentionCount", { count: attention })}</Text>],
                ]}
              />
              <FieldLabel k={k}>
                {t("flow.contexts.received")} · {packets.length}
              </FieldLabel>
              <View style={{ gap: 6 }}>
                {packets.map((task) => {
                  const key = `${member.agentId}:${task.id}`;
                  const batch = batchOf(task.id);
                  const context = batch ? contexts.find((event) => event.at >= batch.at) : undefined;
                  const expanded = open[key] ?? false;
                  const reused = context?.action === "continue";
                  const tagTone = reused ? PART.reports : PART.contexts;
                  return (
                    <Pressable key={task.id} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen((current) => ({ ...current, [key]: !expanded }))} style={(state) => ({ gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, backgroundColor: hovered(state) ? withAlpha(k.c.fg, 0.08) : k.c.muted })}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <IdPill k={k} id={task.id} />
                        {batch ? (
                          <Text numberOfLines={1} style={[k.t.tiny, { flexShrink: 1 }]}>
                            {batchLabel(batch, t)}
                          </Text>
                        ) : null}
                        {context ? (
                          <View style={{ paddingHorizontal: 6, borderRadius: 999, backgroundColor: withAlpha(tagTone, 0.16) }}>
                            <Text style={{ color: ink(k, tagTone), fontSize: 10, fontWeight: "700" }}>{reused ? t("reportUi.reused") : t("reportUi.fresh")}</Text>
                          </View>
                        ) : null}
                        <View style={{ flex: 1 }} />
                        <Dot tone={taskTone(k, task.state)} />
                        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={13} color={k.c.mutedFg} />
                      </View>
                      {expanded ? (
                        <LongText k={k} t={t} text={task.detail || task.title} lines={14} />
                      ) : (
                        <Text numberOfLines={2} style={{ color: withAlpha(k.c.fg, 0.82), fontSize: 12, lineHeight: 17 }}>
                          {task.title}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
                {!packets.length ? <EmptyLine k={k}>–</EmptyLine> : null}
              </View>
            </View>
          );
        })}
      </Grid>
    </View>
  );
}

/** Delegation, step 3: what each sub-agent reported back, and how long its packet took. */
export function ReportsPage({ k, t, run, now, wide, openAgent }: PageProps) {
  if (!run.members.length) return <Empty k={k} icon="Inbox">{t("flow.contexts.none")}</Empty>;
  return (
    <View style={{ gap: 12 }}>
      {run.members.map((member) => {
        const at = reportAt(run, member.agentId, member.dispatchedAt);
        const busy = member.state === "working" || member.state === "attention";
        const { tone, live } = memberTone(k, member);
        const status = busy ? { text: t("flow.reports.working"), tone: k.c.warn } : member.collected ? { text: t("flow.reports.collected"), tone: k.c.ok } : { text: t("flow.reports.waiting"), tone: PART.reports };
        const took = at ? t("flow.took", { time: durationText(Date.parse(at) - Date.parse(member.dispatchedAt), t) }) : busy ? durationText(now - Date.parse(member.dispatchedAt), t) : null;
        return (
          <Panel key={member.agentId} k={k} tone={tone} edge="left" style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 12, borderRadius: k.radius + 2, opacity: member.retired ? 0.6 : 1 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <PartyTag k={k} name={member.title} tone={tone} live={live} onPress={openAgent ? () => openAgent(member.agentId) : undefined} label={t("reportUi.openAgent")} />
              <Text style={k.t.tiny}>{member.role}</Text>
              <View style={{ flex: 1 }} />
              {took ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name="Timer" size={11} color={k.c.mutedFg} />
                  <Text style={k.t.tiny}>{took}</Text>
                </View>
              ) : null}
              <Badge k={k} tone={status.tone} label={status.text} />
            </View>
            <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? 16 : 12 }}>
              {member.task ? (
                <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}>
                  <Field k={k} label={t("flow.reports.task")}>
                    <LongText k={k} t={t} text={member.task} lines={wide ? 9 : 5} />
                  </Field>
                </View>
              ) : null}
              <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}>
                <Field k={k} label={t("flow.reports.result")}>
                  {member.result ? <LongText k={k} t={t} text={member.result} lines={wide ? 9 : 6} /> : <EmptyLine k={k}>{busy ? t("flow.reports.working") : t("reportUi.noResult")}</EmptyLine>}
                </Field>
              </View>
            </View>
          </Panel>
        );
      })}
    </View>
  );
}

/** Delegation, step 4: the lead's summary of each batch, how long the batch took, and its slowest packet. */
export function SummaryPage({ k, t, run, now }: PageProps) {
  return (
    <View style={{ gap: 12 }}>
      <Callout k={k} tone={k.c.warn} icon="TriangleAlert">
        <CalloutText k={k}>{t("flow.summaryPage.noCheck")}</CalloutText>
      </Callout>
      {!run.batches.length ? <Empty k={k} icon="GitMerge">{t("flow.summaryPage.none")}</Empty> : null}
      {[...run.batches].reverse().map((batch) => {
        const owners = new Set(batch.taskIds.map((id) => run.tasks.find((task) => task.id === id)?.owner).filter((owner): owner is string => !!owner));
        const members = run.members.filter((member) => owners.has(member.agentId));
        const reported = members.filter((member) => member.state === "done" || member.state === "failed").length;
        const collected = members.filter((member) => member.collected).length;
        const timings = members.map((member) => ({ member, at: reportAt(run, member.agentId, batch.at) })).filter((entry): entry is { member: RunMember; at: string } => !!entry.at);
        const slowest = timings.sort((a, b) => b.at.localeCompare(a.at))[0];
        return (
          <Panel key={`${batch.round}-${batch.at}`} k={k} tone={PART.summary} edge="top" style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderRadius: k.radius + 2 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <BatchNo k={k} tone={PART.summary}>
                {batchLabel(batch, t)}
              </BatchNo>
              <Text numberOfLines={2} style={{ flex: 1, minWidth: 160, color: k.c.fg, fontSize: 13.5, fontWeight: "600" }}>
                {batch.title}
              </Text>
              {batch.summaryAt ? <Badge k={k} tone={k.c.ok} icon="Check" label={t("flow.summaryPage.done", { ago: agoText(batch.summaryAt, now, t) })} /> : <Badge k={k} tone={PART.summary} icon="Hourglass" label={t("flow.summary.summaryWaiting")} />}
            </View>
            <Grid min={130} gap={10}>
              <Stat k={k} value={batch.summaryAt ? durationText(Date.parse(batch.summaryAt) - Date.parse(batch.at), t) : "–"} label={t("reportUi.metricLatency")} tone={PART.summary} />
              <Stat k={k} value={slowest ? durationText(Date.parse(slowest.at) - Date.parse(batch.at), t) : "–"} label={slowest ? t("reportUi.metricSlowest", { member: slowest.member.title }) : t("reportUi.metricSlowestNone")} tone={PART.split} />
              <Stat k={k} value={`${reported}/${members.length}`} label={t("reportUi.metricReported")} tone={PART.reports} />
              <Stat k={k} value={`${collected}/${members.length}`} label={t("reportUi.metricCollected")} tone={k.c.ok} />
            </Grid>
            {batch.summary ? (
              <Field k={k} label={t("flow.component.summary")}>
                <LongText k={k} t={t} text={batch.summary} lines={16} />
              </Field>
            ) : (
              <EmptyLine k={k}>{t("flow.summaryPage.waiting", { reported, total: members.length, collected })}</EmptyLine>
            )}
          </Panel>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// All flows

const PARTY_ORDER = (party: string) => (party === "user" ? 0 : party === "lead" ? 1 : party === "plugin" ? 3 : 2);

/** Who wrote into and received from each part, as a table. */
function FlowMatrix({ k, t, run, components, focus, onFocus }: { k: Kit; t: Tr; run: DetailRun; components: RunComponent[]; focus: RunComponent | null; onFocus(component: RunComponent | null): void }) {
  const totals = flowTotals(run.events);
  const parties = [...totals.keys()].sort((a, b) => PARTY_ORDER(a) - PARTY_ORDER(b) || run.members.findIndex((member) => member.agentId === a) - run.members.findIndex((member) => member.agentId === b));
  const max = Math.max(1, ...[...totals.values()].flatMap((row) => [...row.values()].map((cell) => cell.in + cell.out)));
  if (!parties.length) return null;
  const light = isLight(k);
  const partyWidth = 150;
  const totalWidth = 84;
  return (
    <Panel k={k}>
      <SectionTitle k={k} icon="Users" right={<Text style={k.t.tiny}>{t("reportUi.matrixHint")}</Text>}>
        {t("flow.usage")}
      </SectionTitle>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: partyWidth }} />
          {components.map((component) => {
            const tone = PART[component];
            const on = focus === component;
            return (
              <Pressable key={component} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onFocus(on ? null : component)} style={(state) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: on || hovered(state) ? withAlpha(tone, 0.14) : "transparent" })}>
                <Tile k={k} icon={COMPONENT_ICON[component]} tone={tone} size={18} />
                <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: ink(k, tone), fontSize: 12, fontWeight: "700" }}>
                  {componentName(component, run.mode, t)}
                </Text>
              </Pressable>
            );
          })}
          <Text style={{ width: totalWidth, textAlign: "right", color: k.c.mutedFg, fontSize: 11, fontWeight: "600" }}>{t("reportUi.total")}</Text>
        </View>
        {parties.map((party) => {
          const row = totals.get(party)!;
          const sum = [...row.values()].reduce((acc, cell) => ({ in: acc.in + cell.in, out: acc.out + cell.out }), { in: 0, out: 0 });
          const member = memberOf(run, party);
          return (
            <View key={party} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: partyWidth, paddingRight: 10 }}>
                {member ? <PartyTag k={k} name={member.title} tone={memberTone(k, member).tone} /> : <PartyTag k={k} name={partyName(party, run.members, t)} tone={party === "lead" ? LEAD_TONE : undefined} />}
              </View>
              {components.map((component) => {
                const cell = row.get(component);
                const weight = cell ? (cell.in + cell.out) / max : 0;
                const tone = PART[component];
                return (
                  <View key={component} style={{ flex: 1, minWidth: 0, height: 30, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(tone, (0.1 + weight * 0.45) * (light ? 0.7 : 1)), opacity: focus && focus !== component ? 0.25 : 1 }}>
                    {cell ? (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {cell.in ? <Text style={{ color: k.c.fg, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}>→{cell.in}</Text> : null}
                        {cell.out ? <Text style={{ color: k.c.fg, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}>←{cell.out}</Text> : null}
                      </View>
                    ) : (
                      <Text style={{ color: k.c.mutedFg, fontSize: 12, opacity: 0.5 }}>·</Text>
                    )}
                  </View>
                );
              })}
              <Text style={{ width: totalWidth, textAlign: "right", color: k.c.mutedFg, fontSize: 11, fontVariant: ["tabular-nums"] }}>
                →{sum.in} ←{sum.out}
              </Text>
            </View>
          );
        })}
      </View>
    </Panel>
  );
}

export function FlowPage({ k, t, run, now, wide }: PageProps) {
  const [component, setComponent] = useState<RunComponent | null>(null);
  const components = componentsOf(run.mode);
  const events = run.events.filter((event) => component === null || event.component === component);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip k={k} label={`${t("flow.filterAll")} ${run.events.length}`} on={component === null} onPress={() => setComponent(null)} />
        {components.map((entry) => (
          <Chip key={entry} k={k} label={`${componentName(entry, run.mode, t)} ${run.events.filter((event) => event.component === entry).length}`} on={component === entry} tone={PART[entry]} onPress={() => setComponent(component === entry ? null : entry)} />
        ))}
      </View>
      {wide ? <FlowMatrix k={k} t={t} run={run} components={components} focus={component} onFocus={setComponent} /> : <Usage k={k} t={t} events={events} members={run.members} />}
      <History k={k} t={t} events={events} members={run.members} mode={run.mode} now={now} title={t("flow.allTitle")} limit={wide ? 60 : 30} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

/** A part's page: what it is, its content, who uses it and its history. */
export function ComponentBody({ k, t, page, run, pending, now, wide, openAgent }: { k: Kit; t: Tr; page: ComponentPage; run: DetailRun | null; pending: Detail["pendingBrief"]; now: number; wide: boolean; openAgent?: (id: string) => void }) {
  const tone = pageTone(page);
  const mode: CollabMode = run?.mode ?? (page === "split" || page === "contexts" || page === "reports" || page === "summary" ? "delegation" : "team");
  const events = run ? run.events.filter((event) => page === "flow" || event.component === page) : [];
  const props = run ? { k, t, run, now, wide, openAgent } : null;
  const content = (() => {
    if (page === "brief") return <BriefPage k={k} t={t} run={run} pending={pending} now={now} openAgent={openAgent} />;
    if (!props) return <Empty k={k} icon={page === "flow" ? "Activity" : COMPONENT_ICON[page]}>{t("session.noRun")}</Empty>;
    switch (page) {
      case "tasks":
        return <TasksPage {...props} />;
      case "plans":
        return <PlansPage {...props} />;
      case "board":
        return <BoardPage {...props} />;
      case "claims":
        return <ClaimsPage {...props} />;
      case "split":
        return <SplitPage {...props} />;
      case "contexts":
        return <ContextsPage {...props} />;
      case "reports":
        return <ReportsPage {...props} />;
      case "summary":
        return <SummaryPage {...props} />;
      case "flow":
        return <FlowPage {...props} />;
    }
  })();
  return (
    <View style={{ gap: 14, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: k.radius, borderWidth: 1, borderColor: withAlpha(tone, 0.2), backgroundColor: withAlpha(tone, 0.06), maxWidth: wide ? 980 : undefined }}>
        <Icon name="Info" size={14} color={tone} />
        <Text style={{ flex: 1, minWidth: 0, color: k.c.mutedFg, fontSize: 12, lineHeight: 18 }}>{aboutText(page, mode, t)}</Text>
      </View>
      {content}
      {run && page !== "flow" ? (
        <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-start" : "stretch", gap: 14 }}>
          <View style={{ flex: wide ? 2 : undefined, minWidth: 0 }}>
            <Usage k={k} t={t} events={events} members={run.members} tone={tone} />
          </View>
          <View style={{ flex: wide ? 3 : undefined, minWidth: 0 }}>
            <History k={k} t={t} events={events} members={run.members} mode={run.mode} now={now} showComponent={false} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
