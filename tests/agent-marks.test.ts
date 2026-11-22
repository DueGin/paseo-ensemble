import { findSvgIconProblem } from "@getpaseo/plugin";
import { describe, expect, it } from "vitest";
import { clientMark, hasIds, modelMark, modelVendor, withIdSuffix } from "../shared/agent-marks";
import { BRAND_SVGS, CLIENT_MARKS, MODEL_MARKS } from "../shared/brand-icons";

describe("the bundled marks", () => {
  it.each(Object.keys(BRAND_SVGS))("%s is an SVG Paseo will draw", (name) => {
    expect(findSvgIconProblem(BRAND_SVGS[name]!)).toBeNull();
    expect(BRAND_SVGS[name]).toContain("viewBox");
    expect(BRAND_SVGS[name]).not.toMatch(/https?:|<title/);
  });

  it("cover every client and vendor they name", () => {
    for (const name of [...Object.values(CLIENT_MARKS), ...Object.values(MODEL_MARKS)]) expect(BRAND_SVGS[name]).toBeDefined();
  });
});

describe("an agent's client mark", () => {
  it("is the client's own mark, so Claude Code differs from the Claude model", () => {
    expect(clientMark("claude", "<svg>snapshot</svg>")).toEqual({ kind: "svg", svg: BRAND_SVGS["claudecode-color"] });
    expect(clientMark("codex")).toEqual({ kind: "svg", svg: BRAND_SVGS["codex-color"] });
    expect(clientMark("opencode")).toEqual({ kind: "svg", svg: BRAND_SVGS.opencode });
  });

  it("falls back to the provider snapshot's icon, then the initial", () => {
    expect(clientMark("antigravity", "<svg>snapshot</svg>")).toEqual({ kind: "svg", svg: "<svg>snapshot</svg>" });
    expect(clientMark("antigravity")).toEqual({ kind: "letter", letter: "A" });
    expect(clientMark("omp", "")).toEqual({ kind: "letter", letter: "O" });
  });
});

describe("a model's vendor", () => {
  it.each([
    ["claude-opus-5-5", "anthropic"],
    ["sonnet", "anthropic"],
    ["claude-fable-5-1", "anthropic"],
    ["gpt-5.5-codex", "openai"],
    ["o4-mini", "openai"],
    ["group/auto-gpt-sol", "openai"],
    ["gemini-2.5-pro", "gemini"],
    ["gemma-3-27b", "gemma"],
    ["deepseek/deepseek-v4-flash", "deepseek"],
    ["openrouter/qwen/qwen3-coder", "qwen"],
    ["kimi-k2", "kimi"],
    ["glm-5", "zhipu"],
    ["MiniMax-M2", "minimax"],
    ["x-ai/grok-4", "xai"],
    ["devstral-medium", "mistral"],
    ["llama-4-maverick", "meta"],
    ["doubao-seed-1.6", "doubao"],
  ])("of %s is %s", (model, vendor) => {
    expect(modelVendor(model)).toBe(vendor);
  });

  it("comes from the client when the model id names none", () => {
    expect(modelVendor("default", "claude")).toBe("anthropic");
    expect(modelVendor("", "codex")).toBe("openai");
    expect(modelVendor("default", "opencode")).toBeNull();
  });

  it("gives the model's initial when unknown, and nothing without a model", () => {
    expect(modelMark("anthropic/claude-haiku-5-5")).toEqual({ kind: "svg", svg: BRAND_SVGS["claude-color"] });
    expect(modelMark("custom/zeta-7b")).toEqual({ kind: "letter", letter: "Z" });
    expect(modelMark(null)).toBeNull();
    expect(modelMark("", "pi")).toBeNull();
  });
});

describe("each copy of a gradient mark has ids of its own", () => {
  const idsOf = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
  const refsOf = (svg: string) => [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((match) => (match[1] ?? match[2])!);
  const withIds = Object.keys(BRAND_SVGS).filter((name) => hasIds(BRAND_SVGS[name]!));

  it("knows which marks define ids (Codex among them)", () => {
    expect(withIds).toContain("codex-color");
    expect(hasIds(BRAND_SVGS["claudecode-color"]!)).toBe(false);
  });

  it.each(withIds)("%s: every id is renamed, every reference follows it, and two copies share none", (name) => {
    const svg = BRAND_SVGS[name]!;
    const one = withIdSuffix(svg, "-e0");
    const two = withIdSuffix(svg, "-e1");
    expect(idsOf(one)).toEqual(idsOf(svg).map((id) => `${id}-e0`));
    for (const ref of refsOf(one)) expect(idsOf(one)).toContain(ref);
    expect(refsOf(one).length).toBe(refsOf(svg).length);
    expect(idsOf(one).filter((id) => idsOf(two).includes(id))).toEqual([]);
    expect(one.replace(/-e0/g, "")).toBe(svg);
    expect(findSvgIconProblem(one)).toBeNull();
  });

  it("leaves an SVG without ids, and references to ids it doesn't define, as they are", () => {
    const plain = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="currentColor"/></svg>';
    expect(withIdSuffix(plain, "-e3")).toBe(plain);
    const mixed = '<svg viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><path fill="url(#g)"/><use href="#g"/><path fill="url(#other)"/></svg>';
    expect(withIdSuffix(mixed, "-e3")).toBe('<svg viewBox="0 0 24 24"><defs><linearGradient id="g-e3"/></defs><path fill="url(#g-e3)"/><use href="#g-e3"/><path fill="url(#other)"/></svg>');
  });
});
