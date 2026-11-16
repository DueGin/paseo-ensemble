// The prompt set for a language: everything the plugin writes for agents comes in English and Simplified Chinese, and an
// agent's language decides which one it gets (and so the language it works and replies in).
import type { PromptLanguage } from "./modes";
import * as en from "./prompt";
import * as zh from "./prompt-zh";

export type Prompts = typeof en;

const SETS: Record<PromptLanguage, Prompts> = { en, zh };

export function promptsFor(language: PromptLanguage | null | undefined): Prompts {
  return SETS[language ?? "en"];
}
