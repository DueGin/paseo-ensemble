import { describe, expect, it } from "vitest";
import { centred, stack } from "../client/report/flow-layout";

describe("the data-flow diagram's positions", () => {
  it("stacks a column from its heights, with the gap between items", () => {
    expect(stack(["lead", "a", "b"], { lead: 40, a: 46, b: 46 }, 8)).toEqual({
      boxes: { lead: { top: 0, bottom: 40 }, a: { top: 48, bottom: 94 }, b: { top: 102, bottom: 148 } },
      height: 148,
    });
  });

  it("waits until every item has been measured", () => {
    expect(stack(["lead", "a"], { lead: 40 }, 8)).toBeNull();
    expect(stack([], {}, 8)).toEqual({ boxes: {}, height: 0 });
  });

  it("centres the shorter column against the taller one", () => {
    const parties = stack(["lead", "a"], { lead: 40, a: 40 }, 8)!; // 88 tall
    const parts = stack(["brief", "tasks", "board"], { brief: 80, tasks: 80, board: 80 }, 8)!; // 256 tall
    const { left, right } = centred(parties, parts);
    expect(left.lead).toEqual({ top: 84, bottom: 124 });
    expect(left.a).toEqual({ top: 132, bottom: 172 });
    expect(right.brief).toEqual({ top: 0, bottom: 80 });
  });

  it("follows a part card that shrinks, so the participants' ends move up with their column", () => {
    const parties = stack(["lead"], { lead: 40 }, 8)!;
    const before = centred(parties, stack(["brief", "tasks"], { brief: 160, tasks: 80 }, 8)!);
    const after = centred(parties, stack(["brief", "tasks"], { brief: 80, tasks: 80 }, 8)!);
    // The card lost 80px, so the centred column moved up 40px: an end measured before the change would sit 40px low.
    expect(before.left.lead!.top - after.left.lead!.top).toBe(40);
    // And the card below the one that shrank moved up 80px.
    expect(before.right.tasks!.top - after.right.tasks!.top).toBe(80);
  });

  it("centres both columns in a row stretched taller by the latest flows beside it", () => {
    const { left, right } = centred(stack(["lead"], { lead: 40 }, 8)!, stack(["brief"], { brief: 100 }, 8)!, 300);
    expect(left.lead).toEqual({ top: 130, bottom: 170 });
    expect(right.brief).toEqual({ top: 100, bottom: 200 });
  });
});
