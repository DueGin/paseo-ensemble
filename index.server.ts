import type { PluginServerContext } from "@getpaseo/plugin/server";
import { contributeCollaboration, sessionDetail, sessionInfo, setSessionMode, workspaceBadges } from "./server/collab";
import { legacyPresets } from "./server/legacy";
import { presetsSettings } from "./shared/presets";
import { applyTeam, saveTeam, startFromPreset, cancelProposal, deleteTeam, improveInstructions, instructionsProposal, pendingProposal, projectTeamsList, proposeTeamEdit, proposeTeam, readTeam, reconnectTeam, restartOrchestrator, restoreTeam, teamEditProposal, teamProposal, teamRoster } from "./server/team";
import { teamSaveRpc, teamApplyRpc, teamDeleteRpc, teamInstructionsImproveRpc, teamInstructionsProposalRpc, teamPendingProposalRpc, teamProjectsRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamReconnectRpc, teamRestartOrchestratorRpc, teamRestoreRpc, teamEditProposalRpc, teamEditProposeRpc, teamRosterRpc, teamSessionModeRpc, teamSessionRpc, teamSessionDetailRpc, teamPresetStartRpc, teamLegacyPresetsRpc, teamBadgesRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  // Global team presets live in host settings, shared by every client and project of the host.
  const presets = server.registerSettings(presetsSettings);
  server.handle(teamPresetStartRpc, async (input, ctx) => {
    const current = await presets.read();
    if (current.status !== "ready") return { ok: false as const, errors: [`The team presets can't be read: ${current.error}`] };
    return startFromPreset(input, ctx, current.values.presets);
  });
  server.handle(teamLegacyPresetsRpc, () => legacyPresets());
  server.handle(teamBadgesRpc, workspaceBadges);
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
  // A session started from the team editor may set its own mode; the lead gets it before its first run.
  server.handle(teamApplyRpc, async (input, ctx) => {
    const result = await applyTeam(input, ctx);
    if (result.ok && input.mode) await setSessionMode({ agentId: result.orchestratorAgentId, mode: input.mode }, ctx).catch((error) => console.error("[ensemble] session mode", error));
    return result;
  });
  server.handle(teamSaveRpc, saveTeam);
  server.handle(teamRestoreRpc, restoreTeam);
  server.handle(teamRestartOrchestratorRpc, restartOrchestrator);
  server.handle(teamRosterRpc, teamRoster);
  server.handle(teamSessionRpc, sessionInfo);
  server.handle(teamSessionDetailRpc, sessionDetail);
  server.handle(teamSessionModeRpc, setSessionMode);
  // Team tools for leads and members, and the hooks that move collaboration runs along.
  return contributeCollaboration(server, async () => {
    const current = await presets.read();
    return current.status === "ready" ? current.values.presets : [];
  });
}
