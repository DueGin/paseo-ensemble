// A badge on the sidebar's workspace rows (Paseo 0.16): the workspace runs a team, in which mode, and how many of its
// members are working or need the user. One shared query feeds every row.
import { useRpc, useTranslation, type PluginClientContext, type PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { teamBadgesRpc } from "../shared/rpc";
import { messages } from "./i18n";

export const BADGES_KEY = ["workspace-agents", "badges"] as const;

function TeamBadge({ workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const { t } = useTranslation(messages);
  const read = useRpc(teamBadgesRpc);
  const badges = useQuery({ queryKey: BADGES_KEY, queryFn: () => read({}), refetchInterval: 5000 });
  const badge = badges.data?.[workspaceId];
  if (!badge) return null;
  if (badge.attention) return <WorkspaceRowBadge icon="Users" label={t("badge.attention")} tone="danger" />;
  if (badge.working) return <WorkspaceRowBadge icon="Users" label={t("badge.working", { count: badge.working })} tone="info" />;
  return <WorkspaceRowBadge icon="Users" label={t(`mode.${badge.mode}`)} tone="muted" accessibilityLabel={`${t("badge.title")} · ${t(`mode.${badge.mode}`)}`} />;
}

export function contributeTeamBadge(client: PluginClientContext): () => void {
  // Apps older than 0.16 have no workspace row badges.
  if (typeof client.addWorkspaceRowBadgeItem !== "function") return () => {};
  return client.addWorkspaceRowBadgeItem({ id: "team", title: messages.message("badge.title"), icon: "Users", Component: TeamBadge });
}
