// Strings of the side panel and the teams screen, in the app's four languages; `client/i18n.ts` serves them under `sideUi.*`. Kept apart from
// messages.ts so each surface's strings change on their own. Every key needs all four languages.
import type { Shape } from "./messages";

export const en = {} as const;

export const ko: Shape<typeof en> = {};

export const ja: Shape<typeof en> = {};

export const zh: Shape<typeof en> = {};
