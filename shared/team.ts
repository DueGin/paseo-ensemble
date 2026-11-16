import { z } from "zod";
import { PROMPT_LANGUAGES, TEAM_MODES } from "./modes";

// The team definition lives in the project repository, not in plugin settings
// (ADR 261029-093300), so it is shared through git and readable by agents.
export const TEAM_FILE = ".agents/team.json";

const name = z.string().trim().min(1);

export const OrchestratorSchema = z.object({
  /** Workspace title, matched by name so the file works on any machine. */
  workspace: name,
  provider: name,
  model: name,
});

export const RoleSchema = z.object({
  name,
  provider: name,
  model: name,
  folders: z.array(z.string().trim().min(1)).default([]),
  instructions: z.string().default(""),
});

/**
 * A candidate member of a preset team: a provider/model the orchestrator may give work to during a session, guided by its
 * description. A candidate is not a role: the orchestrator decides who does what from the descriptions.
 */
export const CandidateSchema = z.object({
  /** A short handle the orchestrator picks it by; derived from the model when left empty. Not a role or a duty. */
  name,
  provider: name,
  model: name,
  /** What the model is good at and suited for, its cost or speed, and work it must not be given. */
  notes: z.string().default(""),
});

/** A handle for a candidate without a name: its model id without the provider family prefix, such as haiku-5-5. */
export function candidateHandle(model: unknown): string {
  const id = typeof model === "string" ? model.trim().split("/").pop() ?? "" : "";
  return id.replace(/^claude-/, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "candidate";
}

/** Fills empty candidate names from their models, keeping given names and making every name unique. */
export function fillCandidateNames(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const named = (entry: unknown) => (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string" ? (entry as { name: string }).name.trim() : "");
  const taken = new Set(value.map(named).filter(Boolean).map((entry) => entry.toLowerCase()));
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || named(entry)) return entry;
    const base = candidateHandle((entry as { model?: unknown }).model);
    let handle = base;
    for (let index = 2; taken.has(handle.toLowerCase()); index += 1) handle = `${base}-${index}`;
    taken.add(handle.toLowerCase());
    return { ...entry, name: handle };
  });
}

/** Candidate lists accept members without a name; each gets one from its model. */
export const CandidatesSchema = z.preprocess(fillCandidateNames, z.array(CandidateSchema));

export const TeamSchema = z
  .object({
    version: z.literal(1),
    goal: z.string().default(""),
    /**
     * How the lead runs a request: a fixed collaboration mode, or "auto" to pick one per request.
     * Files written before modes existed behaved like delegation, so that stays their default.
     */
    mode: z.enum(TEAM_MODES).default("delegation"),
    orchestrator: OrchestratorSchema,
    /** Fixed roles. May be empty when the team has candidate members to form roles from. */
    roles: z.array(RoleSchema).default([]),
    /** The preset pool: models the orchestrator forms roles from during a session. */
    candidates: CandidatesSchema.default([]),
    /** The language of the agents' instructions and replies; set from the app language when the team is applied. */
    language: z.enum(PROMPT_LANGUAGES).optional(),
    /** The global preset the team was started from; a copy, so later edits of the preset don't change it. */
    preset: z.object({ id: z.string(), name: z.string() }).optional(),
  })
  .superRefine((team, ctx) => {
    const roleNames = new Set<string>();
    team.roles.forEach((role, index) => {
      const key = role.name.toLowerCase();
      if (roleNames.has(key)) ctx.addIssue({ code: "custom", path: ["roles", index, "name"], message: `duplicate role name "${role.name}"` });
      roleNames.add(key);
    });
    const candidateNames = new Set<string>();
    team.candidates.forEach((candidate, index) => {
      const key = candidate.name.toLowerCase();
      if (candidateNames.has(key)) ctx.addIssue({ code: "custom", path: ["candidates", index, "name"], message: `duplicate candidate name "${candidate.name}"` });
      candidateNames.add(key);
    });
    if (!team.roles.length && !team.candidates.length) ctx.addIssue({ code: "custom", path: ["roles"], message: "a team needs at least one role or one candidate member" });

  });

export type Team = z.output<typeof TeamSchema>;
export type Role = z.output<typeof RoleSchema>;
export type Candidate = z.output<typeof CandidateSchema>;

export type ParseResult = { ok: true; team: Team } | { ok: false; errors: string[] };

export function checkTeam(value: unknown): ParseResult {
  const result = TeamSchema.safeParse(value);
  if (result.success) return { ok: true, team: result.data };
  return { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "team"}: ${issue.message}`) };
}

export function parseTeam(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`team file is not valid JSON: ${(error as Error).message}`] };
  }
  return checkTeam(value);
}

export function serializeTeam(team: Team): string {
  return JSON.stringify(team, null, 2) + "\n";
}
