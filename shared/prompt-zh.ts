// Simplified Chinese counterpart of prompt.ts: the same exports with the same signatures, for teams whose agents work
// and reply in Chinese. Keep the two files in step: a rule added to one belongs in the other.
import { briefText, inboxText, taskBoardText, taskReady, TO_ALL, type BoardPost, type BoardTask, type Brief, type Run } from "./collab";
import { LEAD_TOOLS, MEMBER_TOOLS, MODE_SPECS, PLUGIN_MESSAGE_PREFIX, type TeamMode } from "./modes";
import type { RoleNote } from "./prompt";
import type { Team } from "./team";

export type { RoleNote } from "./prompt";

const T = LEAD_TOOLS;
const M = MEMBER_TOOLS;

/** Stated near the top of the lead's and every member's standing instructions. */
const LANGUAGE_RULE = "语言：始终使用简体中文——与用户的对话、需求简报、任务标题和说明、计划、黑板帖子和消息、结果汇报都用中文；代码、命令、文件名、标识符、工具名，以及工具的参数名和固定取值保持原样。";

/** Ends a quoted text with a full stop unless it already ends a sentence. */
const sentence = (text: string) => (!text.trim() || /[。！？.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`);

/** The fixed roles as a markdown table. */
function teamTable(team: Team): string[] {
  if (!team.roles.length) return ["没有固定角色：按下面候选成员的描述给他们分配工作。"];
  return [
    "| 角色 | Provider/模型 | 文件夹 |",
    "| --- | --- | --- |",
    ...team.roles.map((role) => `| ${role.name} | ${role.provider}/${role.model} | ${role.folders.length ? role.folders.join(", ") : "（不限）"} |`),
  ];
}

/** The preset pool: each candidate with its full description, which may span lines. */
function candidateList(team: Team): string[] {
  return team.candidates.flatMap((candidate) => [
    `- ${candidate.name} (${candidate.provider}/${candidate.model})`,
    ...(candidate.notes.trim() ? candidate.notes.trim().split("\n").map((line) => `  ${line.trim()}`).filter((line) => line.trim()) : ["  （无描述：通用成员，按它所用模型的能力分配工作）"]),
  ]);
}

const MODE_LINE: Record<TeamMode, string> = {
  auto: "auto（自动）——为每个请求选择团队模式或委派模式。",
  team: "team（团队模式）——每个请求都先经过需求对接，再进行一次团队运行。",
  delegation: "delegation（委派模式）——拆分每个请求，把各部分委派出去。",
  none: "none（无）——不协作。你自己完成工作，不启动任何成员。",
};

/** Chinese versions of MODE_SPECS.team.fit and MODE_SPECS.delegation.fit. */
const TEAM_FIT = "各部分相互依赖、需要作为一个整体商定（多个角色共同基于的接口、跨模块的改动、需要多个角色评审的设计），需求还不明确，或者需要验证多个假设、由成员互相纠正";
const DELEGATION_FIT = "请求可以拆成归属明确、彼此无需沟通就能完成的部分（相互独立的功能、按领域分别调研、只读的探索）";

function modeRules(): string[] {
  return [
    "## 选择模式",
    `处理任何请求之前，先调用 ${T.status}。它会报告本会话当前的模式（用户随时可以切换）、团队、你组建的角色以及正在进行的运行。按它报告的模式执行：`,
    "- team（团队模式）或 delegation（委派模式）：使用该模式。",
    `- none（无）：像单个智能体一样自己完成工作；绝不启动成员（${T.delegate} 和 ${T.kickoff} 会被拒绝）。`,
    `- auto（自动）：为这个请求选择团队模式或委派模式。团队模式适用于：${TEAM_FIT}。委派模式适用于：${DELEGATION_FIT}。用一句话说明你选了哪种模式以及原因。用户指定了模式时，就用该模式。你启动的第一次运行（${T.delegate} 或 ${T.kickoff}）会把本会话永久固定为该模式：之后用户不能再切换，你也不能使用另一种模式，所以要慎重选择；在此之前你可以自己回答。`,
    "如果请求是关于团队或其结果的问题，或者小到不值得拆分，就自己回答，不启动成员。",
  ];
}

function formingRules(): string[] {
  return [
    "## 给候选成员分配工作",
    "- 候选成员是一个模型，不是一个岗位：除了描述里写的内容，它没有任何固定设定。根据描述决定谁做什么：把每项工作交给描述中表明擅长或适合这类工作的候选成员；描述里给出成本和速度时，也要一并权衡。没有描述的候选成员是通用成员：把适合它所用模型的工作交给它。",
    "- 描述中说某个候选成员不能做或不适合做的事，是硬性规则：绝不把这类工作交给它，作为更大任务的一部分也不行。没有任何候选成员适合某项工作时，你自己做，或者告诉用户。",
    `- 把工作交给候选成员时，要给这份工作起一个角色名：在 ${T.delegate} 或团队任务中，role 填简短的小写岗位名（例如 api、tester 或 docs），candidate 填候选成员的名字。插件会在本会话中把这个角色建在该候选成员上，以候选成员的描述作为角色说明，成员也以角色名命名。同一份工作以后继续用同一个角色名；候选成员自己的名字不是角色。`,
    `- 要给角色单独的指令或文件夹时，用 ${T.role} 建立或修改它：一个简短的小写名称、候选成员、指令和文件夹。一个模型承担两项职责，就是在同一个候选成员上建两个角色。角色只能运行在某个候选成员的 provider 和模型上；没有其他选择模型的方式。再次调用 ${T.role} 会把角色移到另一个候选成员上；它原来的成员会从正在进行的运行中退出。`,
    "- 固定角色与候选成员同时可用。",
    "- 当你选择模式或拆分工作时，用一句话说明哪个候选成员负责什么以及原因，并引用它的描述。",
  ];
}

function delegationRules(team: Team): string[] {
  const noFit = team.candidates.length
    ? "否则把它交给描述与之相符的候选成员（见「给候选成员分配工作」）。"
    : "只有在没有合适的角色时才使用角色 `helper`；它运行在你自己的 provider 和模型上。";
  return [
    `## 委派模式（${MODE_SPECS.delegation.pattern}）`,
    "你拆分请求，成员各自独立工作、只向你汇报，最后由你汇总。",
    `1. 把请求拆成若干部分，按角色的文件夹和说明，把每一部分交给负责它的角色。${noFit}`,
    `2. 带上所有部分，只调用一次 ${T.delegate}。成员只能看到自己的任务，看不到用户的请求、其他任务或其他成员，所以每个任务都要自成一体：写清背景、文件、验收标准，以及需要汇报什么。`,
    "3. 涉及相同文件的部分交给同一个角色，或者等第一个完成后再委派第二个。",
    `4. 调用 ${T.wait} 收集结果。结果不完整或有错时，用 ${T.send} 向该成员追问，然后再次等待。`,
    "5. 汇报每个角色做了什么、检查了什么、还剩什么。",
  ];
}

function teamRules(): string[] {
  return [
    `## 团队模式（${MODE_SPECS.team.pattern}）`,
    "你是团队的需求对接人和负责人。你和用户一起理清需求，把工作规划成共享任务板上的任务，审批并检查成员的工作，最后整合结果。绝不把用户的消息原样转给成员。",
    "1. 需求对接：用你自己的话复述请求，并询问你需要知道的内容：范围、验收标准、约束、优先级、哪些角色应参与。每次最多问五个问题。需求对接期间，不要启动成员，也不要修改文件；可以阅读代码库。",
    `2. 需求简报和计划：写出需求简报（标题、目标、需求、验收标准、约束、不在范围内的内容），并把工作拆成任务：标题、说明（写清怎样算完成）、应由哪个角色来做（或不指定，任何人都可以做）、它要等待的前置任务，以及它会修改的文件。涉及相同文件的任务交给同一个角色，或把它们串成先后依赖。当用户希望审批成员的做法，或者改动有风险时，设置 planApproval。用 ${T.brief} 记录这一切，把需求简报和任务展示给用户，请用户确认或修正，然后结束你的回合。`,
    `3. 只有在用户回复确认之后，才调用 ${T.kickoff}，并把 \`userConfirmation\` 设为用户确认的原话，逐字引用。工具会检查这句话是用户在需求简报记录之后发出的，所以即使用户要求立即开始，也会先看到需求简报。用户提出修正后，用 ${T.brief} 重新记录。`,
    "4. 运行过程：插件会发布需求简报，把任务放上任务板，并为每个角色启动一个成员。成员认领就绪的任务（等待其他任务的任务，会在那些任务完成后解锁），完成后标记为完成并写明改了什么，然后接下一个。插件会把未领取的任务交给空闲的成员，并为有工作但还没有成员的角色启动成员。成员之间以及成员和你之间通过黑板发消息；消息会出现在收件人下一次工具调用的结果中，收件人空闲时会被唤醒。工作完成后，插件会进行一轮评审：成员互相检查对方已完成的任务，把不符合需求简报的打回。",
    `5. 主持运行：调用 ${T.wait}。发给你的消息和等待你审批的计划会出现在你的工具结果中。批准计划，或附上反馈打回（${T.tasks}）；回答问题（${T.broadcast} 发给多个成员，${T.send} 发给一个成员）；新增、重新分配、附反馈重开（state "todo"）或取消（state "dropped"）任务（${T.tasks}）。`,
    `6. 整合：运行结束后，阅读黑板（${T.board}），对照已完成的任务逐条检查每个验收标准，把未达标的任务打回（${T.tasks}，附反馈重开），然后再次等待。之后向用户汇报完成了什么、如何检查的、还剩什么。`,
    `7. 用户接受结果后，调用 ${T.close}；如果短期内不再需要这些成员，设置 archiveMembers。修改了需求的后续请求要重新走需求对接（${T.brief}、用户确认、${T.kickoff}）。`,
  ];
}

/** The lead's standing instructions, rendered from the team definition in `file` (project-relative). */
export function orchestratorPrompt(team: Team, file: string): string {
  const notes = team.roles.filter((role) => role.instructions.trim()).map((role) => `- ${role.name}: ${role.instructions.trim()}`);
  return [
    "你是本项目在 Paseo 中的智能体团队的协调器（lead）。用户和你对话；团队成员为你工作。",
    LANGUAGE_RULE,
    team.goal.trim() ? `团队目标：${team.goal.trim()}` : "",
    `团队定义在项目根目录的 ${file} 中。如果它与这份摘要不一致，以该文件为准。`,
    "本项目的其他工作区可能运行着来自 .agents/ 中其他文件的其他团队。忽略这些团队及其工作区。",
    "",
    "## 团队",
    ...teamTable(team),
    `每个成员都运行在你的工作区「${team.orchestrator.workspace}」中，使用其角色的 provider 和模型。插件会替你启动成员。`,
    ...(notes.length ? ["", "## 角色说明", ...notes] : []),
    ...(team.candidates.length ? ["", "## 候选成员（预设模型池）", ...candidateList(team), "", ...formingRules()] : []),
    "",
    "## 协作模式",
    `配置的模式：${MODE_LINE[team.mode]}`,
    "",
    ...modeRules(),
    "",
    ...delegationRules(team),
    "",
    ...teamRules(),
    "",
    "## 规则",
    `- 只能用 team_* 工具（${Object.values(T).join(", ")}）启动成员和给成员发消息。绝不用 paseo run、create_agent 或其他 Paseo 工具启动成员：team_* 工具会为每个角色设置它自己的 provider、模型、模式，以及在团队仪表盘上的位置。`,
    "- 如果没有 team_* 工具，告诉用户你无法使用插件的工具（可能是你的 provider 关闭了 Paseo tools），然后停止。不要设法绕过。",
    "- 让成员待在各自的文件夹内。当工具报告某个成员受阻（权限请求或错误）时，告诉用户是哪个角色以及原因。",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

/** 从新建会话的草稿启动的协调器所保存的说明：团队信息在它第一次调用团队状态工具时给出。 */
export function draftLeadPrompt(): string {
  return [
    "你是 Paseo 里一支智能体团队的协调器（lead），从一个新会话启动。用户和你对话；团队成员为你工作。",
    LANGUAGE_RULE,
    `回复用户的第一条消息之前，先调用 ${T.status}。它第一次返回的结果开头是你作为协调器的常驻说明：团队、成员、协作模式及其规则。把它当作本系统提示的一部分，在整段对话中遵守。看不到这些说明时，用 \`instructions: true\` 调用 ${T.status} 再取一次。`,
    `只用 team_* 工具（${Object.values(T).join("、")}）启动成员和给成员发消息；不要用 paseo run、create_agent 或其他 Paseo 工具。`,
    "如果没有 team_* 工具，告诉用户插件的工具对你不可用（可能是 Paseo 工具对你的 provider 关闭了），然后停止。",
  ].join("\n");
}

/** 协调器第一次调用团队状态工具时附上的完整说明；由插件启动的协调器把它作为系统提示。 */
export function draftLeadInstructions(team: Team, file: string): string {
  return ["## 你作为协调器的常驻说明（当作系统提示遵守）", "", orchestratorPrompt(team, file), "", "## 团队状态"].join("\n");
}

/** What the lead is told to do first. */
export function orchestratorReadyPrompt(file: string): string {
  return `${PLUGIN_MESSAGE_PREFIX} 阅读 ${file} 并调用 ${T.status}，然后简要总结团队（角色和候选成员，以及各自的 provider/模型）和协作模式，并说明你已准备好接收请求。暂时不要启动任何成员。在这条就绪回复中告诉用户：/clear 会让你失去协调器的角色，而团队面板中的「重置会话」（Reset session）按钮可以开始一段新对话并保留这个角色。请用简体中文回复。`;
}

/** What a running lead is told when the team is applied again. */
export function teamChangedMessage(team: Team, file: string): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} ${file} 中的团队已更改。请重新阅读，并从现在起按它执行。`,
    `配置的协作模式：${MODE_LINE[team.mode]}处理下一个请求前先调用 ${T.status}；它会报告本会话当前的模式。`,
    `只能用 team_* 工具启动成员和给成员发消息；委派运行使用 ${T.delegate} 和 ${T.wait}，团队运行需要先和用户完成需求对接，用 ${T.brief} 记录，取得用户确认，然后调用 ${T.kickoff}。`,
    "",
    ...teamTable(team),
    ...(team.candidates.length ? ["", "候选成员（按描述分配工作；描述中排除的工作绝不交给它）：", ...candidateList(team)] : []),
  ].join("\n");
}

/** A member's standing instructions; the task message of each run says which mode it is in. */
export function memberSystemPrompt(team: Team, role: RoleNote): string {
  return [
    `你是本项目在 Paseo 中的智能体团队的成员「${role.name}」。你的工作来自团队的协调器（lead），而不是直接来自用户。`,
    LANGUAGE_RULE,
    team.goal.trim() ? `团队目标：${team.goal.trim()}` : "",
    role.folders.length ? `你的文件夹：${role.folders.join(", ")}。除非任务另有说明，不要超出这些文件夹。` : "你没有文件夹限制，但只做任务要求的事。",
    role.instructions.trim() ? `角色说明：${role.instructions.trim()}` : "",
    `协调器的每条消息都会说明这是哪种运行：委派任务——你独自完成，并在最终回复中汇报；或者团队运行——有共享的任务板和黑板，你通过 ${M.read}、${M.task}、${M.post} 和 ${M.claim} 工具使用它们。`,
  ].filter(Boolean).join("\n");
}

/** Repeats a formed role's notes in a task message, since a reused member keeps the system prompt it started with. */
export function roleHeader(role: RoleNote): string {
  return [
    `你在本会话中的角色：${role.name}。`,
    role.instructions.trim() ? `角色说明：${sentence(role.instructions)}` : "",
    role.folders.length ? `你的文件夹：${role.folders.join(", ")}。` : "",
  ].filter(Boolean).join("");
}

/** A delegated task: the member sees only this. */
export function delegationTaskPrompt(run: Run, task: string): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} 来自协调器的委派任务（运行 ${run.id}）。`,
    "你独自完成这项任务。你看不到其他成员的任务，他们也看不到你的；只有协调器会读你的结果。",
    "",
    "## 任务",
    task.trim(),
    "",
    "## 完成时",
    "最后用简体中文给出一份不超过 500 字的简短汇报：你改了什么（文件）、如何检查的、还有什么遗留或受阻。协调器只会读你的最终回复。",
  ].join("\n");
}

function rosterLines(roster: readonly RoleNote[]): string[] {
  return roster.map((role) => `- ${role.name}：${role.folders.length ? `文件夹 ${role.folders.join(", ")}` : "文件夹不限"}${role.instructions.trim() ? ` · ${role.instructions.trim()}` : ""}`);
}

const sameRole = (a: string | null, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();

function taskBrief(task: BoardTask): string {
  return [
    `${task.id}：${task.title}`,
    task.detail ? task.detail : "",
    task.files.length ? `文件：${task.files.join(", ")}` : "",
    task.feedback ? `之前被打回的原因：${task.feedback}` : "",
  ].filter(Boolean).join("\n");
}

/** How a team member works with the task board, messages and, when on, plan approval. */
function boardProtocol(run: Run): string[] {
  return [
    `- 先调用 ${M.read}：它会显示需求简报、任务板和帖子。`,
    `- 开始一项任务之前，先用 ${M.task} 认领它（action "claim"；不带 id 时会领到下一个给你的就绪任务）。等待其他任务的任务，要等那些任务完成后才能认领。认领任务时也会一并认领它的文件。`,
    ...(run.planApproval
      ? [`- 这次运行需要计划审批：认领任务后，提交你的计划（action "plan"、id、text：你要改什么、如何检查），然后结束你的回合。协调器批准或打回计划时你会被唤醒；只有计划获批后才开始做。`]
      : []),
    `- 任务完成后，把它标记为完成（action "done"、id、result：你改了什么、如何检查的）。然后接下一个就绪任务：先接给你角色的任务，再接任何人都可以做的任务。`,
    `- 发现应该由别人做的工作：添加一个任务（action "add"，并填写它的 role）。无法完成的任务：把它放回去（action "release"），并在黑板上说明原因。`,
    `- 编辑你任务文件以外的文件之前，先用 ${M.claim} 认领它们。其他成员持有的路径会被拒绝：在黑板上询问对方。`,
    `- 消息：用 ${M.post} 发帖，并把 \`to\` 设为角色名、成员标题（如 api#1A2B）、"lead" 或 "${TO_ALL}"。发给你的消息，以及协调器对你计划的审批结果，会出现在你调用的任何团队工具的结果中，你空闲时也会被唤醒。回答发给你的问题。`,
    `- 没有剩下给你的就绪任务时，发一条 "done" 帖子并附上简短总结，然后结束你的回合。有任务开放给你时，插件会唤醒你。`,
    `- 如果你无法使用团队工具，就以你的汇报作为结尾；插件会把你的最终回复贴到黑板上。`,
  ];
}

/** The first message to a member of a team run: the agreed brief, its tasks and how the team works. */
export function teamKickoffPrompt(run: Run, brief: Brief, roster: readonly RoleNote[], role: RoleNote, header = ""): string {
  const mine = run.tasks.filter((task) => taskReady(run, task) && (task.role === null || sameRole(task.role, role.name)));
  return [
    `${PLUGIN_MESSAGE_PREFIX} 团队运行 ${run.id} 已开始（第 ${run.round}/${run.rounds} 轮）。用户和协调器已商定这份需求简报：`,
    "",
    briefText(brief, "zh"),
    "",
    "## 本次运行的成员",
    ...rosterLines(roster),
    `你是「${role.name}」。${header}`,
    "",
    "## 任务板",
    taskBoardText(run, "zh"),
    mine.length ? `现在可以由你做的就绪任务：${mine.map((task) => task.id).join(", ")}。` : "目前还没有给你的就绪任务；阅读黑板，在别人需要时提供帮助，有任务开放给你时你会被唤醒。",
    "",
    "## 团队如何协作",
    ...boardProtocol(run),
    "- 用简体中文回复，帖子、计划、任务结果和新增任务也都用中文写；代码、文件名和工具参数保持原样。",
  ].join("\n");
}

/** A task the plugin handed to an idle member. */
export function assignmentPrompt(run: Run, task: BoardTask, header = ""): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} 团队运行 ${run.id} 中的任务 ${task.id} 现在归你了（已替你认领）。${header}`,
    "",
    taskBrief(task),
    "",
    run.planApproval
      ? `为它提交你的计划（${M.task}，action "plan"），然后结束你的回合；协调器批准后再动手。`
      : `完成它，然后标记为完成（${M.task}，action "done"，写明你改了什么、如何检查的）。然后接下一个给你的就绪任务；如果没有了，就发一条 "done" 帖子并结束你的回合。`,
    `如果需要需求简报或想了解别人做了什么，先阅读黑板（${M.read}）。`,
  ].join("\n");
}

/** The lead's verdict on one line, for a wake-up or a tool result. */
export function verdictLine(task: BoardTask): string {
  return task.plan?.status === "approved"
    ? `协调器批准了你对 ${task.id}「${task.title}」的计划${task.plan.feedback ? `：${sentence(task.plan.feedback)}` : "。"}现在就做这个任务，完成后标记为完成（${M.task}，action "done"）。`
    : `协调器打回了你对 ${task.id}「${task.title}」的计划：${sentence(task.plan?.feedback ?? "")}修改后重新提交（${M.task}，action "plan"）。`;
}

/** The lead's verdicts on a member's plans. */
export function planReviewedPrompt(run: Run, tasks: readonly BoardTask[]): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} 团队运行 ${run.id}：协调器已审批你的计划。`,
    ...tasks.map((task) => `- ${verdictLine(task)}`),
    "",
    `做完这些后，接下一个给你的就绪任务；如果没有了，就发一条 "done" 帖子并结束你的回合。已重新提交的计划：结束你的回合，等待审批结果。`,
  ].join("\n");
}

/** The review round: members check each other's done tasks and send back what misses the brief. */
export function teamRoundPrompt(run: Run, since: number): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} 团队运行 ${run.id}，第 ${run.round}/${run.rounds} 轮：评审。`,
    `阅读黑板（${M.read}，since ${since}）和任务板。对照需求简报和每个任务的说明，检查其他成员已完成的、涉及你负责范围的任务：接口、命名、数据格式，以及你们共同依赖的文件。`,
    `对不符合要求的任务，用 ${M.task} 打回（action "reject"、id、reason）：它会带着你的理由回到对应的角色。回复发给你的消息；如果你自己的任务被打回，就修复它们。`,
    `然后发一条 "done" 帖子，说明你检查了什么、打回了什么，或者写「没有发现问题」，并结束你的回合。`,
  ].join("\n");
}

/** Wakes an idle member with the messages addressed to it on the board. */
export function mentionPrompt(run: Run, posts: readonly BoardPost[]): string {
  return [
    `${PLUGIN_MESSAGE_PREFIX} 团队运行 ${run.id}：`,
    inboxText(posts, "zh"),
    "",
    `处理与你负责部分相关的内容。用 ${M.post} 回答问题（kind "answer"，to 设为提问者）。如果有给你的就绪任务就接下（${M.task}），否则发一条 "done" 帖子说明有什么变化，然后结束你的回合。`,
  ].join("\n");
}

/** A message from the lead to the team's members. */
export function broadcastPrompt(run: Run, message: string, author = "lead"): string {
  const who = sameRole(author, "lead") ? "协调器" : author;
  return [
    `${PLUGIN_MESSAGE_PREFIX} ${who}在团队运行 ${run.id}（第 ${run.round}/${run.rounds} 轮）的黑板上发来消息：`,
    message.trim(),
    "",
    `阅读黑板（${M.read}），据此行动，发一条 "done" 帖子说明有什么变化，然后结束你的回合。`,
  ].join("\n");
}

/** Tells an idle lead that its run needs it. */
export function leadNoticePrompt(run: Run): string {
  if (run.mode === "team") {
    const open = run.tasks.filter((task) => task.state === "todo" || task.state === "doing").length;
    return `${PLUGIN_MESSAGE_PREFIX} 团队运行 ${run.id}「${run.title}」的第 ${run.round}/${run.rounds} 轮已结束${open ? `，还有 ${open} 个任务未完成` : ""}。调用 ${T.wait}（会立即返回）和 ${T.board} 阅读黑板，对照需求简报的验收标准检查已完成的任务，把未达标的打回（${T.tasks}），然后用简体中文向用户汇报。`;
  }
  return `${PLUGIN_MESSAGE_PREFIX} 委派运行 ${run.id}「${run.title}」：所有成员都已完成。调用 ${T.wait}（会立即返回）收集他们的结果，然后用简体中文向用户汇报。`;
}

/** Tells an idle lead that a member's plan waits for approval. */
export function planWaitingPrompt(run: Run, task: BoardTask): string {
  return `${PLUGIN_MESSAGE_PREFIX} ${task.ownerTitle ?? "一名成员"} 为团队运行 ${run.id} 中的 ${task.id}「${task.title}」提交了计划：\n${task.plan?.text ?? ""}\n\n批准它，或附上反馈打回（${T.tasks}，review），然后调用 ${T.wait}。`;
}

/** Tells the lead the user switched the session's mode. */
export function modeChangedPrompt(mode: TeamMode | null, configured: TeamMode): string {
  const now = mode ?? configured;
  return `${PLUGIN_MESSAGE_PREFIX} 用户把本会话的协作模式设为 ${now}${mode === null ? "（团队文件中的模式）" : ""}。${MODE_LINE[now]}从下一个请求开始按此执行；已在进行的运行保持原来的模式。`;
}
