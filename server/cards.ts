// Appends the delegation cards (see shared/cards.ts) to a lead's timeline. A host without plugin timeline rows, or a
// lead that is gone, just doesn't get them: the run goes on.
import { HANDOFF_CARD, UPDATE_CARD, type HandoffCard, type UpdateCard } from "../shared/cards";
import type { PaseoApi } from "./common";

async function append(paseo: PaseoApi, leadId: string, id: string, kind: string, data: HandoffCard | UpdateCard): Promise<void> {
  try {
    await paseo.agents.ref(leadId).timeline.append({ type: "plugin", id, kind, version: 1, data });
  } catch (error) {
    console.error(`[ensemble] could not show ${kind} in ${leadId}`, error);
  }
}

/** "Handed off to agent": a member was started, or an idle one continued, with work from the lead. */
export function showHandoff(paseo: PaseoApi, leadId: string, card: HandoffCard): Promise<void> {
  return append(paseo, leadId, `handoff:${card.agentId}:${card.at}`, HANDOFF_CARD, card);
}

/** "Update from worker": a member's turn ended with its result. */
export function showUpdate(paseo: PaseoApi, leadId: string, card: UpdateCard): Promise<void> {
  return append(paseo, leadId, `update:${card.agentId}:${card.at}`, UPDATE_CARD, card);
}
