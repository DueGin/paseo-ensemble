// Delegation shown in the lead's own chat, as Orca shows a native handoff: a card when a member is given work ("Handed
// off to agent"), and a card when its turn ends with a result ("Update from worker"). The daemon appends them to the
// lead's timeline (`timeline.append`); the app draws them (`addTimelineRenderer`). Both sides validate with these.
import { z } from "zod";

export const HANDOFF_CARD = "ensemble-handoff";
export const UPDATE_CARD = "ensemble-update";

export const HandoffCardSchema = z.object({
  runId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  agentId: z.string(),
  title: z.string(),
  role: z.string(),
  provider: z.string(),
  model: z.string(),
  /** What the member was given, shortened. */
  task: z.string(),
  /** An idle member given more work, rather than a new one. */
  continued: z.boolean(),
  at: z.string(),
});
export type HandoffCard = z.output<typeof HandoffCardSchema>;

export const UpdateCardSchema = z.object({
  runId: z.string(),
  workspaceId: z.string().nullable(),
  agentId: z.string(),
  title: z.string(),
  role: z.string(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  /** The member's client and model, for its avatar; cards written before they were added have neither. */
  provider: z.string().optional(),
  model: z.string().optional(),
  /** Its result, shortened. */
  result: z.string(),
  at: z.string(),
});
export type UpdateCard = z.output<typeof UpdateCardSchema>;
