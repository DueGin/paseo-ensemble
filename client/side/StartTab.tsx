// The side panel's Start tab: start a lead on a team (this workspace's team file, or a preset), here or in a new workspace,
// with an optional first request, a mode for the session and the agents' language.
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { freeWorkspace } from "../../shared/apply-plan";
import { TEAM_MODES, type PromptLanguage, type TeamMode } from "../../shared/modes";
import { taskWorkspaceTitle, type Preset } from "../../shared/presets";
import { teamApplyRpc, teamPresetStartRpc } from "../../shared/rpc";
import type { Team } from "../../shared/team";
import { messages } from "../i18n";
import { Badge, Button, Callout, Card, Field, Input, MODE_LOOK, PART, Segmented, Spinner, T, type Kit } from "../kit";
import { parsedTeam, runtimeText, teamLabel, type WorkspaceTeam } from "./data";
import type { Translate } from "./run-parts";
import { LANGUAGE_NAMES } from "./preset-card";

type Choice =
  | { key: string; kind: "file"; label: string; mode: TeamMode; lead: string; roles: number; candidates: number; file: string; team: Team; language: PromptLanguage | undefined }
  | { key: string; kind: "preset"; label: string; mode: TeamMode; lead: string; roles: number; candidates: number; preset: Preset; language: PromptLanguage | undefined };

function TeamOption({ k, t, choice, on, onPick }: { k: Kit; t: Translate; choice: Choice; on: boolean; onPick(): void }) {
  const look = MODE_LOOK[choice.mode];
  return (
    <Card k={k} selected={on} onPress={onPick} label={choice.label} style={{ gap: 3, paddingVertical: 9 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Badge k={k} label={choice.kind === "file" ? t("sideUi.start.fileTag") : t("sideUi.start.presetTag")} tone={choice.kind === "file" ? PART.tasks : PART.plans} icon={choice.kind === "file" ? "FileText" : "Layers"} />
        <T k={k} v="strong" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {choice.label}
        </T>
        <Badge k={k} label={t(`mode.${choice.mode}`)} tone={look.tone} />
      </View>
      <T k={k} v="tiny" numberOfLines={1}>
        {[`${t("screen.lead")} ${choice.lead}`, choice.roles ? t("screen.roles", { count: choice.roles }) : null, choice.candidates ? t("screen.candidates", { count: choice.candidates }) : null].filter(Boolean).join(" · ")}
      </T>
      {choice.kind === "file" ? (
        <T k={k} v="tiny" numberOfLines={1} style={{ fontFamily: "Menlo" }}>
          {choice.file}
        </T>
      ) : null}
    </Card>
  );
}

export function StartTab({ k, t, workspaceId, workspace, presets, onStarted }: { k: Kit; t: Translate; workspaceId: string; workspace: WorkspaceTeam; presets: readonly Preset[]; onStarted(agentId: string, workspaceId: string): void }) {
  const { locale } = useTranslation(messages);
  const apply = useRpc(teamApplyRpc);
  const startPreset = useRpc(teamPresetStartRpc);
  const [picked, setPicked] = useState(null as string | null);
  const [request, setRequest] = useState("");
  const [where, setWhere] = useState<"here" | "new">("here");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState(null as TeamMode | null);
  const [language, setLanguage] = useState<PromptLanguage | "auto">("auto");
  const here = workspace.workspace ?? "";
  const own = useMemo(() => parsedTeam(workspace.team), [workspace.team]);

  const choices = useMemo<Choice[]>(() => [
    ...(own && workspace.file
      ? [{ key: "file", kind: "file" as const, label: teamLabel(own, workspace.file, here), mode: own.mode, lead: runtimeText(own.orchestrator.provider, own.orchestrator.model), roles: own.roles.length, candidates: own.candidates.length, file: workspace.file, team: own, language: own.language }]
      : []),
    ...presets.map((preset) => ({ key: `preset:${preset.id}`, kind: "preset" as const, label: preset.name, mode: preset.mode, lead: runtimeText(preset.orchestrator.provider, preset.orchestrator.model), roles: 0, candidates: preset.candidates.length, preset, language: preset.language })),
  ], [own, workspace.file, presets, here]);
  const choice = choices.find((entry) => entry.key === picked) ?? choices[0] ?? null;
  // A new choice starts from its own mode.
  useEffect(() => setMode(null), [choice?.key]);

  // A preset can only start here when this workspace has no team yet; a workspace runs one team.
  const hereAllowed = choice?.kind !== "preset" || !workspace.team;
  const place = hereAllowed ? where : "new";
  const effectiveMode = mode ?? choice?.mode ?? "auto";
  const fixedLanguage = choice?.kind === "preset" && choice.preset.language ? choice.preset.language : null;
  const suggested = taskWorkspaceTitle(request, choice?.label ?? "task");
  const newTitle = () => freeWorkspace(title.trim() || suggested, [...workspace.projectWorkspaces, ...workspace.takenWorkspaces]);

  const started = useMutation({
    mutationFn: async (): Promise<{ ok: true; agentId: string; workspaceId: string } | { ok: false; errors: string[] }> => {
      if (!choice) return { ok: false, errors: [] };
      const firstRequest = request.trim();
      if (choice.kind === "file") {
        const team: Team = {
          ...choice.team,
          ...(language !== "auto" ? { language } : {}),
          ...(place === "new" ? { orchestrator: { ...choice.team.orchestrator, workspace: newTitle() } } : {}),
        };
        const result = await apply({ workspaceId, team, locale, ...(firstRequest ? { request: firstRequest } : {}), ...(effectiveMode !== choice.team.mode ? { mode: effectiveMode } : {}) });
        return result.ok ? { ok: true, agentId: result.orchestratorAgentId, workspaceId: result.workspaces[0]?.id ?? workspaceId } : result;
      }
      const result = await startPreset({
        projectId: workspace.project.id,
        presetId: choice.preset.id,
        workspace: place === "here" ? { workspaceId } : { title: newTitle() },
        request: firstRequest,
        ...(effectiveMode !== choice.preset.mode ? { mode: effectiveMode } : {}),
        // A preset without a language of its own takes it from the locale.
        locale: language === "auto" ? locale : language,
      });
      return result.ok ? { ok: true, agentId: result.orchestratorAgentId, workspaceId: result.workspaceId } : result;
    },
    onSuccess: (result) => {
      if (!result.ok) return;
      setRequest("");
      setTitle("");
      onStarted(result.agentId, result.workspaceId);
    },
  });
  const errors = started.error ? [String(started.error)] : started.data && !started.data.ok ? started.data.errors : [];
  const toolsOff = workspace.toolsEnabled === false;

  return (
    <View style={{ gap: 16 }}>
      {toolsOff ? (
        <Callout k={k} tone={k.c.warn} icon="TriangleAlert">
          <T k={k} v="small">{t("toolsOff")}</T>
        </Callout>
      ) : null}

      <Field k={k} label={t("sideUi.start.team")}>
        {choices.length ? (
          <View style={{ gap: 6 }}>
            {choices.map((entry) => (
              <TeamOption key={entry.key} k={k} t={t} choice={entry} on={entry.key === choice?.key} onPick={() => setPicked(entry.key)} />
            ))}
          </View>
        ) : (
          <T k={k} v="muted">{t("sideUi.start.noTeams")}</T>
        )}
      </Field>

      <Field k={k} label={t("sideUi.start.request")} hint={t("sideUi.start.requestHint")}>
        <Input k={k} value={request} onChangeText={setRequest} multiline minHeight={84} placeholder={t("presets.request")} accessibilityLabel={t("sideUi.start.request")} />
      </Field>

      <Field k={k} label={t("sideUi.start.where")}>
        <Segmented<"here" | "new">
          k={k}
          stretch
          value={place}
          onChange={setWhere}
          options={[
            { value: "here", label: t("sideUi.start.here"), icon: "MapPin" },
            { value: "new", label: t("presets.newWorkspace"), icon: "Plus" },
          ]}
        />
        {place === "new" ? (
          <View style={{ gap: 4, paddingTop: 4 }}>
            <Input k={k} value={title} onChangeText={setTitle} placeholder={suggested} accessibilityLabel={t("sideUi.start.workspaceName")} />
            <T k={k} v="tiny">{t("sideUi.start.newHint", { project: workspace.project.name })}</T>
          </View>
        ) : (
          <T k={k} v="tiny" numberOfLines={1}>
            {workspace.project.name} · {here}
          </T>
        )}
        {!hereAllowed ? <T k={k} v="tiny" style={{ color: k.c.warn }}>{t("sideUi.start.hereTaken")}</T> : null}
      </Field>

      <Field k={k} label={t("sideUi.start.mode")}>
        <Segmented<TeamMode> k={k} stretch value={effectiveMode} onChange={(next) => setMode(next)} options={TEAM_MODES.map((entry) => ({ value: entry, label: t(`mode.${entry}`) }))} />
        <T k={k} v="tiny">
          {t(`mode.${effectiveMode}Hint`)}
          {choice?.kind === "file" && effectiveMode === choice.mode ? ` ${t("mode.fromFile")}` : ""}
        </T>
      </Field>

      <Field k={k} label={t("sideUi.start.language")}>
        <Segmented<PromptLanguage | "auto">
          k={k}
          stretch
          value={fixedLanguage ?? language}
          disabled={fixedLanguage !== null}
          onChange={setLanguage}
          options={[{ value: "auto", label: t("sideUi.start.languageAuto") }, { value: "zh", label: LANGUAGE_NAMES.zh }, { value: "en", label: LANGUAGE_NAMES.en }]}
        />
        {fixedLanguage ? <T k={k} v="tiny">{t("sideUi.start.languageFixed")}</T> : null}
      </Field>

      {errors.length ? (
        <Callout k={k} tone={k.c.bad} icon="TriangleAlert">
          {errors.map((error) => (
            <T key={error} k={k} v="small">
              {error}
            </T>
          ))}
        </Callout>
      ) : null}
      <Button k={k} variant="primary" size="lg" icon="Play" block busy={started.isPending} disabled={!choice || toolsOff} label={started.isPending ? t("sideUi.start.starting") : t("sideUi.start.go")} onPress={() => started.mutate()} />
      {started.isPending ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Spinner k={k} />
          <T k={k} v="tiny" style={{ flex: 1 }}>{t("progress.keepOpen")}</T>
        </View>
      ) : null}
    </View>
  );
}
