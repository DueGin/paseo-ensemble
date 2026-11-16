import type { PluginServerContext } from "@getpaseo/plugin/server";
import { contributeCollaboration, sessionDetail, sessionInfo, setSessionMode } from "./server/collab";
import { legacyPresets } from "./server/legacy";
import { presetsSettings } from "./shared/presets";
import { applyTeam, startFromPreset, cancelProposal, deleteTeam, improveInstructions, instructionsProposal, pendingProposal, projectTeamsList, proposeTeamEdit, proposeTeam, readTeam, reconnectTeam, restartOrchestrator, restoreTeam, teamEditProposal, teamProposal, teamRoster } from "./server/team";
import { teamApplyRpc, teamDeleteRpc, teamInstructionsImproveRpc, teamInstructionsProposalRpc, teamPendingProposalRpc, teamProjectsRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamReconnectRpc, teamRestartOrchestratorRpc, teamRestoreRpc, teamEditProposalRpc, teamEditProposeRpc, teamRosterRpc, teamSessionModeRpc, teamSessionRpc, teamSessionDetailRpc, teamPresetStartRpc, teamLegacyPresetsRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  // Global team presets live in host settings, shared by every client and project of the host.
  const presets = server.registerSettings(presetsSettings);
  server.handle(teamPresetStartRpc, async (input, ctx) => {
    const current = await presets.read();
    if (current.status !== "ready") return { ok: false as const, errors: [`The team presets can't be read: ${current.error}`] };
    return startFromPreset(input, ctx, current.values.presets);
  });
  server.handle(teamLegacyPresetsRpc, () => legacyPresets());
  server.handle(teamProjectsRpc, projectTeamsList);
  server.handle(teamDeleteRpc, deleteTeam);
  server.handle(teamReconnectRpc, reconnectTeam);
  server.handle(teamReadRpc, readTeam);
  server.handle(teamProposeRpc, proposeTeam);
  server.handle(teamProposalRpc, teamProposal);
  server.handle(teamPendingProposalRpc, pendingProposal);
  server.handle(teamProposalCancelRpc, cancelProposal);
  server.handle(teamEditProposeRpc, proposeTeamEdit);
  server.handle(teamEditProposalRpc, teamEditProposal);
  server.handle(teamInstructionsImproveRpc, improveInstructions);
  server.handle(teamInstructionsProposalRpc, instructionsProposal);
  server.handle(teamApplyRpc, applyTeam);
  server.handle(teamRestoreRpc, restoreTeam);
  server.handle(teamRestartOrchestratorRpc, restartOrchestrator);
  server.handle(teamRosterRpc, teamRoster);
  server.handle(teamSessionRpc, sessionInfo);
  server.handle(teamSessionDetailRpc, sessionDetail);
  server.handle(teamSessionModeRpc, setSessionMode);
  // Team tools for leads and members, and the hooks that move collaboration runs along.
  return contributeCollaboration(server);
}
