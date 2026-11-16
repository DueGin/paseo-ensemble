import { MODE_SPECS, TEAM_MODES, type PromptLanguage } from "./modes";
import { checkTeam, type ParseResult, type Role, type Team } from "./team";
import type { ProviderInfo } from "./validate";

const text = { type: "string", minLength: 1 } as const;

/** The instructions planner's `outputSchema`: only the rewritten instructions. */
export const INSTRUCTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["instructions"],
  properties: { instructions: text },
};

/** The planner agent's `outputSchema`: a complete team file, every field present. */
export const TEAM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "goal", "mode", "orchestrator", "roles", "candidates"],
  properties: {
    version: { type: "integer", const: 1 },
    goal: { type: "string" },
    mode: { type: "string", enum: [...TEAM_MODES] },
    orchestrator: {
      type: "object",
      additionalProperties: false,
      required: ["workspace", "provider", "model"],
      properties: { workspace: text, provider: text, model: text },
    },
    roles: { type: "array", items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "provider", "model", "folders", "instructions"],
      properties: { name: text, provider: text, model: text, folders: { type: "array", items: text }, instructions: { type: "string" } },
    } },
    candidates: { type: "array", items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "provider", "model", "notes"],
      properties: { name: text, provider: text, model: text, notes: { type: "string" } },
    } },
  },
};

// outputSchema isn't enforced by every provider (Claude answered with its own key names),
// so the prompt shows the exact shape too.
const INSTRUCTIONS_EXAMPLE = { instructions: "<improved instructions>" };
const EXAMPLE = {
  version: 1,
  goal: "<the goal>",
  mode: "auto",
  orchestrator: { workspace: "orchestrator", provider: "<provider id>", model: "<model id>" },
  roles: [{ name: "<role>", provider: "<provider id>", model: "<model id>", folders: ["<relative/path>"], instructions: "<what this role does>" }],
  candidates: [{ name: "<short identifier, may be empty>", provider: "<provider id>", model: "<model id>", notes: "<good at / suited for; cost or speed; work not to give it>" }],
};

/** The same shape with Chinese placeholders, so a Chinese planner writes Chinese values. */
const EXAMPLE_ZH = {
  version: 1,
  goal: "<团队目标>",
  mode: "auto",
  orchestrator: { workspace: "orchestrator", provider: "<provider id>", model: "<model id>" },
  roles: [{ name: "<角色名，小写英文>", provider: "<provider id>", model: "<model id>", folders: ["<相对路径>"], instructions: "<这个角色做什么>" }],
  candidates: [{ name: "<简短标识，可留空>", provider: "<provider id>", model: "<model id>", notes: "<擅长/适合；成本或速度；不要让它做的工作>" }],
};
const INSTRUCTIONS_EXAMPLE_ZH = { instructions: "<改进后的说明>" };

const LANGUAGE_RULE_ZH = "- 语言：JSON 的键保持英文；goal、instructions、notes 等所有文字内容都用简体中文。";

/** How the planner picks the team's collaboration mode. */
const MODE_RULE = `- Set mode to how the orchestrator runs requests: "delegation" (${MODE_SPECS.delegation.pattern}: it splits each request and members work alone) when the work ${MODE_SPECS.delegation.fit.replace(/^the request /, "")}; "team" (${MODE_SPECS.team.pattern}: it first agrees a brief with the user, then members share a task board and review each other's work) when ${MODE_SPECS.team.fit}; "auto" to let the orchestrator pick per request; "none" when the orchestrator should work alone without members. Prefer "auto" unless the goal clearly calls for one.`;

const MODE_RULE_ZH = `- mode 决定协调器如何处理需求："delegation"（委派，${MODE_SPECS.delegation.pattern}：拆分需求，成员各自独立完成）适合能拆成职责清晰、互不依赖的部分的工作；"team"（团队，${MODE_SPECS.team.pattern}：先与用户确认需求简报，成员共用任务板并互相评审）适合各部分相互依赖、需要统一约定、需求尚不清楚或需要多方互相纠错的工作；"auto"（自动）由协调器按每个需求选择；"none"（无）表示协调器独自完成、不启动成员。除非目标明显需要某一种，否则优先用 "auto"。`;

const STRUCTURE_RULES_ZH = [
  "- 团队由固定角色、候选成员或两者组成：",
  "  - 固定角色负责项目中稳定的区域（文件夹）。为每个角色给出简短的小写英文名、它负责的文件夹（相对路径，可为空）和一两句中文说明。挑 2 到 6 个职责明确不重叠的角色。",
  "  - 候选成员是预设的模型池，不是角色：会话中协调器按每个需求的描述来分工，且只能用这些 provider 和模型。为每个候选写中文描述：擅长/适合做什么、成本或速度、不要让它做的工作；标识可留空。挑 2 到 4 个能力有差异的候选。",
  "  - 工作能按稳定区域划分时用固定角色；工作因需求而异时用候选成员；两者都有时都用。不需要的部分用空数组，但不能两者都为空。",
  "- 适合的话优先用不同的 provider（例如一个负责视觉设计，另一个负责音频）。",
];

function modelLines(catalog: readonly ProviderInfo[]): string[] {
  return catalog.filter((provider) => provider.ready).map((provider) => `- ${provider.id}: ${provider.models.map((model) => model.id).join(", ")}`);
}

/** The JSON object in a planner's final message, tolerating a code fence or text around it. */
function jsonIn(message: string | null, what: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  if (!message?.trim()) return { ok: false, errors: ["the planner finished without an answer"] };
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, errors: [`the planner's answer has no JSON ${what}`] };
  try {
    return { ok: true, value: JSON.parse(message.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, errors: [`the planner's answer is not valid JSON: ${(error as Error).message}`] };
  }
}

/** How the planner chooses between fixed roles and a candidate pool. */
const STRUCTURE_RULES = [
  "- A team has fixed roles, candidate members, or both:",
  "  - Fixed roles own stable areas of the project (folders). Give each a short lowercase name, its folders (relative paths, may be empty), and one or two sentences of instructions. Pick 2 to 6 roles that do clearly separate work.",
  "  - Candidate members are a preset pool of models. During a session the orchestrator forms roles itself, per request, and may give them only these providers and models. Give each a short name and notes on what it is good at, its cost or speed. Pick 2 to 4 that differ in strengths.",
  "  - Use fixed roles when the work splits into stable areas; use candidates when the work varies from request to request; use both when stable areas exist but other work comes up too. Use an empty array for the part you leave out, but never leave both empty.",
  "- Prefer different providers where they suit the work better (for example one provider for visual design, another for audio).",
];

/**
 * Asks a planner agent to propose a team, using only models this host can run. Without a goal, the planner reads the
 * project to work out what it is and what work it needs.
 */
export function plannerPrompt(goal: string, catalog: readonly ProviderInfo[], language: PromptLanguage = "en"): string {
  const given = goal.trim();
  if (language === "zh") return plannerPromptZh(given, catalog);
  return [
    "Propose an agent team for this project. Every member runs in the orchestrator's workspace on its own provider and model; an orchestrator leads them.",
    "",
    given ? `Goal: ${given}` : "No goal was given. Work it out from the project itself.",
    "",
    "Providers and model ids available on this host (use these exact ids, nothing else):",
    ...modelLines(catalog),
    "",
    "Rules:",
    given
      ? "- Look around the repository to fit roles and folders to what is there. Do not create, change or delete any file."
      : "- Read the project before proposing: README and docs, CLAUDE.md or AGENTS.md, package manifests and build files, the source tree layout, tests, and open TODOs. Work out what the project is, how it is built and what work it needs. Do not create, change or delete any file.",
    ...STRUCTURE_RULES,
    '- The orchestrator gets the workspace "orchestrator" and a strong reasoning model.',
    MODE_RULE,
    given ? "- Set version to 1 and goal to the goal above." : "- Set version to 1, and goal to one sentence you write about what the team is for in this project.",
    "- Answer with JSON only, using exactly these keys and no others:",
    JSON.stringify(EXAMPLE, null, 2),
  ].join("\n");
}

function plannerPromptZh(given: string, catalog: readonly ProviderInfo[]): string {
  return [
    "为这个项目规划一个智能体团队。每个成员都在协调器的工作区里、用自己的 provider 和模型运行，由协调器统一带领。",
    "",
    given ? `目标：${given}` : "没有给出目标，请从项目本身判断。",
    "",
    "本主机可用的 provider 和模型 id（必须原样使用这些 id，不能用其他的）：",
    ...modelLines(catalog),
    "",
    "规则：",
    given
      ? "- 先浏览代码仓库，让角色和文件夹贴合项目现状。不要创建、修改或删除任何文件。"
      : "- 规划前先阅读项目：README 和文档、CLAUDE.md 或 AGENTS.md、依赖清单和构建文件、源码目录结构、测试和待办事项。弄清楚项目是什么、怎么构建、需要哪些工作。不要创建、修改或删除任何文件。",
    ...STRUCTURE_RULES_ZH,
    '- 协调器的工作区设为 "orchestrator"，并用一个推理能力强的模型。',
    MODE_RULE_ZH,
    given ? "- version 设为 1，goal 设为上面的目标。" : "- version 设为 1，goal 用一句中文写明这个团队在本项目中要做什么。",
    LANGUAGE_RULE_ZH,
    "- 只用 JSON 回答，键必须与下面完全一致，不能多也不能少：",
    JSON.stringify(EXAMPLE_ZH, null, 2),
  ].join("\n");
}

/** Reads the planner's final message as a team, tolerating a code fence or text around the JSON. */
export function extractProposal(message: string | null): ParseResult {
  const json = jsonIn(message, "team");
  if (!json.ok) return json;
  return checkTeam(json.value);
}

/** The team context used to keep a role's instructions within its ownership. */
export interface TeamOutline {
  orchestratorWorkspace: string;
  roles: { name: string; folders: string[] }[];
}

/** Asks a planner to revise the current draft, keeping its orchestrator workspace fixed. */
export function teamEditPrompt(request: string, draft: Team, catalog: readonly ProviderInfo[], language: PromptLanguage = "en"): string {
  if (language === "zh") return teamEditPromptZh(request, draft, catalog);
  return [
    "Revise this project's entire agent team according to the user's request.",
    "",
    `User request: ${request.trim()}`,
    "Current draft:",
    JSON.stringify(draft, null, 2),
    "",
    "Providers and model ids available on this host (use these exact ids, nothing else):",
    ...modelLines(catalog),
    "",
    "Rules:",
    "- Look around the repository to ground the changes. Do not create, change or delete any file.",
    "- Treat the request as an edit of the existing team. When it names an existing role, or the work fits an existing role's folders or responsibility, change that role's instructions, folders, provider/model or name instead of adding a role.",
    '- For example, "add UI testing to tester" means update tester\'s instructions/folders; do not create a new role.',
    "- Add a new role only when the request explicitly asks for a new or separate role, or when no existing role can own the work.",
    "- Remove a role only when the request asks for it or its work is merged into another role by the request.",
    '- A request may affect several roles at once: for example, "every role must run the tests" means change all of them.',
    "- Keep roles the request does not affect exactly as they are. Change the orchestrator's provider/model, the mode and the goal only when requested.",
    "- candidates is the team's pool of models the orchestrator gives work to by their descriptions (name: optional identifier, provider, model, notes: what it is good at and must not do). Change it only when the request is about it; keep it as it is otherwise. A team must keep at least one role or one candidate.",
    `- mode is one of ${TEAM_MODES.map((mode) => `"${mode}"`).join(", ")}; keep ${JSON.stringify(draft.mode)} unless the request asks for another collaboration mode.`,
    `- Keep the orchestrator workspace exactly ${JSON.stringify(draft.orchestrator.workspace)} and version ${draft.version}.`,
    "- Use only the listed provider/model ids and give each role a unique name.",
    "- Answer with the full team JSON only, using exactly these keys and no others:",
    JSON.stringify({ ...EXAMPLE, mode: draft.mode, orchestrator: { ...EXAMPLE.orchestrator, workspace: draft.orchestrator.workspace } }, null, 2),
  ].join("\n");
}

function teamEditPromptZh(request: string, draft: Team, catalog: readonly ProviderInfo[]): string {
  return [
    "按用户的要求修改这个项目的整个智能体团队。",
    "",
    `用户要求：${request.trim()}`,
    "当前草稿：",
    JSON.stringify(draft, null, 2),
    "",
    "本主机可用的 provider 和模型 id（必须原样使用这些 id，不能用其他的）：",
    ...modelLines(catalog),
    "",
    "规则：",
    "- 先浏览代码仓库作为修改依据。不要创建、修改或删除任何文件。",
    "- 把要求当作对现有团队的修改。要求提到某个现有角色，或这项工作属于某个现有角色的文件夹或职责时，修改该角色的说明、文件夹、provider/模型或名称，而不是新增角色。",
    "- 例如「给 tester 加上 UI 测试」意味着更新 tester 的说明或文件夹，不要新建角色。",
    "- 只有要求明确要新角色，或没有现有角色能负责这项工作时，才新增角色。",
    "- 只有要求删除某角色，或要求把它的工作并入其他角色时，才删除角色。",
    "- 一个要求可能同时影响多个角色，例如「每个角色都要跑测试」意味着全部修改。",
    "- 要求没涉及的角色保持原样。只有被要求时才改协调器的 provider/模型、mode 和 goal。",
    "- candidates 是团队的模型池，协调器按它们的描述分工（name：可选标识，provider，model，notes：擅长什么、不要让它做什么）。只有要求与它有关时才改，否则保持原样。团队至少要保留一个角色或一个候选成员。",
    `- mode 取值为 ${TEAM_MODES.map((mode) => `"${mode}"`).join("、")}；除非要求换协作模式，否则保持 ${JSON.stringify(draft.mode)}。`,
    `- 协调器工作区必须保持为 ${JSON.stringify(draft.orchestrator.workspace)}，version 保持 ${draft.version}。`,
    "- 只用上面列出的 provider/模型 id，每个角色名唯一。",
    LANGUAGE_RULE_ZH,
    "- 只用完整的团队 JSON 回答，键必须与下面完全一致，不能多也不能少：",
    JSON.stringify({ ...EXAMPLE_ZH, mode: draft.mode, orchestrator: { ...EXAMPLE_ZH.orchestrator, workspace: draft.orchestrator.workspace } }, null, 2),
  ].join("\n");
}

/** Asks a planner to improve one role's instructions without requiring a valid team draft. */
export function instructionsPrompt(role: Pick<Role, "name" | "folders" | "instructions">, request: string, team: TeamOutline & { goal: string }, language: PromptLanguage = "en"): string {
  const roles = team.roles.filter((other) => other.name !== role.name).map((other) => `- ${other.name} (folders ${other.folders.length ? other.folders.join(", ") : "any"})`);
  if (language === "zh") {
    return [
      "为这个项目在 Paseo 中的智能体团队重写这个角色的说明。",
      "",
      `角色：${role.name}`,
      `文件夹：${role.folders.length ? role.folders.join(", ") : "不限"}`,
      `当前说明：${role.instructions}`,
      ...(request.trim() ? [`用户要求：${request.trim()}`] : []),
      "",
      `团队目标：${team.goal}`,
      `协调器工作区：${team.orchestratorWorkspace}`,
      "其他角色：",
      ...(roles.length ? roles : ["- （无）"]),
      "",
      "规则：",
      "- 先浏览代码仓库（包括 CLAUDE.md 和该角色的文件夹），让说明贴合项目现状。不要创建、修改或删除任何文件。",
      "- 写几句具体的祈使句，协调器可以直接放进该角色的任务里。",
      "- 不超出该角色的文件夹，不接手其他角色的工作。",
      "- 有用户要求时照做。",
      "- 用简体中文写。",
      "- 只用 JSON 回答，键必须与下面完全一致：",
      JSON.stringify(INSTRUCTIONS_EXAMPLE_ZH, null, 2),
    ].join("\n");
  }
  return [
    "Rewrite this role's instructions for this project's agent team in Paseo.",
    "",
    `Role: ${role.name}`,
    `Folders: ${role.folders.length ? role.folders.join(", ") : "any"}`,
    `Current instructions: ${role.instructions}`,
    ...(request.trim() ? [`User request: ${request.trim()}`] : []),
    "",
    `Team goal: ${team.goal}`,
    `Orchestrator workspace: ${team.orchestratorWorkspace}`,
    "Other roles:",
    ...(roles.length ? roles : ["- (none)"]),
    "",
    "Rules:",
    "- Look around the repository, including CLAUDE.md and the role's folders, to ground the instructions in what is there. Do not create, change or delete any file.",
    "- Write a few concrete imperative sentences that the orchestrator can paste into a role agent's task.",
    "- Stay within the role's folders and do not take over other roles' work.",
    "- Follow the user's request when given.",
    "- Write in English.",
    "- Answer with JSON only, using exactly these keys and no others:",
    JSON.stringify(INSTRUCTIONS_EXAMPLE, null, 2),
  ].join("\n");
}

/** Reads the instructions planner's final message, tolerating a code fence or surrounding text. */
export function extractInstructions(message: string | null): { ok: true; instructions: string } | { ok: false; errors: string[] } {
  const json = jsonIn(message, "instructions");
  if (!json.ok) return json;
  const value = json.value;
  if (typeof value !== "object" || value === null || !("instructions" in value) || typeof value.instructions !== "string" || !value.instructions.trim()) {
    return { ok: false, errors: ["instructions: expected a non-empty string"] };
  }
  return { ok: true, instructions: value.instructions.trim() };
}
