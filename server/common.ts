// Daemon-side helpers shared by the team handlers and the collaboration tools.
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { access, lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

/** Whether `path` is `root` itself or inside it; both absolute. */
export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A project file the plugin refuses to write or remove, because it, or a folder on its way, leads outside the project. */
export class OutsideProjectError extends Error {}

const outside = (file: string, where: string) =>
  new OutsideProjectError(`${file} leads outside the project (to ${where}), so Ensemble won't write it. Replace the link with a real file or folder inside the project.`);

/**
 * Where a file of the project really is: its path after following every link on the way, file and folders alike. Throws
 * OutsideProjectError when that path is outside the project, or when the file is a link to nothing. Folders that don't
 * exist yet are created inside the deepest one that does, so they stay in the project too.
 */
export async function projectFile(root: string, file: string): Promise<string> {
  const base = await realpath(root);
  const target = resolve(root, file);
  if (!within(resolve(root), target)) throw outside(file, target);
  const rest: string[] = [];
  for (let existing = target; ; existing = dirname(existing)) {
    const real = await realpath(existing).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (real !== null) {
      if (!within(base, real)) throw outside(file, real);
      return join(real, ...rest);
    }
    // A link to a missing place: writing it would create whatever it names, inside the project or not.
    if (await lstat(existing).then((stats) => stats.isSymbolicLink(), () => false)) throw outside(file, `a missing target of ${existing}`);
    rest.unshift(basename(existing));
  }
}

/** Writes a file of the project (see projectFile) through a temporary file; returns where it was written. */
export async function writeProjectFile(root: string, file: string, text: string): Promise<string> {
  const path = await projectFile(root, file);
  await writeFileAtomic(path, text);
  return path;
}

/** Removes a file of the project: the entry itself (a link, not what it points to), from a folder inside the project. */
export async function removeProjectFile(root: string, file: string): Promise<void> {
  const folder = await projectFile(root, dirname(file));
  await unlink(join(folder, basename(file)));
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
