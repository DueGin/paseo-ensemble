import { describe, expect, it } from "vitest";
import { addTasks, createRun, type BoardPost, type BoardTask, type Brief, type Run } from "../shared/collab";
import { LEAD_TOOLS, MEMBER_TOOLS, PLUGIN_MESSAGE_PREFIX } from "../shared/modes";
import * as en from "../shared/prompt";
import * as zh from "../shared/prompt-zh";
import type { Team } from "../shared/team";

const team: Team = {
  version: 1,
  goal: "2D platformer game",
  mode: "auto",
  candidates: [
    { name: "opus", provider: "claude", model: "claude-opus-5-5", notes: "Good at: architecture, hard bugs\nSlow and expensive\nDo not give it: routine edits" },
    { name: "sol", provider: "codex", model: "gpt-6.1-sol", notes: "" },
  ],
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [
    { name: "design", provider: "codex", model: "gpt-6.1-sol", folders: ["src/ui", "assets/images"], instructions: "Owns UI and art." },
    { name: "sound", provider: "antigravity", model: "gemini-4-argon-high", folders: [], instructions: "" },
  ],
};

const file = ".agents/teams/orchestrator.json";
const LANGUAGE_RULE = "始终使用简体中文";
const brief: Brief = { title: "Title screen", goal: "Redesign the title screen", requirements: ["New logo"], acceptance: ["Builds", "Logo shows"], constraints: ["No new deps"], outOfScope: [], userConfirmation: "yes" };

/** Share of non-space characters that are CJK ideographs or CJK punctuation. */
function cjkShare(text: string): number {
  const chars = [...text.replace(/\s/g, "")];
  return chars.filter((char) => /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(char)).length / chars.length;
}

function teamRun(planApproval: boolean): { run: Run; task: BoardTask } {
  let run = createRun({ id: "R00BB", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "Login", planApproval, now: "x" });
  run = addTasks(run, [{ title: "Logo", detail: "SVG, 64px", role: "design", files: ["src/ui/logo.svg"] }, { title: "Jingle", role: "sound" }, { title: "Mix", role: "sound", after: ["2"] }], "lead", "x").run;
  const task = { ...run.tasks[0]!, ownerTitle: "design#1A2B", feedback: "too big", plan: { text: "draw it", status: "approved" as const, feedback: "", notified: true, delivered: false } };
  return { run, task };
}

/** Every message function called with the same arguments, for both languages. */
function messages(p: typeof en): Record<string, string> {
  const delegation = createRun({ id: "R00AA", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "Docs", now: "x" });
  const { run, task } = teamRun(false);
  const approval = teamRun(true);
  const rejected = { ...task, id: "T2", title: "Icon", plan: { text: "p", status: "rejected" as const, feedback: "use the palette", notified: true, delivered: false } };
  const post: BoardPost = { seq: 3, at: "x", round: 1, author: "design", agentId: "d", kind: "question", text: "Which sample rate?", to: ["sound"], files: [] };
  const header = p.roleHeader({ name: "api", folders: ["src/api"], instructions: "REST only" });
  return {
    orchestratorPrompt: p.orchestratorPrompt(team, file),
    orchestratorPromptNoCandidates: p.orchestratorPrompt({ ...team, candidates: [], mode: "team" }, file),
    orchestratorReadyPrompt: p.orchestratorReadyPrompt(file),
    teamChangedMessage: p.teamChangedMessage(team, file),
    memberSystemPrompt: p.memberSystemPrompt(team, team.roles[0]!),
    memberSystemPromptNoFolders: p.memberSystemPrompt(team, team.roles[1]!),
    roleHeader: header,
    delegationTaskPrompt: p.delegationTaskPrompt(delegation, "Draw a logo in src/ui/logo.svg"),
    teamKickoffPrompt: p.teamKickoffPrompt(run, brief, team.roles, team.roles[1]!, header),
    teamKickoffPromptApproval: p.teamKickoffPrompt(approval.run, brief, team.roles, team.roles[0]!),
    assignmentPrompt: p.assignmentPrompt(run, task, header),
    assignmentPromptApproval: p.assignmentPrompt(approval.run, approval.task),
    verdictApproved: p.verdictLine(task),
    verdictRejected: p.verdictLine(rejected),
    planReviewedPrompt: p.planReviewedPrompt(run, [task, rejected]),
    teamRoundPrompt: p.teamRoundPrompt({ ...run, round: 2 }, 7),
    mentionPrompt: p.mentionPrompt(run, [post]),
    mentionPromptEmpty: p.mentionPrompt(run, []),
    broadcastPrompt: p.broadcastPrompt(run, "Use 44.1 kHz"),
    leadNoticeTeam: p.leadNoticePrompt(run),
    leadNoticeDelegation: p.leadNoticePrompt(delegation),
    planWaitingPrompt: p.planWaitingPrompt(approval.run, approval.task),
    modeChangedPrompt: p.modeChangedPrompt("team", "auto"),
    modeChangedPromptCleared: p.modeChangedPrompt(null, "delegation"),
  };
}

const english = messages(en);
const chinese = messages(zh);

describe("prompt-zh", () => {
  it("exports the same functions as prompt.ts", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("renders the lead's instructions in Chinese, with every tool, the language rule and the candidates", () => {
    const prompt = chinese.orchestratorPrompt!;
    for (const tool of Object.values(LEAD_TOOLS)) expect(prompt).toContain(tool);
    expect(prompt).toContain(LANGUAGE_RULE);
    expect(prompt).toContain("- opus (claude/claude-opus-5-5)\n  Good at: architecture, hard bugs\n  Slow and expensive\n  Do not give it: routine edits");
    expect(prompt).toContain("- sol (codex/gpt-6.1-sol)\n  （无描述：通用成员，按它所用模型的能力分配工作）");
    expect(prompt).toContain("| design | codex/gpt-6.1-sol | src/ui, assets/images |");
    expect(prompt).toContain("2D platformer game");
    expect(prompt).toContain(file);
    expect(prompt).toContain("MA-04");
    expect(prompt).toContain("MA-08");
    expect(prompt).toContain("userConfirmation");
    expect(prompt).toContain("planApproval");
    expect(prompt).toContain("auto（自动）");
    expect(chinese.orchestratorPromptNoCandidates).toContain("`helper`");
    expect(prompt).not.toContain("`helper`");
    expect(cjkShare(prompt)).toBeGreaterThanOrEqual(0.3);
  });

  it("starts with the plugin's prefix wherever the English message does", () => {
    for (const [name, text] of Object.entries(english)) {
      expect(chinese[name]!.startsWith(PLUGIN_MESSAGE_PREFIX), name).toBe(text.startsWith(PLUGIN_MESSAGE_PREFIX));
    }
  });

  it("keeps every tool name and action value the English message has", () => {
    const tokens = [...Object.values(LEAD_TOOLS), ...Object.values(MEMBER_TOOLS)].sort((a, b) => b.length - a.length);
    for (const [name, text] of Object.entries(english)) {
      for (const tool of tokens) if (text.split(/[^a-z_]/).includes(tool)) expect(chinese[name], `${name}: ${tool}`).toContain(tool);
      for (const value of text.match(/"(claim|done|release|add|plan|reject|answer|lead|all)"/g) ?? []) expect(chinese[name], `${name}: ${value}`).toContain(value);
    }
  });

  it("is mostly Chinese and has no doubled blank lines", () => {
    for (const [name, text] of Object.entries(chinese)) {
      if (!/\n\n\n/.test(english[name]!)) expect(text, name).not.toMatch(/\n\n\n/);
      if (name !== "roleHeader" && name !== "verdictRejected" && name !== "mentionPromptEmpty") expect(cjkShare(text), name).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("gives a member its tools and the language rule", () => {
    const prompt = chinese.memberSystemPrompt!;
    for (const tool of Object.values(MEMBER_TOOLS)) expect(prompt).toContain(tool);
    expect(prompt).toContain(LANGUAGE_RULE);
    expect(prompt).toContain("「design」");
    expect(prompt).toContain("src/ui, assets/images");
    expect(prompt).toContain("Owns UI and art.");
    expect(chinese.memberSystemPromptNoFolders).toContain("没有文件夹限制");
  });

  it("asks for Chinese replies in the messages the agents answer", () => {
    for (const name of ["orchestratorReadyPrompt", "leadNoticeTeam", "leadNoticeDelegation", "delegationTaskPrompt", "teamKickoffPrompt"]) expect(chinese[name], name).toContain("简体中文");
  });

  it("renders the brief, the task board and the inbox in Chinese", () => {
    expect(chinese.teamKickoffPrompt).toContain("验收标准：\n- Builds\n- Logo shows");
    expect(chinese.teamKickoffPrompt).toContain("- T3 [待办，等待 T2] (sound) Mix");
    expect(chinese.teamKickoffPrompt).toContain("你是「sound」。你在本会话中的角色：api。");
    expect(chinese.teamKickoffPrompt).toContain("第 1/2 轮");
    expect(chinese.teamKickoffPromptApproval).toContain('action "plan"');
    expect(chinese.teamKickoffPrompt).not.toContain('action "plan"');
    expect(chinese.mentionPrompt).toContain("📬 你有 1 条新消息：");
    expect(chinese.mentionPrompt).toContain("#3 [第 1 轮] design · question → sound");
    expect(chinese.teamRoundPrompt).toContain("since 7");
    expect(chinese.assignmentPrompt).toContain("T1：Logo\nSVG, 64px\n文件：src/ui/logo.svg\n之前被打回的原因：too big");
    expect(chinese.verdictRejected).toContain("use the palette。");
    expect(chinese.modeChangedPromptCleared).toContain("delegation（团队文件中的模式）");
    expect(chinese.roleHeader).toBe("你在本会话中的角色：api。角色说明：REST only。你的文件夹：src/api。");
  });
});
