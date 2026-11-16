import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_PLUGIN_ID, legacyPresets } from "../server/legacy";

describe("presets saved under the old plugin id", () => {
  it("reads them from the host's plugin settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "ensemble-legacy-"));
    await mkdir(join(home, "plugin-settings", LEGACY_PLUGIN_ID), { recursive: true });
    const preset = { id: "p-00000001", name: "常用团队", description: "", mode: "auto", orchestrator: { provider: "claude", model: "claude-opus-5-5" }, candidates: [{ name: "sonnet", provider: "claude", model: "claude-sonnet-5-5", notes: "通用" }], updatedAt: "2026-11-13T07:27:25.248Z" };
    await writeFile(join(home, "plugin-settings", LEGACY_PLUGIN_ID, "presets.json"), JSON.stringify({ version: 1, values: { presets: [preset] } }));
    const { presets } = await legacyPresets(home);
    expect(presets.map((entry) => [entry.name, entry.candidates[0]!.name])).toEqual([["常用团队", "sonnet"]]);
  });

  it("gives no presets when there is no old document, or it is broken", async () => {
    const home = await mkdtemp(join(tmpdir(), "ensemble-legacy-"));
    expect((await legacyPresets(home)).presets).toEqual([]);
    await mkdir(join(home, "plugin-settings", LEGACY_PLUGIN_ID), { recursive: true });
    await writeFile(join(home, "plugin-settings", LEGACY_PLUGIN_ID, "presets.json"), "{not json");
    expect((await legacyPresets(home)).presets).toEqual([]);
  });
});
