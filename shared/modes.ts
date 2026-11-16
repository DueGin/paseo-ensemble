// Collaboration modes. A team file fixes one in advance or sets "auto", which lets the lead pick one per request.
// Each mode is a pattern from the multi-agent catalogue (MA-xx). Add a new mode here, then give it lead and
// member prompts in prompt.ts and its tools in server/collab.ts.

/** The modes a collaboration run can use. */
export const COLLAB_MODES = ["team", "delegation"] as const;
export type CollabMode = (typeof COLLAB_MODES)[number];

/** What a team file or a session can be set to: one mode, "auto" to pick one, or "none" for no collaboration. */
export const TEAM_MODES = ["auto", ...COLLAB_MODES, "none"] as const;
export type TeamMode = (typeof TEAM_MODES)[number];

export interface ModeSpec {
  id: CollabMode;
  /** The pattern in the multi-agent catalogue. */
  pattern: string;
  /** The lead agrees a brief with the user before any member sees the request. */
  intake: boolean;
  /** Members read each other's work on a shared board, or only report to the lead. */
  visibility: "shared" | "isolated";
  /** For the lead in auto mode: when this mode fits. */
  fit: string;
  /** When it does not fit. */
  unfit: string;
}

export const MODE_SPECS: Record<CollabMode, ModeSpec> = {
  team: {
    id: "team",
    pattern: "MA-08",
    intake: true,
    visibility: "shared",
    fit: "the parts depend on each other and need to be agreed as one piece (an interface several roles build against, a cross-cutting change, a design several roles review), the requirements are still unclear, or several hypotheses need checking with members correcting each other",
    unfit: "small or clearly separable work, where every member reading every post only costs time",
  },
  delegation: {
    id: "delegation",
    pattern: "MA-04",
    intake: false,
    visibility: "isolated",
    fit: "the request splits into parts with clear owners that can be done without talking to each other (independent features, research per area, read-only exploration)",
    unfit: "parts that must agree on shared details while they are built, or many parts writing the same files",
  },
};

/**
 * The mode a session runs in: the mode auto settled on (locked for the whole session), else the user's override for the
 * session, else the team file's mode.
 */
export function effectiveMode(teamMode: TeamMode, override: TeamMode | null | undefined, locked?: CollabMode | null): TeamMode {
  return locked ?? override ?? teamMode;
}

/** Whether a run in `mode` may start when the session is set to `effective`; "none" starts no run. */
export function allowsMode(effective: TeamMode, mode: CollabMode): boolean {
  return effective === "auto" || effective === mode;
}

export function isCollabMode(value: unknown): value is CollabMode {
  return typeof value === "string" && (COLLAB_MODES as readonly string[]).includes(value);
}

export function isTeamMode(value: unknown): value is TeamMode {
  return typeof value === "string" && (TEAM_MODES as readonly string[]).includes(value);
}

/** Tools the plugin attaches to the lead (the orchestrator). Claude sees them as `mcp__paseo__<name>`. */
export const LEAD_TOOLS = {
  status: "team_status",
  role: "team_role",
  delegate: "team_delegate",
  brief: "team_brief",
  kickoff: "team_kickoff",
  tasks: "team_tasks",
  broadcast: "team_broadcast",
  send: "team_send",
  wait: "team_wait",
  board: "team_board",
  close: "team_close",
} as const;

/** Tools the plugin attaches to member agents for the shared board of a team run. */
export const MEMBER_TOOLS = {
  read: "team_board_read",
  post: "team_board_post",
  claim: "team_board_claim",
  task: "team_task",
} as const;

export const ALL_TOOLS: readonly string[] = [...Object.values(LEAD_TOOLS), ...Object.values(MEMBER_TOOLS)];

/** Prefix of every message the plugin sends to an agent, so intake checks can tell them from the user's own. */
export const PLUGIN_MESSAGE_PREFIX = "[ensemble]";
/** Plugin messages in sessions from before the rename to Ensemble start with this. */
export const LEGACY_MESSAGE_PREFIX = "[agent-team]";

/** Languages the plugin writes agent instructions in; the agents reply in it too. */
export const PROMPT_LANGUAGES = ["zh", "en"] as const;
export type PromptLanguage = (typeof PROMPT_LANGUAGES)[number];

/** The prompt language for an app locale such as `zh-CN`: Chinese for Chinese, else English. */
export function languageFromLocale(locale: string | null | undefined): PromptLanguage {
  return (locale ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function isPromptLanguage(value: unknown): value is PromptLanguage {
  return typeof value === "string" && (PROMPT_LANGUAGES as readonly string[]).includes(value);
}

/** Label key on the plugin's agents naming the language of their instructions; their tools follow it. */
export const LANGUAGE_LABEL = "agent-team-lang";
