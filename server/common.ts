// Daemon-side helpers shared by the team handlers and the collaboration tools.
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProjectRef } from "../shared/projects";
import { parseTeam, TEAM_FILE } from "../shared/team";
import { legacyWorkspacesOf, TEAMS_DIR, type TeamFile } from "../shared/team-files";
import { agentFeaturesOf, agentModeOf, type AgentFeatures, type ProviderEntry } from "../shared/validate";

// Server code must not import @getpaseo/client, even for types; derive them from the plugin SDK instead.
export type PaseoApi = PluginHandlerContext["paseo"];
export type Target = { workspaceId: string } | { projectId: string };

export async function providerEntries(paseo: PaseoApi): Promise<ProviderEntry[]> {
  const snapshot = await paseo.providers.snapshot();
  return snapshot.entries as unknown as ProviderEntry[];
}

/** Feature discovery is optional: an unavailable provider must not prevent applying a team or starting a member. */
export async function featuresFor(paseo: PaseoApi, entries: readonly ProviderEntry[], provider: string, cwd: string): Promise<AgentFeatures> {
  const id = provider.split("/")[0]!;
  if (agentModeOf(entries, id) !== undefined) return undefined;
  try {
    const result = await paseo.providers.listFeatures({ provider, cwd });
    return agentFeaturesOf(entries, id, result.features ?? []);
  } catch {
    return undefined;
  }
}

export async function allProjects(paseo: PaseoApi): Promise<ProjectRef[]> {
  const { projects } = await paseo.projects.list();
  return projects.map((project) => ({ id: project.projectId, name: project.projectCustomName || project.projectDisplayName, root: project.projectRootPath }));
}

export async function projectOf(paseo: PaseoApi, target: Target): Promise<ProjectRef> {
  if ("projectId" in target) {
    const project = (await allProjects(paseo)).find((candidate) => candidate.id === target.projectId);
    if (!project) throw new Error(`Project ${target.projectId} was not found.`);
    return project;
  }
  const workspace = await paseo.workspaces.ref(target.workspaceId).refresh();
  if (!workspace) throw new Error(`Workspace ${target.workspaceId} was not found.`);
  return { id: workspace.projectId, name: workspace.projectCustomName || workspace.projectDisplayName, root: workspace.projectRootPath };
}

/** The project's team files, relative to its root: the single-team file first, then the teams folder by name. */
export async function teamFileNames(project: ProjectRef): Promise<string[]> {
  const legacy = await access(join(project.root, TEAM_FILE)).then(() => [TEAM_FILE], () => []);
  const names = await readdir(join(project.root, TEAMS_DIR)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return [...legacy, ...names.filter((name) => name.endsWith(".json")).sort().map((name) => `${TEAMS_DIR}/${name}`)];
}

/** Every team of the project, the names of all its team files, and the problems of those that don't parse. */
export async function projectTeams(project: ProjectRef): Promise<{ teams: TeamFile[]; names: string[]; errors: string[] }> {
  const names = await teamFileNames(project);
  const teams: TeamFile[] = [];
  const errors: string[] = [];
  for (const file of names) {
    const text = await readFile(join(project.root, file), "utf8");
    const parsed = parseTeam(text);
    if (parsed.ok) teams.push({ file, team: parsed.team, legacyWorkspaces: legacyWorkspacesOf(JSON.parse(text)) });
    else errors.push(...parsed.errors.map((error) => `${file}: ${error}`));
  }
  return { teams, names, errors };
}

/** Writes through a temporary file, so a crash never leaves half a JSON file behind. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Whether agents on this host get Paseo's tools, and with them the plugin's team tools (Settings → Orchestration →
 * Enable Paseo tools, `daemon.mcp.injectIntoAgents`). Off by default in Paseo 0.15; null when the config can't be read.
 */
export async function teamToolsEnabled(paseo: PaseoApi): Promise<boolean | null> {
  try {
    return (await paseo.config.get()).config.mcp.injectIntoAgents !== false;
  } catch {
    return null;
  }
}

export const TOOLS_OFF_ERROR = "Paseo tools are turned off for agents on this host, so the orchestrator would not get the team tools. Turn on Settings → Orchestration → Enable Paseo tools (or run `paseo daemon config set daemon.mcp.injectIntoAgents true`), then try again.";
