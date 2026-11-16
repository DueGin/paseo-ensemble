// Global team presets: reusable across every project on the host. A preset is a pool of candidate members, the lead's
// model and a collaboration mode; starting a task from it in any project writes that project's team from the preset.
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { PROMPT_LANGUAGES, TEAM_MODES, type TeamMode } from "./modes";
import { CandidateSchema, fillCandidateNames, type Candidate, type Team } from "./team";

const name = z.string().trim().min(1);

export const PresetSchema = z.object({
  id: name,
  name,
  description: z.string().default(""),
  mode: z.enum(TEAM_MODES).default("auto"),
  /** The agents' language; the app language when not set. */
  language: z.enum(PROMPT_LANGUAGES).optional(),
  /** The lead's provider and model. */
  orchestrator: z.object({ provider: name, model: name }),
  /** Candidates without a name get one from their model. */
  candidates: z.preprocess(fillCandidateNames, z.array(CandidateSchema).min(1)),
  updatedAt: z.string().default(""),
});

export type Preset = z.output<typeof PresetSchema>;

/** Host settings: one document shared by every client of the host, kept across plugin reloads and updates. */
export const presetsSettings = defineSettings({
  id: "presets",
  scope: "host",
  version: 1,
  schema: z.object({ presets: z.array(PresetSchema).default([]) }),
});

export type PresetDocument = z.output<typeof presetsSettings.schema>;

/** A new preset id such as `p-3f2a90c1`; `random` returns 0..1. */
export function newPresetId(random: () => number = Math.random): string {
  return `p-${Math.floor(random() * 0x100000000).toString(16).padStart(8, "0")}`;
}

/** The team a preset gives a workspace: no fixed roles, the preset's candidates, its mode unless one is given. */
export function presetToTeam(preset: Preset, workspace: string, options: { goal?: string; mode?: TeamMode } = {}): Team {
  return {
    version: 1,
    goal: options.goal?.trim() || preset.description.trim(),
    mode: options.mode ?? preset.mode,
    orchestrator: { workspace, provider: preset.orchestrator.provider, model: preset.orchestrator.model },
    roles: [],
    candidates: preset.candidates.map((candidate) => ({ ...candidate })),
    preset: { id: preset.id, name: preset.name },
    ...(preset.language ? { language: preset.language } : {}),
  };
}

/** A preset made from a team: its candidates, and its fixed roles as candidates whose notes are their instructions. */
export function teamToPreset(team: Team, presetName: string, id: string, now: string): Preset {
  const fromRoles: Candidate[] = team.roles.map((role) => ({ name: role.name, provider: role.provider, model: role.model, notes: role.instructions.trim() }));
  const seen = new Set<string>();
  const candidates = [...team.candidates, ...fromRoles].filter((candidate) => {
    const key = candidate.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { id, name: presetName.trim(), description: team.goal.trim(), mode: team.mode, ...(team.language ? { language: team.language } : {}), orchestrator: { provider: team.orchestrator.provider, model: team.orchestrator.model }, candidates, updatedAt: now };
}

/** The candidates with an empty name named from their models, as they are saved. */
export function namedCandidates(candidates: readonly Candidate[]): Candidate[] {
  return fillCandidateNames(candidates) as Candidate[];
}

/** Problems that keep a preset draft from being saved; a candidate may go without a name. */
export function presetProblems(preset: Pick<Preset, "name" | "candidates" | "orchestrator">): string[] {
  const problems: string[] = [];
  if (!preset.name.trim()) problems.push("name");
  if (!preset.orchestrator.provider.trim() || !preset.orchestrator.model.trim()) problems.push("orchestrator");
  if (!preset.candidates.length) problems.push("candidates");
  const names = preset.candidates.map((candidate) => candidate.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) problems.push("candidateNames");
  if (preset.candidates.some((candidate) => !candidate.provider.trim() || !candidate.model.trim())) problems.push("candidateModels");
  return problems;
}

/** A workspace title for a new task: the request's first words, else the preset's name. */
export function taskWorkspaceTitle(request: string, presetName: string): string {
  const firstLine = request.trim().split("\n")[0]?.trim() ?? "";
  const base = (firstLine || presetName).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return base.length > 40 ? `${base.slice(0, 40).trimEnd()}…` : base || "task";
}
