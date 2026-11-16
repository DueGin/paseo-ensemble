import { describe, expect, it } from "vitest";
import {
  addPost, boardText, claimPaths, confirmsBrief, createRun, finishMember, markCollected, memberOf, nextStep, normalizePath, pathsOverlap,
  releaseClaims, roundComplete, runSummary, startBatch, startRound, upsertMember, conversationFrom, wakeMembers, boardPage, newRunId, timelineEnd, type Run,
} from "../shared/collab";
import { PLUGIN_MESSAGE_PREFIX } from "../shared/modes";
import { allowsMode, effectiveMode } from "../shared/modes";

const T = "2026-11-12T00:00:00.000Z";

function teamRun(rounds = 2): Run {
  let run = createRun({ id: "R1234", leadAgentId: "lead", workspaceId: "w", mode: "team", title: "Login", rounds, now: T });
  run = upsertMember(run, { role: "api", agentId: "a1", title: "api#0001", task: "" }, T);
  run = upsertMember(run, { role: "ui", agentId: "a2", title: "ui#0002", task: "" }, T);
  return run;
}

describe("modes", () => {
  it("uses the session's override over the team file's mode", () => {
    expect(effectiveMode("auto", null)).toBe("auto");
    expect(effectiveMode("auto", "team")).toBe("team");
  });

  it("lets auto start either run, and a fixed mode only its own", () => {
    expect(allowsMode("auto", "team") && allowsMode("auto", "delegation")).toBe(true);
    expect(allowsMode("team", "delegation")).toBe(false);
    expect(allowsMode("delegation", "team")).toBe(false);
  });
});

describe("createRun", () => {
  it("clamps team rounds to 1..3 and keeps delegation at one batch", () => {
    expect(createRun({ id: "R", leadAgentId: "l", workspaceId: "w", mode: "team", title: "t", rounds: 9, now: T }).rounds).toBe(3);
    expect(createRun({ id: "R", leadAgentId: "l", workspaceId: "w", mode: "team", title: "t", rounds: 0, now: T }).rounds).toBe(1);
    expect(createRun({ id: "R", leadAgentId: "l", workspaceId: "w", mode: "team", title: "t", now: T }).rounds).toBe(2);
    expect(createRun({ id: "R", leadAgentId: "l", workspaceId: "w", mode: "delegation", title: "t", rounds: 3, now: T }).rounds).toBe(1);
  });
});

describe("team run", () => {
  it("starts the review round once every member finished round 1, then tells the lead after the last round", () => {
    let run = teamRun();
    expect(nextStep(run)).toEqual({ kind: "none" });
    run = finishMember(run, "a1", "completed", "api done", T);
    expect(nextStep(run)).toEqual({ kind: "none" });
    run = finishMember(run, "a2", "completed", "ui done", T);
    expect(nextStep(run)).toEqual({ kind: "next-round", round: 2 });
    run = startRound(run, T);
    expect(run.round).toBe(2);
    expect(run.members.every((member) => member.state === "working")).toBe(true);
    run = finishMember(finishMember(run, "a1", "completed", "ok", T), "a2", "completed", "ok", T);
    expect(nextStep(run)).toEqual({ kind: "notify-lead" });
    run = { ...run, notifiedRound: 2 };
    expect(nextStep(run)).toEqual({ kind: "none" });
  });

  it("puts a member's final reply on the board when it posted no done itself, once per round", () => {
    let run = teamRun();
    run = addPost(run, { author: "api", agentId: "a1", kind: "done", text: "changed api.ts", to: [], files: [] }, T).run;
    run = finishMember(run, "a1", "completed", "final words", T);
    run = finishMember(run, "a2", "completed", "ui final reply", T);
    expect(run.posts.map((post) => [post.author, post.kind, post.text])).toEqual([
      ["api", "done", "changed api.ts"],
      ["ui", "done", "ui final reply"],
    ]);
  });

  it("tells the lead when every member failed instead of starting another round", () => {
    let run = teamRun();
    run = finishMember(finishMember(run, "a1", "failed", "boom", T), "a2", "failed", "boom", T);
    expect(nextStep(run)).toEqual({ kind: "notify-lead" });
  });

  it("numbers posts and stamps the round", () => {
    let run = teamRun();
    run = addPost(run, { author: "lead", agentId: "lead", kind: "brief", text: "# Brief", to: [], files: [] }, T).run;
    const { run: next, post } = addPost(run, { author: "ui", agentId: "a2", kind: "question", text: "  Which route?  ", to: ["api"], files: ["src/routes.ts"] }, T);
    expect(post).toMatchObject({ seq: 2, round: 1, text: "Which route?", to: ["api"] });
    expect(boardText(next)).toContain("#2 [round 1] ui · question → api");
    expect(boardText(next, 1)).not.toContain("# Brief");
    expect(boardText(next, 2)).toBe("No new posts since #2.");
  });

  it("wakes members for a lead message; after the run finished it opens another round", () => {
    let run = teamRun(1);
    run = finishMember(finishMember(run, "a1", "completed", "x", T), "a2", "completed", "y", T);
    run = markCollected({ ...run, notifiedRound: 1 }, T);
    run = wakeMembers(run, ["a2"], T);
    expect(run.round).toBe(2);
    expect(run.rounds).toBe(2);
    expect(memberOf(run, "a2")?.state).toBe("working");
    expect(memberOf(run, "a1")?.state).toBe("done");
    run = finishMember(run, "a2", "completed", "fixed", T);
    expect(nextStep(run)).toEqual({ kind: "notify-lead" });
  });
});

describe("delegation run", () => {
  it("tells the lead once every member finished a batch, and again after the next batch", () => {
    let run = createRun({ id: "R0001", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "Docs", now: T });
    run = upsertMember(run, { role: "docs", agentId: "d1", title: "docs#0001", task: "Write README" }, T);
    run = finishMember(run, "d1", "completed", "README written", T);
    expect(memberOf(run, "d1")?.result).toBe("README written");
    expect(run.posts).toEqual([]);
    expect(nextStep(run)).toEqual({ kind: "notify-lead" });
    run = markCollected({ ...run, notifiedRound: 1 }, T);
    expect(nextStep(run)).toEqual({ kind: "none" });
    run = startBatch(run, T);
    expect(run.round).toBe(2);
    run = upsertMember(run, { role: "docs", agentId: "d1", title: "docs#0001", task: "Fix typo" }, T);
    expect(roundComplete(run)).toBe(false);
    run = finishMember(run, "d1", "completed", "fixed", T);
    expect(nextStep(run)).toEqual({ kind: "notify-lead" });
  });

  it("does not start a new batch while members still work", () => {
    let run = createRun({ id: "R0002", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "t", now: T });
    run = upsertMember(run, { role: "a", agentId: "x", title: "a#1", task: "t" }, T);
    expect(startBatch(run, T).round).toBe(1);
  });

  it("summarises members and their tasks", () => {
    let run = createRun({ id: "R0003", leadAgentId: "lead", workspaceId: "w", mode: "delegation", title: "t", now: T });
    run = upsertMember(run, { role: "docs", agentId: "d1", title: "docs#0001", task: "Write README" }, T);
    expect(runSummary(run)).toContain("Run R0003 (delegation mode, MA-04) \"t\" · in progress · batch 1");
    expect(runSummary(finishMember(run, "d1", "completed", "ok", T))).toContain("· finished ·");
    expect(runSummary(run)).toContain("- docs#0001 (docs): working · task: Write README");
  });
});

describe("claims", () => {
  it("normalizes paths and finds overlaps", () => {
    expect(normalizePath("./src/ui/")).toBe("src/ui");
    expect(normalizePath(".")).toBe("");
    expect(pathsOverlap("src/ui", "src/ui/button.tsx")).toBe(true);
    expect(pathsOverlap("src/ui", "src/uikit")).toBe(false);
    expect(pathsOverlap(".", "anything")).toBe(true);
  });

  it("refuses a path another working member holds, and frees it once that member is done", () => {
    let run = teamRun();
    run = claimPaths(run, "a1", ["src/api"], T).run;
    const blocked = claimPaths(run, "a2", ["src/api/routes.ts", "src/ui"], T);
    expect(blocked.conflicts).toEqual([{ path: "src/api/routes.ts", heldBy: "api", held: "src/api" }]);
    expect(blocked.run.claims).toHaveLength(1);
    run = addPost(run, { author: "api", agentId: "a1", kind: "done", text: "done", to: [], files: [] }, T).run;
    expect(run.claims).toEqual([]);
    expect(claimPaths(run, "a2", ["src/api/routes.ts"], T).conflicts).toEqual([]);
  });

  it("releases only the given paths", () => {
    let run = teamRun();
    run = claimPaths(run, "a1", ["a", "b"], T).run;
    expect(releaseClaims(run, "a1", ["a"]).claims.map((claim) => claim.path)).toEqual(["b"]);
  });
});

describe("intake confirmation", () => {
  let seq = 0;
  const user = (text: string) => ({ role: "user" as const, text, seq: ++seq });
  const lead = (text: string) => ({ role: "assistant" as const, text, seq: ++seq });
  const before = [lead("Ready."), user("Build a login page and start the team"), lead("Questions: OAuth? Which fields?"), user("Email + password, no OAuth")];
  const recordedAt = ++seq; // team_brief records the end of the chat here
  const conversation = [...before, lead("Brief: ... Confirm?"), user("Looks good, go ahead!")];

  it("accepts the user's reply after the brief was recorded, ignoring case, spacing and quotes", () => {
    expect(confirmsBrief(conversation, recordedAt, "looks good,  go ahead")).toBe(true);
    expect(confirmsBrief(conversation, recordedAt, "“Looks good, go ahead!”")).toBe(true);
  });

  it("rejects the request and anything else said before the brief, even right after the lead's greeting", () => {
    expect(confirmsBrief(conversation, recordedAt, "Build a login page and start the team")).toBe(false);
    expect(confirmsBrief(conversation, recordedAt, "Email + password, no OAuth")).toBe(false);
    expect(confirmsBrief([lead("Ready."), user("Build a login page and start the team")], 0, "start the team")).toBe(false);
  });

  it("rejects words never written, empty quotes and a word picked out of a long correction", () => {
    expect(confirmsBrief(conversation, recordedAt, "yes, start")).toBe(false);
    expect(confirmsBrief(conversation, recordedAt, "  ")).toBe(false);
    const corrected = [...before, lead("Brief"), user("No, the login page must also support SSO and remember-me, please revise")];
    expect(confirmsBrief(corrected, recordedAt, "please")).toBe(false);
  });

  it("accepts a short confirmation in full, such as ok", () => {
    expect(confirmsBrief([...before, lead("Brief"), user("ok")], recordedAt, "ok")).toBe(true);
    expect(confirmsBrief([...before, lead("Brief"), user("确认，开始吧")], recordedAt, "确认，开始吧")).toBe(true);
  });

  it("ignores the plugin's own messages to the lead", () => {
    const withNotice = [...before, lead("Brief"), user(`${PLUGIN_MESSAGE_PREFIX} Team run R1 finished`)];
    expect(confirmsBrief(withNotice, recordedAt, "Team run R1 finished")).toBe(false);
  });

  it("reads the conversation from a timeline page in sequence order, and the end of the page", () => {
    const entries = [
      { item: { type: "assistant_message", text: "hello" }, seqStart: 2, seqEnd: 3, timestamp: T },
      { item: { type: "user_message", text: "hi" }, seqStart: 1, seqEnd: 1, timestamp: T },
      { item: { type: "tool_call" }, seqStart: 4, seqEnd: 6, timestamp: T },
      null,
      { item: { type: "user_message", text: "go" }, seqStart: 7, seqEnd: 7, timestamp: T },
    ];
    expect(conversationFrom(entries)).toEqual([{ role: "user", text: "hi", seq: 1 }, { role: "assistant", text: "hello", seq: 2 }, { role: "user", text: "go", seq: 7 }]);
    expect(timelineEnd(entries)).toBe(7);
    expect(timelineEnd([])).toBe(0);
  });
});

describe("board pages", () => {
  it("stops within the budget and reports the last post shown, so read markers never skip posts", () => {
    let run = teamRun();
    for (let index = 0; index < 5; index += 1) run = addPost(run, { author: "api", agentId: "a1", kind: "update", text: "x".repeat(100), to: [], files: [] }, T).run;
    const page = boardPage(run, 0, 300);
    expect(page.lastSeq).toBe(2);
    expect(page.more).toBe(true);
    expect(page.text).toContain("read again with since 2");
    const rest = boardPage(run, page.lastSeq, Infinity);
    expect(rest).toMatchObject({ lastSeq: 5, more: false });
    expect(boardPage(run, 5, 300)).toEqual({ text: "No new posts since #5.", lastSeq: 5, more: false });
  });

  it("always shows at least one post", () => {
    const run = addPost(teamRun(), { author: "api", agentId: "a1", kind: "update", text: "y".repeat(1000), to: [], files: [] }, T).run;
    expect(boardPage(run, 0, 10).lastSeq).toBe(1);
  });

  it("moves the lead's marker only as far as given", () => {
    let run = teamRun();
    for (let index = 0; index < 3; index += 1) run = addPost(run, { author: "api", agentId: "a1", kind: "update", text: "t", to: [], files: [] }, T).run;
    expect(markCollected(run, T, 2).leadReadSeq).toBe(2);
    expect(markCollected(run, T).leadReadSeq).toBe(3);
  });
});

describe("run ids", () => {
  it("have 8 hex digits", () => {
    expect(newRunId(() => 0.5)).toBe("R80000000");
    expect(newRunId()).toMatch(/^R[0-9A-F]{8}$/);
  });
});
