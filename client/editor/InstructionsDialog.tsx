// A role's instructions in a dialog, with Improve with AI: a planner agent proposes better instructions, which the user
// applies or discards before saving them back to the draft.
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { teamInstructionsImproveRpc, teamInstructionsProposalRpc } from "../../shared/rpc";
import type { Role, Team } from "../../shared/team";
import { Button, Callout, Card, Spinner, type Kit } from "../kit";
import { useT, type MaybeText, type Target } from "./common";
import { Slot, TextField } from "./controls";

export function InstructionsDialog({ k, target, team, role, onSave, onClose }: { k: Kit; target: Target; team: Team | null; role: Role | null; onSave(instructions: string): void; onClose(): void }) {
  const { t, locale } = useT();
  const improve = useRpc(teamInstructionsImproveRpc);
  const instructionsProposal = useRpc(teamInstructionsProposalRpc);
  const open = role !== null && team !== null;
  const [instructions, setInstructions] = useState("");
  const [request, setRequest] = useState("");
  const [suggestion, setSuggestion] = useState<MaybeText>(null);
  const [plannerId, setPlannerId] = useState<MaybeText>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<MaybeText>(null);
  const requestCounter = useRef(0);

  const stopTracking = () => {
    requestCounter.current += 1;
    setStarting(false);
    setStartError(null);
    setPlannerId(null);
  };

  useEffect(() => {
    stopTracking();
    if (!open || !role) return;
    setInstructions(role.instructions);
    setRequest("");
    setSuggestion(null);
  }, [open]);

  const planning = useQuery({
    queryKey: ["workspace-agents", "instructions-proposal", plannerId],
    queryFn: () => instructionsProposal({ agentId: plannerId! }),
    enabled: plannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });

  useEffect(() => {
    if (planning.data?.status !== "done") return;
    setSuggestion(planning.data.instructions);
    setPlannerId(null);
  }, [planning.data]);

  const startImprove = useMutation({
    onMutate: () => {
      const currentRequest = ++requestCounter.current;
      setStarting(true);
      setStartError(null);
      setPlannerId(null);
      setSuggestion(null);
      return { request: currentRequest };
    },
    mutationFn: ({ currentRole, currentTeam, currentInstructions, currentRequest }: { currentRole: Role; currentTeam: Team; currentInstructions: string; currentRequest: string }) =>
      improve({
        ...target,
        role: { name: currentRole.name, folders: currentRole.folders, instructions: currentInstructions },
        request: currentRequest,
        locale: currentTeam.language ?? locale,
        team: {
          goal: currentTeam.goal,
          orchestratorWorkspace: currentTeam.orchestrator.workspace,
          roles: currentTeam.roles.map(({ name, folders }) => ({ name, folders })),
        },
      }),
    onSuccess: ({ agentId }, _vars, context) => {
      if (requestCounter.current !== context.request) return;
      setStarting(false);
      setPlannerId(agentId);
    },
    onError: (error, _vars, context) => {
      if (requestCounter.current !== context?.request) return;
      setStarting(false);
      setStartError(String(error));
    },
  });

  const busy = starting || (plannerId !== null && planning.data?.status !== "failed");

  const close = () => {
    stopTracking();
    setSuggestion(null);
    setRequest("");
    onClose();
  };

  return (
    <Modal title={t("role.instructionsTitle", { role: role?.name.trim() || t("role.name") })} open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <Modal.Content>
        {open && role && team ? (
          <View style={{ gap: 14 }}>
            <Slot k={k} label={t("editorUi.role.instructions")}>
              <TextField k={k} multiline minHeight={160} value={instructions} placeholder={t("editorUi.role.instructionsPlaceholder")} onChangeText={setInstructions} />
            </Slot>
            {suggestion !== null ? (
              <Callout k={k} tone={k.c.primary} icon="Sparkles">
                <View style={{ gap: 10 }}>
                  <Text style={k.t.body} selectable>
                    {suggestion}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <Button k={k} variant="primary" size="sm" icon="Check" label={t("role.applySuggestion")} onPress={() => { setInstructions(suggestion); setSuggestion(null); }} />
                    <Button k={k} size="sm" label={t("role.discardSuggestion")} onPress={() => setSuggestion(null)} />
                  </View>
                </View>
              </Callout>
            ) : null}
            <Card k={k} inset style={{ gap: 10 }}>
              <TextField k={k} multiline minHeight={48} value={request} placeholder={t("role.improveRequestPlaceholder")} onChangeText={setRequest} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Button k={k} icon="Sparkles" label={t("role.improveWithAi")} disabled={busy} onPress={() => startImprove.mutate({ currentRole: role, currentTeam: team, currentInstructions: instructions, currentRequest: request })} />
                {busy ? (
                  <>
                    <Spinner k={k} />
                    <Text style={k.t.muted}>{t("role.instructionsPlanning")}</Text>
                  </>
                ) : null}
              </View>
              {planning.data?.status === "failed" ? planning.data.errors.map((error) => <Text key={error} style={{ color: k.c.bad, fontSize: 12 }}>{error}</Text>) : null}
              {planning.error ? <Text style={{ color: k.c.bad, fontSize: 12 }}>{String(planning.error)}</Text> : null}
              {startError ? <Text style={{ color: k.c.bad, fontSize: 12 }}>{startError}</Text> : null}
            </Card>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
              <Button k={k} label={t("review.cancel")} onPress={close} />
              <Button
                k={k}
                variant="primary"
                icon="Check"
                label={t("role.saveInstructions")}
                onPress={() => {
                  onSave(instructions);
                  close();
                }}
              />
            </View>
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
