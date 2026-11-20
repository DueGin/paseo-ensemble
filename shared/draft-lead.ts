// Leads started from Paseo's own new-agent draft. The composer's Team control writes DRAFT_TEAM into the draft's
// metadata; when the agent is created the daemon gives it the lead's instructions and LEAD_META, and when it first opens
// the daemon sets up its workspace's team. Agents the plugin starts itself carry labels instead; agents can't be
// labelled after creation, so code that asks "is this a lead?" reads either.
import { z } from "zod";
import { PROMPT_LANGUAGES, TEAM_MODES, type PromptLanguage } from "./modes";

/** The team a draft picked: the workspace's own team, or a global preset; with a mode for the session when set. */
export const DRAFT_TEAM = "paseo-ensemble.team";
/** On a lead started from a draft: its language, and once set up, its team file. */
export const LEAD_META = "paseo-ensemble.lead";

export const DraftTeamSchema = z.object({
  source: z.enum(["workspace", "preset"]),
  presetId: z.string().min(1).optional(),
  mode: z.enum(TEAM_MODES).optional(),
  /** The app language of the client the draft was written in, for a team without a language of its own. */
  locale: z.string().optional(),
  /** The person picked "members work without asking" in the composer; unset: members ask first. */
  unattended: z.boolean().optional(),
});
export type DraftTeam = z.output<typeof DraftTeamSchema>;

export const LeadMetaSchema = z.object({
  language: z.enum(PROMPT_LANGUAGES),
  /** Project-relative team file, once the lead's workspace has its team. */
  file: z.string().optional(),
  /** The lead has been given its full instructions (in its first team_status). */
  instructed: z.boolean().optional(),
  /** Its members work without asking, as the person who started it chose. */
  unattended: z.boolean().optional(),
});
export type LeadMeta = z.output<typeof LeadMetaSchema>;

type Metadata = Readonly<Record<string, unknown>> | null | undefined;

export function draftTeamOf(metadata: Metadata): DraftTeam | null {
  const parsed = DraftTeamSchema.safeParse(metadata?.[DRAFT_TEAM]);
  if (!parsed.success) return null;
  return parsed.data.source === "preset" && !parsed.data.presetId ? null : parsed.data;
}

export function leadMetaOf(metadata: Metadata): LeadMeta | null {
  const parsed = LeadMetaSchema.safeParse(metadata?.[LEAD_META]);
  return parsed.success ? parsed.data : null;
}

/** The composer's value for a choice: "none", "workspace" or "preset:<id>". */
export function draftChoiceValue(choice: DraftTeam | null): string {
  if (!choice) return "none";
  return choice.source === "preset" ? `preset:${choice.presetId}` : "workspace";
}

/** The metadata value for a composer choice, keeping the mode and member permissions already chosen; null clears it. */
export function draftTeamFor(value: string, current: DraftTeam | null, locale: string): DraftTeam | null {
  if (value === "none") return null;
  const mode = { ...(current?.mode ? { mode: current.mode } : {}), ...(current?.unattended ? { unattended: true } : {}) };
  if (value === "workspace") return { source: "workspace", ...mode, locale };
  if (value.startsWith("preset:") && value.length > "preset:".length) return { source: "preset", presetId: value.slice("preset:".length), ...mode, locale };
  return null;
}

/** The language a draft lead starts in before its team is known: the preset's, else the client's. */
export function draftLanguage(choice: DraftTeam, presetLanguage: PromptLanguage | undefined, fromLocale: (locale: string | undefined) => PromptLanguage): PromptLanguage {
  return presetLanguage ?? fromLocale(choice.locale);
}

/**
 * Marks a lead, and the members it started, whose person let members work without asking: members then start in their
 * provider's full-access mode and the plugin approves their tool requests. Without it they keep their permission prompts.
 */
export const UNATTENDED_LABEL = "ensemble-unattended";

/** Whether the person who started this lead let its members work without asking: its label, or its draft's choice. */
export function leadUnattended(agent: { labels?: Readonly<Record<string, string>> | null; metadata?: Metadata }): boolean {
  return agent.labels?.[UNATTENDED_LABEL] === "on" || leadMetaOf(agent.metadata)?.unattended === true || draftTeamOf(agent.metadata)?.unattended === true;
}

/**
 * Whether a record carries the signals that answer {@link leadUnattended} by itself: labels (which are absent from the
 * agent a team tool runs for) or a draft lead's metadata. Without them the record says nothing either way, and the
 * lead's own record has to be read.
 */
export function recordSaysUnattended(agent: { labels?: Readonly<Record<string, string>> | null; metadata?: Metadata }): boolean {
  return agent.labels !== undefined || leadMetaOf(agent.metadata) !== null;
}
