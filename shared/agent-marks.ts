// An agent's two marks: its client (Claude Code, Codex, OpenCode…, from its provider) and the vendor of the model it
// runs (Anthropic, OpenAI, DeepSeek…, from the model id). Avatars draw the client and badge it with the model.
import { BRAND_SVGS, CLIENT_MARKS, MODEL_MARKS } from "./brand-icons";

export type Mark = { kind: "svg"; svg: string } | { kind: "letter"; letter: string };

const letterOf = (text: string): Mark => ({ kind: "letter", letter: (text.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase() });

/** The client's mark: its built-in mark, else the provider snapshot's icon, else its initial. */
export function clientMark(provider: string, snapshotSvg?: string | null): Mark {
  const name = CLIENT_MARKS[provider];
  const svg = (name && BRAND_SVGS[name]) || snapshotSvg;
  return svg ? { kind: "svg", svg } : letterOf(provider);
}

// The first rule that matches the model id (lower case) names its vendor. Specific names come before general ones:
// gemma before gemini, and the OpenAI families last, since "o3" or "gpt" can appear inside other ids.
const VENDOR_RULES: readonly (readonly [RegExp, string])[] = [
  [/claude|opus|sonnet|haiku|fable|anthropic/, "anthropic"],
  [/gemma/, "gemma"],
  [/gemini/, "gemini"],
  [/deepseek/, "deepseek"],
  [/qwen|qwq|qvq|tongyi/, "qwen"],
  [/kimi|moonshot/, "kimi"],
  [/glm|zhipu|z-ai/, "zhipu"],
  [/minimax|abab/, "minimax"],
  [/grok|x-ai|xai\//, "xai"],
  [/mistral|mixtral|codestral|devstral|magistral|ministral|pixtral/, "mistral"],
  [/llama/, "meta"],
  [/doubao|bytedance|seed-/, "doubao"],
  [/hunyuan/, "hunyuan"],
  [/ernie|wenxin/, "wenxin"],
  [/(?:^|[/_-])yi-/, "yi"],
  [/stepfun|(?:^|[/_-])step-\d/, "stepfun"],
  [/baichuan/, "baichuan"],
  [/longcat/, "longcat"],
  [/gpt|chatgpt|openai|codex|davinci|(?:^|[/_-])o[1345](?:-|$)/, "openai"],
];

/** The vendor a client's own models come from, for a model id that names none (such as "default"). */
const CLIENT_VENDOR: Readonly<Record<string, string>> = { claude: "anthropic", codex: "openai", gemini: "gemini", "qwen-code": "qwen", kimi: "kimi" };

/** The vendor of the model, from its id, else from the client when the id names none; null when neither tells. */
export function modelVendor(model: string, provider = ""): string | null {
  const id = model.trim().toLowerCase();
  if (id) for (const [rule, vendor] of VENDOR_RULES) if (rule.test(id)) return vendor;
  return CLIENT_VENDOR[provider] ?? null;
}

/** The model's mark: its vendor's, else the initial of the model's own name; null without a model. */
export function modelMark(model: string | null | undefined, provider = ""): Mark | null {
  const vendor = modelVendor(model ?? "", provider);
  const name = vendor ? MODEL_MARKS[vendor] : undefined;
  if (name && BRAND_SVGS[name]) return { kind: "svg", svg: BRAND_SVGS[name] };
  const own = (model ?? "").trim().split("/").pop() ?? "";
  return own ? letterOf(own) : null;
}

/** Whether the SVG defines ids (the gradients of the color marks), which each copy on a page must rename. */
export function hasIds(svg: string): boolean {
  return /\sid="[^"]+"/.test(svg);
}

/**
 * The SVG with every id it defines renamed with `suffix`, and every reference to them (`url(#…)`, `href="#…"`) to
 * match. An id names one element per page: a second copy of a gradient mark draws with the first copy's gradient, and
 * draws nothing while that copy is hidden (Codex then shows as a blank tile). So each copy on screen needs its own ids.
 */
export function withIdSuffix(svg: string, suffix: string): string {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
  if (!ids.size) return svg;
  return svg
    .replace(/(\sid=")([^"]+)"/g, (_all, head: string, id: string) => `${head}${id}${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, (all, id: string) => (ids.has(id) ? `url(#${id}${suffix})` : all))
    .replace(/((?:xlink:)?href=")#([^"]+)"/g, (all, head: string, id: string) => (ids.has(id) ? `${head}#${id}${suffix}"` : all));
}
