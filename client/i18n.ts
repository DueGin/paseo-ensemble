import { defineTranslations } from "@getpaseo/plugin/client";
import * as editor from "../shared/messages-editor";
import * as report from "../shared/messages-report";
import * as side from "../shared/messages-side";
import { en, ja, ko, zh } from "../shared/messages";

// Each surface's own strings sit under their namespace: `editorUi.*`, `reportUi.*`, `sideUi.*`.
const merged = <T extends object>(base: T, lang: "en" | "ko" | "ja" | "zh") => ({ ...base, editorUi: editor[lang], reportUi: report[lang], sideUi: side[lang] });

export const messages = defineTranslations({ resources: { en: merged(en, "en"), ko: merged(ko, "ko"), ja: merged(ja, "ja"), zh: merged(zh, "zh") } });
