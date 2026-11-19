// What the side panel and the teams screen read: the workspace's team (team.read), every project's teams (team.projects),
// the host's agents (kept live through Paseo's agent stream) and the leads of a workspace. The query keys match the team
// editor's, so a team saved or applied anywhere refreshes every list.
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { teamProjectsRpc, teamReadRpc } from "../../shared/rpc";
import type { Agent } from "./model";

export * from "./model";

type Timer = ReturnType<SetTimeout>;
type SetTimeout = typeof setTimeout;

/** The keys the team editor uses too: every project's teams, and the team of one workspace. */
export const PROJECTS_KEY = ["workspace-agents", "projects"] as const;
export const TEAM_KEY = ["workspace-agents", "team"] as const;
export const teamKey = (workspaceId: string) => [...TEAM_KEY, { workspaceId }] as const;
/** The side panel's own queries: the agents and a lead's session. */
export const SIDE_KEY = ["ensemble-side"] as const;
export const AGENTS_KEY = [...SIDE_KEY, "agents"] as const;
export const SESSIONS_KEY = [...SIDE_KEY, "session"] as const;
export const sessionKey = (agentId: string | null) => [...SESSIONS_KEY, agentId] as const;

/** Every project and its teams, read again when the host's projects change. */
export function useProjectTeams() {
  const list = useRpc(teamProjectsRpc);
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  useEffect(() => paseo.projects.subscribe(() => void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })), [paseo, queryClient]);
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: () => list({}) });
}

/** The workspace's project, title and team, and what the host can run. */
export function useWorkspaceTeam(workspaceId: string) {
  const read = useRpc(teamReadRpc);
  return useQuery({ queryKey: teamKey(workspaceId), queryFn: () => read({ workspaceId }) });
}

/** The host's unarchived agents, refreshed (at most about once a second) whenever one changes. */
export function useAgents() {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  useEffect(() => {
    let active = true;
    let timer: Timer | null = null;
    const refresh = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: SIDE_KEY }, { cancelRefetch: false });
      }, 800);
    };
    const off = paseo.agents.subscribe(refresh);
    // The update stream only flows while a subscribed list is held.
    let release: (() => void) | null = null;
    void paseo.agents
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        if (active) release = () => void subscription.release();
        else void subscription.release();
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      off();
      release?.();
    };
  }, [paseo, queryClient]);
  return useQuery({ queryKey: AGENTS_KEY, queryFn: async () => (await paseo.agents.list()).entries.map((entry) => entry.agent as unknown as Agent) });
}
