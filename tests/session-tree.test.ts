import { describe, expect, it } from "vitest";
import { buildAgentForest, sessionForest, sessionMembers, sessionRootOf, workspaceForest, type AgentNode, type DashboardAgent } from "../shared/agent-tree";
import { LABEL } from "../shared/cleanup";

const PARENT = "paseo.parent-agent-id";

const agent = (id: string, over: Partial<DashboardAgent> = {}): DashboardAgent => ({
  id,
  workspaceId: "wks_a",
  provider: "claude",
  model: "m",
  title: id,
  status: "idle",
  labels: {},
  archivedAt: null,
  createdAt: "2026-11-12T00:00:00Z",
  ...over,
});
const child = (id: string, parent: string, over: Partial<DashboardAgent> = {}) => agent(id, { ...over, labels: { ...over.labels, [PARENT]: parent } });
const ids = (nodes: AgentNode[]) => nodes.map((node) => node.agent.id);
const all = (nodes: AgentNode[]): string[] => nodes.flatMap((node) => [node.agent.id, ...all(node.children)]);

// Two sessions in workspace A (a team lead with members, and a solo chat), one in workspace B started from A's lead.
const agents = [
  agent("lead", { labels: { [LABEL]: "orchestrator" }, status: "running" }),
  child("api", "lead", { labels: { role: "api", [LABEL]: "member" }, status: "running" }),
  child("ui", "lead", { labels: { role: "ui", [LABEL]: "member" }, status: "running" }),
  child("sub", "ui", { subagent: true, status: "running" }),
  child("far", "lead", { workspaceId: "wks_b", status: "running" }),
  agent("chat"),
  agent("other", { workspaceId: "wks_b" }),
];
const forest = buildAgentForest(agents, ["wks_a", "wks_b"], { showClosed: false });

describe("sessionRootOf", () => {
  it("walks up to the top of the parent chain", () => {
    expect(sessionRootOf(agents, "sub")).toBe("lead");
    expect(sessionRootOf(agents, "lead")).toBe("lead");
    expect(sessionRootOf(agents, "chat")).toBe("chat");
  });

  it("stops at a parent that is not listed, at a cycle, and optionally at another workspace", () => {
    expect(sessionRootOf([child("x", "gone")], "x")).toBe("x");
    expect(sessionRootOf([child("a", "b"), child("b", "a")], "a")).toBe("b");
    expect(sessionRootOf(agents, "far", { sameWorkspace: true })).toBe("far");
    expect(sessionRootOf(agents, "far")).toBe("lead");
    expect(sessionRootOf(agents, "unknown")).toBe("unknown");
  });
});

describe("sessionMembers", () => {
  it("is the root and everything below it, sub-agents and other workspaces included", () => {
    expect([...sessionMembers(agents, "lead")].sort()).toEqual(["api", "far", "lead", "sub", "ui"]);
    expect([...sessionMembers(agents, "chat")]).toEqual(["chat"]);
  });
});

describe("sessionForest", () => {
  it("shows only the session of the agent it was opened from, whichever agent of the session that is", () => {
    for (const from of ["lead", "ui", "sub", "far"]) {
      const session = sessionForest(forest, agents, from);
      expect(ids(session.trees)).toEqual(["lead"]);
      expect(session.solo).toEqual([]);
      expect(all(session.trees).sort()).toEqual(["api", "far", "lead", "sub", "ui"]);
    }
  });

  it("shows a solo chat as its own card", () => {
    const session = sessionForest(forest, agents, "chat");
    expect(session.trees).toEqual([]);
    expect(ids(session.solo)).toEqual(["chat"]);
  });

  it("keeps the shown children of a hidden root", () => {
    const closedLead = agents.map((entry) => (entry.id === "lead" ? { ...entry, status: "closed" } : entry));
    const session = sessionForest(buildAgentForest(closedLead, ["wks_a", "wks_b"], { showClosed: false }), closedLead, "lead");
    expect([...ids(session.trees), ...ids(session.solo)].sort()).toEqual(["api", "far", "ui"]);
    expect(all([...session.trees, ...session.solo])).not.toContain("chat");
  });
});

describe("workspaceForest", () => {
  it("keeps the sessions rooted in the workspace with what they started elsewhere, and drops the others", () => {
    const here = workspaceForest(forest, "wks_a");
    expect(ids(here.trees)).toEqual(["lead"]);
    expect(ids(here.solo)).toEqual(["chat"]);
    expect(all(here.trees)).toContain("far");
    expect(ids(workspaceForest(forest, "wks_b").solo)).toEqual(["other"]);
  });
});
