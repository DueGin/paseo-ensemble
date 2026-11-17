// Turning an agent started from Paseo's own new-agent draft into a team lead. The draft's Team control stores the
// choice in the agent's metadata (see shared/draft-lead.ts). Creation gives the agent short lead instructions and marks
// it a lead; the first open, which knows the agent's workspace, gives the workspace its team (a preset is written as the
// workspace's team file) and attaches the lead tools. The full instructions arrive with the lead's first team_status.
import type { PluginHooks } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { workspaceLabel } from "../shared/apply-plan";
import { draftLanguage, draftTeamOf, LEAD_META, leadMetaOf, type LeadMeta } from "../shared/draft-lead";
import { languageFromLocale, type PromptLanguage, type TeamMode } from "../shared/modes";
import { claudeToolRules } from "../shared/permissions";
import { presetToTeam, type Preset } from "../shared/presets";
import { promptsFor } from "../shared/prompts";
import { serializeTeam, type Team } from "../shared/team";
import { teamFileFor, teamIn, workspaceClashes, workspacesOfOtherTeams } from "../shared/team-files";
import { catalogFrom, validateTeam } from "../shared/validate";
import { projectTeams, providerEntries, teamToolsEnabled, TOOLS_OFF_ERROR, writeFileAtomic, type PaseoApi } from "./common";
import { allowTeamTools } from "./team";

type CreateRequest = PluginHooks["agent.create.before"]["request"];
type OpenRequest = PluginHooks["agent.open.before"]["request"];

const say = (lang: PromptLanguage, en: string, zh: string) => (lang === "zh" ? zh : en);

/**
 * agent.create.before: a draft with a team choice becomes a lead. Its saved instructions only say how to start; the team
 * is not known yet, since creation doesn't say which workspace the agent lands in. A preset that no longer exists fails
 * creation, so the draft stays for another choice.
 */
export function draftCreateRequest(request: CreateRequest, presets: readonly Preset[]): CreateRequest | undefined {
  const choice = draftTeamOf(request.metadata);
  if (!choice || leadMetaOf(request.metadata)) return undefined;
  const preset = choice.source === "preset" ? presets.find((entry) => entry.id === choice.presetId) : undefined;
  const lang = draftLanguage(choice, preset?.language, languageFromLocale);
  if (choice.source === "preset" && !preset) throw new Error(say(lang, "The team preset picked for this agent no longer exists. Pick another team in the composer.", "为这个 agent 选择的团队预设已不存在，请在输入框里重新选择团队。"));
  const lead: LeadMeta = { language: lang };
  const own = request.config.systemPrompt?.trim();
  return {
    ...request,
    config: { ...request.config, systemPrompt: [promptsFor(lang).draftLeadPrompt(), own].filter(Boolean).join("\n\n") },
    metadata: { ...request.metadata, [LEAD_META]: lead },
  };
}

/** What the first open of a draft lead set up. */
export interface DraftLeadSetup {
  root: string;
  file: string;
  team: Team;
  lead: LeadMeta;
  mode: TeamMode | null;
}

/**
 * agent.open.before, when a draft lead opens for the first time: its workspace runs the workspace's team, or gets one from
 * the preset. Fails the open, with what to do, when the workspace has no team to use or already runs another one.
 */
export async function prepareDraftLead(paseo: PaseoApi, request: OpenRequest, presets: readonly Preset[]): Promise<DraftLeadSetup | null> {
  const choice = draftTeamOf(request.metadata);
  const lead = leadMetaOf(request.metadata);
  if (!choice || !lead || lead.file || request.reason !== "create") return null;
  const lang = lead.language;
  if ((await teamToolsEnabled(paseo)) === false) throw new Error(TOOLS_OFF_ERROR);
  const workspace = (await paseo.workspaces.list()).entries.find((entry) => entry.id === request.workspaceId);
  if (!workspace) throw new Error(say(lang, "A team lead needs a workspace; this agent has none.", "团队协调器需要工作区，这个 agent 没有。"));
  const root = workspace.projectRootPath;
  const title = workspaceLabel(workspace);
  const { teams, names } = await projectTeams({ id: workspace.projectId, name: workspace.projectDisplayName, root });
  const own = teamIn(teams, title);
  let team: Team;
  let file: string;
  if (choice.source === "workspace") {
    if (!own) throw new Error(say(lang, `Workspace "${title}" has no team yet. Pick a preset in the composer, or set up a team in its Agent team panel.`, `工作区「${title}」还没有团队。请在输入框里选择一个预设，或先在它的智能体团队面板里建好团队。`));
    ({ team, file } = own);
  } else {
    const preset = presets.find((entry) => entry.id === choice.presetId);
    if (!preset) throw new Error(say(lang, "The team preset picked for this agent no longer exists. Pick another team in the composer.", "为这个 agent 选择的团队预设已不存在，请在输入框里重新选择团队。"));
    if (own) throw new Error(say(lang, `Workspace "${title}" already runs the team in ${own.file}. Pick "This workspace's team", or start the preset in a new workspace.`, `工作区「${title}」已经有团队（${own.file}）。请选择「本工作区的团队」，或在新工作区里使用这个预设。`));
    team = presetToTeam(preset, title);
    team = { ...team, language: team.language ?? lang };
    const clashes = workspaceClashes(team, workspacesOfOtherTeams(teams, title));
    if (clashes.length) throw new Error(clashes.map((problem) => `${problem.target}: ${problem.message}`).join("\n"));
    const problems = validateTeam(team, catalogFrom(await providerEntries(paseo)));
    if (problems.length) throw new Error(problems.map((problem) => `${problem.target}: ${problem.message}`).join("\n"));
    // A New workspace starts out titled with the prompt and is renamed later, so a long title names the file after the preset.
    file = teamFileFor(title.length > 32 ? { ...team, orchestrator: { ...team.orchestrator, workspace: preset.name } } : team, teams, names);
    await writeFileAtomic(join(root, file), serializeTeam(team));
  }
  const permission = await allowTeamTools({ id: workspace.projectId, name: workspace.projectDisplayName, root }, claudeToolRules(team));
  if (!permission.ok) throw new Error(permission.errors.join("\n"));
  const mode = choice.mode && choice.mode !== team.mode ? choice.mode : null;
  return { root, file, team, lead: { language: team.language ?? lang, file }, mode };
}
