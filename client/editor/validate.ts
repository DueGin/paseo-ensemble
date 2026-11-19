// Checks a draft the way Save and Start will: the team schema, the provider catalog of this host (shared/validate.ts) and
// the workspaces of the project's other teams. Each problem is tied to the field it belongs to, so the status list can
// jump there; tips are warnings that don't stop a team but usually mean it won't work as meant.
import { workspaceClashes } from "../../shared/team-files";
import { TeamSchema, type Team } from "../../shared/team";
import { validateTeam, type ProviderInfo } from "../../shared/validate";
import type { Translate } from "./common";

export interface Issue {
  /** The field, as a path such as `roles.1.name`; anchors carry the same value. */
  field: string;
  level: "error" | "warning";
  message: string;
}

export interface Check {
  issues: Issue[];
  errors: number;
  warnings: number;
  /** The parsed team (defaults applied, candidate handles filled) when the schema accepts the draft. */
  team: Team | null;
}

export type SectionId = "overview" | "collab" | "lead" | "roles" | "candidates";

/** The section a field is shown in. */
export function sectionOf(field: string): SectionId {
  const head = field.split(".")[0];
  if (head === "mode" || head === "language") return "collab";
  if (head === "lead" || head === "roles" || head === "candidates") return head;
  return "overview";
}

const quoted = (message: string) => /"([^"]*)"/.exec(message)?.[1] ?? "";

function fieldOf(path: readonly PropertyKey[]): string {
  const parts = path.map(String);
  if (parts[0] === "orchestrator") return parts[1] === "workspace" ? "name" : `lead.${parts[1] ?? "provider"}`;
  if (parts[0] === "roles" && parts[2] === "folders") return parts.slice(0, 3).join(".");
  return parts.join(".") || "name";
}

function schemaMessage(t: Translate, path: readonly PropertyKey[], code: string, message: string): string {
  const parts = path.map(String);
  const last = parts[parts.length - 1];
  if (code === "too_small" || code === "invalid_type") {
    if (parts[0] === "orchestrator" && last === "workspace") return t("editorUi.v.workspace");
    if (parts[parts.length - 2] === "folders") return t("editorUi.v.folder");
    if (last === "name") return t("editorUi.v.roleName");
    if (last === "provider") return t("editorUi.v.provider");
    if (last === "model") return t("editorUi.v.model");
  }
  if (code === "custom") {
    if (message.startsWith("duplicate role name")) return t("editorUi.v.dupRole", { name: quoted(message) });
    if (message.startsWith("duplicate candidate name")) return t("editorUi.v.dupCandidate", { name: quoted(message) });
    if (message.startsWith("a team needs")) return t("editorUi.v.empty");
  }
  return message;
}

function catalogMessage(t: Translate, message: string, provider: string, model: string): { part: "provider" | "model"; text: string } {
  if (/is not enabled/.test(message)) return { part: "provider", text: t("editorUi.v.providerOff", { provider }) };
  const notReady = /is not ready \((.*)\)$/.exec(message);
  if (notReady) return { part: "provider", text: t("editorUi.v.providerNotReady", { provider, status: notReady[1] ?? "" }) };
  if (/is not available/.test(message)) return { part: "model", text: t("editorUi.v.modelMissing", { provider, model }) };
  return { part: "model", text: message };
}

export function checkDraft(team: Team, catalog: readonly ProviderInfo[], takenWorkspaces: readonly string[], t: Translate): Check {
  const issues: Issue[] = [];
  const result = TeamSchema.safeParse(team);
  if (!result.success) {
    for (const issue of result.error.issues) issues.push({ field: fieldOf(issue.path), level: "error", message: schemaMessage(t, issue.path, issue.code, issue.message) });
  }

  // The catalog check runs on every entry, valid or not, under names that point back to its index.
  const lead = { provider: team.orchestrator.provider.trim(), model: team.orchestrator.model.trim() };
  const roles = team.roles.map((role) => ({ provider: role.provider.trim(), model: role.model.trim() }));
  const candidates = team.candidates.map((candidate) => ({ provider: candidate.provider.trim(), model: candidate.model.trim() }));
  const probe: Team = {
    version: 1,
    goal: "",
    mode: team.mode,
    orchestrator: { workspace: team.orchestrator.workspace, ...lead },
    roles: roles.map((runtime, index) => ({ name: `#${index}`, ...runtime, folders: [], instructions: "" })),
    candidates: candidates.map((runtime, index) => ({ name: `#${index}`, ...runtime, notes: "" })),
  };
  for (const error of validateTeam(probe, catalog)) {
    const index = Number(error.target.replace(/^candidate /, "").slice(1));
    const [base, runtime] = error.target === "orchestrator" ? ["lead", lead] : error.target.startsWith("candidate ") ? [`candidates.${index}`, candidates[index]] : [`roles.${index}`, roles[index]];
    if (!runtime?.provider) continue;
    const { part, text } = catalogMessage(t, error.message, runtime.provider, runtime.model);
    if (part === "model" && !runtime.model) continue;
    issues.push({ field: `${base}.${part}`, level: "error", message: text });
  }

  if (team.orchestrator.workspace.trim()) {
    for (const _clash of workspaceClashes(probe, takenWorkspaces)) issues.push({ field: "name", level: "error", message: t("editorUi.v.clash", { workspace: team.orchestrator.workspace.trim() }) });
  }

  team.roles.forEach((role, index) => {
    if (!role.instructions.trim()) issues.push({ field: `roles.${index}.instructions`, level: "warning", message: t("editorUi.v.noInstructions") });
  });
  if (team.mode === "none" && (team.roles.length || team.candidates.length)) issues.push({ field: "mode", level: "warning", message: t("editorUi.v.modeNone") });

  const errors = issues.filter((issue) => issue.level === "error").length;
  return { issues, errors, warnings: issues.length - errors, team: result.success ? result.data : null };
}

/** Where an issue is, in words: "Role 2 · frontend". */
export function issuePlace(team: Team, field: string, t: Translate): string {
  const [head, index] = field.split(".");
  const at = Number(index);
  if (head === "roles" && Number.isInteger(at)) return `${t("editorUi.where.role", { n: at + 1 })}${team.roles[at]?.name.trim() ? ` · ${team.roles[at]!.name.trim()}` : ""}`;
  if (head === "roles") return t("editorUi.where.roles");
  if (head === "candidates" && Number.isInteger(at)) return `${t("editorUi.where.candidate", { n: at + 1 })}${team.candidates[at]?.name.trim() ? ` · @${team.candidates[at]!.name.trim()}` : ""}`;
  if (head === "candidates") return t("editorUi.where.candidates");
  if (head === "lead") return t("editorUi.where.lead");
  if (head === "mode") return t("editorUi.where.mode");
  if (head === "name") return t("editorUi.where.workspace");
  return t("editorUi.where.team");
}
