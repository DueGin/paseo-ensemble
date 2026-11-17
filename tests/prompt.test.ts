import { describe, expect, it } from "vitest";
import { addTasks, createRun, type Brief } from "../shared/collab";
import { ALL_TOOLS, LEAD_TOOLS, MEMBER_TOOLS, PLUGIN_MESSAGE_PREFIX } from "../shared/modes";
import { assignmentPrompt, broadcastPrompt, delegationTaskPrompt, leadNoticePrompt, memberSystemPrompt, mentionPrompt, modeChangedPrompt, orchestratorPrompt, orchestratorReadyPrompt, planReviewedPrompt, roleHeader, teamChangedMessage, teamKickoffPrompt, teamRoundPrompt } from "../shared/prompt";
import type { Team } from "../shared/team";

const team: Team = {
  version: 1,
  goal: "2D platformer game",
  mode: "auto",
  candidates: [],
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [
    { name: "design", provider: "codex", model: "gpt-6.1-sol", folders: ["src/ui", "assets/images"], instructions: "Owns UI and art." },
    { name: "sound", provider: "antigravity", model: "gemini-4-argon-high", folders: [], instructions: "" },
  ],
};

const file = ".agents/teams/orchestrator.json";

describe("orchestratorPrompt", () => {
  const prompt = orchestratorPrompt(team, file);

  it("states the goal and the team's own file, and ignores other teams", () => {
    expect(prompt).toContain("2D platformer game");
    expect(prompt).toContain(`The team is defined in ${file} at the project root.`);
    expect(prompt).toMatch(/other teams/i);
  });

  it("lists every role with its provider/model and folders, and its notes", () => {
    expect(prompt).toContain("| Role | Provider/model | Folders |");
    expect(prompt).toContain("| design | codex/gpt-6.1-sol | src/ui, assets/images |");
    expect(prompt).toContain("| sound | antigravity/gemini-4-argon-high | (any) |");
    expect(prompt).toContain("- design: Owns UI and art.");
    expect(prompt).toContain('Every member runs in your workspace "orchestrator"');
  });

  it("names the configured mode and tells it to check the session's current mode first", () => {
    expect(prompt).toContain("Configured mode: auto");
    expect(prompt).toContain(`call ${LEAD_TOOLS.status}`);
    expect(prompt).toMatch(/user can switch it/);
    expect(orchestratorPrompt({ ...team, mode: "team" }, file)).toContain("Configured mode: team");
    expect(orchestratorPrompt({ ...team, mode: "delegation" }, file)).toContain("Configured mode: delegation");
  });

  it("describes delegation: self-contained tasks, isolated members, wait and report", () => {
    expect(prompt).toContain("## Delegation mode (MA-04)");
    expect(prompt).toContain(LEAD_TOOLS.delegate);
    expect(prompt).toMatch(/sees only its own task/);
    expect(prompt).toContain(LEAD_TOOLS.wait);
    expect(prompt).toContain("`helper`");
  });

  it("describes team mode as intake first: no member sees the request before the user confirms a brief", () => {
    expect(prompt).toContain("## Team mode (MA-08)");
    expect(prompt).toMatch(/liaison/);
    expect(prompt).toMatch(/Never pass the user's message on as it is/);
    expect(prompt).toMatch(/Intake:.*ask/s);
    expect(prompt).toMatch(/do not start members/);
    expect(prompt).toMatch(/Record it all with team_brief, show the brief and the tasks to the user, ask them to confirm or correct, and end your turn/);
    expect(prompt).toMatch(/Only after the user replies to confirm it, call team_kickoff/);
    expect(prompt).toContain("userConfirmation");
    expect(prompt).toContain(LEAD_TOOLS.board);
    expect(prompt).toMatch(/break the work into tasks/);
    expect(prompt).toContain(LEAD_TOOLS.tasks);
    expect(prompt).toContain(LEAD_TOOLS.close);
    expect(prompt).toMatch(/hands open tasks to idle members/);
  });

  it("lists candidate members with their full descriptions, and has work assigned by them", () => {
    expect(prompt).not.toContain("Candidate members");
    const preset = orchestratorPrompt({ ...team, roles: [], candidates: [
      { name: "opus", provider: "claude", model: "claude-opus-5-5", notes: "Good at: architecture, hard bugs\nSlow and expensive\nDo not give it: routine edits" },
      { name: "sol", provider: "codex", model: "gpt-6.1-sol", notes: "" },
    ] }, file);
    expect(preset).toContain("No fixed roles: assign work to the candidate members below, by their descriptions.");
    expect(preset).toContain("- opus (claude/claude-opus-5-5)\n  Good at: architecture, hard bugs\n  Slow and expensive\n  Do not give it: routine edits");
    expect(preset).toContain("- sol (codex/gpt-6.1-sol)\n  (no description: a general member; give it work its model suits)");
    expect(preset).toMatch(/A candidate is a model, not a job/);
    expect(preset).toMatch(/must not do, or is not suited for, as a hard rule: never give it that work/);
    expect(preset).toMatch(/give work straight to a candidate by its name/);
    expect(preset).toContain(LEAD_TOOLS.role);
    expect(preset).not.toContain("`helper`");
  });

  it("forbids starting members any other way and says what to do without the tools", () => {
    expect(prompt).toMatch(/Never start them with paseo run, create_agent/);
    expect(prompt).toMatch(/team_\* tools are missing.*stop/s);
    expect(prompt).not.toContain("paseo run --workspace");
  });

  it("has no doubled blank lines", () => {
    expect(prompt).not.toMatch(/\n\n\n/);
  });
});

describe("lead messages", () => {
  it("marks every message the plugin sends, so intake checks can skip them", () => {
    const run = createRun({ id: "R0001", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", now: "2026-11-12T00:00:00Z" });
    for (const text of [orchestratorReadyPrompt(file), teamChangedMessage(team, file), leadNoticePrompt(run), modeChangedPrompt("team", "auto"), delegationTaskPrompt(run, "x"), teamRoundPrompt(run, 0), broadcastPrompt(run, "x"), mentionPrompt(run, [])]) {
      expect(text.startsWith(PLUGIN_MESSAGE_PREFIX)).toBe(true);
    }
  });

  it("tells a re-applied lead to re-read the team and use the team tools", () => {
    const message = teamChangedMessage({ ...team, mode: "team" }, file);
    expect(message).toContain(`The team in ${file} changed. Re-read it`);
    expect(message).toContain("Configured collaboration mode: team");
    expect(message).toContain(LEAD_TOOLS.kickoff);
    expect(message).toContain("| design | codex/gpt-6.1-sol | src/ui, assets/images |");
  });

  it("tells an idle lead what to do when a run finished", () => {
    const team2 = createRun({ id: "R0002", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "Login", now: "x" });
    expect(leadNoticePrompt(team2)).toMatch(/acceptance criteria/);
    const delegation = createRun({ id: "R0003", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "Docs", now: "x" });
    expect(leadNoticePrompt(delegation)).toContain(LEAD_TOOLS.wait);
  });

  it("says the session's mode when the user switches it, or the file's when cleared", () => {
    expect(modeChangedPrompt("team", "auto")).toContain("collaboration mode to team");
    expect(modeChangedPrompt(null, "delegation")).toContain("to delegation (the team file's mode)");
  });
});

describe("member prompts", () => {
  const brief: Brief = { title: "Title screen", goal: "Redesign the title screen", requirements: ["New logo"], acceptance: ["Builds", "Logo shows"], constraints: ["No new deps"], outOfScope: [], userConfirmation: "yes" };

  it("repeats a formed role's notes in task messages", () => {
    expect(roleHeader({ name: "api", folders: ["src/api"], instructions: "REST only" })).toBe("Your role in this session: api. Role notes: REST only Your folders: src/api.");
  });

  it("gives a member its role, folders and notes, and explains both kinds of run", () => {
    const prompt = memberSystemPrompt(team, team.roles[0]!);
    expect(prompt).toContain('"design" member');
    expect(prompt).toContain("Your folders: src/ui, assets/images");
    expect(prompt).toContain("Owns UI and art.");
    for (const tool of Object.values(MEMBER_TOOLS)) expect(prompt).toContain(tool);
    expect(memberSystemPrompt(team, team.roles[1]!)).toMatch(/no folder limit/);
  });

  it("keeps a delegated task isolated", () => {
    const run = createRun({ id: "R00AA", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "t", now: "x" });
    const prompt = delegationTaskPrompt(run, "Draw a logo in src/ui/logo.svg");
    expect(prompt).toContain("Draw a logo in src/ui/logo.svg");
    expect(prompt).toMatch(/don't see the other members' tasks/);
    expect(prompt).toMatch(/only the lead reads your result/);
  });

  it("hands a team member the agreed brief, the task board, the other members and the board protocol", () => {
    let run = createRun({ id: "R00BB", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", now: "x" });
    run = addTasks(run, [{ title: "Logo", role: "design" }, { title: "Jingle", role: "sound" }, { title: "Mix", role: "sound", after: ["2"] }], "lead", "x").run;
    const prompt = teamKickoffPrompt(run, brief, team.roles, team.roles[1]!);
    expect(prompt).toContain("# Title screen");
    expect(prompt).toContain("Acceptance criteria:\n- Builds\n- Logo shows");
    expect(prompt).toContain("- design: folders src/ui, assets/images · Owns UI and art.");
    expect(prompt).toContain('You are "sound".');
    expect(prompt).toContain("- T3 [todo, waits for T2] (sound) Mix");
    expect(prompt).toContain("Ready for you now: T2.");
    expect(prompt).toContain(MEMBER_TOOLS.task);
    expect(prompt).toContain(MEMBER_TOOLS.claim);
    expect(prompt).toMatch(/action "claim"/);
    expect(prompt).not.toMatch(/plan approval/);
    expect(prompt).toContain("round 1 of 2");
  });

  it("tells members to submit plans first when the run needs plan approval", () => {
    const run = createRun({ id: "R00BC", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", planApproval: true, now: "x" });
    expect(teamKickoffPrompt(run, brief, team.roles, team.roles[0]!)).toMatch(/plan approval: after claiming a task, submit your plan/);
  });

  it("hands an idle member a task, and tells it the lead's verdict on its plan", () => {
    let run = createRun({ id: "R00BD", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", now: "x" });
    run = addTasks(run, [{ title: "Logo", detail: "SVG, 64px", role: "design", files: ["src/ui/logo.svg"] }], "lead", "x").run;
    const task = { ...run.tasks[0]!, feedback: "too big" };
    const assigned = assignmentPrompt(run, task, "Your role in this session: design.");
    expect(assigned).toContain("T1: Logo\nSVG, 64px\nFiles: src/ui/logo.svg\nSent back before: too big");
    expect(assigned).toContain("Your role in this session: design.");
    expect(assigned).toMatch(/mark it done/);
    const verdicts = planReviewedPrompt(run, [
      { ...task, plan: { text: "p", status: "approved", feedback: "", notified: true, delivered: false } },
      { ...task, id: "T2", title: "Icon", plan: { text: "p", status: "rejected", feedback: "use the palette", notified: true, delivered: false } },
    ]);
    expect(verdicts).toContain('approved your plan for T1 "Logo".');
    expect(verdicts).toContain('sent back your plan for T2 "Icon": use the palette');
  });

  it("asks for a review of the others' done tasks in the next round, from where the member last read", () => {
    const run = { ...createRun({ id: "R00CC", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", now: "x" }), round: 2 };
    const prompt = teamRoundPrompt(run, 7);
    expect(prompt).toContain("round 2 of 2: review");
    expect(prompt).toContain("since 7");
    expect(prompt).toMatch(/action "reject"/);
  });

  it("wakes a member with every message addressed to it", () => {
    const run = createRun({ id: "R00DD", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "t", now: "x" });
    const post = (seq: number, text: string) => ({ seq, at: "x", round: 1, author: "design", agentId: "d", kind: "question" as const, text, to: ["sound"], files: [] });
    const prompt = mentionPrompt(run, [post(3, "Which sample rate?"), post(4, "Stereo?")]);
    expect(prompt).toContain("📬 2 new messages for you:");
    expect(prompt).toContain("#3 [round 1] design · question → sound");
    expect(prompt).toContain("Stereo?");
  });
});

describe("tool names", () => {
  it("are valid Paseo agent tool names and unique", () => {
    for (const name of ALL_TOOLS) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(new Set(ALL_TOOLS).size).toBe(ALL_TOOLS.length);
  });
});
