// The team editor: the workspace's team as a page of sections (overview, collaboration, lead, fixed roles, candidates),
// with its own undo history over every field, live problems tied to their fields, and the actions of the top bar: Save
// (writes the file only), Save as preset and Start a session. Without a team it offers the AI planner, a blank team or a
// preset; a planner's proposal opens here as a draft to review.
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginTab } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { freeWorkspace, withFreeWorkspaces } from "../../shared/apply-plan";
import { newCandidate, newRole } from "../../shared/draft";
import { languageFromLocale, type PromptLanguage, type TeamMode } from "../../shared/modes";
import { newPresetId, presetsSettings, presetToTeam, taskWorkspaceTitle, teamToPreset, type Preset } from "../../shared/presets";
import { teamApplyRpc, teamEditProposalRpc, teamEditProposeRpc, teamPendingProposalRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamRestartOrchestratorRpc, teamSaveRpc } from "../../shared/rpc";
import { candidateHandle, checkTeam, type Team } from "../../shared/team";
import { applyTeamEdit, summarizeTeamEdit } from "../../shared/team-edit";
import { Button, Callout, Card, Chip, MODE_LOOK, PART, SectionHeader, Spinner, Tile, useKit, type Kit } from "../kit";
import { IssuesDialog, SECTIONS, SectionNav, StatusPill, TopBar, UndoRedo } from "./chrome";
import { LANGUAGE_NAMES, PROJECT_TEAMS_KEY, useT, type MaybeIndex, type MaybeText, type Target, type Timer } from "./common";
import { AddCard, Anchor, AnchorContext, EmptyBlock, Fact, FieldIssues, Grid, hasError, IssuesContext, kitPickerLook, RuntimeEditor, Slot, TextField, ToolButton } from "./controls";
import { useHistory } from "./history";
import { InstructionsDialog } from "./InstructionsDialog";
import { PickerHost } from "./picker";
import { SavedTeam } from "./SavedTeam";
import { CandidateCard, LanguageRow, ModeCards, RoleCard } from "./sections";
import { StartDialog, type StartChoice, type Where } from "./StartDialog";
import { checkDraft, sectionOf, type Issue, type SectionId } from "./validate";

type ApplyRpc = typeof teamApplyRpc;
type EditProposalRpc = typeof teamEditProposalRpc;
type SummarizeEdit = typeof summarizeTeamEdit;

export type Applied = Extract<RpcOutput<ApplyRpc>, { ok: true }>;

export type TeamEditorProps = Pick<PluginScreenProps, "theme" | "layout" | "navigation"> & {
  target: Target;
  onApplied?(result: Applied): void;
  /** The panel's tab: shows the unsaved dot while the editor holds changes the file doesn't have. */
  tab?: Pick<PluginTab, "setModified">;
};

type ApplyInput = { target: Target; team: Team; request?: string; mode?: TeamMode; source: "dialog" | "again"; where: Where };
type EditNotice = { summary: ReturnType<SummarizeEdit>; validation: Extract<RpcOutput<EditProposalRpc>, { status: "done" }>["validation"] };

/** The team as the schema reads it (defaults applied, candidate handles filled), so drafts and files compare alike. */
function normalize(team: Team): Team {
  const checked = checkTeam(team);
  return checked.ok ? checked.team : team;
}
const keyOf = (team: Team) => JSON.stringify(normalize(team));

function withLanguage(team: Team, language: PromptLanguage | undefined): Team {
  const { language: _previous, ...rest } = team;
  return language ? { ...rest, language } : rest;
}

/** A section of the page: its anchor for the problem list and its position for the side navigation. */
function SectionFrame({ id, k, first, onLayout, children }: { id: SectionId; k: Kit; first?: boolean; onLayout(event: LayoutChangeEvent): void; children: ReactNode }) {
  return (
    <View onLayout={onLayout} style={first ? { paddingTop: k.compact ? 20 : 30, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: k.c.border } : { paddingTop: k.compact ? 24 : 30, paddingBottom: 6 }}>
      <Anchor field={`@${id}`} style={{ gap: first ? 14 : 16 }}>
        {children}
      </Anchor>
    </View>
  );
}

function ErrorText({ k, children }: { k: Kit; children: ReactNode }) {
  return <Text style={{ color: k.c.bad, fontSize: 12, lineHeight: 17 }}>{children}</Text>;
}

/** Propose, review, edit, save and start the team of the target's workspace (or of a project, from the Agent teams screen). */
export function TeamEditor({ theme, layout, navigation, target, onApplied, tab }: TeamEditorProps) {
  const k = useKit(theme, layout.compact);
  const { t, locale } = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const paseo = usePaseo();
  const providers = useQuery({ queryKey: ["dashboard", "providers"], queryFn: () => paseo.providers.snapshot() });
  const icons = useMemo(() => new Map((providers.data?.entries ?? []).map((provider) => [provider.provider, provider.iconSvg])), [providers.data]);
  const read = useRpc(teamReadRpc);
  const propose = useRpc(teamProposeRpc);
  const proposal = useRpc(teamProposalRpc);
  const apply = useRpc(teamApplyRpc);
  const save = useRpc(teamSaveRpc);
  const restartOrchestrator = useRpc(teamRestartOrchestratorRpc);
  const proposeTeamEdit = useRpc(teamEditProposeRpc);
  const teamEditProposal = useRpc(teamEditProposalRpc);
  const pendingProposal = useRpc(teamPendingProposalRpc);
  const cancelProposal = useRpc(teamProposalCancelRpc);
  const presetSettings = useSettings(presetsSettings);
  const presets: readonly Preset[] = presetSettings.status === "ready" ? presetSettings.values.presets : [];

  const current = useQuery({ queryKey: ["workspace-agents", "team", target], queryFn: () => read(target) });
  const data = current.data;
  const catalog = data?.catalog ?? [];
  const history = useHistory<Team | null>(null);
  const draft = history.value;

  // From a workspace, the team's lead always runs in that workspace.
  const here = data?.workspace ?? null;
  const titles = data?.projectWorkspaces ?? [];
  const atHere = (team: Team): Team => (here === null ? team : { ...team, orchestrator: { ...team.orchestrator, workspace: here } });
  // A new draft gets the app's language unless it names one, and a workspace name no workspace of the project has.
  const fresh = (team: Team): Team => withFreeWorkspaces(atHere({ ...team, language: team.language ?? languageFromLocale(locale) }), titles, { orchestrator: here === null });

  // ----- The saved team, and what the editor compares against

  const savedTeam = data?.team ?? null;
  const savedKey = savedTeam ? keyOf(savedTeam) : null;
  // A team this editor wrote whose file the read doesn't show (a project target), else null.
  const [written, setWritten] = useState<MaybeText>(null);
  const lastSaved = useRef<MaybeText>(null);
  useEffect(() => {
    if (!current.isSuccess) return;
    const previous = lastSaved.current;
    lastSaved.current = savedKey;
    setWritten(null);
    const present = history.current();
    if (!savedTeam) return;
    // The panel opens on the saved team; an editor without changes follows the file when it changes.
    if (present === null) history.reset(savedTeam);
    else if (previous !== null && keyOf(present) === previous) history.replace(savedTeam);
  }, [current.isSuccess, savedKey]);

  const check = useMemo(() => (draft ? checkDraft(draft, catalog, data?.takenWorkspaces ?? [], t) : null), [draft, data, locale]);
  const draftKey = draft ? JSON.stringify(check?.team ?? draft) : null;
  const baselineKey = written ?? savedKey;
  const dirty = draft !== null && draftKey !== baselineKey;
  useEffect(() => {
    tab?.setModified(dirty);
  }, [dirty]);

  const issuesByField = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of check?.issues ?? []) map.set(issue.field, [...(map.get(issue.field) ?? []), issue]);
    return map;
  }, [check]);
  const issuesFor = useMemo(() => (field: string) => issuesByField.get(field) ?? [], [issuesByField]);

  const edit = (patch: (team: Team) => Team, group?: string) => {
    const present = history.current();
    if (present) history.edit(patch(present), group);
  };

  // ----- The AI planner: a proposal for a team without one

  const [goal, setGoal] = useState("");
  const [plannerId, setPlannerId] = useState<MaybeText>(null);
  // The planner keeps running when this screen closes; reopening it picks the newest proposal back up.
  // Fetched fresh on every open (gcTime 0) and only once the team is read, since a proposal is fitted to it.
  const pendingKey = ["workspace-agents", "pending-proposal", target];
  const pending = useQuery({ queryKey: pendingKey, queryFn: () => pendingProposal(target), enabled: data !== undefined, gcTime: 0 });
  useEffect(() => {
    const agentId = pending.data?.agentId;
    if (agentId) setPlannerId((id) => id ?? agentId);
  }, [pending.data]);
  const cancelled = useMutation({ mutationFn: () => cancelProposal(target), onSuccess: () => queryClient.setQueryData(pendingKey, { agentId: null }) });
  const planning = useQuery({
    queryKey: ["workspace-agents", "proposal", plannerId],
    queryFn: () => proposal({ agentId: plannerId! }),
    enabled: plannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });

  // ----- Edit with AI: a planner rewrites the whole draft; the result lands as one undoable step

  const [editRequest, setEditRequest] = useState("");
  const [editPlannerId, setEditPlannerId] = useState<MaybeText>(null);
  const [editStarting, setEditStarting] = useState(false);
  const [editStartError, setEditStartError] = useState<MaybeText>(null);
  const [editNotice, setEditNotice] = useState<EditNotice | null>(null);
  const editRequestCounter = useRef(0);
  const appliedEditId = useRef<MaybeText>(null);
  const cancelTeamEdit = () => {
    editRequestCounter.current += 1;
    setEditStarting(false);
    setEditStartError(null);
    setEditPlannerId(null);
    setEditNotice(null);
  };
  const editPlanning = useQuery({
    queryKey: ["workspace-agents", "team-edit-proposal", editPlannerId],
    queryFn: () => teamEditProposal({ agentId: editPlannerId! }),
    enabled: editPlannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });
  const startTeamEdit = useMutation({
    onMutate: () => {
      const request = ++editRequestCounter.current;
      setEditPlannerId(null);
      setEditNotice(null);
      setEditStarting(true);
      setEditStartError(null);
      return { request };
    },
    mutationFn: (team: Team) => proposeTeamEdit({ ...target, request: editRequest, team, locale }),
    onSuccess: ({ agentId }, _team, context) => {
      if (editRequestCounter.current !== context.request) return;
      setEditStarting(false);
      setEditPlannerId(agentId);
    },
    onError: (error, _team, context) => {
      if (editRequestCounter.current !== context?.request) return;
      setEditStarting(false);
      setEditStartError(String(error));
    },
  });
  const editBusy = editStarting || (editPlannerId !== null && (!editPlanning.data || editPlanning.data.status === "running"));
  useEffect(() => {
    const result = editPlanning.data;
    const present = history.current();
    if (!present || !editPlannerId || result?.status !== "done" || appliedEditId.current === editPlannerId) return;
    appliedEditId.current = editPlannerId;
    const after = applyTeamEdit(present, { ...result.team, language: result.team.language ?? present.language });
    history.edit(after);
    setEditNotice({ summary: summarizeTeamEdit(present, after), validation: result.validation });
    setEditRequest("");
    setEditPlannerId(null);
  }, [editPlannerId, editPlanning.data]);

  // A finished proposal becomes the draft (one undoable step over an open draft).
  const appliedProposal = useRef<MaybeText>(null);
  useEffect(() => {
    if (planning.data?.status !== "done" || !plannerId || appliedProposal.current === plannerId) return;
    appliedProposal.current = plannerId;
    cancelTeamEdit();
    const next = fresh(planning.data.team);
    if (history.current()) history.edit(next);
    else history.reset(next);
  }, [planning.data, plannerId]);

  const start = useMutation({ onMutate: () => cancelTeamEdit(), mutationFn: () => propose({ ...target, goal, locale }), onSuccess: ({ agentId }) => setPlannerId(agentId) });

  // ----- Writing the team: Save, Start a session / Apply again, Reset session

  const invalidateTeams = () => {
    void current.refetch();
    void queryClient.invalidateQueries({ queryKey: PROJECT_TEAMS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "roster"] });
  };
  const relativeFile = (file: string) => (data && file.startsWith(`${data.project.root}/`) ? file.slice(data.project.root.length + 1) : file);
  const [result, setResult] = useState<Applied | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  const saved = useMutation({
    mutationFn: (team: Team) => save({ ...target, team }),
    onSuccess: (outcome, team) => {
      if (!outcome.ok) {
        toast.error(t("editorUi.saveFailed", { error: outcome.errors.join("; ") }));
        return;
      }
      setWritten(keyOf(team));
      const present = history.current();
      if (present && keyOf(present) === keyOf(team)) history.replace(team);
      toast.show(t("editorUi.saved", { file: relativeFile(outcome.file) }), { variant: "success" });
      invalidateTeams();
    },
    onError: (error) => toast.error(t("editorUi.saveFailed", { error: String(error) })),
  });

  const applied = useMutation({
    mutationFn: (input: ApplyInput) => apply({ ...input.target, team: input.team, locale, ...(input.request?.trim() ? { request: input.request.trim() } : {}), ...(input.mode ? { mode: input.mode } : {}) }),
    onSuccess: (outcome, input) => {
      invalidateTeams();
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "agents"] });
      if (!outcome.ok) return;
      // Apply archives the planners.
      setPlannerId(null);
      setResult(outcome);
      if (input.where === "here") {
        // The file now holds the team, with the app's language when it named none.
        const team = normalize({ ...input.team, language: input.team.language ?? languageFromLocale(locale) });
        setWritten(keyOf(team));
        const present = history.current();
        if (present && keyOf(present) === keyOf(input.team)) history.replace(team);
      }
      if (input.source === "dialog") {
        setStartOpen(false);
        toast.show(t("editorUi.startModal.started", { workspace: outcome.workspaces[0]?.workspace ?? "" }), { variant: "success" });
      }
      onApplied?.(outcome);
    },
  });

  const [confirmRestart, setConfirmRestart] = useState(false);
  const restarted = useMutation({
    mutationFn: () => restartOrchestrator({ ...target, locale }),
    onSuccess: () => {
      invalidateTeams();
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "agents"] });
    },
  });

  const startSession = (choice: StartChoice) => {
    const present = history.current();
    const parsed = check?.team;
    if (!present || !parsed || !data) return;
    const language = choice.language === "auto" ? undefined : choice.language;
    // The language picked for the session is the team's: the file keeps it, so the draft does too.
    if (language !== present.language) history.edit(withLanguage(present, language));
    const team = withLanguage(parsed, language);
    const mode = choice.mode !== team.mode ? choice.mode : undefined;
    if (choice.where === "new") {
      const base = choice.title.trim() || taskWorkspaceTitle(choice.request, team.orchestrator.workspace);
      const workspace = freeWorkspace(base, [...titles, ...data.takenWorkspaces]);
      applied.mutate({ target: { projectId: data.project.id }, team: { ...team, orchestrator: { ...team.orchestrator, workspace } }, request: choice.request, mode, source: "dialog", where: "new" });
    } else {
      applied.mutate({ target, team, request: choice.request, mode, source: "dialog", where: "here" });
    }
  };

  // ----- Save as preset

  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const savePreset = () => {
    if (presetSettings.status !== "ready" || !check?.team || !presetName.trim()) return;
    const preset = teamToPreset(check.team, presetName, newPresetId(), new Date().toISOString());
    void presetSettings.save({ presets: [...presetSettings.values.presets, preset] }, presetSettings.revision).then((ok) => {
      if (!ok) return;
      toast.show(t("presets.savedAsPreset", { name: preset.name }), { variant: "success" });
      setPresetOpen(false);
      setPresetName("");
    });
  };

  // ----- Discarding a draft or changes

  const [editingRoleIndex, setEditingRoleIndex] = useState<MaybeIndex>(null);
  const discard = () => {
    if (plannerId) cancelled.mutate();
    setPlannerId(null);
    cancelTeamEdit();
    setEditRequest("");
    setEditingRoleIndex(null);
    if (savedTeam) history.edit(savedTeam);
    else history.reset(null);
  };

  // ----- Anchors: the problem list scrolls to a field and flashes it

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const anchorNodes = useRef(new Map<string, View>());
  const [flash, setFlash] = useState<MaybeText>(null);
  const flashTimer = useRef<Timer | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);
  const anchorContext = useMemo(
    () => ({
      register: (field: string, node: View | null) => {
        if (node) anchorNodes.current.set(field, node);
        else anchorNodes.current.delete(field);
      },
      flash,
      warn: k.c.warn,
    }),
    [flash, k],
  );
  const jumpTo = (field: string, highlight = true) => {
    let path = field;
    let node = anchorNodes.current.get(path);
    while (!node && path.includes(".")) {
      path = path.slice(0, path.lastIndexOf("."));
      node = anchorNodes.current.get(path);
    }
    if (!node) {
      path = `@${sectionOf(field)}`;
      node = anchorNodes.current.get(path);
    }
    const content = contentRef.current;
    if (!node || !content) return;
    node.measureLayout(content, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }), () => {});
    if (!highlight) return;
    setFlash(path);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  };

  // ----- The section navigation of wide layouts

  const [width, setWidth] = useState(0);
  const wide = !layout.compact && width >= 760;
  const sectionY = useRef<Partial<Record<SectionId, number>>>({});
  const [active, setActive] = useState<SectionId>("overview");
  const onSectionLayout = (id: SectionId) => (event: LayoutChangeEvent) => {
    sectionY.current[id] = event.nativeEvent.layout.y;
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    let next: SectionId = "overview";
    for (const section of SECTIONS) {
      const y = sectionY.current[section.id];
      if (y !== undefined && y <= contentOffset.y + 90) next = section.id;
    }
    if (contentOffset.y > 0 && contentOffset.y + layoutMeasurement.height >= contentSize.height - 4) next = SECTIONS[SECTIONS.length - 1]!.id;
    setActive((was) => (was === next ? was : next));
  };
  const pickSection = (id: SectionId) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY.current[id] ?? 0) - 4), animated: true });
    setActive(id);
  };

  // A card added or duplicated takes the focus and comes into view.
  const [focusField, setFocusField] = useState<MaybeText>(null);
  useEffect(() => {
    if (!focusField) return;
    const timer = setTimeout(() => {
      jumpTo(focusField);
      setFocusField(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [focusField]);

  // ----- Progress of the planners and of Apply again

  const [issuesOpen, setIssuesOpen] = useState(false);
  const teamBusy = plannerId !== null && (!planning.data || planning.data.status === "running");
  const progress = applied.isPending && applied.variables?.source === "again"
    ? { status: t("result.applying"), error: null, onCancel: null }
    : editBusy
      ? { status: t("review.editPlanning"), error: editPlanning.error ? String(editPlanning.error) : null, onCancel: cancelTeamEdit }
      : teamBusy
        ? {
            status: t("create.planning"),
            error: planning.error ? String(planning.error) : null,
            onCancel: () => {
              cancelled.mutate();
              setPlannerId(null);
            },
          }
        : null;
  const progressModal = (
    <Modal title={t("progress.title")} open={progress !== null} onOpenChange={(open) => { if (!open) progress?.onCancel?.(); }}>
      <Modal.Content>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Spinner k={k} />
            {progress ? <Text style={[k.t.body, { flex: 1 }]}>{progress.status}</Text> : null}
          </View>
          <Text style={k.t.muted}>{t("progress.keepOpen")}</Text>
          {progress?.error ? <ErrorText k={k}>{progress.error}</ErrorText> : null}
          {progress?.onCancel ? (
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Button k={k} label={t("review.cancel")} onPress={progress.onCancel} />
            </View>
          ) : null}
        </View>
      </Modal.Content>
    </Modal>
  );

  // ----- Rendering

  const look = useMemo(() => kitPickerLook(k), [k]);
  const pad = k.compact ? 14 : 24;

  if (current.isLoading || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: k.c.bg, padding: pad, gap: 10 }}>
        {current.error ? (
          <Callout k={k} tone={k.c.bad} icon="CircleAlert">
            <Text style={k.t.small}>{String(current.error)}</Text>
          </Callout>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Spinner k={k} />
            <Text style={k.t.muted}>{t("loading")}</Text>
          </View>
        )}
      </View>
    );
  }

  const notices = (
    <>
      {data.toolsEnabled === false ? (
        <Callout k={k} tone={k.c.warn} icon="TriangleAlert">
          <Text style={k.t.small}>{t("toolsOff")}</Text>
        </Callout>
      ) : null}
      {data.errors.length ? (
        <Callout k={k} tone={k.c.bad} icon="CircleAlert">
          <View style={{ gap: 3 }}>
            {data.errors.map((error) => (
              <Text key={error} style={k.t.small}>
                {error}
              </Text>
            ))}
          </View>
        </Callout>
      ) : null}
    </>
  );

  // No team and no draft: the planner, a blank team or a preset.
  if (!draft || !check) {
    const blank = () => {
      cancelTeamEdit();
      const claude = catalog.find((entry) => entry.id === "claude");
      history.reset(fresh({ version: 1, goal, mode: "auto", orchestrator: { workspace: "orchestrator", provider: "claude", model: claude?.models[0]?.id ?? "" }, roles: [newRole(catalog, [])], candidates: [] }));
    };
    const fromPreset = (preset: Preset) => {
      cancelTeamEdit();
      history.reset(fresh(presetToTeam(preset, "orchestrator", { goal })));
    };
    return (
      <View style={{ flex: 1, backgroundColor: k.c.bg }}>
        <TopBar k={k} title={here ?? data.project.name} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: pad, paddingTop: k.compact ? 20 : 36, alignItems: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ width: "100%", maxWidth: 760, gap: 14 }}>
            {notices}
            <Card k={k} style={{ gap: 16, padding: k.compact ? 14 : 20, borderRadius: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
                <Tile k={k} icon="Users" size={42} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={k.t.h1}>{t("editorUi.create.title")}</Text>
                  <Text style={k.t.muted}>{t(here === null ? "create.intro" : "create.introHere")}</Text>
                </View>
              </View>
              <TextField k={k} multiline minHeight={72} value={goal} placeholder={t("create.goalPlaceholder")} accessibilityLabel={t("create.goalPlaceholder")} onChangeText={setGoal} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <Button k={k} variant="primary" size="lg" icon="Sparkles" label={goal.trim() ? t("create.propose") : t("create.proposeFromProject")} busy={start.isPending} disabled={teamBusy} onPress={() => start.mutate()} />
                <Text style={k.t.muted}>{t("editorUi.create.or")}</Text>
                <Button k={k} size="lg" icon="Plus" label={t("create.blank")} onPress={blank} />
              </View>
              {presets.length ? (
                <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: k.c.border }}>
                  <Text style={k.t.label}>{t("presets.fromPreset")}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {presets.map((preset) => (
                      <Chip key={preset.id} k={k} icon="Star" label={preset.name} onPress={() => fromPreset(preset)} />
                    ))}
                  </View>
                </View>
              ) : null}
              {planning.data?.status === "failed" ? planning.data.errors.map((error) => <ErrorText key={error} k={k}>{error}</ErrorText>) : null}
              {start.error ? <ErrorText k={k}>{String(start.error)}</ErrorText> : null}
              {cancelled.error ? <ErrorText k={k}>{String(cancelled.error)}</ErrorText> : null}
            </Card>
          </View>
        </ScrollView>
        {progressModal}
      </View>
    );
  }

  // ----- The editor

  const title = draft.orchestrator.workspace.trim() || t("editorUi.untitled");
  const setRole = (index: number, role: Team["roles"][number], group?: string) => edit((team) => ({ ...team, roles: team.roles.map((entry, at) => (at === index ? role : entry)) }), group);
  const setCandidate = (index: number, candidate: Team["candidates"][number], group?: string) => edit((team) => ({ ...team, candidates: team.candidates.map((entry, at) => (at === index ? candidate : entry)) }), group);
  const addRole = () => {
    const index = draft.roles.length;
    edit((team) => ({ ...team, roles: [...team.roles, newRole(catalog, team.roles.map((role) => role.name))] }));
    setFocusField(`roles.${index}`);
  };
  const duplicateRole = (index: number) => {
    edit((team) => {
      const source = team.roles[index]!;
      const copy = { ...source, folders: [...source.folders], name: freeWorkspace(source.name.trim() || "role", team.roles.map((role) => role.name)) };
      return { ...team, roles: [...team.roles.slice(0, index + 1), copy, ...team.roles.slice(index + 1)] };
    });
    setFocusField(`roles.${index + 1}`);
  };
  const removeRole = (index: number) => {
    const name = draft.roles[index]?.name.trim() || t("editorUi.where.role", { n: index + 1 });
    edit((team) => ({ ...team, roles: team.roles.filter((_, at) => at !== index) }));
    if (editingRoleIndex !== null) setEditingRoleIndex(null);
    toast.show(t("editorUi.role.removed", { name }));
  };
  const addCandidate = () => {
    const index = draft.candidates.length;
    edit((team) => ({ ...team, candidates: [...team.candidates, newCandidate(catalog)] }));
    setFocusField(`candidates.${index}`);
  };
  const duplicateCandidate = (index: number) => {
    edit((team) => {
      const source = team.candidates[index]!;
      const copy = { ...source, name: source.name.trim() ? freeWorkspace(source.name.trim(), team.candidates.map((candidate) => candidate.name)) : "" };
      return { ...team, candidates: [...team.candidates.slice(0, index + 1), copy, ...team.candidates.slice(index + 1)] };
    });
    setFocusField(`candidates.${index + 1}`);
  };
  const removeCandidate = (index: number) => {
    const candidate = draft.candidates[index];
    const name = candidate ? candidate.name.trim() || candidateHandle(candidate.model) : "";
    edit((team) => ({ ...team, candidates: team.candidates.filter((_, at) => at !== index) }));
    toast.show(t("editorUi.candidate.removed", { name }));
  };

  const sectionErrors: Partial<Record<SectionId, number>> = {};
  for (const issue of check.issues) if (issue.level === "error") sectionErrors[sectionOf(issue.field)] = (sectionErrors[sectionOf(issue.field)] ?? 0) + 1;
  const nameIssues = issuesFor("name");
  const applyBusy = applied.isPending || restarted.isPending;
  const againErrors = applied.variables?.source === "again" ? [...(applied.error ? [String(applied.error)] : []), ...(applied.data && !applied.data.ok ? applied.data.errors : [])] : [];
  const dialogErrors = applied.variables?.source === "dialog" ? [...(applied.error ? [String(applied.error)] : []), ...(applied.data && !applied.data.ok ? applied.data.errors : [])] : [];
  const restartErrors = [...(restarted.error ? [String(restarted.error)] : []), ...(restarted.data && !restarted.data.ok ? restarted.data.errors : [])];
  const summary = editNotice?.summary;
  const summaryEmpty = summary && !summary.added.length && !summary.removed.length && !summary.changed.length && !summary.orchestrator && !summary.goal && !summary.mode && !summary.candidates;

  return (
    <IssuesContext.Provider value={issuesFor}>
      <AnchorContext.Provider value={anchorContext}>
        <PickerHost look={look}>
          <View style={{ flex: 1, backgroundColor: k.c.bg }} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}>
            <TopBar
              k={k}
              title={title}
              unsaved={dirty}
              actions={
                <>
                  <UndoRedo
                    k={k}
                    canUndo={history.canUndo && !editBusy}
                    canRedo={history.canRedo && !editBusy}
                    onUndo={() => {
                      history.undo();
                      setEditNotice(null);
                    }}
                    onRedo={() => {
                      history.redo();
                      setEditNotice(null);
                    }}
                  />
                  <Button k={k} icon="Save" label={k.compact ? undefined : t("editorUi.save")} accessibilityLabel={t("editorUi.save")} busy={saved.isPending} disabled={!check.team} onPress={() => check.team && saved.mutate(check.team)} />
                  <StatusPill k={k} check={check} onPress={() => setIssuesOpen(true)} />
                  <Button
                    k={k}
                    icon="Star"
                    label={k.compact ? undefined : t("presets.saveAsPreset")}
                    accessibilityLabel={check.team ? t("presets.saveAsPreset") : t("editorUi.fixFirst")}
                    disabled={!check.team || presetSettings.status !== "ready"}
                    onPress={() => {
                      setPresetName(draft.orchestrator.workspace.trim());
                      setPresetOpen(true);
                    }}
                  />
                  <Button
                    k={k}
                    variant="primary"
                    icon="Play"
                    label={t("editorUi.start")}
                    onPress={() => {
                      applied.reset();
                      setStartOpen(true);
                    }}
                  />
                </>
              }
            />
            <View style={{ flex: 1, flexDirection: "row" }}>
              {wide ? (
                <View style={{ width: 204, paddingLeft: 20, paddingRight: 4, paddingTop: 30 }}>
                  <SectionNav k={k} active={active} counts={{ roles: draft.roles.length, candidates: draft.candidates.length }} errors={sectionErrors} onPick={pickSection} />
                </View>
              ) : null}
              <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: wide ? 28 : pad, paddingBottom: 56 }} onScroll={onScroll} scrollEventThrottle={32} keyboardShouldPersistTaps="handled">
                <View ref={contentRef} collapsable={false} style={{ width: "100%", maxWidth: 1080 }}>
                  {/* Overview */}
                  <SectionFrame id="overview" k={k} first onLayout={onSectionLayout("overview")}>
                    {notices}
                    {result ? (
                      <Callout k={k} tone={k.c.ok} icon="CircleCheck">
                        <View style={{ gap: 6 }}>
                          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                            <Text style={[k.t.strong, { flex: 1 }]}>{t("result.applied", { file: relativeFile(result.file) })}</Text>
                            <ToolButton k={k} icon="X" label={t("editorUi.dismiss")} onPress={() => setResult(null)} />
                          </View>
                          {result.workspaces.map((workspace) => (
                            <Text key={workspace.id} style={k.t.small}>
                              • {t(workspace.created ? "result.created" : "result.reused", { target: workspace.target, workspace: workspace.workspace })}
                            </Text>
                          ))}
                          {result.permission ? <Text style={k.t.muted}>{t("result.permission", { file: result.permission })}</Text> : null}
                          {result.cleanup.map((failure) => <ErrorText key={failure} k={k}>{t("result.cleanupFailed", { failure })}</ErrorText>)}
                          {navigation ? <Button k={k} size="sm" variant="primary" icon="ArrowUpRight" label={t("result.openOrchestrator")} onPress={() => navigation.openAgent({ agentId: result.orchestratorAgentId })} /> : null}
                        </View>
                      </Callout>
                    ) : null}
                    {baselineKey === null ? (
                      <Callout k={k} tone={k.c.info} icon="FilePen">
                        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                          <View style={{ flexGrow: 1, flexBasis: 240, gap: 2 }}>
                            <Text style={k.t.strong}>{plannerId ? t("review.title") : t("editorUi.overview.draftTitle")}</Text>
                            <Text style={k.t.muted}>{t("editorUi.overview.draftHint")}</Text>
                          </View>
                          <Button k={k} size="sm" variant="ghost" icon="Trash2" label={t("editorUi.overview.discardDraft")} onPress={discard} />
                        </View>
                      </Callout>
                    ) : null}

                    <Anchor field="name" style={{ gap: 4 }}>
                      {here !== null ? (
                        <Text style={{ color: k.c.fg, fontSize: k.compact ? 22 : 28, fontWeight: "800", letterSpacing: -0.4 }} numberOfLines={2}>
                          {here}
                        </Text>
                      ) : (
                        <TextField k={k} variant="hero" style={{ marginLeft: -10 }} value={draft.orchestrator.workspace} placeholder={t("editorUi.overview.workspacePlaceholder")} accessibilityLabel={t("editorUi.overview.workspace")} invalid={hasError(nameIssues)} onChangeText={(workspace) => edit((team) => ({ ...team, orchestrator: { ...team.orchestrator, workspace } }), "name")} />
                      )}
                      <Text style={k.t.tiny}>{t(here !== null ? "editorUi.overview.runsHere" : "editorUi.overview.runsIn")}</Text>
                      <FieldIssues k={k} field="name" />
                    </Anchor>
                    <Anchor field="goal">
                      <TextField k={k} variant="bare" multiline minHeight={40} style={{ marginLeft: -9, fontSize: 14, lineHeight: 21 }} value={draft.goal} placeholder={t("editorUi.overview.goalPlaceholder")} accessibilityLabel={t("editorUi.overview.goalPlaceholder")} onChangeText={(next) => edit((team) => ({ ...team, goal: next }), "goal")} />
                    </Anchor>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      <Fact k={k} icon={MODE_LOOK[draft.mode].icon} label={t(`mode.${draft.mode}`)} />
                      <Fact k={k} icon="Crown" mono label={`${draft.orchestrator.provider || "?"}/${draft.orchestrator.model || "?"}`} />
                      <Fact k={k} icon="Users" label={t("editorUi.roleCount", { count: draft.roles.length })} />
                      <Fact k={k} icon="Boxes" label={t("editorUi.candidateCount", { count: draft.candidates.length })} />
                      {draft.language ? <Fact k={k} icon="Languages" label={LANGUAGE_NAMES[draft.language]} /> : null}
                      {draft.preset ? <Fact k={k} icon="Star" label={t("editorUi.fromPreset", { name: draft.preset.name })} /> : null}
                    </View>

                    {savedTeam ? (
                      <SavedTeam
                        k={k}
                        team={savedTeam}
                        file={data.file}
                        dirty={dirty}
                        icons={icons}
                        actions={
                          <>
                            <Button k={k} size="sm" icon="RefreshCw" label={t("current.reapply")} disabled={applyBusy} onPress={() => applied.mutate({ target, team: savedTeam, source: "again", where: "here" })} />
                            <Button k={k} size="sm" icon="RotateCcw" label={t("current.restart")} disabled={applyBusy} onPress={() => setConfirmRestart(true)} />
                            {dirty ? <Button k={k} size="sm" variant="ghost" icon="Undo2" label={t("editorUi.overview.discardChanges")} onPress={discard} /> : null}
                          </>
                        }
                      >
                        {restarted.isPending ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Spinner k={k} />
                            <Text style={k.t.muted}>{t("current.restarting")}</Text>
                          </View>
                        ) : null}
                        {[...againErrors, ...restartErrors].map((error) => <ErrorText key={error} k={k}>{error}</ErrorText>)}
                      </SavedTeam>
                    ) : null}

                    <Card k={k} style={{ gap: 10, padding: 14, borderRadius: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                        <Tile k={k} icon="WandSparkles" tone={MODE_LOOK.auto.tone} size={30} />
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text style={k.t.h3}>{t("editorUi.ai.title")}</Text>
                          <Text style={k.t.muted}>{t("editorUi.ai.hint")}</Text>
                        </View>
                      </View>
                      <TextField k={k} multiline minHeight={52} value={editRequest} placeholder={t("review.teamEditRequest")} accessibilityLabel={t("review.teamEditRequest")} onChangeText={setEditRequest} />
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <Button k={k} icon="Sparkles" label={t("review.editTeamWithAi")} busy={editBusy} disabled={!editRequest.trim()} onPress={() => startTeamEdit.mutate(history.current()!)} />
                      </View>
                      {editPlanning.data?.status === "failed" ? editPlanning.data.errors.map((error) => <ErrorText key={error} k={k}>{error}</ErrorText>) : null}
                      {editPlanning.error ? <ErrorText k={k}>{String(editPlanning.error)}</ErrorText> : null}
                      {editStartError ? <ErrorText k={k}>{editStartError}</ErrorText> : null}
                      {editNotice && summary ? (
                        <Callout k={k} tone={k.c.ok} icon="Sparkles">
                          <View style={{ gap: 3 }}>
                            <Text style={k.t.strong}>{t("review.editSummary")}</Text>
                            {summary.added.map((name) => <Text key={`added-${name}`} style={k.t.small}>{t("review.editAdded", { name })}</Text>)}
                            {summary.removed.map((name) => <Text key={`removed-${name}`} style={k.t.small}>{t("review.editRemoved", { name })}</Text>)}
                            {summary.changed.map(({ name, fields }) => <Text key={`changed-${name}`} style={k.t.small}>{t("review.editChanged", { name, fields: fields.map((field) => t(`role.${field}`)).join(", ") })}</Text>)}
                            {summary.orchestrator ? <Text style={k.t.small}>{t("review.editOrchestratorChanged")}</Text> : null}
                            {summary.goal ? <Text style={k.t.small}>{t("review.editGoalChanged")}</Text> : null}
                            {summary.mode ? <Text style={k.t.small}>{t("review.editModeChanged")}</Text> : null}
                            {summary.candidates ? <Text style={k.t.small}>{t("review.editCandidatesChanged")}</Text> : null}
                            {summaryEmpty ? <Text style={k.t.muted}>{t("review.editNoChanges")}</Text> : null}
                            {editNotice.validation.map((error) => <ErrorText key={error.target + error.message} k={k}>{error.target}: {error.message}</ErrorText>)}
                          </View>
                        </Callout>
                      ) : null}
                    </Card>
                  </SectionFrame>

                  {/* Collaboration */}
                  <SectionFrame id="collab" k={k} onLayout={onSectionLayout("collab")}>
                    <SectionHeader k={k} icon="Layers" tone={PART.split} title={t("editorUi.section.collab")} subtitle={t("editorUi.section.collabHint")} />
                    <View>
                      <ModeCards k={k} value={draft.mode} onChange={(mode) => edit((team) => ({ ...team, mode }))} />
                      <View style={{ marginTop: 6 }}>
                        <FieldIssues k={k} field="mode" />
                      </View>
                      <LanguageRow k={k} value={draft.language} onChange={(language) => edit((team) => withLanguage(team, language))} />
                    </View>
                  </SectionFrame>

                  {/* Lead */}
                  <SectionFrame id="lead" k={k} onLayout={onSectionLayout("lead")}>
                    <SectionHeader k={k} icon="Crown" tone={PART.plans} title={t("editorUi.section.lead")} subtitle={t("editorUi.section.leadHint")} />
                    <Anchor field="lead">
                      <Card k={k} style={{ padding: 14, borderRadius: 12 }}>
                        <View style={{ maxWidth: 760 }}>
                          <RuntimeEditor k={k} catalog={catalog} icons={icons} provider={draft.orchestrator.provider} model={draft.orchestrator.model} field="lead" onChange={(next, group) => edit((team) => ({ ...team, orchestrator: { ...team.orchestrator, ...next } }), group)} />
                        </View>
                      </Card>
                    </Anchor>
                  </SectionFrame>

                  {/* Fixed roles */}
                  <SectionFrame id="roles" k={k} onLayout={onSectionLayout("roles")}>
                    <SectionHeader
                      k={k}
                      icon="Users"
                      tone={PART.tasks}
                      title={t("editorUi.section.roles")}
                      count={draft.roles.length}
                      subtitle={t("editorUi.section.rolesHint")}
                      right={draft.roles.length ? <Button k={k} size="sm" icon="Plus" label={k.compact ? undefined : t("editorUi.role.add")} accessibilityLabel={t("editorUi.role.add")} onPress={addRole} /> : undefined}
                    />
                    <Anchor field="roles" style={{ gap: 12 }}>
                      <FieldIssues k={k} field="roles" />
                      {draft.roles.length ? (
                        <View>
                          <Grid min={340} max={3}>
                            {draft.roles.map((role, index) => (
                              <RoleCard
                                key={index}
                                k={k}
                                role={role}
                                index={index}
                                catalog={catalog}
                                icons={icons}
                                autoFocus={focusField === `roles.${index}`}
                                onChange={(next, group) => setRole(index, next, group)}
                                onDuplicate={() => duplicateRole(index)}
                                onRemove={() => removeRole(index)}
                                onEditInstructions={() => setEditingRoleIndex(index)}
                              />
                            ))}
                          </Grid>
                          <AddCard k={k} label={t("editorUi.role.add")} onPress={addRole} />
                        </View>
                      ) : (
                        <EmptyBlock k={k} icon="Users" text={t("editorUi.role.empty")} action={<Button k={k} size="sm" icon="Plus" label={t("editorUi.role.add")} onPress={addRole} />} />
                      )}
                    </Anchor>
                  </SectionFrame>

                  {/* Candidates */}
                  <SectionFrame id="candidates" k={k} onLayout={onSectionLayout("candidates")}>
                    <SectionHeader
                      k={k}
                      icon="Boxes"
                      tone={PART.board}
                      title={t("editorUi.section.candidates")}
                      count={draft.candidates.length}
                      subtitle={t("editorUi.section.candidatesHint")}
                      right={draft.candidates.length ? <Button k={k} size="sm" icon="Plus" label={k.compact ? undefined : t("editorUi.candidate.add")} accessibilityLabel={t("editorUi.candidate.add")} onPress={addCandidate} /> : undefined}
                    />
                    <Anchor field="candidates" style={{ gap: 12 }}>
                      <FieldIssues k={k} field="candidates" />
                      {draft.candidates.length ? (
                        <View>
                          <Grid min={340} max={3}>
                            {draft.candidates.map((candidate, index) => (
                              <CandidateCard
                                key={index}
                                k={k}
                                candidate={candidate}
                                index={index}
                                catalog={catalog}
                                icons={icons}
                                autoFocus={focusField === `candidates.${index}`}
                                onChange={(next, group) => setCandidate(index, next, group)}
                                onDuplicate={() => duplicateCandidate(index)}
                                onRemove={() => removeCandidate(index)}
                              />
                            ))}
                          </Grid>
                          <AddCard k={k} label={t("editorUi.candidate.add")} onPress={addCandidate} />
                        </View>
                      ) : (
                        <EmptyBlock k={k} icon="Boxes" text={t("editorUi.candidate.empty")} action={<Button k={k} size="sm" icon="Plus" label={t("editorUi.candidate.add")} onPress={addCandidate} />} />
                      )}
                    </Anchor>
                  </SectionFrame>
                </View>
              </ScrollView>
            </View>

            <IssuesDialog
              k={k}
              open={issuesOpen}
              check={check}
              team={draft}
              onClose={() => setIssuesOpen(false)}
              onJump={(field) => {
                setIssuesOpen(false);
                setTimeout(() => jumpTo(field), 150);
              }}
            />

            <StartDialog
              k={k}
              open={startOpen}
              team={draft}
              check={check}
              here={here}
              project={data.project.name}
              toolsOff={data.toolsEnabled === false}
              busy={applied.isPending && applied.variables?.source === "dialog"}
              errors={dialogErrors}
              onClose={() => setStartOpen(false)}
              onStart={startSession}
            />

            <Modal title={t("presets.saveAsPreset")} open={presetOpen} onOpenChange={(open) => { if (!open) setPresetOpen(false); }}>
              <Modal.Content>
                <View style={{ gap: 14 }}>
                  <Text style={k.t.muted}>{t("editorUi.presetDialog.hint")}</Text>
                  <Slot k={k} label={t("presets.name")}>
                    <TextField k={k} autoFocus value={presetName} placeholder={t("presets.saveAsPresetName")} onChangeText={setPresetName} onSubmitEditing={savePreset} />
                  </Slot>
                  {presetSettings.status === "ready" && presetSettings.saveError ? (
                    <Callout k={k} tone={k.c.bad} icon="CircleAlert">
                      <Text style={k.t.small}>{t("presets.saveFailed", { error: presetSettings.saveError })}</Text>
                    </Callout>
                  ) : null}
                  <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
                    <Button k={k} label={t("review.cancel")} onPress={() => setPresetOpen(false)} />
                    <Button k={k} variant="primary" icon="Star" label={t("presets.save")} busy={presetSettings.status === "ready" && presetSettings.saving} disabled={!presetName.trim() || !check.team} onPress={savePreset} />
                  </View>
                </View>
              </Modal.Content>
            </Modal>

            <Modal title={t("current.restartConfirmTitle")} open={confirmRestart} onOpenChange={setConfirmRestart}>
              <Modal.Content>
                <View style={{ gap: 14 }}>
                  <Text style={k.t.body}>{t("current.restartConfirmBody")}</Text>
                  <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
                    <Button k={k} label={t("review.cancel")} disabled={restarted.isPending} onPress={() => setConfirmRestart(false)} />
                    <Button
                      k={k}
                      variant="primary"
                      icon="RotateCcw"
                      label={t("current.restartConfirm")}
                      disabled={restarted.isPending}
                      onPress={() => {
                        setConfirmRestart(false);
                        restarted.mutate();
                      }}
                    />
                  </View>
                </View>
              </Modal.Content>
            </Modal>

            <InstructionsDialog
              k={k}
              target={target}
              team={draft}
              role={editingRoleIndex !== null ? (draft.roles[editingRoleIndex] ?? null) : null}
              onSave={(instructions) => {
                const role = editingRoleIndex !== null ? draft.roles[editingRoleIndex] : undefined;
                if (editingRoleIndex !== null && role) setRole(editingRoleIndex, { ...role, instructions });
              }}
              onClose={() => setEditingRoleIndex(null)}
            />

            {progressModal}
          </View>
        </PickerHost>
      </AnchorContext.Provider>
    </IssuesContext.Provider>
  );
}
