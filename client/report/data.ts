// The full run of a session, for the report's header facts and its part pages. Every reader shares one query, polled
// while the run is active or a brief waits for the user's confirmation.
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { teamSessionDetailRpc } from "../../shared/rpc";

export const sessionDetailKey = (agentId: string | null) => ["dashboard", "session-detail", agentId] as const;

export function useSessionDetail(agentId: string | null) {
  const read = useRpc(teamSessionDetailRpc);
  return useQuery({
    queryKey: sessionDetailKey(agentId),
    queryFn: () => read({ agentId: agentId! }),
    enabled: agentId !== null,
    refetchInterval: (query) => (query.state.data?.run?.status === "active" || query.state.data?.pendingBrief ? 3000 : false),
  });
}
