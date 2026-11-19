// Small shared pieces of the team editor: where a team goes, the translation function's type and the query key of the
// project list.
import { useTranslation } from "@getpaseo/plugin/client";
import { messages } from "../i18n";

/** Where the team goes: a workspace's project, or a project picked without a workspace. */
export type Target = { workspaceId: string } | { projectId: string };

/** The Agent teams screen's list of projects and their teams. */
export const PROJECT_TEAMS_KEY = ["workspace-agents", "projects"] as const;

export function useT() {
  return useTranslation(messages);
}

type UseT = typeof useT;
export type Translate = ReturnType<UseT>["t"];

/** Text, or none yet. */
export type MaybeText = string | null;

/** A position in a list, or none. */
export type MaybeIndex = number | null;

type SetTimeout = typeof setTimeout;
export type Timer = ReturnType<SetTimeout>;

/** The two agent languages by their own names; they read the same in every app language. */
export const LANGUAGE_NAMES = { zh: "中文", en: "English" } as const;
