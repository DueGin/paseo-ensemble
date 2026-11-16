import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { FLOW_ACTIONS, RUN_COMPONENTS } from "./flow";
import { COLLAB_MODES, PROMPT_LANGUAGES, TEAM_MODES } from "./modes";
import { PresetSchema } from "./presets";
import { TeamSchema } from "./team";

const ProviderInfoSchema = z.object({
  id: z.string(),
  ready: z.boolean(),
  status: z.string(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
});

const TeamErrorSchema = z.object({ target: z.string(), message: z.string() });

const ProjectSchema = z.object({ id: z.string(), name: z.string(), root: z.string() });

/** A workspace of the project, or the project itself when no workspace is open. */
const TargetSchema = z.union([z.object({ workspaceId: z.string() }), z.object({ projectId: z.string() })]);

/** Every project on this host with its teams, orchestrator workspaces and team-file parse errors. */
export const teamProjectsRpc = defineRpc({
  name: "team.projects",
  input: z.object({}),
  output: z.array(ProjectSchema.extend({
    workspaces: z.array(z.object({ id: z.string(), title: z.string() })),
    teams: z.array(z.object({
      file: z.string(),
      goal: z.string(),
      orchestratorWorkspace: z.string(),
      workspaceId: z.string().nullable(),
      roles: z.number(),
      candidates: z.number(),
      mode: z.enum(TEAM_MODES),
      /** The orchestrator's provider and model. */
      orchestrator: z.object({ provider: z.string(), model: z.string() }),
      language: z.enum(["zh", "en"]).nullable(),
    })),
    errors: z.array(z.string()),
  })),
});

/**
 * Archives the team's agents in workspaces no other team uses, then deletes its files (including an old `.agents/team.json`).
 * Agent failures prevent file deletion; file failures are reported separately.
 */
export const teamDeleteRpc = defineRpc({
  name: "team.delete",
  input: z.object({ projectId: z.string(), file: z.string() }),
  output: z.object({ files: z.array(z.string()), archived: z.number(), failures: z.array(z.string()), fileFailures: z.array(z.string()) }),
});

/** Reconnects a team's files to an existing workspace by its current title, without changing agents. */
export const teamReconnectRpc = defineRpc({
  name: "team.reconnect",
  input: z.object({ projectId: z.string(), file: z.string(), workspaceId: z.string() }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({ ok: z.literal(true), files: z.array(z.string()) }),
  ]),
});

/** For the agent dashboard: the teams of a workspace's project, with their team workspace resolved to an id. */
export const teamRosterRpc = defineRpc({
  name: "team.roster",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({
    teams: z.array(z.object({
      /** Null when the orchestrator's workspace doesn't exist. */
      orchestratorWorkspaceId: z.string().nullable(),
      mode: z.enum(TEAM_MODES),
      /** Every role uses the orchestrator workspace id. */
      roles: z.array(z.object({ name: z.string(), provider: z.string(), model: z.string(), workspaceId: z.string().nullable() })),
    })),
    /** Problems reading or parsing the project's team files. */
    errors: z.array(z.string()),
  }),
});

/** The project (or a workspace's project), the team that runs in the workspace (if any) and what this host can run. */
export const teamReadRpc = defineRpc({
  name: "team.read",
  input: TargetSchema,
  output: z.object({
    project: ProjectSchema,
    /** The target workspace's title, or null when the target is the project. */
    workspace: z.string().nullable(),
    /** The project-relative file of the team that runs in the workspace, or null when it has none. */
    file: z.string().nullable(),
    team: TeamSchema.nullable(),
    /** Workspace titles the project's other teams use; a team can't use them too. */
    takenWorkspaces: z.array(z.string()),
    /** Titles of the project's workspaces; a new draft gets workspace names that aren't among them. */
    projectWorkspaces: z.array(z.string()),
    /** Problems reading or parsing the project's team files. */
    errors: z.array(z.string()),
    /** Providers or models in the team file this host can't run. */
    validation: z.array(TeamErrorSchema),
    catalog: z.array(ProviderInfoSchema),
    /** Whether agents get Paseo's tools, which carry the team tools; null when unknown. */
    toolsEnabled: z.boolean().nullable(),
  }),
});

/** Starts a planner agent that proposes a team for the goal, or, without one, from what it reads in the project. */
export const teamProposeRpc = defineRpc({
  name: "team.propose",
  input: TargetSchema.and(z.object({ goal: z.string().trim().default(""), locale: z.string().optional() })),
  output: z.object({ agentId: z.string() }),
});

/** The planner's proposal once it has finished. */
export const teamProposalRpc = defineRpc({
  name: "team.proposal",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("running") }),
    z.object({ status: z.literal("done"), team: TeamSchema, validation: z.array(TeamErrorSchema) }),
    z.object({ status: z.literal("failed"), errors: z.array(z.string()) }),
  ]),
});

/** The newest team planner still proposing for the target, so a reopened screen picks its proposal back up. */
export const teamPendingProposalRpc = defineRpc({
  name: "team.proposal.pending",
  input: TargetSchema,
  output: z.object({ agentId: z.string().nullable() }),
});

/** Archives the target's team planners, so a cancelled proposal does not come back. */
export const teamProposalCancelRpc = defineRpc({
  name: "team.proposal.cancel",
  input: TargetSchema,
  output: z.object({}),
});

const TeamOutlineSchema = z.object({
  orchestratorWorkspace: z.string(),
  roles: z.array(z.object({ name: z.string(), folders: z.array(z.string()) })),
});

/** Starts a planner that revises the whole team draft, including incomplete editor fields. */
export const teamEditProposeRpc = defineRpc({
  name: "team.edit.propose",
  input: TargetSchema.and(z.object({
    request: z.string().trim().min(1),
    locale: z.string().optional(),
    team: z.object({
      version: z.literal(1),
      goal: z.string(),
      mode: z.enum(TEAM_MODES).default("auto"),
      language: z.enum(PROMPT_LANGUAGES).optional(),
      orchestrator: z.object({ workspace: z.string(), provider: z.string(), model: z.string() }),
      roles: z.array(z.object({ name: z.string(), provider: z.string(), model: z.string(), folders: z.array(z.string()), instructions: z.string() })),
      candidates: z.array(z.object({ name: z.string(), provider: z.string(), model: z.string(), notes: z.string() })).default([]),
    }),
  })),
  output: z.object({ agentId: z.string() }),
});

/** The team editor's proposal once it has finished. */
export const teamEditProposalRpc = defineRpc({
  name: "team.edit.proposal",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("running") }),
    z.object({ status: z.literal("done"), team: TeamSchema, validation: z.array(TeamErrorSchema) }),
    z.object({ status: z.literal("failed"), errors: z.array(z.string()) }),
  ]),
});

/** Starts a planner that improves instructions for a role in the current draft. */
export const teamInstructionsImproveRpc = defineRpc({
  name: "team.instructions.improve",
  input: TargetSchema.and(z.object({
    locale: z.string().optional(),
    role: z.object({ name: z.string(), folders: z.array(z.string()), instructions: z.string() }),
    request: z.string(),
    team: TeamOutlineSchema.extend({ goal: z.string() }),
  })),
  output: z.object({ agentId: z.string() }),
});

/** The instructions planner's proposal once it has finished. */
export const teamInstructionsProposalRpc = defineRpc({
  name: "team.instructions.proposal",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("running") }),
    z.object({ status: z.literal("done"), instructions: z.string() }),
    z.object({ status: z.literal("failed"), errors: z.array(z.string()) }),
  ]),
});

const AppliedWorkspaceSchema = z.object({ target: z.string(), workspace: z.string(), id: z.string(), created: z.boolean() });

/** Writes the team file, creates missing workspaces, starts the orchestrator and archives the planners. */
export const teamApplyRpc = defineRpc({
  name: "team.apply",
  input: TargetSchema.and(z.object({ team: z.unknown(), locale: z.string().optional() })),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({
      ok: z.literal(true),
      file: z.string(),
      workspaces: z.array(AppliedWorkspaceSchema),
      orchestratorAgentId: z.string(),
      /** Planners or planner workspaces that could not be archived; the team itself was applied. */
      cleanup: z.array(z.string()),
      /** The Claude settings file the team tools' allow rules were added to, or null when none was added. */
      permission: z.string().nullable(),
    }),
  ]),
});

/** Applies a saved team, matching or creating its orchestrator workspace. */
export const teamRestoreRpc = defineRpc({
  name: "team.restore",
  input: z.object({ projectId: z.string(), file: z.string(), locale: z.string().optional() }),
  output: teamApplyRpc.output,
});

/** Archives the workspace's orchestrators and starts a new one from the team file on disk; role sessions are kept. */
export const teamRestartOrchestratorRpc = defineRpc({
  name: "team.restart-orchestrator",
  input: TargetSchema.and(z.object({ locale: z.string().optional() })),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({ ok: z.literal(true), orchestratorAgentId: z.string(), archived: z.array(z.string()) }),
  ]),
});

/** One step of a run's data flow; see flow.ts. */
export const RunEventSchema = z.object({
  seq: z.number(),
  at: z.string(),
  component: z.enum(RUN_COMPONENTS),
  action: z.enum(FLOW_ACTIONS),
  direction: z.enum(["in", "out"]),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  note: z.string(),
  count: z.number(),
});

const BriefSchema = z.object({
  title: z.string(),
  goal: z.string(),
  requirements: z.array(z.string()),
  acceptance: z.array(z.string()),
  constraints: z.array(z.string()),
  outOfScope: z.array(z.string()),
  userConfirmation: z.string(),
});

/** A brief the lead showed the user that still waits for their confirmation. */
const PendingBriefSchema = z.object({
  brief: BriefSchema.omit({ userConfirmation: true }),
  roles: z.array(z.string()),
  rounds: z.number(),
  planApproval: z.boolean(),
  reason: z.string(),
  tasks: z.array(z.object({ title: z.string(), detail: z.string(), role: z.string().nullable(), after: z.array(z.string()), files: z.array(z.string()) })),
  at: z.string(),
});

const RunViewSchema = z.object({
  id: z.string(),
  mode: z.enum(COLLAB_MODES),
  title: z.string(),
  status: z.enum(["active", "closed"]),
  round: z.number(),
  rounds: z.number(),
  planApproval: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  brief: z.object({ title: z.string(), goal: z.string(), acceptance: z.array(z.string()) }).nullable(),
  members: z.array(z.object({ role: z.string(), agentId: z.string(), title: z.string(), state: z.enum(["working", "done", "attention", "failed"]), task: z.string(), retired: z.boolean() })),
  /** The shared task board. */
  tasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    role: z.string().nullable(),
    state: z.enum(["todo", "doing", "done", "dropped"]),
    ownerTitle: z.string().nullable(),
    waitingOn: z.array(z.string()),
    plan: z.enum(["pending", "approved", "rejected"]).nullable(),
    sentBack: z.boolean(),
  })),
  /** The newest posts, oldest first. */
  posts: z.array(z.object({ seq: z.number(), round: z.number(), author: z.string(), kind: z.string(), text: z.string(), to: z.array(z.string()), at: z.string() })),
  postCount: z.number(),
  claims: z.array(z.object({ role: z.string(), path: z.string() })),
  /** The newest steps of the data flow, oldest first. */
  events: z.array(RunEventSchema),
  /** Delegation: each split of a request into packets. */
  batches: z.array(z.object({ round: z.number(), title: z.string(), packets: z.number(), warnings: z.number(), followUp: z.boolean(), summarized: z.boolean() })),
});

/** For the session dashboard: the collaboration mode of a lead's session and its latest run. */
export const teamSessionRpc = defineRpc({
  name: "team.session",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    /** The lead of the agent's session, or null when the session has no team lead. */
    leadAgentId: z.string().nullable(),
    configured: z.enum(TEAM_MODES).nullable(),
    override: z.enum(TEAM_MODES).nullable(),
    /** The mode auto settled on for the session; it can't be switched any more. */
    locked: z.enum(COLLAB_MODES).nullable(),
    effective: z.enum(TEAM_MODES).nullable(),
    run: RunViewSchema.nullable(),
    /** Roles the lead formed from candidate members in this session. */
    roles: z.array(z.object({ name: z.string(), candidate: z.string(), provider: z.string(), model: z.string() })),
    /** The brief in intake: shown to the user, not confirmed yet. */
    pendingBrief: z.object({ title: z.string(), goal: z.string(), roles: z.array(z.string()), tasks: z.number(), at: z.string() }).nullable(),
  }),
});

/** Everything about a session's latest run, for the dashboard's component pages. */
export const teamSessionDetailRpc = defineRpc({
  name: "team.session.detail",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    leadAgentId: z.string().nullable(),
    pendingBrief: PendingBriefSchema.nullable(),
    run: z.object({
      id: z.string(),
      mode: z.enum(COLLAB_MODES),
      title: z.string(),
      reason: z.string(),
      status: z.enum(["active", "closed"]),
      round: z.number(),
      rounds: z.number(),
      planApproval: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
      brief: BriefSchema.nullable(),
      leadReadSeq: z.number(),
      leadInboxSeq: z.number(),
      members: z.array(z.object({
        role: z.string(),
        agentId: z.string(),
        title: z.string(),
        state: z.enum(["working", "done", "attention", "failed"]),
        task: z.string(),
        result: z.string().nullable(),
        collected: z.boolean(),
        readSeq: z.number(),
        inboxSeq: z.number(),
        retired: z.boolean(),
        dispatchedAt: z.string(),
        /** The member's agent, when it still exists. */
        provider: z.string().nullable(),
        model: z.string().nullable(),
      })),
      tasks: z.array(z.object({
        id: z.string(),
        title: z.string(),
        detail: z.string(),
        role: z.string().nullable(),
        deps: z.array(z.string()),
        waitingOn: z.array(z.string()),
        files: z.array(z.string()),
        state: z.enum(["todo", "doing", "done", "dropped"]),
        owner: z.string().nullable(),
        ownerTitle: z.string().nullable(),
        result: z.string(),
        plan: z.object({ text: z.string(), status: z.enum(["pending", "approved", "rejected"]), feedback: z.string(), notified: z.boolean(), delivered: z.boolean() }).nullable(),
        feedback: z.string(),
        createdBy: z.string(),
        updatedAt: z.string(),
      })),
      posts: z.array(z.object({ seq: z.number(), round: z.number(), author: z.string(), agentId: z.string(), kind: z.string(), text: z.string(), to: z.array(z.string()), files: z.array(z.string()), at: z.string() })),
      claims: z.array(z.object({ role: z.string(), agentId: z.string(), path: z.string(), at: z.string() })),
      events: z.array(RunEventSchema),
      batches: z.array(z.object({ round: z.number(), title: z.string(), reason: z.string(), at: z.string(), taskIds: z.array(z.string()), warnings: z.array(z.string()), followUp: z.boolean(), summary: z.string(), summaryAt: z.string().nullable() })),
    }).nullable(),
  }),
});

/** Switches a lead's session to a collaboration mode, or back to the team file's (`null`). */
export const teamSessionModeRpc = defineRpc({
  name: "team.session.mode",
  input: z.object({ agentId: z.string(), mode: z.enum(TEAM_MODES).nullable() }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({ ok: z.literal(true), effective: z.enum(TEAM_MODES), notified: z.boolean() }),
  ]),
});

/**
 * Starts a new task in a project from a global preset: a new workspace (or one without a team) gets the preset's team,
 * and its orchestrator starts with the request as the first message.
 */
export const teamPresetStartRpc = defineRpc({
  name: "team.preset.start",
  input: z.object({
    projectId: z.string(),
    presetId: z.string(),
    /** A title for a new workspace, or an existing workspace of the project without a team. */
    workspace: z.union([z.object({ title: z.string() }), z.object({ workspaceId: z.string() })]),
    request: z.string().default(""),
    /** Overrides the preset's mode for this team. */
    mode: z.enum(TEAM_MODES).optional(),
    /** The app language, for a preset without its own language. */
    locale: z.string().optional(),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({ ok: z.literal(true), file: z.string(), workspaceId: z.string(), orchestratorAgentId: z.string(), permission: z.string().nullable() }),
  ]),
});

/** The presets saved by this plugin under its former id, `paseo-agent-team`, so they can be imported once. */
export const teamLegacyPresetsRpc = defineRpc({
  name: "team.presets.legacy",
  input: z.object({}),
  output: z.object({ presets: z.array(PresetSchema) }),
});
