// Presets saved before the plugin was renamed from `paseo-agent-team` to `paseo-ensemble`. Host settings are stored
// per plugin id, so the old document stays behind; the presets screen offers to import it once.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PresetSchema, type Preset } from "../shared/presets";

export const LEGACY_PLUGIN_ID = "paseo-agent-team";

/** The old presets document of this host, or no presets when there is none or it can't be read. */
export async function legacyPresets(home = process.env.PASEO_HOME || join(homedir(), ".paseo")): Promise<{ presets: Preset[] }> {
  try {
    const raw = JSON.parse(await readFile(join(home, "plugin-settings", LEGACY_PLUGIN_ID, "presets.json"), "utf8")) as { values?: unknown };
    const parsed = z.object({ presets: z.array(PresetSchema) }).safeParse(raw.values);
    return { presets: parsed.success ? parsed.data.presets : [] };
  } catch {
    return { presets: [] };
  }
}
