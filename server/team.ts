import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureWorkspaces, freeWorkspace, planWorkspaces, workspaceLabel } from "../shared/apply-plan";
import { presetToTeam, taskWorkspaceTitle, type Preset } from "../shared/presets";
import { findOrchestrator, orchestratorsToArchive, teamAgentsToArchive, LABEL, pendingPlanners, PLANNER_WORKSPACE, plannerCleanup, PROPOSAL_FOR, proposalTarget } from "../shared/cleanup";
import { CLAUDE_LOCAL_SETTINGS, claudeToolRules, withAllowRule } from "../shared/permissions";
import { LANGUAGE_LABEL, languageFromLocale } from "../shared/modes";
import { promptsFor } from "../shared/prompts";
import { extractInstructions, extractProposal, INSTRUCTIONS_JSON_SCHEMA, instructionsPrompt, plannerPrompt, teamEditPrompt, TEAM_JSON_SCHEMA } from "../shared/proposal";
import { plannerWorkspace, teamWorkspaceId, type ProjectRef } from "../shared/projects";
import type { teamSaveRpc, teamPresetStartRpc, teamApplyRpc, teamDeleteRpc, teamInstructionsImproveRpc, teamInstructionsProposalRpc, teamPendingProposalRpc, teamProjectsRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamReconnectRpc, teamRestartOrchestratorRpc, teamRestoreRpc, teamEditProposalRpc, teamEditProposeRpc, teamRosterRpc } from "../shared/rpc";
import { checkTeam, serializeTeam, type Team } from "../shared/team";
import { sameTeamFiles, teamFileFor, teamFileWorkspaces, teamIn, workspaceOwnerOf, workspaceClashes, workspacesOfOtherTeams } from "../shared/team-files";
import { catalogFrom, agentModeOf, validateTeam, type ProviderEntry } from "../shared/validate";
import { allProjects, OutsideProjectError, projectFile, projectOf, projectTeams, providerEntries, removeProjectFile, teamToolsEnabled, TOOLS_OFF_ERROR, writeFileAtomic, writeProjectFile, type PaseoApi, type Target } from "./common";
import { leadUnattended, UNATTENDED_LABEL } from "../shared/draft-lead";

/** The workspace to start the planner in: the given one, else one of the project's, else a new "Team planner". */
async function plannerWorkspaceOf(paseo: PaseoApi, target: Target): Promise<string> {
  if ("workspaceId" in target) return target.workspaceId;
  const project = await projectOf(paseo, target);
  const { entries } = await paseo.workspaces.list();
  return plannerWorkspace(entries, project.id) ?? (await paseo.workspaces.create({ title: PLANNER_WORKSPACE, source: { kind: "directory", path: project.root, projectId: project.id } })).id;
}

/** The planner runs on Claude when it's ready, else the first ready provider, with that provider's default model. */
function plannerProvider(entries: readonly ProviderEntry[]): string {
  const ready = entries.filter((entry) => entry.enabled && entry.status === "ready");
  const entry = ready.find((candidate) => candidate.provider === "claude") ?? ready[0];
  if (!entry) throw new Error("No provider is ready on this host.");
  const models = (entry.models ?? []) as readonly { id: string; isDefault?: boolean }[];
  const model = models.find((candidate) => candidate.isDefault) ?? models[0];
  return model ? `${entry.provider}/${model.id}` : entry.provider;
}

export async function projectTeamsList(_input: RpcInput<typeof teamProjectsRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProjectsRpc>> {
  const [projects, { entries }] = await Promise.all([allProjects(paseo), paseo.workspaces.list()]);
  return Promise.all(projects.map(async (project) => {
    const { teams, errors } = await projectTeams(project);
    return {
      ...project,
      workspaces: entries.filter((entry) => entry.projectId === project.id && !entry.archivingAt).map((entry) => ({ id: entry.id, title: workspaceLabel(entry) })),
      teams: teams.map(({ file, team }) => ({
        file,
        goal: team.goal,
        orchestratorWorkspace: team.orchestrator.workspace,
        workspaceId: teamWorkspaceId(entries, project.id, team.orchestrator.workspace),
        roles: team.roles.length,
        candidates: team.candidates.length,
        mode: team.mode,
        orchestrator: { provider: team.orchestrator.provider, model: team.orchestrator.model },
        language: team.language ?? null,
      })),
      errors,
    };
  }));
}

/** Archives the team's agents in workspaces no other team uses, then deletes its files only if archiving succeeds. */
export async function deleteTeam({ projectId, file }: RpcInput<typeof teamDeleteRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamDeleteRpc>> {
  const project = await projectOf(paseo, { projectId });
  const [{ teams }, { entries }, { entries: agentEntries }] = await Promise.all([projectTeams(project), paseo.workspaces.list(), paseo.agents.list()]);
  // Only a file the listing showed can be deleted, so the path can't point anywhere else.
  const own = sameTeamFiles(teams, file);
  if (!own.length) throw new Error(`${file} is not a team file of ${project.name}.`);
  const idOf = (title: string) => teamWorkspaceId(entries, project.id, title);
  const workspaceIds = own.flatMap(teamFileWorkspaces).map(idOf).filter((id): id is string => id !== null);
  const keep = workspacesOfOtherTeams(teams, own[0]!.team.orchestrator.workspace).map(idOf).filter((id): id is string => id !== null);
  const agents = agentEntries.map((entry) => entry.agent);
  const ids = teamAgentsToArchive(agents, workspaceIds.filter((id) => !keep.includes(id)), own.flatMap(({ team }) => team.roles.map((role) => role.name)));
  const failures = await archiveAgents(paseo, ids, "agent");
  // Keep the files after an agent failure so deletion can be retried from the same team row.
  if (failures.length) return { files: [], archived: ids.length - failures.length, failures, fileFailures: [] };
  const fileFailures: string[] = [];
  const files: string[] = [];
  for (const entry of own) {
    try { await removeProjectFile(project.root, entry.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { fileFailures.push(`file ${entry.file}: ${String(error)}`); continue; }
    }
    files.push(entry.file);
  }
  return { files, archived: ids.length, failures, fileFailures };
}

/** Reconnects every file for the team to the selected workspace's current title. */
export async function reconnectTeam({ projectId, file, workspaceId }: RpcInput<typeof teamReconnectRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamReconnectRpc>> {
  const project = await projectOf(paseo, { projectId });
  const [{ teams }, { entries }] = await Promise.all([projectTeams(project), paseo.workspaces.list()]);
  const own = sameTeamFiles(teams, file);
  if (!own.length) throw new Error(`${file} is not a team file of ${project.name}.`);
  const workspace = entries.find((entry) => entry.id === workspaceId && entry.projectId === project.id && !entry.archivingAt);
  if (!workspace) return { ok: false, errors: [`Workspace ${workspaceId} was not found in ${project.name}.`] };
  const title = workspaceLabel(workspace);
  const key = (value: string) => value.trim().toLowerCase();
  const taken = workspacesOfOtherTeams(teams, own[0]!.team.orchestrator.workspace);
  if (taken.some((name) => key(name) === key(title))) return { ok: false, errors: [`Workspace "${title}" belongs to another team.`] };
  // Every file is checked before any is written, so one that leads outside the project leaves the others as they were.
  let paths: string[];
  try {
    paths = await Promise.all(own.map((entry) => projectFile(project.root, entry.file)));
  } catch (error) {
    if (error instanceof OutsideProjectError) return { ok: false, errors: [error.message] };
    throw error;
  }
  for (const [index, { team }] of own.entries()) await writeFileAtomic(paths[index]!, serializeTeam({ ...team, orchestrator: { ...team.orchestrator, workspace: title } }));
  return { ok: true, files: own.map((entry) => entry.file) };
}

export async function teamRoster({ workspaceId }: RpcInput<typeof teamRosterRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamRosterRpc>> {
  const { entries } = await paseo.workspaces.list();
  const workspace = entries.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} was not found.`);
  const project: ProjectRef = { id: workspace.projectId, name: workspace.projectCustomName || workspace.projectDisplayName, root: workspace.projectRootPath };
  const { teams, errors } = await projectTeams(project);
  const idOf = (title: string) => teamWorkspaceId(entries, project.id, title);
  return {
    teams: teams.map(({ team }) => {
      const orchestratorWorkspaceId = idOf(team.orchestrator.workspace);
      return {
        orchestratorWorkspaceId,
        mode: team.mode,
        roles: team.roles.map((role) => ({ name: role.name, provider: role.provider, model: role.model, workspaceId: orchestratorWorkspaceId })),
      };
    }),
    errors,
  };
}

async function workspaceTitle(paseo: PaseoApi, workspaceId: string): Promise<string> {
  const workspace = (await paseo.workspaces.list()).entries.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} was not found.`);
  return workspaceLabel(workspace);
}

export async function readTeam(target: RpcInput<typeof teamReadRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamReadRpc>> {
  const project = await projectOf(paseo, target);
  const catalog = catalogFrom(await providerEntries(paseo));
  const [{ teams, errors }, { entries }] = await Promise.all([projectTeams(project), paseo.workspaces.list()]);
  const workspace = "workspaceId" in target ? await workspaceTitle(paseo, target.workspaceId) : null;
  const own = workspace === null ? undefined : workspaceOwnerOf(teams, workspace);
  return {
    project,
    workspace,
    file: own?.file ?? null,
    team: own?.team ?? null,
    takenWorkspaces: workspacesOfOtherTeams(teams, own?.team.orchestrator.workspace ?? workspace ?? ""),
    projectWorkspaces: entries.filter((entry) => entry.projectId === project.id && !entry.archivingAt).map(workspaceLabel),
    errors,
    validation: own ? validateTeam(own.team, catalog) : [],
    catalog,
    toolsEnabled: await teamToolsEnabled(paseo),
  };
}

/** The target's unarchived team planners, newest first. */
async function plannersFor(paseo: PaseoApi, target: Target): Promise<string[]> {
  return pendingPlanners((await paseo.agents.list()).entries.map((entry) => entry.agent), proposalTarget(target));
}

/** A new proposal replaces the target's earlier ones, so only one can ever come back to the screen. */
async function archivePlannersFor(paseo: PaseoApi, target: Target): Promise<void> {
  for (const id of await plannersFor(paseo, target)) await paseo.agents.ref(id).archive();
}

export async function proposeTeam({ goal, locale, ...target }: RpcInput<typeof teamProposeRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProposeRpc>> {
  // A leftover earlier planner can't shadow this one (the newest is restored), so failing to archive it doesn't block proposing.
  await archivePlannersFor(paseo, target).catch(() => undefined);
  const entries = await providerEntries(paseo);
  const provider = plannerProvider(entries);
  const agent = await paseo.workspaces.ref(await plannerWorkspaceOf(paseo, target)).agents.create({
    // A planner only reads the project: its provider's reviewed auto mode, else its default mode, never an unattended one.
    config: { provider, modeId: agentModeOf(entries, provider.split("/")[0]!) },
    title: "Team planner",
    prompt: plannerPrompt(goal, catalogFrom(entries), languageFromLocale(locale)),
    outputSchema: TEAM_JSON_SCHEMA,
    labels: { [LABEL]: "planner", [PROPOSAL_FOR]: proposalTarget(target) },
  });
  return { agentId: agent.id };
}

export async function pendingProposal(target: RpcInput<typeof teamPendingProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamPendingProposalRpc>> {
  return { agentId: (await plannersFor(paseo, target))[0] ?? null };
}

export async function cancelProposal(target: RpcInput<typeof teamProposalCancelRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProposalCancelRpc>> {
  await archivePlannersFor(paseo, target);
  return {};
}

/** Waits up to a second for a planner; its final message once it has finished. */
async function plannerAnswer(paseo: PaseoApi, agentId: string): Promise<{ status: "running" } | { status: "failed"; errors: string[] } | { status: "finished"; message: string | null }> {
  const result = await paseo.agents.ref(agentId).waitForFinish(1000);
  if (result.status === "timeout") return { status: "running" };
  if (result.status === "error") return { status: "failed", errors: [result.error ?? "the planner stopped with an error"] };
  if (result.status === "permission") return { status: "failed", errors: ["the planner is waiting for a permission; answer it in the planner's chat, then try again"] };
  return { status: "finished", message: result.lastMessage };
}

export async function teamProposal({ agentId }: RpcInput<typeof teamProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProposalRpc>> {
  const result = await plannerAnswer(paseo, agentId);
  if (result.status !== "finished") return result;
  const parsed = extractProposal(result.message);
  if (!parsed.ok) return { status: "failed", errors: parsed.errors };
  return { status: "done", team: parsed.team, validation: validateTeam(parsed.team, catalogFrom(await providerEntries(paseo))) };
}

export async function proposeTeamEdit({ request, team, locale, ...target }: RpcInput<typeof teamEditProposeRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamEditProposeRpc>> {
  const entries = await providerEntries(paseo);
  const provider = plannerProvider(entries);
  const agent = await paseo.workspaces.ref(await plannerWorkspaceOf(paseo, target)).agents.create({
    // A planner only reads the project: its provider's reviewed auto mode, else its default mode, never an unattended one.
    config: { provider, modeId: agentModeOf(entries, provider.split("/")[0]!) },
    title: "Team editor",
    prompt: teamEditPrompt(request, team, catalogFrom(entries), team.language ?? languageFromLocale(locale)),
    outputSchema: TEAM_JSON_SCHEMA,
    labels: { [LABEL]: "planner" },
  });
  return { agentId: agent.id };
}

export async function teamEditProposal({ agentId }: RpcInput<typeof teamEditProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamEditProposalRpc>> {
  const result = await plannerAnswer(paseo, agentId);
  if (result.status !== "finished") return result;
  const parsed = extractProposal(result.message);
  if (!parsed.ok) return { status: "failed", errors: parsed.errors };
  await paseo.agents.ref(agentId).archive().catch(() => undefined);
  return { status: "done", team: parsed.team, validation: validateTeam(parsed.team, catalogFrom(await providerEntries(paseo))) };
}

export async function improveInstructions({ role, request, team, locale, ...target }: RpcInput<typeof teamInstructionsImproveRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamInstructionsImproveRpc>> {
  const entries = await providerEntries(paseo);
  const provider = plannerProvider(entries);
  const agent = await paseo.workspaces.ref(await plannerWorkspaceOf(paseo, target)).agents.create({
    // A planner only reads the project: its provider's reviewed auto mode, else its default mode, never an unattended one.
    config: { provider, modeId: agentModeOf(entries, provider.split("/")[0]!) },
    title: "Instructions planner",
    prompt: instructionsPrompt(role, request, team, languageFromLocale(locale)),
    outputSchema: INSTRUCTIONS_JSON_SCHEMA,
    labels: { [LABEL]: "planner" },
  });
  return { agentId: agent.id };
}

export async function instructionsProposal({ agentId }: RpcInput<typeof teamInstructionsProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamInstructionsProposalRpc>> {
  const result = await plannerAnswer(paseo, agentId);
  if (result.status !== "finished") return result;
  const parsed = extractInstructions(result.message);
  return parsed.ok ? { status: "done", instructions: parsed.instructions } : { status: "failed", errors: parsed.errors };
}

/** Archives agents, returning failures with the caller's label. */
async function archiveAgents(paseo: PaseoApi, ids: readonly string[], prefix: string): Promise<string[]> {
  const failures: string[] = [];
  for (const id of ids) await paseo.agents.ref(id).archive().catch((error: unknown) => failures.push(`${prefix} ${id}: ${String(error)}`));
  return failures;
}

/** Archives the planners, then their emptied workspaces; returns what failed instead of throwing. */
async function archivePlanners(paseo: PaseoApi, targets: { agents: string[]; workspaces: string[] }): Promise<string[]> {
  const failures = await archiveAgents(paseo, targets.agents, "planner");
  for (const id of targets.workspaces) {
    const result = await paseo.workspaces.archive(id).catch((error: unknown) => ({ error: String(error) }));
    if (result.error) failures.push(`workspace ${id}: ${result.error}`);
  }
  return failures;
}

/**
 * Lets the team's Claude agents call the plugin's team tools without asking Claude's Auto-mode reviewer, which could
 * deny starting a member in an unattended mode. Returns the settings file when a rule was added, null when none was.
 */
export async function allowTeamTools(project: ProjectRef, rules: readonly string[]): Promise<{ ok: true; file: string | null } | { ok: false; errors: string[] }> {
  if (!rules.length) return { ok: true, file: null };
  const file = join(project.root, CLAUDE_LOCAL_SETTINGS);
  let path: string;
  try {
    path = await projectFile(project.root, CLAUDE_LOCAL_SETTINGS);
  } catch (error) {
    if (error instanceof OutsideProjectError) return { ok: false, errors: [error.message] };
    throw error;
  }
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`${CLAUDE_LOCAL_SETTINGS} is not valid JSON: ${(error as Error).message}`] };
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return { ok: false, errors: [`${CLAUDE_LOCAL_SETTINGS} is not a JSON object`] };
  let next = settings as Record<string, unknown>;
  for (const rule of rules) next = withAllowRule(next, rule) ?? next;
  if (next === settings) return { ok: true, file: null };
  await writeFileAtomic(path, JSON.stringify(next, null, 2) + "\n");
  return { ok: true, file };
}

/**
 * Starts the team's lead with the same configuration for apply and restart; the plugin starts members through its tools.
 * With a request, the lead starts on it as the user's first message instead of introducing the team.
 */
async function startOrchestrator(paseo: PaseoApi, workspaceId: string, team: Team, orchestratorMode: ReturnType<typeof agentModeOf>, relative: string, unattended: boolean, request = "") {
  const prompts = promptsFor(team.language);
  return paseo.workspaces.ref(workspaceId).agents.create({
    // The lead's provider's reviewed auto mode, else its default mode. `unattended` is the person's choice for the members.
    config: { provider: `${team.orchestrator.provider}/${team.orchestrator.model}`, modeId: orchestratorMode, systemPrompt: prompts.orchestratorPrompt(team, relative) },
    title: "Orchestrator",
    prompt: request.trim() || prompts.orchestratorReadyPrompt(relative),
    labels: { [LABEL]: "orchestrator", [LANGUAGE_LABEL]: team.language ?? "en", ...(unattended ? { [UNATTENDED_LABEL]: "on" } : {}) },
  });
}

export async function restartOrchestrator(target: RpcInput<typeof teamRestartOrchestratorRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamRestartOrchestratorRpc>> {
  const project = await projectOf(paseo, target);
  const { teams, errors } = await projectTeams(project);
  const workspace = "workspaceId" in target ? await workspaceTitle(paseo, target.workspaceId) : null;
  const own = workspace === null ? undefined : teamIn(teams, workspace);
  if (!own) return { ok: false, errors: [...errors, "No team was found for the target workspace."] };
  const { file } = own;
  if ((await teamToolsEnabled(paseo)) === false) return { ok: false, errors: [TOOLS_OFF_ERROR] };
  // A team file without a language gets the app's, so the new lead works in it and later runs keep it.
  const team = own.team.language ? own.team : { ...own.team, language: languageFromLocale(target.locale) };
  if (!own.team.language) await writeProjectFile(project.root, file, serializeTeam(team));
  const providers = await providerEntries(paseo);
  const problems = validateTeam(team, catalogFrom(providers));
  if (problems.length) return { ok: false, errors: problems.map((problem) => `${problem.target}: ${problem.message}`) };
  const { entries } = await paseo.workspaces.list();
  const workspaceId = teamWorkspaceId(entries, project.id, team.orchestrator.workspace);
  if (!workspaceId) return { ok: false, errors: [`Workspace ${team.orchestrator.workspace} was not found.`] };
  const permission = await allowTeamTools(project, claudeToolRules(team));
  if (!permission.ok) return { ok: false, errors: permission.errors };
  const agents = (await paseo.agents.list()).entries.map((entry) => entry.agent);
  const archived = orchestratorsToArchive(agents, workspaceId);
  // A reset session goes on as the person started it: members work without asking only if they chose that then.
  const unattended = agents.some((agent) => archived.includes(agent.id) && leadUnattended(agent));
  const failures: string[] = [];
  for (const id of archived) {
    await paseo.agents.ref(id).archive().catch((error: unknown) => failures.push(`orchestrator ${id}: ${String(error)}`));
  }
  if (failures.length) return { ok: false, errors: failures };
  const orchestrator = await startOrchestrator(paseo, workspaceId, team, agentModeOf(providers, team.orchestrator.provider), file, unattended);
  return { ok: true, orchestratorAgentId: orchestrator.id, archived };
}

/** Writes a team's file, as Apply does, without starting the lead: a team edited ahead of its first session. */
export async function saveTeam({ team: input, ...target }: RpcInput<typeof teamSaveRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamSaveRpc>> {
  const checked = checkTeam(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const team = checked.team;
  const project = await projectOf(paseo, target);
  const { teams, names } = await projectTeams(project);
  const clashes = workspaceClashes(team, workspacesOfOtherTeams(teams, team.orchestrator.workspace));
  if (clashes.length) return { ok: false, errors: clashes.map((problem) => `${problem.target}: ${problem.message}`) };
  const relative = teamFileFor(team, teams, names);
  const file = join(project.root, relative);
  await writeProjectFile(project.root, relative, serializeTeam(team));
  return { ok: true, file };
}

/** Restores a saved team through the same validation and workspace setup as Apply. */
export async function restoreTeam({ projectId, file, locale }: RpcInput<typeof teamRestoreRpc>, ctx: PluginHandlerContext): Promise<RpcOutput<typeof teamRestoreRpc>> {
  const project = await projectOf(ctx.paseo, { projectId });
  const { teams } = await projectTeams(project);
  const saved = teams.find((entry) => entry.file === file);
  if (!saved) return { ok: false, errors: [`Team file ${file} was not found.`] };
  return applyTeam({ projectId, team: saved.team, locale }, ctx);
}

export async function applyTeam({ team: input, locale, request, mode: _mode, unattended = false, ...target }: RpcInput<typeof teamApplyRpc>, { paseo }: PluginHandlerContext, options: { request?: string } = {}): Promise<RpcOutput<typeof teamApplyRpc>> {
  options = { ...options, request: options.request ?? request };
  const checked = checkTeam(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  // The agents' language: the team's own, else the app language it is applied from.
  const team = { ...checked.team, language: checked.team.language ?? languageFromLocale(locale) };
  if ((await teamToolsEnabled(paseo)) === false) return { ok: false, errors: [TOOLS_OFF_ERROR] };
  const providers = await providerEntries(paseo);
  const problems = validateTeam(team, catalogFrom(providers));
  if (problems.length) return { ok: false, errors: problems.map((problem) => `${problem.target}: ${problem.message}`) };

  const project = await projectOf(paseo, target);
  const { teams, names } = await projectTeams(project);
  // Teams never share a workspace, so one team's role sessions can't mix with another's.
  const clashes = workspaceClashes(team, workspacesOfOtherTeams(teams, team.orchestrator.workspace));
  if (clashes.length) return { ok: false, errors: clashes.map((problem) => `${problem.target}: ${problem.message}`) };
  const permission = await allowTeamTools(project, claudeToolRules(team));
  if (!permission.ok) return { ok: false, errors: permission.errors };
  const relative = teamFileFor(team, teams, names);
  const file = join(project.root, relative);
  await writeProjectFile(project.root, relative, serializeTeam(team));

  const { entries } = await paseo.workspaces.list();
  const existing = entries.filter((workspace) => workspace.projectId === project.id && !workspace.archivingAt);
  const workspaces = await ensureWorkspaces(planWorkspaces(team, existing), async (title) => (await paseo.workspaces.create({ title, source: { kind: "directory", path: project.root, projectId: project.id } })).id);

  const lead = workspaces[0]!;
  const orchestratorMode = agentModeOf(providers, team.orchestrator.provider);
  // Applying again keeps the orchestrator already running on the same model and mode and tells it to re-read the team.
  const agents = (await paseo.agents.list()).entries.map((entry) => entry.agent);
  const running = findOrchestrator(agents, lead.id, team, orchestratorMode);
  if (running) {
    const request = options.request?.trim();
    const changed = promptsFor(team.language).teamChangedMessage(team, relative);
    await paseo.agents.ref(running.id).send(request ? `${changed}\n\n${team.language === "zh" ? "用户的新需求：" : "The user's new request:"}\n${request}` : changed);
    return { ok: true, file, workspaces, orchestratorAgentId: running.id, cleanup: await archivePlanners(paseo, plannerCleanup(existing, agents, team)), permission: permission.file };
  }
  const orchestrator = await startOrchestrator(paseo, lead.id, team, orchestratorMode, relative, unattended, options.request);
  return { ok: true, file, workspaces, orchestratorAgentId: orchestrator.id, cleanup: await archivePlanners(paseo, plannerCleanup(existing, agents, team)), permission: permission.file };
}

/**
 * Starts a new task in a project from a global preset. A new workspace gets a title no workspace of the project has; an
 * existing one must not run a team yet, since a workspace runs one team. The team is written like Apply writes it.
 */
export async function startFromPreset(input: RpcInput<typeof teamPresetStartRpc>, ctx: PluginHandlerContext, presets: readonly Preset[]): Promise<RpcOutput<typeof teamPresetStartRpc>> {
  const { paseo } = ctx;
  const preset = presets.find((entry) => entry.id === input.presetId);
  if (!preset) return { ok: false, errors: [`The preset was not found; it may have been deleted.`] };
  const project = await projectOf(paseo, { projectId: input.projectId });
  const [{ teams }, { entries }] = await Promise.all([projectTeams(project), paseo.workspaces.list()]);
  const live = entries.filter((entry) => entry.projectId === project.id && !entry.archivingAt);
  let title: string;
  if ("workspaceId" in input.workspace) {
    const workspaceId = input.workspace.workspaceId;
    const workspace = live.find((entry) => entry.id === workspaceId);
    if (!workspace) return { ok: false, errors: [`Workspace ${workspaceId} was not found in ${project.name}.`] };
    title = workspaceLabel(workspace);
    if (workspaceOwnerOf(teams, title)) return { ok: false, errors: [`Workspace "${title}" already runs a team; pick another one or a new workspace.`] };
  } else {
    // A new workspace never lands on an existing one, which planWorkspaces would reuse by title.
    title = freeWorkspace(input.workspace.title.trim() || taskWorkspaceTitle(input.request, preset.name), [...live.map(workspaceLabel), ...teams.flatMap(teamFileWorkspaces)]);
  }
  const team = presetToTeam(preset, title, { goal: input.request.trim().split("\n")[0]?.slice(0, 200), mode: input.mode });
  const applied = await applyTeam({ projectId: project.id, team, locale: input.locale, unattended: input.unattended === true }, ctx, { request: input.request });
  if (!applied.ok) return applied;
  return { ok: true, file: applied.file, workspaceId: applied.workspaces[0]!.id, orchestratorAgentId: applied.orchestratorAgentId, permission: applied.permission };
}
