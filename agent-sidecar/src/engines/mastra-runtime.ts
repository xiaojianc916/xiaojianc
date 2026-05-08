import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Agent, type ToolsInput } from '@mastra/core/agent';
import { createDurableAgent, DurableStepIds } from '@mastra/core/agent/durable';
import type { MastraModelConfig } from '@mastra/core/llm';
import { Mastra } from '@mastra/core/mastra';
import { RequestContext } from '@mastra/core/request-context';
import { toStandardSchema } from '@mastra/core/schema';
import type {
    TextDeltaPayload,
    ToolCallPayload,
} from '@mastra/core/stream';
import { createTool } from '@mastra/core/tools';
import {
    LocalFilesystem,
    LocalSandbox,
    WORKSPACE_TOOLS,
    Workspace,
    type AnyWorkspace,
    type LSPConfig,
    type WorkspaceToolsConfig,
} from '@mastra/core/workspace';
import { LibSQLStore } from '@mastra/libsql';

import {
    createDeepSeekModelConfigFromEnv,
    type IDeepSeekModelConfig,
} from '../models/deepseek-model.js';
import type { TJsonValue } from '../schemas/events.js';
import { agentPlanSchema, type TAgentPlan } from '../schemas/plan.js';
import {
    createAgentRuntimeEvent,
    type IAgentRuntimeEventContext,
    type TAgentRuntimeEventDraft,
} from '../streaming/stream-types.js';
import { redactForStream } from '../streaming/stream-redaction.js';
import { createMastraMcpClientBundle } from '../tools/mcp.js';
import { buildSystemPrompt } from './agent-runtime-helpers.js';
import type {
    IAgentRuntimeResponse,
    IAgentRuntimeRunOptions,
    TAgentRuntimeOutputEvent,
} from './runtime-contracts.js';
import type {
    IAgentMessageInput,
    IAgentRuntimeInput,
    IApprovalResolutionInput,
    ICheckpointRestoreInput,
    TRollbackStepPath,
} from './runtime-input.js';

const DEFAULT_MASTRA_STORAGE_DIRECTORY = '.agent-sidecar';
const DEFAULT_MASTRA_STORAGE_URL = `file:./${DEFAULT_MASTRA_STORAGE_DIRECTORY}/mastra.db`;
const DEFAULT_EXECUTION_AGENT_ID = 'calamex-agent-sidecar';
const DEFAULT_EXECUTION_AGENT_NAME = 'Calamex Agent Sidecar';
const RUNTIME_TOOL_PREVIEW_CHARS = 1200;
const WORKSPACE_OPERATION_TIMEOUT_MS = 30_000;
const WORKSPACE_LSP_DIAGNOSTIC_TIMEOUT_MS = 5_000;
const WORKSPACE_LSP_INIT_TIMEOUT_MS = 15_000;
const SIDECAR_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PROJECT_ROOT = resolve(SIDECAR_ROOT, '..');
const DEFAULT_ROLLBACK_STEP: TRollbackStepPath = [
    DurableStepIds.AGENTIC_EXECUTION,
    DurableStepIds.LLM_EXECUTION,
];

type TMastraRequestContextValues = Record<string, unknown>;
type TMastraRequestContext = RequestContext<TMastraRequestContextValues>;
type TDeepSeekFetch = typeof fetch;
type TDeepSeekLanguageModelFinishReason =
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error'
    | 'other'
    | 'unknown';
type TDeepSeekLanguageModelUsage = {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
    reasoningTokens?: number | undefined;
    cachedInputTokens?: number | undefined;
};
type TDeepSeekLanguageModelContent =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: string };
type TDeepSeekLanguageModelStreamPart =
    | { type: 'stream-start'; warnings: [] }
    | { type: 'response-metadata'; id?: string; modelId?: string; timestamp?: Date }
    | { type: 'reasoning-start'; id: string }
    | { type: 'reasoning-delta'; id: string; delta: string }
    | { type: 'reasoning-end'; id: string }
    | { type: 'text-start'; id: string }
    | { type: 'text-delta'; id: string; delta: string }
    | { type: 'text-end'; id: string }
    | { type: 'tool-input-start'; id: string; toolName: string }
    | { type: 'tool-input-delta'; id: string; delta: string }
    | { type: 'tool-input-end'; id: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
    | { type: 'finish'; finishReason: TDeepSeekLanguageModelFinishReason; usage: TDeepSeekLanguageModelUsage; providerMetadata: { deepseek: Record<string, never> } }
    | { type: 'raw'; rawValue: unknown }
    | { type: 'error'; error: unknown };
type TDeepSeekLanguageModelGenerateResult = {
    content: TDeepSeekLanguageModelContent[];
    finishReason: TDeepSeekLanguageModelFinishReason;
    usage: TDeepSeekLanguageModelUsage;
    providerMetadata: { deepseek: Record<string, never> };
    request: { body: IDeepSeekRequestBody };
    response: {
        headers: Record<string, string>;
        body: Record<string, unknown>;
        id?: string;
        modelId?: string;
        timestamp?: Date;
    };
    warnings: [];
};
type TDeepSeekLanguageModelStreamResult = {
    stream: ReadableStream<TDeepSeekLanguageModelStreamPart>;
    request: { body: IDeepSeekRequestBody };
    response: { headers: Record<string, string> };
};
interface IDeepSeekReasoningLanguageModel {
    readonly specificationVersion: 'v2';
    readonly provider: string;
    readonly modelId: string;
    supportedUrls: Record<string, RegExp[]>;
    supportsStructuredOutputs: true;
    doGenerate(options: unknown): Promise<TDeepSeekLanguageModelGenerateResult>;
    doStream(options: unknown): Promise<TDeepSeekLanguageModelStreamResult>;
}

type TMastraChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

interface IMastraAgentStreamLike {
    fullStream: AsyncIterable<unknown>;
    runId?: string;
    cleanup?: () => void;
}

interface IMastraApprovalOptions {
    runId: string;
    toolCallId?: string;
    abortSignal?: AbortSignal | undefined;
}

interface IMastraGenerateOptions {
    abortSignal?: AbortSignal | undefined;
    runId?: string;
    maxSteps?: number;
    toolChoice?: 'auto' | 'none';
    requestContext?: TMastraRequestContext;
    structuredOutput?: {
        schema: unknown;
    };
}

interface IMastraGenerateResultLike {
    object?: unknown;
    text?: string;
}

interface IMastraAgentLike {
    stream(
        messages: TMastraChatMessage[],
        options?: IMastraGenerateOptions,
    ): Promise<IMastraAgentStreamLike>;
    generate(
        messages: TMastraChatMessage[],
        options?: IMastraGenerateOptions,
    ): Promise<IMastraGenerateResultLike>;
    approveToolCall?: (options: IMastraApprovalOptions) => Promise<IMastraAgentStreamLike>;
    declineToolCall?: (options: IMastraApprovalOptions) => Promise<IMastraAgentStreamLike>;
}

interface IMastraWorkflowRunLike {
    timeTravel(options: {
        step: TRollbackStepPath;
        requestContext?: TMastraRequestContext;
        resumeData?: unknown;
    }): Promise<unknown>;
}

interface IMastraWorkflowLike {
    id: string;
    createRun(options?: { runId?: string }): Promise<IMastraWorkflowRunLike>;
}

interface IMastraExecutionHandle {
    agent: IMastraAgentLike;
    workflow: IMastraWorkflowLike;
}

interface IMastraWorkflowSnapshotLike {
    requestContext?: unknown;
    status?: string;
}

interface IMastraWorkflowStoreLike {
    loadWorkflowSnapshot(options: {
        workflowName: string;
        runId: string;
    }): Promise<IMastraWorkflowSnapshotLike | null>;
}

interface IMastraStorageLike {
    getStore(domain: 'workflows'): Promise<IMastraWorkflowStoreLike | null | undefined>;
}

interface IMastraAgentConfig {
    id: string;
    name: string;
    instructions: string;
    model: MastraModelConfig;
    tools?: ToolsInput;
    workspace?: AnyWorkspace;
}

interface IMcpToolLike {
    name: string;
    description: string;
    toolSpec: {
        inputSchema?: unknown;
    };
}

interface IMastraMcpBundle {
    tools: IMcpToolLike[];
    disconnectAll: () => Promise<void>;
}

interface IMastraRuntimeDeps {
    createAgent?: (config: IMastraAgentConfig) => IMastraAgentLike;
    createExecutionHandle?: (config: IMastraAgentConfig) => Promise<IMastraExecutionHandle>;
    createStorage?: () => IMastraStorageLike;
    loadExecutionSnapshot?: (
        workflowName: string,
        runId: string,
    ) => Promise<IMastraWorkflowSnapshotLike | null>;
    readModelConfig?: () => IDeepSeekModelConfig | null;
    createMcpClientBundle?: (
        options?: { workspaceRootPath?: string | null },
    ) => Promise<IMastraMcpBundle>;
    now?: () => string;
    fetch?: TDeepSeekFetch;
}

interface IMastraPendingApproval {
    agent: IMastraAgentLike;
    bundle: IMastraMcpBundle;
    runId: string;
    sessionId: string;
    toolCallId: string;
    workspace?: AnyWorkspace;
}

interface IMastraTextStreamSummary {
    pendingApproval: boolean;
    releaseResources: boolean;
    streamErrorMessage: string | null;
    visibleText: string;
}

type TRuntimeEventFactory = (draft: TAgentRuntimeEventDraft) => TAgentRuntimeOutputEvent;

interface IMastraDurableAgentLike {
    stream(
        messages: TMastraChatMessage[],
        options?: IMastraGenerateOptions,
    ): Promise<{
        fullStream: ReadableStream<unknown>;
        runId: string;
        cleanup: () => void;
    }>;
    resume(
        runId: string,
        resumeData: unknown,
    ): Promise<{
        fullStream: ReadableStream<unknown>;
        runId: string;
        cleanup: () => void;
    }>;
    getWorkflow(): IMastraWorkflowLike;
}

const createSessionId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const APPROVAL_TOKEN_PREFIX = 'mastra-approval.';

const DEFAULT_TOOL_INPUT_SCHEMA = {
    type: 'object',
    properties: {},
    additionalProperties: false,
} as const;

const toRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
);

const toNonEmptyString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const isRequestContextLike = (value: unknown): value is {
    all?: unknown;
    entries?: () => Iterable<readonly [string, unknown]>;
    toJSON?: () => unknown;
} => Boolean(value && typeof value === 'object');

const requestContextToRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value) {
        return null;
    }

    if (isRequestContextLike(value)) {
        if (typeof value.toJSON === 'function') {
            const jsonValue = toRecord(value.toJSON());
            if (jsonValue) {
                return jsonValue;
            }
        }

        const allValue = toRecord(value.all);
        if (allValue) {
            return allValue;
        }

        if (typeof value.entries === 'function') {
            return Object.fromEntries(value.entries());
        }
    }

    return toRecord(value);
};

const createMastraRequestContext = (
    values: Record<string, unknown>,
): TMastraRequestContext => new RequestContext<TMastraRequestContextValues>(
    Object.entries(values),
);

const toJsonValue = (value: unknown): TJsonValue => {
    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }

    const record = toRecord(value);
    if (!record) {
        return String(value);
    }

    return Object.fromEntries(
        Object.entries(record).map(([key, item]) => [key, toJsonValue(item)]),
    );
};

const stringifyJsonValue = (value: TJsonValue): string => {
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
};

const createRuntimePreview = (
    value: unknown,
    limit = RUNTIME_TOOL_PREVIEW_CHARS,
): string => {
    const normalized = stringifyJsonValue(toJsonValue(value))
        .replace(/\s+/gu, ' ')
        .trim();

    if (!normalized) {
        return '';
    }

    const characters = Array.from(normalized);
    const clipped = characters.length <= limit
        ? normalized
        : `${characters.slice(0, limit).join('')}...`;

    return redactForStream(clipped);
};

const pushUiEvent = (
    events: TAgentRuntimeOutputEvent[],
    event: TAgentRuntimeOutputEvent,
    options: IAgentRuntimeRunOptions = {},
): void => {
    events.push(event);
    options.onEvent?.(event);
};

const createRuntimeEventFactory = (
    context: IAgentRuntimeEventContext,
): ((draft: TAgentRuntimeEventDraft) => TAgentRuntimeOutputEvent) => {
    let seq = 0;

    return (draft) => ({
        type: 'agent_event',
        event: createAgentRuntimeEvent(context, seq++, draft),
    });
};

const createExecutionRequestContext = (
    input: IAgentRuntimeInput,
    systemPrompt: string,
): TMastraRequestContext => createMastraRequestContext({
    mode: input.mode,
    goal: input.goal,
    systemPrompt,
    workspaceRootPath: input.workspaceRootPath ?? null,
    context: input.context ?? [],
});

const resolveSystemPromptFromSnapshot = (
    snapshot: IMastraWorkflowSnapshotLike,
): string | null => toNonEmptyString(requestContextToRecord(snapshot.requestContext)?.systemPrompt);

const resolveWorkspaceRootPathFromSnapshot = (
    snapshot: IMastraWorkflowSnapshotLike,
): string | undefined => {
    const value = toNonEmptyString(requestContextToRecord(snapshot.requestContext)?.workspaceRootPath);
    return value ?? undefined;
};

const extractRestoreResultText = (result: unknown): string | null => {
    const topLevel = toRecord(result);
    const nestedResult = toRecord(topLevel?.result);
    const output = toRecord(nestedResult?.output) ?? toRecord(topLevel?.output);
    return toNonEmptyString(output?.text);
};

const resolveMastraStorageUrl = (env: NodeJS.ProcessEnv = process.env): string => {
    const configured = toNonEmptyString(env.AGENT_SIDECAR_LIBSQL_URL);

    if (configured) {
        return configured;
    }

    mkdirSync(join(process.cwd(), DEFAULT_MASTRA_STORAGE_DIRECTORY), { recursive: true });
    return DEFAULT_MASTRA_STORAGE_URL;
};

const resolveWorkspaceDirectory = (workspaceRootPath?: string | null): string | null => {
    const configured = toNonEmptyString(workspaceRootPath);

    if (!configured) {
        return null;
    }

    const absolutePath = resolve(configured);

    try {
        if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
            return null;
        }

        return realpathSync(absolutePath);
    } catch {
        return null;
    }
};

const createWorkspaceSearchPaths = (workspaceRoot: string): string[] => {
    const searchPaths = [workspaceRoot, SIDECAR_ROOT, PROJECT_ROOT, process.cwd()];
    const seen = new Set<string>();

    return searchPaths.flatMap((path) => {
        const resolvedPath = resolveWorkspaceDirectory(path);

        if (!resolvedPath || seen.has(resolvedPath)) {
            return [];
        }

        seen.add(resolvedPath);
        return [resolvedPath];
    });
};

const createWorkspaceLspConfig = (workspaceRoot: string): LSPConfig => ({
    root: workspaceRoot,
    diagnosticTimeout: WORKSPACE_LSP_DIAGNOSTIC_TIMEOUT_MS,
    initTimeout: WORKSPACE_LSP_INIT_TIMEOUT_MS,
    searchPaths: createWorkspaceSearchPaths(workspaceRoot),
});

const createWorkspaceToolsConfig = (): WorkspaceToolsConfig => ({
    enabled: false,
    requireApproval: false,
    [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: {
        enabled: true,
        maxOutputTokens: 6_000,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: {
        enabled: true,
        maxOutputTokens: 3_000,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT]: {
        enabled: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.GREP]: {
        enabled: true,
        maxOutputTokens: 6_000,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT]: {
        enabled: true,
        requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.LSP.LSP_INSPECT]: {
        enabled: true,
        maxOutputTokens: 6_000,
    },
});

const createMastraWorkspace = (workspaceRootPath?: string | null): AnyWorkspace | undefined => {
    const workspaceRoot = resolveWorkspaceDirectory(workspaceRootPath);

    if (!workspaceRoot) {
        return undefined;
    }

    const workspaceId = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 24);

    return new Workspace({
        id: `sidecar-${workspaceId}`,
        name: 'Xiaojianc Agent Workspace',
        filesystem: new LocalFilesystem({
            basePath: workspaceRoot,
            contained: true,
        }),
        sandbox: new LocalSandbox({
            workingDirectory: workspaceRoot,
            timeout: WORKSPACE_OPERATION_TIMEOUT_MS,
        }),
        lsp: createWorkspaceLspConfig(workspaceRoot),
        tools: createWorkspaceToolsConfig(),
        operationTimeout: WORKSPACE_OPERATION_TIMEOUT_MS,
    });
};

const destroyMastraWorkspace = async (workspace: AnyWorkspace | undefined): Promise<void> => {
    if (!workspace || workspace.status === 'destroyed') {
        return;
    }

    await workspace.destroy().catch(() => undefined);
};

const createMastraModelConfig = (
    modelConfig: IDeepSeekModelConfig,
    fetchFn: TDeepSeekFetch,
): MastraModelConfig => createDeepSeekReasoningLanguageModel(modelConfig, fetchFn);

const defaultCreateAgent = (config: IMastraAgentConfig): IMastraAgentLike => {
    const agent = new Agent({
        id: config.id,
        name: config.name,
        instructions: config.instructions,
        model: config.model,
        ...(config.tools ? { tools: config.tools } : {}),
        ...(config.workspace ? { workspace: config.workspace } : {}),
    });
    const bridge = agent as unknown as IMastraAgentLike;
    const approveToolCall = typeof bridge.approveToolCall === 'function'
        ? async (options: IMastraApprovalOptions): Promise<IMastraAgentStreamLike> => bridge.approveToolCall!(options)
        : undefined;
    const declineToolCall = typeof bridge.declineToolCall === 'function'
        ? async (options: IMastraApprovalOptions): Promise<IMastraAgentStreamLike> => bridge.declineToolCall!(options)
        : undefined;

    return {
        stream: async (messages, options) => bridge.stream(messages, options),
        generate: async (messages, options) => bridge.generate(messages, options),
        ...(approveToolCall ? { approveToolCall } : {}),
        ...(declineToolCall ? { declineToolCall } : {}),
    };
};

const defaultCreateStorage = (): IMastraStorageLike => new LibSQLStore({
    id: 'agent-sidecar-storage',
    url: resolveMastraStorageUrl(),
});

const defaultCreateExecutionHandle = async (
    config: IMastraAgentConfig,
    storage: IMastraStorageLike,
): Promise<IMastraExecutionHandle> => {
    const baseAgent = new Agent({
        id: config.id,
        name: config.name,
        instructions: config.instructions,
        model: config.model,
        ...(config.tools ? { tools: config.tools } : {}),
        ...(config.workspace ? { workspace: config.workspace } : {}),
    });
    const durableAgent = createDurableAgent({ agent: baseAgent });
    const mastra = new Mastra({
        agents: {
            [config.id]: durableAgent,
        },
        ...(config.tools ? { tools: config.tools as never } : {}),
        storage: storage as never,
    });
    const registeredAgent = mastra.getAgentById(baseAgent.id) as unknown as IMastraDurableAgentLike;

    return {
        agent: {
            stream: async (messages, options) => {
                const streamResult = await registeredAgent.stream(messages, {
                    ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
                    ...(options?.runId ? { runId: options.runId } : {}),
                    ...(options?.maxSteps ? { maxSteps: options.maxSteps } : {}),
                    ...(options?.toolChoice ? { toolChoice: options.toolChoice } : {}),
                    ...(options?.requestContext ? { requestContext: options.requestContext } : {}),
                });

                return {
                    fullStream: streamResult.fullStream as unknown as AsyncIterable<unknown>,
                    runId: streamResult.runId,
                    cleanup: streamResult.cleanup,
                };
            },
            generate: async () => {
                throw new Error('Durable execution handle does not support generate().');
            },
            approveToolCall: async ({ runId }) => {
                const streamResult = await registeredAgent.resume(runId, { approved: true });

                return {
                    fullStream: streamResult.fullStream as unknown as AsyncIterable<unknown>,
                    runId: streamResult.runId,
                    cleanup: streamResult.cleanup,
                };
            },
            declineToolCall: async ({ runId }) => {
                const streamResult = await registeredAgent.resume(runId, { approved: false });

                return {
                    fullStream: streamResult.fullStream as unknown as AsyncIterable<unknown>,
                    runId: streamResult.runId,
                    cleanup: streamResult.cleanup,
                };
            },
        },
        workflow: registeredAgent.getWorkflow(),
    };
};

const getMcpToolClient = (tool: IMcpToolLike): {
    callTool: (targetTool: unknown, args: TJsonValue) => Promise<unknown>;
} | null => {
    const candidate = toRecord(tool)?.mcpClient;
    const client = toRecord(candidate);

    if (!client || typeof client.callTool !== 'function') {
        return null;
    }

    return {
        callTool: client.callTool as (targetTool: unknown, args: TJsonValue) => Promise<unknown>,
    };
};

const createMastraMcpTools = (
    tools: IMcpToolLike[],
): Record<string, ReturnType<typeof createTool>> => Object.fromEntries(
    tools.map((tool) => [tool.name, createTool({
        id: tool.name,
        description: tool.description,
        inputSchema: toStandardSchema(tool.toolSpec.inputSchema ?? DEFAULT_TOOL_INPUT_SCHEMA),
        execute: async (inputData) => {
            const client = getMcpToolClient(tool);

            if (!client) {
                throw new Error(`MCP tool ${tool.name} 缺少客户端句柄。`);
            }

            return toJsonValue(await client.callTool(tool, toJsonValue(inputData)));
        },
    })]),
);

const loadMastraMcpTools = async (
    createBundle: (
        options?: { workspaceRootPath?: string | null },
    ) => Promise<IMastraMcpBundle>,
    workspaceRootPath?: string,
): Promise<{
    bundle: IMastraMcpBundle;
    tools: ToolsInput;
    hasTools: boolean;
}> => {
    const bundle = await createBundle(workspaceRootPath
        ? { workspaceRootPath }
        : {});
    const tools = createMastraMcpTools(bundle.tools);

    return {
        bundle,
        tools,
        hasTools: Object.keys(tools).length > 0,
    };
};

const isConversationMessage = (
    message: IAgentMessageInput,
): message is IAgentMessageInput & { role: 'user' | 'assistant' } => (
    message.role === 'user' || message.role === 'assistant'
);

const findLastUserMessageIndex = (messages: IAgentMessageInput[]): number => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') {
            return index;
        }
    }

    return -1;
};

const buildMastraUserPrompt = (input: IAgentRuntimeInput): string => {
    const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
    const lastUserContent = lastUserMessageIndex >= 0
        ? input.messages[lastUserMessageIndex]?.content.trim()
        : '';
    const request = lastUserContent || input.goal;
    const toolContext = input.messages
        .filter((message) => message.role === 'tool')
        .map((message, index) => `tool ${index + 1}: ${message.content}`)
        .join('\n');
    const goal = request === input.goal ? '' : `目标：${input.goal}`;

    return [
        goal,
        request,
        toolContext ? `工具上下文：\n${toolContext}` : '',
    ]
        .filter((line) => line.trim().length > 0)
        .join('\n');
};

const buildMastraMessages = (input: IAgentRuntimeInput): TMastraChatMessage[] => {
    const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
    const history = (lastUserMessageIndex >= 0
        ? input.messages.slice(0, lastUserMessageIndex)
        : input.messages)
        .filter(isConversationMessage)
        .map((message) => ({
            role: message.role,
            content: message.content,
        }));
    const userPrompt = buildMastraUserPrompt(input).trim();

    if (userPrompt.length > 0) {
        history.push({
            role: 'user',
            content: userPrompt,
        });
    }

    if (history.length > 0) {
        return history;
    }

    return [{
        role: 'user',
        content: input.goal.trim().length > 0 ? input.goal : '继续。',
    }];
};

const formatApprovalSummary = (payload: ToolCallPayload): string => {
    if (payload.args === undefined) {
        return `${payload.toolName} 请求执行，但当前没有可展示的参数。`;
    }

    const serializedArgs = JSON.stringify(toJsonValue(payload.args));
    return `${payload.toolName} 请求执行，参数：${serializedArgs}`;
};

const normalizeMastraError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    const message = toRecord(error)?.message;
    return typeof message === 'string' && message.trim().length > 0
        ? message
        : String(error);
};

const encodeApprovalRequestId = (runId: string, toolCallId: string): string => {
    const encoded = Buffer.from(JSON.stringify({ runId, toolCallId }), 'utf8').toString('base64url');

    return `${APPROVAL_TOKEN_PREFIX}${encoded}`;
};

const decodeApprovalRequestId = (
    requestId: string,
): { runId: string; toolCallId: string } | null => {
    if (!requestId.startsWith(APPROVAL_TOKEN_PREFIX)) {
        return null;
    }

    try {
        const parsed = JSON.parse(
            Buffer.from(requestId.slice(APPROVAL_TOKEN_PREFIX.length), 'base64url').toString('utf8'),
        ) as { runId?: unknown; toolCallId?: unknown };

        return typeof parsed.runId === 'string' && typeof parsed.toolCallId === 'string'
            ? { runId: parsed.runId, toolCallId: parsed.toolCallId }
            : null;
    } catch {
        return null;
    }
};

const getChunkRunId = (chunk: unknown): string | null => {
    const runId = toRecord(chunk)?.runId;
    return typeof runId === 'string' && runId.trim().length > 0 ? runId : null;
};

const getStringField = (
    record: Record<string, unknown> | null,
    fields: readonly string[],
): string | null => {
    if (!record) {
        return null;
    }

    for (const field of fields) {
        const value = record[field];
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }

    return null;
};

const isApprovedDecision = (decision: string): boolean => {
    const normalizedDecision = decision.trim().toLowerCase();

    return ![
        'decline',
        'declined',
        'deny',
        'denied',
        'no',
        'reject',
        'rejected',
    ].includes(normalizedDecision);
};

const getTextDelta = (payload: TextDeltaPayload): string => payload.text;

const getReasoningDelta = (chunk: unknown): string | null => {
    const record = toRecord(chunk);
    const chunkType = getStringField(record, ['type']);
    const reasoningFields = [
        'textDelta',
        'text',
        'delta',
        'reasoning',
        'reasoning_content',
        'reasoningContent',
    ] as const;

    if (
        chunkType !== 'reasoning'
        && chunkType !== 'reasoning-delta'
        && chunkType !== 'reasoning_delta'
    ) {
        return null;
    }

    return getStringField(record, reasoningFields)
        ?? getStringField(toRecord(record?.payload), reasoningFields)
        ?? getStringField(toRecord(record?.delta), reasoningFields);
};

const isChunkWithType = <TType extends string>(
    chunk: unknown,
    type: TType,
): chunk is { type: TType; payload?: unknown } => toRecord(chunk)?.type === type;

const isTextDeltaChunk = (
    chunk: unknown,
): chunk is { type: 'text-delta'; payload: TextDeltaPayload } => {
    if (!isChunkWithType(chunk, 'text-delta')) {
        return false;
    }

    const payload = toRecord(chunk.payload);
    return typeof payload?.text === 'string';
};

const isToolCallChunk = (
    chunk: unknown,
): chunk is { type: 'tool-call' | 'tool-call-approval'; payload: ToolCallPayload } => {
    if (!isChunkWithType(chunk, 'tool-call') && !isChunkWithType(chunk, 'tool-call-approval')) {
        return false;
    }

    const payload = toRecord(chunk.payload);
    return typeof payload?.toolName === 'string' && typeof payload?.toolCallId === 'string';
};

const isToolResultChunk = (
    chunk: unknown,
): chunk is { type: 'tool-result'; payload: { toolName: string; result: unknown } } => {
    if (!isChunkWithType(chunk, 'tool-result')) {
        return false;
    }

    const payload = toRecord(chunk.payload);
    return typeof payload?.toolName === 'string' && 'result' in payload;
};

const isToolCallSuspendedChunk = (
    chunk: unknown,
): chunk is { type: 'tool-call-suspended'; payload: { toolCallId: string; toolName: string; suspendPayload: unknown } } => {
    if (!isChunkWithType(chunk, 'tool-call-suspended')) {
        return false;
    }

    const payload = toRecord(chunk.payload);
    return typeof payload?.toolCallId === 'string' && typeof payload?.toolName === 'string';
};

const isToolErrorChunk = (
    chunk: unknown,
): chunk is { type: 'tool-error'; payload: { toolName: string; error: unknown } } => {
    if (!isChunkWithType(chunk, 'tool-error')) {
        return false;
    }

    const payload = toRecord(chunk.payload);
    return typeof payload?.toolName === 'string' && 'error' in payload;
};

const isErrorChunk = (
    chunk: unknown,
): chunk is { type: 'error'; payload: { error: unknown } } => {
    if (!isChunkWithType(chunk, 'error')) {
        return false;
    }

    const payload = toRecord(chunk.payload);
    return payload !== null && 'error' in payload;
};

interface IDeepSeekToolFunction {
    name: string;
    arguments: string;
}

interface IDeepSeekToolCall {
    id: string;
    type: 'function';
    function: IDeepSeekToolFunction;
}

interface IDeepSeekPendingToolCall {
    index: number;
    id: string;
    functionName: string;
    argumentsText: string;
    started: boolean;
    emitted: boolean;
}

type TDeepSeekChatMessage =
    | { role: 'system' | 'user'; content: string }
    | {
        role: 'assistant';
        content: string;
        reasoning_content?: string;
        tool_calls?: IDeepSeekToolCall[];
    }
    | { role: 'tool'; tool_call_id: string; content: string };

interface IDeepSeekToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: { [key: string]: TJsonValue };
    };
}

interface IDeepSeekModelCallOptions {
    prompt?: unknown;
    maxOutputTokens?: unknown;
    temperature?: unknown;
    topP?: unknown;
    frequencyPenalty?: unknown;
    presencePenalty?: unknown;
    stopSequences?: unknown;
    responseFormat?: unknown;
    seed?: unknown;
    tools?: unknown;
    toolChoice?: unknown;
    includeRawChunks?: unknown;
    abortSignal?: AbortSignal | undefined;
    headers?: unknown;
    providerOptions?: unknown;
}

interface IDeepSeekUsage {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    prompt_tokens_details?: {
        cached_tokens?: number | null;
    } | null;
    completion_tokens_details?: {
        reasoning_tokens?: number | null;
        accepted_prediction_tokens?: number | null;
        rejected_prediction_tokens?: number | null;
    } | null;
}

interface IDeepSeekRequestBody {
    model: string;
    messages: TDeepSeekChatMessage[];
    stream?: boolean;
    max_tokens?: number | undefined;
    temperature?: number | undefined;
    top_p?: number | undefined;
    frequency_penalty?: number | undefined;
    presence_penalty?: number | undefined;
    stop?: string[] | undefined;
    seed?: number | undefined;
    response_format?: TJsonValue | undefined;
    tools?: IDeepSeekToolDefinition[] | undefined;
    tool_choice?: 'auto' | 'none' | 'required' | {
        type: 'function';
        function: {
            name: string;
        };
    } | undefined;
}

interface IDeepSeekFetchResult {
    response: Response;
    body: IDeepSeekRequestBody;
}

const normalizeDeepSeekModelId = (model: string): string => {
    const normalized = model.trim();
    return normalized.startsWith('deepseek/')
        ? normalized.slice('deepseek/'.length)
        : normalized;
};

const buildDeepSeekChatCompletionsUrl = (baseUrl: string): string => {
    const normalized = baseUrl.trim().replace(/\/+$/u, '');
    return normalized.endsWith('/chat/completions')
        ? normalized
        : `${normalized}/chat/completions`;
};

const toDeepSeekToolParameters = (schema: unknown): { [key: string]: TJsonValue } => {
    const normalized = toJsonValue(schema ?? DEFAULT_TOOL_INPUT_SCHEMA);
    return toRecord(normalized) as { [key: string]: TJsonValue } | null
        ?? DEFAULT_TOOL_INPUT_SCHEMA;
};

const createDeepSeekToolDefinitions = (
    tools: unknown,
): IDeepSeekToolDefinition[] => {
    if (!Array.isArray(tools)) {
        return [];
    }

    return tools.flatMap((tool): IDeepSeekToolDefinition[] => {
        const record = toRecord(tool);
        if (record?.type !== 'function') {
            return [];
        }

        const name = getStringField(record, ['name']);
        if (!name) {
            return [];
        }

        return [{
            type: 'function',
            function: {
                name,
                description: getStringField(record, ['description']) ?? '',
                parameters: toDeepSeekToolParameters(record.inputSchema),
            },
        }];
    });
};

const appendDeepSeekSseDataLines = (
    eventText: string,
    chunks: string[],
): void => {
    for (const line of eventText.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
            continue;
        }

        const data = trimmed.slice('data:'.length).trim();
        if (data && data !== '[DONE]') {
            chunks.push(data);
        }
    }
};

async function* readDeepSeekSseData(response: Response): AsyncIterable<string> {
    const reader = response.body?.getReader();
    if (!reader) {
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split(/\r?\n\r?\n/u);
            buffer = parts.pop() ?? '';

            const chunks: string[] = [];
            parts.forEach((part) => appendDeepSeekSseDataLines(part, chunks));
            for (const chunk of chunks) {
                yield chunk;
            }
        }

        buffer += decoder.decode();
        const chunks: string[] = [];
        appendDeepSeekSseDataLines(buffer, chunks);
        for (const chunk of chunks) {
            yield chunk;
        }
    } finally {
        reader.releaseLock();
    }
}

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
    try {
        return toRecord(JSON.parse(value));
    } catch {
        return null;
    }
};

const parseDeepSeekJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
    const text = await response.text();
    const parsed = parseJsonRecord(text);

    if (!parsed) {
        throw new Error('DeepSeek 返回了无法解析的 JSON 响应。');
    }

    return parsed;
};

const getArrayField = (
    record: Record<string, unknown> | null,
    field: string,
): unknown[] => {
    const value = record?.[field];
    return Array.isArray(value) ? value : [];
};

const getNumberField = (
    record: Record<string, unknown> | null,
    field: string,
): number | null => {
    const value = record?.[field];
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
};

const getBooleanField = (
    record: Record<string, unknown> | null,
    field: string,
): boolean | null => {
    const value = record?.[field];
    return typeof value === 'boolean' ? value : null;
};

const serializeDeepSeekToolResult = (value: unknown): string =>
    stringifyJsonValue(toJsonValue(value));

const serializeDeepSeekToolInput = (value: unknown): string => (
    typeof value === 'string'
        ? value
        : stringifyJsonValue(toJsonValue(value))
);

const mergeDeepSeekToolCallDelta = (
    toolCalls: Map<number, IDeepSeekPendingToolCall>,
    value: unknown,
): void => {
    const record = toRecord(value);
    const index = getNumberField(record, 'index');
    if (index === null) {
        return;
    }

    const existing = toolCalls.get(index) ?? {
        index,
        id: '',
        functionName: '',
        argumentsText: '',
        started: false,
        emitted: false,
    };
    const functionRecord = toRecord(record?.function);
    const id = getStringField(record, ['id']);
    const name = getStringField(functionRecord, ['name']);
    const argumentsText = getStringField(functionRecord, ['arguments']);

    toolCalls.set(index, {
        ...existing,
        ...(id ? { id } : {}),
        ...(name ? { functionName: `${existing.functionName}${name}` } : {}),
        ...(argumentsText ? { argumentsText: `${existing.argumentsText}${argumentsText}` } : {}),
    });
};

const isDeepSeekToolCallReady = (toolCall: IDeepSeekPendingToolCall): boolean =>
    Boolean(toolCall.id && toolCall.functionName);

const isJsonObjectText = (value: string): boolean => {
    if (!value.trim()) {
        return true;
    }

    return parseJsonRecord(value) !== null;
};

const createDeepSeekHeaders = (
    modelConfig: IDeepSeekModelConfig,
    callHeaders: unknown,
): Record<string, string> => {
    const headers: Record<string, string> = {
        authorization: `Bearer ${modelConfig.apiKey}`,
        'content-type': 'application/json',
    };
    const extraHeaders = toRecord(callHeaders);

    if (extraHeaders) {
        Object.entries(extraHeaders).forEach(([key, value]) => {
            if (typeof value === 'string' && value.length > 0) {
                headers[key.toLowerCase()] = value;
            }
        });
    }

    return headers;
};

const getDeepSeekResponseHeaders = (headers: Headers): Record<string, string> =>
    Object.fromEntries(headers.entries());

const toDeepSeekTextContent = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map((part) => {
            const record = toRecord(part);
            return record?.type === 'text'
                ? getStringField(record, ['text']) ?? ''
                : '';
        })
        .join('');
};

const toDeepSeekToolResultContent = (output: unknown): string => {
    const record = toRecord(output);
    const type = getStringField(record, ['type']);

    if (type === 'text' || type === 'error-text') {
        return getStringField(record, ['value']) ?? '';
    }

    if ('value' in (record ?? {})) {
        return serializeDeepSeekToolResult(record?.value);
    }

    return serializeDeepSeekToolResult(output);
};

const appendDeepSeekAssistantMessage = (
    messages: TDeepSeekChatMessage[],
    content: unknown,
): void => {
    if (!Array.isArray(content)) {
        return;
    }

    let text = '';
    let reasoningContent = '';
    const toolCalls: IDeepSeekToolCall[] = [];

    content.forEach((part) => {
        const record = toRecord(part);
        const type = getStringField(record, ['type']);

        if (type === 'text') {
            text += getStringField(record, ['text']) ?? '';
            return;
        }

        if (type === 'reasoning') {
            reasoningContent += getStringField(record, ['text', 'reasoning']) ?? '';
            return;
        }

        if (type === 'tool-call') {
            const toolCallId = getStringField(record, ['toolCallId']);
            const toolName = getStringField(record, ['toolName']);

            if (!toolCallId || !toolName) {
                return;
            }

            toolCalls.push({
                id: toolCallId,
                type: 'function',
                function: {
                    name: toolName,
                    arguments: serializeDeepSeekToolInput(record?.input),
                },
            });
        }
    });

    messages.push({
        role: 'assistant',
        content: text,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
};

const appendDeepSeekToolMessages = (
    messages: TDeepSeekChatMessage[],
    content: unknown,
): void => {
    if (!Array.isArray(content)) {
        return;
    }

    content.forEach((part) => {
        const record = toRecord(part);
        if (record?.type !== 'tool-result') {
            return;
        }

        const toolCallId = getStringField(record, ['toolCallId']);
        if (!toolCallId) {
            return;
        }

        messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: toDeepSeekToolResultContent(record.output),
        });
    });
};

const shouldMoveReasoningToToolCall = (
    candidate: TDeepSeekChatMessage,
): candidate is Extract<TDeepSeekChatMessage, { role: 'assistant' }> => (
    candidate.role === 'assistant'
    && Boolean(candidate.reasoning_content)
    && !candidate.tool_calls?.length
    && candidate.content.length === 0
);

const attachDeepSeekReasoningToPreviousToolCall = (
    messages: TDeepSeekChatMessage[],
    reasoningIndex: number,
): boolean => {
    const reasoningMessage = messages[reasoningIndex];
    if (!reasoningMessage || !shouldMoveReasoningToToolCall(reasoningMessage)) {
        return false;
    }

    for (let index = reasoningIndex - 1; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (!candidate) {
            continue;
        }

        if (candidate.role === 'tool') {
            continue;
        }

        if (candidate.role !== 'assistant' || !candidate.tool_calls?.length) {
            return false;
        }

        candidate.reasoning_content = [
            candidate.reasoning_content ?? '',
            reasoningMessage.reasoning_content ?? '',
        ].join('');
        messages.splice(reasoningIndex, 1);
        return true;
    }

    return false;
};

const normalizeDeepSeekToolReasoningMessages = (
    messages: TDeepSeekChatMessage[],
): TDeepSeekChatMessage[] => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        attachDeepSeekReasoningToPreviousToolCall(messages, index);
    }

    return messages;
};

const convertDeepSeekPromptMessages = (prompt: unknown): TDeepSeekChatMessage[] => {
    if (!Array.isArray(prompt)) {
        return [];
    }

    const messages: TDeepSeekChatMessage[] = [];

    prompt.forEach((message) => {
        const record = toRecord(message);
        const role = getStringField(record, ['role']);

        if (role === 'system') {
            messages.push({
                role,
                content: toDeepSeekTextContent(record?.content),
            });
            return;
        }

        if (role === 'user') {
            messages.push({
                role,
                content: toDeepSeekTextContent(record?.content),
            });
            return;
        }

        if (role === 'assistant') {
            appendDeepSeekAssistantMessage(messages, record?.content);
            return;
        }

        if (role === 'tool') {
            appendDeepSeekToolMessages(messages, record?.content);
        }
    });

    return normalizeDeepSeekToolReasoningMessages(messages);
};

const toDeepSeekToolChoice = (
    toolChoice: unknown,
): IDeepSeekRequestBody['tool_choice'] | undefined => {
    const record = toRecord(toolChoice);
    const type = getStringField(record, ['type']);

    if (type === 'auto' || type === 'none' || type === 'required') {
        return type;
    }

    if (type === 'tool') {
        const toolName = getStringField(record, ['toolName']);
        return toolName
            ? {
                type: 'function',
                function: {
                    name: toolName,
                },
            }
            : undefined;
    }

    return undefined;
};

const toDeepSeekResponseFormat = (responseFormat: unknown): TJsonValue | undefined => {
    const record = toRecord(responseFormat);
    const type = getStringField(record, ['type']);

    if (type !== 'json') {
        return undefined;
    }

    const schema = toRecord(record?.schema);
    if (!schema) {
        return {
            type: 'json_object',
        };
    }

    return {
        type: 'json_schema',
        json_schema: {
            name: getStringField(record, ['name']) ?? 'response',
            ...(getStringField(record, ['description'])
                ? { description: getStringField(record, ['description']) }
                : {}),
            schema: toJsonValue(schema),
        },
    };
};

const getNumberOption = (
    options: IDeepSeekModelCallOptions,
    key: keyof IDeepSeekModelCallOptions,
): number | undefined => {
    const value = options[key];
    return typeof value === 'number' ? value : undefined;
};

const getStringArrayOption = (
    value: unknown,
): string[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const strings = value.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : undefined;
};

const getDeepSeekProviderOptions = (
    providerOptions: unknown,
): Record<string, TJsonValue> => {
    const record = toRecord(providerOptions);
    const deepseekOptions = toRecord(record?.deepseek);

    if (!deepseekOptions) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(deepseekOptions).map(([key, value]) => [key, toJsonValue(value)]),
    );
};

const buildDeepSeekRequestBody = (
    modelConfig: IDeepSeekModelConfig,
    options: IDeepSeekModelCallOptions,
    stream: boolean,
): IDeepSeekRequestBody => {
    const tools = createDeepSeekToolDefinitions(options.tools);
    const toolChoice = toDeepSeekToolChoice(options.toolChoice);
    const responseFormat = toDeepSeekResponseFormat(options.responseFormat);

    return {
        model: normalizeDeepSeekModelId(modelConfig.model),
        messages: convertDeepSeekPromptMessages(options.prompt),
        stream,
        ...(getNumberOption(options, 'maxOutputTokens') !== undefined
            ? { max_tokens: getNumberOption(options, 'maxOutputTokens') }
            : {}),
        ...(getNumberOption(options, 'temperature') !== undefined
            ? { temperature: getNumberOption(options, 'temperature') }
            : {}),
        ...(getNumberOption(options, 'topP') !== undefined ? { top_p: getNumberOption(options, 'topP') } : {}),
        ...(getNumberOption(options, 'frequencyPenalty') !== undefined
            ? { frequency_penalty: getNumberOption(options, 'frequencyPenalty') }
            : {}),
        ...(getNumberOption(options, 'presencePenalty') !== undefined
            ? { presence_penalty: getNumberOption(options, 'presencePenalty') }
            : {}),
        ...(getStringArrayOption(options.stopSequences) ? { stop: getStringArrayOption(options.stopSequences) } : {}),
        ...(getNumberOption(options, 'seed') !== undefined ? { seed: getNumberOption(options, 'seed') } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        ...getDeepSeekProviderOptions(options.providerOptions),
    };
};

const toDeepSeekCallOptions = (options: unknown): IDeepSeekModelCallOptions => {
    const record = toRecord(options) ?? {};
    return {
        prompt: record.prompt,
        maxOutputTokens: record.maxOutputTokens,
        temperature: record.temperature,
        topP: record.topP,
        frequencyPenalty: record.frequencyPenalty,
        presencePenalty: record.presencePenalty,
        stopSequences: record.stopSequences,
        responseFormat: record.responseFormat,
        seed: record.seed,
        tools: record.tools,
        toolChoice: record.toolChoice,
        includeRawChunks: record.includeRawChunks,
        abortSignal: record.abortSignal instanceof AbortSignal ? record.abortSignal : undefined,
        headers: record.headers,
        providerOptions: record.providerOptions,
    };
};

const postDeepSeekChatCompletions = async (
    modelConfig: IDeepSeekModelConfig,
    fetchFn: TDeepSeekFetch,
    options: IDeepSeekModelCallOptions,
    stream: boolean,
): Promise<IDeepSeekFetchResult> => {
    const body = buildDeepSeekRequestBody(modelConfig, options, stream);
    const response = await fetchFn(buildDeepSeekChatCompletionsUrl(modelConfig.baseUrl), {
        method: 'POST',
        headers: createDeepSeekHeaders(modelConfig, options.headers),
        body: JSON.stringify(body),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });

    if (!response.ok) {
        throw new Error(`DeepSeek 请求失败：HTTP ${response.status} ${await response.text()}`);
    }

    return {
        response,
        body,
    };
};

const getDeepSeekFinishReason = (value: string | null): TDeepSeekLanguageModelFinishReason => {
    switch (value) {
        case 'stop':
            return 'stop';
        case 'length':
            return 'length';
        case 'content_filter':
            return 'content-filter';
        case 'function_call':
        case 'tool_calls':
            return 'tool-calls';
        default:
            return 'unknown';
    }
};

const getDeepSeekUsage = (usage: IDeepSeekUsage | null | undefined): TDeepSeekLanguageModelUsage => ({
    inputTokens: usage?.prompt_tokens ?? undefined,
    outputTokens: usage?.completion_tokens ?? undefined,
    totalTokens: usage?.total_tokens ?? undefined,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? undefined,
});

const getDeepSeekResponseMetadata = (record: Record<string, unknown> | null): {
    id?: string;
    modelId?: string;
    timestamp?: Date;
} => {
    const metadata: {
        id?: string;
        modelId?: string;
        timestamp?: Date;
    } = {};
    const id = getStringField(record, ['id']);
    const modelId = getStringField(record, ['model']);

    if (id) {
        metadata.id = id;
    }

    if (modelId) {
        metadata.modelId = modelId;
    }

    if (typeof record?.created === 'number') {
        metadata.timestamp = new Date(record.created * 1000);
    }

    return metadata;
};

const getDeepSeekChoice = (record: Record<string, unknown> | null): Record<string, unknown> | null =>
    toRecord(getArrayField(record, 'choices')[0]);

const getDeepSeekUsageRecord = (record: Record<string, unknown> | null): IDeepSeekUsage | null =>
    toRecord(record?.usage) as IDeepSeekUsage | null;

const createDeepSeekGeneratedContent = (
    message: Record<string, unknown> | null,
): TDeepSeekLanguageModelContent[] => {
    const content: TDeepSeekLanguageModelContent[] = [];
    const text = getStringField(message, ['content']);
    const reasoning = getStringField(message, ['reasoning_content', 'reasoning']);

    if (text) {
        content.push({
            type: 'text',
            text,
        });
    }

    if (reasoning) {
        content.push({
            type: 'reasoning',
            text: reasoning,
        });
    }

    getArrayField(message, 'tool_calls').forEach((toolCall) => {
        const record = toRecord(toolCall);
        const functionRecord = toRecord(record?.function);
        const toolCallId = getStringField(record, ['id']);
        const toolName = getStringField(functionRecord, ['name']);

        if (!toolCallId || !toolName) {
            return;
        }

        content.push({
            type: 'tool-call',
            toolCallId,
            toolName,
            input: getStringField(functionRecord, ['arguments']) ?? '{}',
        });
    });

    return content;
};

const emitDeepSeekToolCall = (
    controller: ReadableStreamDefaultController<TDeepSeekLanguageModelStreamPart>,
    toolCall: IDeepSeekPendingToolCall,
): void => {
    if (!isDeepSeekToolCallReady(toolCall) || toolCall.emitted) {
        return;
    }

    if (!toolCall.started) {
        controller.enqueue({
            type: 'tool-input-start',
            id: toolCall.id,
            toolName: toolCall.functionName,
        });
        toolCall.started = true;
    }

    controller.enqueue({
        type: 'tool-input-end',
        id: toolCall.id,
    });
    controller.enqueue({
        type: 'tool-call',
        toolCallId: toolCall.id,
        toolName: toolCall.functionName,
        input: toolCall.argumentsText || '{}',
    });
    toolCall.emitted = true;
};

const streamDeepSeekResponse = async (
    response: Response,
    includeRawChunks: boolean,
    controller: ReadableStreamDefaultController<TDeepSeekLanguageModelStreamPart>,
): Promise<void> => {
    const pendingToolCalls = new Map<number, IDeepSeekPendingToolCall>();
    let finishReason: TDeepSeekLanguageModelFinishReason = 'unknown';
    let usage: IDeepSeekUsage | null = null;
    let isReasoningActive = false;
    let isTextActive = false;
    let hasMetadata = false;

    for await (const data of readDeepSeekSseData(response)) {
        const record = parseJsonRecord(data);

        if (!record) {
            continue;
        }

        if (includeRawChunks) {
            controller.enqueue({
                type: 'raw',
                rawValue: record,
            });
        }

        if (!hasMetadata) {
            hasMetadata = true;
            controller.enqueue({
                type: 'response-metadata',
                ...getDeepSeekResponseMetadata(record),
            });
        }

        usage = getDeepSeekUsageRecord(record) ?? usage;

        const choice = getDeepSeekChoice(record);
        const nextFinishReason = getStringField(choice, ['finish_reason']);
        if (nextFinishReason) {
            finishReason = getDeepSeekFinishReason(nextFinishReason);
        }

        const delta = toRecord(choice?.delta);
        if (!delta) {
            continue;
        }

        const reasoningContent = getStringField(delta, ['reasoning_content', 'reasoning']);
        if (reasoningContent) {
            if (!isReasoningActive) {
                controller.enqueue({
                    type: 'reasoning-start',
                    id: 'reasoning-0',
                });
                isReasoningActive = true;
            }

            controller.enqueue({
                type: 'reasoning-delta',
                id: 'reasoning-0',
                delta: reasoningContent,
            });
        }

        const textContent = getStringField(delta, ['content']);
        if (textContent) {
            if (!isTextActive) {
                controller.enqueue({
                    type: 'text-start',
                    id: 'text-0',
                });
                isTextActive = true;
            }

            controller.enqueue({
                type: 'text-delta',
                id: 'text-0',
                delta: textContent,
            });
        }

        getArrayField(delta, 'tool_calls').forEach((toolCallDelta) => {
            mergeDeepSeekToolCallDelta(pendingToolCalls, toolCallDelta);
            const record = toRecord(toolCallDelta);
            const index = getNumberField(record, 'index');
            const pendingToolCall = index === null ? null : pendingToolCalls.get(index);

            if (!pendingToolCall) {
                return;
            }

            if (!pendingToolCall.started && pendingToolCall.id && pendingToolCall.functionName) {
                controller.enqueue({
                    type: 'tool-input-start',
                    id: pendingToolCall.id,
                    toolName: pendingToolCall.functionName,
                });
                pendingToolCall.started = true;
            }

            const functionRecord = toRecord(record?.function);
            const argumentsText = getStringField(functionRecord, ['arguments']);
            if (argumentsText) {
                controller.enqueue({
                    type: 'tool-input-delta',
                    id: pendingToolCall.id,
                    delta: argumentsText,
                });
            }

            if (isJsonObjectText(pendingToolCall.argumentsText)) {
                emitDeepSeekToolCall(controller, pendingToolCall);
            }
        });
    }

    if (isReasoningActive) {
        controller.enqueue({
            type: 'reasoning-end',
            id: 'reasoning-0',
        });
    }

    if (isTextActive) {
        controller.enqueue({
            type: 'text-end',
            id: 'text-0',
        });
    }

    pendingToolCalls.forEach((toolCall) => emitDeepSeekToolCall(controller, toolCall));
    controller.enqueue({
        type: 'finish',
        finishReason,
        usage: getDeepSeekUsage(usage),
        providerMetadata: {
            deepseek: {},
        },
    });
};

const doDeepSeekGenerate = async (
    modelConfig: IDeepSeekModelConfig,
    fetchFn: TDeepSeekFetch,
    rawOptions: unknown,
): Promise<TDeepSeekLanguageModelGenerateResult> => {
    const options = toDeepSeekCallOptions(rawOptions);
    const { response, body } = await postDeepSeekChatCompletions(modelConfig, fetchFn, options, false);
    const responseBody = await parseDeepSeekJsonResponse(response);
    const choice = getDeepSeekChoice(responseBody);
    const message = toRecord(choice?.message);

    return {
        content: createDeepSeekGeneratedContent(message),
        finishReason: getDeepSeekFinishReason(getStringField(choice, ['finish_reason'])),
        usage: getDeepSeekUsage(getDeepSeekUsageRecord(responseBody)),
        providerMetadata: {
            deepseek: {},
        },
        request: {
            body,
        },
        response: {
            ...getDeepSeekResponseMetadata(responseBody),
            headers: getDeepSeekResponseHeaders(response.headers),
            body: responseBody,
        },
        warnings: [],
    };
};

const doDeepSeekStream = async (
    modelConfig: IDeepSeekModelConfig,
    fetchFn: TDeepSeekFetch,
    rawOptions: unknown,
): Promise<TDeepSeekLanguageModelStreamResult> => {
    const options = toDeepSeekCallOptions(rawOptions);
    const { response, body } = await postDeepSeekChatCompletions(modelConfig, fetchFn, options, true);
    const includeRawChunks = getBooleanField(toRecord(rawOptions), 'includeRawChunks') ?? false;

    return {
        stream: new ReadableStream<TDeepSeekLanguageModelStreamPart>({
            start: async (controller) => {
                controller.enqueue({
                    type: 'stream-start',
                    warnings: [],
                });

                try {
                    await streamDeepSeekResponse(response, includeRawChunks, controller);
                    controller.close();
                } catch (error) {
                    controller.enqueue({
                        type: 'error',
                        error,
                    });
                    controller.close();
                }
            },
        }),
        request: {
            body,
        },
        response: {
            headers: getDeepSeekResponseHeaders(response.headers),
        },
    };
};

function createDeepSeekReasoningLanguageModel(
    modelConfig: IDeepSeekModelConfig,
    fetchFn: TDeepSeekFetch,
): IDeepSeekReasoningLanguageModel {
    return {
        specificationVersion: 'v2' as const,
        provider: 'deepseek.chat',
        modelId: normalizeDeepSeekModelId(modelConfig.model),
        supportedUrls: {},
        supportsStructuredOutputs: true,
        doGenerate: (options: unknown) => doDeepSeekGenerate(modelConfig, fetchFn, options),
        doStream: (options: unknown) => doDeepSeekStream(modelConfig, fetchFn, options),
    };
}

const createApprovalRequest = (payload: ToolCallPayload, runId?: string | null) => ({
    id: runId ? encodeApprovalRequestId(runId, payload.toolCallId) : payload.toolCallId,
    toolName: payload.toolName,
    question: `${payload.toolName} 需要你的确认后才能继续执行。`,
    summary: formatApprovalSummary(payload),
    riskLevel: 'medium' as const,
    reversible: false,
    createdAt: new Date().toISOString(),
});

const createDoneResultFromPlan = (plan: TAgentPlan): string =>
    `已生成计划：${plan.steps.length} 个待办事项。`;

const createPlanResponse = (
    sessionId: string,
    plan: TAgentPlan,
    events: TAgentRuntimeOutputEvent[] = [],
    options: IAgentRuntimeRunOptions = {},
): IAgentRuntimeResponse => {
    const doneResult = createDoneResultFromPlan(plan);
    const planEvent: TAgentRuntimeOutputEvent = {
        type: 'plan_ready',
        plan,
    };
    const doneEvent: TAgentRuntimeOutputEvent = {
        type: 'done',
        result: doneResult,
    };

    pushUiEvent(events, planEvent, options);
    pushUiEvent(events, doneEvent, options);

    return {
        sessionId,
        events,
        result: doneResult,
    };
};

const createErrorResponse = (
    sessionId: string,
    message: string,
    events: TAgentRuntimeOutputEvent[] = [],
    options: IAgentRuntimeRunOptions = {},
): IAgentRuntimeResponse => {
    const errorEvent: TAgentRuntimeOutputEvent = {
        type: 'error',
        message,
    };

    options.onEvent?.(errorEvent);

    return {
        sessionId,
        events: [...events, errorEvent],
        result: null,
    };
};

export class MastraRuntime {
    private readonly createAgent: (config: IMastraAgentConfig) => IMastraAgentLike;

    private readonly createExecutionHandle: (config: IMastraAgentConfig) => Promise<IMastraExecutionHandle>;

    private readonly loadExecutionSnapshot: (
        workflowName: string,
        runId: string,
    ) => Promise<IMastraWorkflowSnapshotLike | null>;

    private readonly readModelConfig: () => IDeepSeekModelConfig | null;

    private readonly createMcpClientBundle: (
        options?: { workspaceRootPath?: string | null },
    ) => Promise<IMastraMcpBundle>;

    private readonly now: (() => string) | undefined;

    private readonly fetch: TDeepSeekFetch;

    private readonly storage: IMastraStorageLike;

    private readonly pendingApprovals = new Map<string, IMastraPendingApproval>();

    readonly name = 'mastra';

    constructor(deps: IMastraRuntimeDeps = {}) {
        this.createAgent = deps.createAgent ?? defaultCreateAgent;
        this.storage = deps.createStorage ? deps.createStorage() : defaultCreateStorage();
        this.createExecutionHandle = deps.createExecutionHandle
            ?? ((config) => defaultCreateExecutionHandle(config, this.storage));
        this.loadExecutionSnapshot = deps.loadExecutionSnapshot
            ?? (async (workflowName, runId) => {
                const workflowStore = await this.storage.getStore('workflows');
                return workflowStore?.loadWorkflowSnapshot({ workflowName, runId }) ?? null;
            });
        this.readModelConfig = deps.readModelConfig ?? createDeepSeekModelConfigFromEnv;
        this.createMcpClientBundle = deps.createMcpClientBundle ?? createMastraMcpClientBundle;
        this.now = deps.now;
        this.fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    }

    private registerPendingApproval(
        sessionId: string,
        agent: IMastraAgentLike,
        bundle: IMastraMcpBundle,
        chunk: { type: 'tool-call-approval'; payload: ToolCallPayload },
        workspace?: AnyWorkspace,
    ): string | null {
        const runId = getChunkRunId(chunk);

        if (
            !runId
            || typeof agent.approveToolCall !== 'function'
            || typeof agent.declineToolCall !== 'function'
        ) {
            return null;
        }

        const requestId = encodeApprovalRequestId(runId, chunk.payload.toolCallId);
        this.pendingApprovals.set(requestId, {
            agent,
            bundle,
            runId,
            sessionId,
            toolCallId: chunk.payload.toolCallId,
            ...(workspace ? { workspace } : {}),
        });

        return requestId;
    }

    private async consumeTextStream(
        agent: IMastraAgentLike,
        bundle: IMastraMcpBundle,
        sessionId: string,
        stream: IMastraAgentStreamLike,
        events: TAgentRuntimeOutputEvent[],
        options: IAgentRuntimeRunOptions,
        createRuntimeEvent?: TRuntimeEventFactory,
        workspace?: AnyWorkspace,
    ): Promise<IMastraTextStreamSummary> {
        let visibleText = '';
        let emittedVisibleText = '';
        let streamErrorMessage: string | null = null;
        let pendingApproval = false;
        let releaseResources = true;

        for await (const chunk of stream.fullStream) {
            const reasoningDelta = getReasoningDelta(chunk);
            if (reasoningDelta) {
                if (createRuntimeEvent) {
                    pushUiEvent(events, createRuntimeEvent({
                        type: 'agent.reasoning.delta',
                        visibility: 'user',
                        level: 'info',
                        text: redactForStream(reasoningDelta),
                    }), options);
                }
                continue;
            }

            if (isTextDeltaChunk(chunk)) {
                const nextText = getTextDelta(chunk.payload);
                if (!nextText) {
                    continue;
                }

                visibleText += nextText;

                if (visibleText !== emittedVisibleText) {
                    emittedVisibleText = visibleText;
                    pushUiEvent(events, {
                        type: 'message_delta',
                        text: visibleText,
                        phase: 'final',
                    }, options);
                }
                continue;
            }

            if (isChunkWithType(chunk, 'tool-call') && isToolCallChunk(chunk)) {
                const input = chunk.payload.args === undefined ? null : toJsonValue(chunk.payload.args);

                if (createRuntimeEvent) {
                    const inputPreview = chunk.payload.args === undefined
                        ? ''
                        : createRuntimePreview(chunk.payload.args);

                    pushUiEvent(events, createRuntimeEvent({
                        type: 'agent.tool.started',
                        visibility: 'user',
                        level: 'info',
                        toolName: chunk.payload.toolName,
                        toolUseId: chunk.payload.toolCallId,
                        ...(inputPreview ? { inputPreview } : {}),
                    }), options);
                }

                pushUiEvent(events, {
                    type: 'tool_start',
                    toolName: chunk.payload.toolName,
                    input,
                }, options);
                continue;
            }

            if (isToolResultChunk(chunk)) {
                const output = toJsonValue(chunk.payload.result);

                if (createRuntimeEvent) {
                    const resultPreview = createRuntimePreview(chunk.payload.result);

                    pushUiEvent(events, createRuntimeEvent({
                        type: 'agent.tool.completed',
                        visibility: 'user',
                        level: 'info',
                        toolName: chunk.payload.toolName,
                        ok: true,
                        ...(resultPreview ? { resultPreview } : {}),
                    }), options);
                }

                pushUiEvent(events, {
                    type: 'tool_result',
                    toolName: chunk.payload.toolName,
                    output,
                }, options);
                continue;
            }

            if (isChunkWithType(chunk, 'tool-call-approval') && isToolCallChunk(chunk)) {
                pendingApproval = true;
                const pendingRequestId = this.registerPendingApproval(
                    sessionId,
                    agent,
                    bundle,
                    chunk,
                    workspace,
                );

                if (pendingRequestId) {
                    releaseResources = false;
                }

                pushUiEvent(events, {
                    type: 'approval_required',
                    request: createApprovalRequest(chunk.payload, pendingRequestId ? getChunkRunId(chunk) : null),
                }, options);
                continue;
            }

            if (isToolCallSuspendedChunk(chunk)) {
                pendingApproval = true;
                pushUiEvent(events, {
                    type: 'approval_required',
                    request: {
                        id: chunk.payload.toolCallId,
                        toolName: chunk.payload.toolName,
                        question: `${chunk.payload.toolName} 已暂停，等待继续信息。`,
                        summary: JSON.stringify(toJsonValue(chunk.payload.suspendPayload)),
                        riskLevel: 'medium',
                        reversible: true,
                        createdAt: new Date().toISOString(),
                    },
                }, options);
                continue;
            }

            if (isToolErrorChunk(chunk)) {
                const errorMessage = normalizeMastraError(chunk.payload.error);

                if (createRuntimeEvent) {
                    pushUiEvent(events, createRuntimeEvent({
                        type: 'agent.tool.completed',
                        visibility: 'user',
                        level: 'error',
                        toolName: chunk.payload.toolName,
                        ok: false,
                        errorMessage,
                    }), options);
                }

                pushUiEvent(events, {
                    type: 'tool_result',
                    toolName: chunk.payload.toolName,
                    output: toJsonValue({
                        error: errorMessage,
                    }),
                }, options);
                continue;
            }

            if (isErrorChunk(chunk)) {
                streamErrorMessage = normalizeMastraError(chunk.payload.error);
                continue;
            }

            if (isChunkWithType(chunk, 'abort')) {
                streamErrorMessage = 'Mastra Agent 执行已中止。';
            }
        }

        return {
            pendingApproval,
            releaseResources,
            streamErrorMessage,
            visibleText,
        };
    }

    private createFallbackApprovalResponse(
        input: IApprovalResolutionInput,
        sessionId: string,
        options: IAgentRuntimeRunOptions,
    ): IAgentRuntimeResponse {
        const result = '审批结果已记录，等待下一次 Agent 执行继续消费。';
        const events: TAgentRuntimeOutputEvent[] = [];

        pushUiEvent(events, {
            type: 'tool_result',
            toolName: 'approval',
            output: {
                requestId: input.requestId,
                decision: input.decision,
            },
        }, options);
        pushUiEvent(events, {
            type: 'done',
            result,
        }, options);

        return {
            sessionId,
            events,
            result,
        };
    }

    private async runTextMode(
        input: IAgentRuntimeInput,
        mode: IAgentRuntimeInput['mode'],
        sessionPrefix: string,
        options: IAgentRuntimeRunOptions = {},
    ): Promise<IAgentRuntimeResponse> {
        const normalizedInput: IAgentRuntimeInput = {
            ...input,
            mode,
        };
        const sessionId = normalizedInput.sessionId ?? createSessionId(sessionPrefix);
        const events: TAgentRuntimeOutputEvent[] = [];
        const modelConfig = this.readModelConfig();

        if (!modelConfig) {
            return createErrorResponse(
                sessionId,
                'DeepSeek 未配置：请在 Node sidecar 环境设置 DEEPSEEK_API_KEY。',
                events,
                options,
            );
        }

        const {
            bundle: mcpBundle,
            tools: mastraTools,
            hasTools,
        } = await loadMastraMcpTools(this.createMcpClientBundle, normalizedInput.workspaceRootPath);
        const workspace = createMastraWorkspace(normalizedInput.workspaceRootPath);
        const hasAgentTools = hasTools || Boolean(workspace);
        let shouldDisconnectBundle = true;

        try {
            const agent = this.createAgent({
                id: 'calamex-agent-sidecar',
                name: 'Calamex Agent Sidecar',
                instructions: buildSystemPrompt(normalizedInput, modelConfig.model),
                model: createMastraModelConfig(modelConfig, this.fetch),
                ...(hasTools ? { tools: mastraTools } : {}),
                ...(workspace ? { workspace } : {}),
            });
            const toolChoice: IMastraGenerateOptions['toolChoice'] = hasAgentTools ? 'auto' : 'none';
            const streamOptions: IMastraGenerateOptions = {
                maxSteps: hasAgentTools ? 10 : 1,
                toolChoice,
                ...(options.context?.signal ? { abortSignal: options.context.signal } : {}),
                ...(options.context?.requestId ? { runId: options.context.requestId } : {}),
            };
            const stream = await agent.stream(buildMastraMessages(normalizedInput), {
                ...streamOptions,
            });
            const createRuntimeEvent = createRuntimeEventFactory({
                runId: stream.runId ?? options.context?.requestId ?? sessionId,
                sessionId,
                agentId: DEFAULT_EXECUTION_AGENT_ID,
                ...(this.now ? { now: this.now } : {}),
            });
            const streamSummary = await this.consumeTextStream(
                agent,
                mcpBundle,
                sessionId,
                stream,
                events,
                options,
                createRuntimeEvent,
                workspace,
            );
            shouldDisconnectBundle = streamSummary.releaseResources;

            if (streamSummary.streamErrorMessage) {
                return createErrorResponse(
                    sessionId,
                    `Mastra Agent 执行失败：${streamSummary.streamErrorMessage}`,
                    events,
                    options,
                );
            }

            if (streamSummary.pendingApproval) {
                return {
                    sessionId,
                    events,
                    result: null,
                };
            }

            const result = streamSummary.visibleText.trim().length > 0
                ? streamSummary.visibleText
                : 'Agent 已完成。';
            const doneEvent: TAgentRuntimeOutputEvent = {
                type: 'done',
                result,
            };

            pushUiEvent(events, doneEvent, options);

            return {
                sessionId,
                events,
                result,
            };
        } catch (error) {
            return createErrorResponse(
                sessionId,
                `Mastra Agent 执行失败：${normalizeMastraError(error)}`,
                events,
                options,
            );
        } finally {
            if (shouldDisconnectBundle) {
                await mcpBundle.disconnectAll();
                await destroyMastraWorkspace(workspace);
            }
        }
    }

    async chat(
        input: IAgentRuntimeInput,
        options: IAgentRuntimeRunOptions = {},
    ): Promise<IAgentRuntimeResponse> {
        return this.runTextMode(input, input.mode ?? 'ask', 'mastra-chat', options);
    }

    async plan(
        input: IAgentRuntimeInput,
        options: IAgentRuntimeRunOptions = {},
    ): Promise<IAgentRuntimeResponse> {
        const sessionId = input.sessionId ?? createSessionId('mastra-plan');
        const modelConfig = this.readModelConfig();

        if (!modelConfig) {
            return createErrorResponse(
                sessionId,
                'DeepSeek 未配置：请在 Node sidecar 环境设置 DEEPSEEK_API_KEY。',
                [],
                options,
            );
        }

        const {
            bundle: mcpBundle,
            tools: mastraTools,
            hasTools,
        } = await loadMastraMcpTools(this.createMcpClientBundle, input.workspaceRootPath);
        const workspace = createMastraWorkspace(input.workspaceRootPath);
        const hasAgentTools = hasTools || Boolean(workspace);

        try {
            const agent = this.createAgent({
                id: 'calamex-agent-sidecar-plan',
                name: 'Calamex Agent Plan Sidecar',
                instructions: buildSystemPrompt({
                    ...input,
                    mode: 'plan',
                }, modelConfig.model),
                model: createMastraModelConfig(modelConfig, this.fetch),
                ...(hasTools ? { tools: mastraTools } : {}),
                ...(workspace ? { workspace } : {}),
            });
            const toolChoice: IMastraGenerateOptions['toolChoice'] = hasAgentTools ? 'auto' : 'none';
            const generateOptions: IMastraGenerateOptions = {
                maxSteps: hasAgentTools ? 10 : 1,
                toolChoice,
                structuredOutput: {
                    schema: agentPlanSchema,
                },
                ...(options.context?.signal ? { abortSignal: options.context.signal } : {}),
                ...(options.context?.requestId ? { runId: options.context.requestId } : {}),
            };
            const generated = await agent.generate(buildMastraMessages({
                ...input,
                mode: 'plan',
            }), generateOptions);
            const parsedPlan = agentPlanSchema.safeParse(generated.object);

            if (!parsedPlan.success) {
                return createErrorResponse(
                    sessionId,
                    'Mastra structured output 没有返回有效 AgentPlan，计划未生成。',
                    [],
                    options,
                );
            }

            return createPlanResponse(sessionId, parsedPlan.data, [], options);
        } catch (error) {
            return createErrorResponse(
                sessionId,
                `Mastra Plan 执行失败：${normalizeMastraError(error)}`,
                [],
                options,
            );
        } finally {
            await mcpBundle.disconnectAll();
            await destroyMastraWorkspace(workspace);
        }
    }

    async execute(
        input: IAgentRuntimeInput,
        options: IAgentRuntimeRunOptions = {},
    ): Promise<IAgentRuntimeResponse> {
        const normalizedInput: IAgentRuntimeInput = {
            ...input,
            mode: 'agent',
        };
        const sessionId = normalizedInput.sessionId ?? createSessionId('mastra-execute');
        const events: TAgentRuntimeOutputEvent[] = [];
        const modelConfig = this.readModelConfig();

        if (!modelConfig) {
            return createErrorResponse(
                sessionId,
                'DeepSeek 未配置：请在 Node sidecar 环境设置 DEEPSEEK_API_KEY。',
                events,
                options,
            );
        }

        const {
            bundle: mcpBundle,
            tools: mastraTools,
            hasTools,
        } = await loadMastraMcpTools(this.createMcpClientBundle, normalizedInput.workspaceRootPath);
        const workspace = createMastraWorkspace(normalizedInput.workspaceRootPath);
        const hasAgentTools = hasTools || Boolean(workspace);
        const requestedRunId = options.context?.requestId ?? createSessionId('mastra-run');
        const createRequestedRunEvent = createRuntimeEventFactory({
            runId: requestedRunId,
            sessionId,
            agentId: DEFAULT_EXECUTION_AGENT_ID,
            ...(this.now ? { now: this.now } : {}),
        });
        const systemPrompt = buildSystemPrompt(normalizedInput, modelConfig.model);
        let shouldDisconnectBundle = true;
        let streamCleanup: (() => void) | undefined;

        try {
            const toolChoice: IMastraGenerateOptions['toolChoice'] = hasAgentTools ? 'auto' : 'none';
            const executionHandle = await this.createExecutionHandle({
                id: DEFAULT_EXECUTION_AGENT_ID,
                name: DEFAULT_EXECUTION_AGENT_NAME,
                instructions: systemPrompt,
                model: createMastraModelConfig(modelConfig, this.fetch),
                ...(hasTools ? { tools: mastraTools } : {}),
                ...(workspace ? { workspace } : {}),
            });
            const stream = await executionHandle.agent.stream(
                buildMastraMessages(normalizedInput),
                {
                    maxSteps: hasAgentTools ? 10 : 1,
                    toolChoice,
                    ...(options.context?.signal ? { abortSignal: options.context.signal } : {}),
                    runId: requestedRunId,
                    requestContext: createExecutionRequestContext(normalizedInput, systemPrompt),
                },
            );
            streamCleanup = stream.cleanup;
            const checkpointRunId = stream.runId ?? requestedRunId;
            const createCheckpointEvent = checkpointRunId === requestedRunId
                ? createRequestedRunEvent
                : createRuntimeEventFactory({
                    runId: checkpointRunId,
                    sessionId,
                    agentId: DEFAULT_EXECUTION_AGENT_ID,
                    ...(this.now ? { now: this.now } : {}),
                });

            pushUiEvent(events, createCheckpointEvent({
                type: 'rollback.checkpoint.created',
                visibility: 'user',
                level: 'info',
                snapshotId: checkpointRunId,
            }), options);

            const streamSummary = await this.consumeTextStream(
                executionHandle.agent,
                mcpBundle,
                sessionId,
                stream,
                events,
                options,
                createCheckpointEvent,
                workspace,
            );
            shouldDisconnectBundle = streamSummary.releaseResources;

            if (streamSummary.streamErrorMessage) {
                return createErrorResponse(
                    sessionId,
                    `Mastra Agent 执行失败：${streamSummary.streamErrorMessage}`,
                    events,
                    options,
                );
            }

            if (streamSummary.pendingApproval) {
                return {
                    sessionId,
                    events,
                    result: null,
                };
            }

            const result = streamSummary.visibleText.trim().length > 0
                ? streamSummary.visibleText
                : 'Agent 已完成。';

            pushUiEvent(events, {
                type: 'done',
                result,
            }, options);

            return {
                sessionId,
                events,
                result,
            };
        } catch (error) {
            pushUiEvent(events, createRequestedRunEvent({
                type: 'rollback.checkpoint.failed',
                visibility: 'user',
                level: 'error',
                snapshotId: requestedRunId,
                errorMessage: normalizeMastraError(error),
            }), options);

            return createErrorResponse(
                sessionId,
                `Mastra Agent 执行失败：${normalizeMastraError(error)}`,
                events,
                options,
            );
        } finally {
            if (shouldDisconnectBundle) {
                streamCleanup?.();
                await mcpBundle.disconnectAll();
                await destroyMastraWorkspace(workspace);
            }
        }
    }

    async resolveApproval(
        input: IApprovalResolutionInput,
        options: IAgentRuntimeRunOptions = {},
    ): Promise<IAgentRuntimeResponse> {
        const decodedRequest = decodeApprovalRequestId(input.requestId);
        const pending = this.pendingApprovals.get(input.requestId);
        const sessionId = pending?.sessionId ?? input.sessionId ?? createSessionId('mastra-approval');

        if (!pending || !decodedRequest) {
            return this.createFallbackApprovalResponse(input, sessionId, options);
        }

        this.pendingApprovals.delete(input.requestId);

        const continueStream = isApprovedDecision(input.decision)
            ? pending.agent.approveToolCall
            : pending.agent.declineToolCall;

        if (!continueStream) {
            await pending.bundle.disconnectAll();
            await destroyMastraWorkspace(pending.workspace);
            return this.createFallbackApprovalResponse(input, sessionId, options);
        }

        const events: TAgentRuntimeOutputEvent[] = [];
        let shouldDisconnectBundle = true;
        let streamCleanup: (() => void) | undefined;

        try {
            const stream = await continueStream({
                runId: decodedRequest.runId,
                toolCallId: decodedRequest.toolCallId,
                ...(options.context?.signal ? { abortSignal: options.context.signal } : {}),
            });
            streamCleanup = stream.cleanup;
            const streamSummary = await this.consumeTextStream(
                pending.agent,
                pending.bundle,
                sessionId,
                stream,
                events,
                options,
                createRuntimeEventFactory({
                    runId: stream.runId ?? decodedRequest.runId,
                    sessionId,
                    agentId: DEFAULT_EXECUTION_AGENT_ID,
                    ...(this.now ? { now: this.now } : {}),
                }),
                pending.workspace,
            );
            shouldDisconnectBundle = streamSummary.releaseResources;

            if (streamSummary.streamErrorMessage) {
                return createErrorResponse(
                    sessionId,
                    `Mastra Approval 执行失败：${streamSummary.streamErrorMessage}`,
                    events,
                    options,
                );
            }

            if (streamSummary.pendingApproval) {
                return {
                    sessionId,
                    events,
                    result: null,
                };
            }

            const result = streamSummary.visibleText.trim().length > 0
                ? streamSummary.visibleText
                : 'Agent 已完成。';

            pushUiEvent(events, {
                type: 'done',
                result,
            }, options);

            return {
                sessionId,
                events,
                result,
            };
        } catch (error) {
            return createErrorResponse(
                sessionId,
                `Mastra Approval 执行失败：${normalizeMastraError(error)}`,
                events,
                options,
            );
        } finally {
            if (shouldDisconnectBundle) {
                streamCleanup?.();
                await pending.bundle.disconnectAll();
                await destroyMastraWorkspace(pending.workspace);
            }
        }
    }

    async restoreCheckpoint(
        input: ICheckpointRestoreInput,
        options: IAgentRuntimeRunOptions = {},
    ): Promise<IAgentRuntimeResponse> {
        const sessionId = input.sessionId ?? createSessionId('mastra-rollback');
        const events: TAgentRuntimeOutputEvent[] = [];
        const snapshotId = input.snapshotId ?? input.runId;
        const createRuntimeEvent = createRuntimeEventFactory({
            runId: input.runId,
            sessionId,
            agentId: DEFAULT_EXECUTION_AGENT_ID,
            ...(this.now ? { now: this.now } : {}),
        });
        const modelConfig = this.readModelConfig();

        if (!modelConfig) {
            return createErrorResponse(
                sessionId,
                'DeepSeek 未配置：请在 Node sidecar 环境设置 DEEPSEEK_API_KEY。',
                events,
                options,
            );
        }

        try {
            const snapshot = await this.loadExecutionSnapshot(DurableStepIds.AGENTIC_LOOP, input.runId);

            if (!snapshot) {
                pushUiEvent(events, createRuntimeEvent({
                    type: 'rollback.restore.failed',
                    visibility: 'user',
                    level: 'error',
                    snapshotId,
                    errorMessage: '未找到可恢复的 checkpoint。',
                }), options);

                return createErrorResponse(
                    sessionId,
                    'Mastra 回滚恢复失败：未找到可恢复的 checkpoint。',
                    events,
                    options,
                );
            }

            if (snapshot.status === 'running') {
                pushUiEvent(events, createRuntimeEvent({
                    type: 'rollback.restore.failed',
                    visibility: 'user',
                    level: 'error',
                    snapshotId,
                    errorMessage: '当前 run 仍在执行，暂时不能回滚。',
                }), options);

                return createErrorResponse(
                    sessionId,
                    'Mastra 回滚恢复失败：当前 run 仍在执行，暂时不能回滚。',
                    events,
                    options,
                );
            }

            const systemPrompt = resolveSystemPromptFromSnapshot(snapshot);

            if (!systemPrompt) {
                pushUiEvent(events, createRuntimeEvent({
                    type: 'rollback.restore.failed',
                    visibility: 'user',
                    level: 'error',
                    snapshotId,
                    errorMessage: 'checkpoint 缺少可恢复的系统提示词。',
                }), options);

                return createErrorResponse(
                    sessionId,
                    'Mastra 回滚恢复失败：checkpoint 缺少可恢复的系统提示词。',
                    events,
                    options,
                );
            }

            const workspaceRootPath = resolveWorkspaceRootPathFromSnapshot(snapshot);
            const {
                bundle: mcpBundle,
                tools: mastraTools,
                hasTools,
            } = await loadMastraMcpTools(this.createMcpClientBundle, workspaceRootPath);
            const workspace = createMastraWorkspace(workspaceRootPath);

            try {
                const executionHandle = await this.createExecutionHandle({
                    id: DEFAULT_EXECUTION_AGENT_ID,
                    name: DEFAULT_EXECUTION_AGENT_NAME,
                    instructions: systemPrompt,
                    model: createMastraModelConfig(modelConfig, this.fetch),
                    ...(hasTools ? { tools: mastraTools } : {}),
                    ...(workspace ? { workspace } : {}),
                });
                const run = await executionHandle.workflow.createRun({ runId: input.runId });
                const requestContextRecord = requestContextToRecord(snapshot.requestContext);
                const requestContext = requestContextRecord
                    ? createMastraRequestContext(requestContextRecord)
                    : undefined;

                pushUiEvent(events, createRuntimeEvent({
                    type: 'rollback.restore.started',
                    visibility: 'user',
                    level: 'info',
                    snapshotId,
                }), options);

                const restoreResult = await run.timeTravel({
                    step: input.step ?? DEFAULT_ROLLBACK_STEP,
                    ...(requestContext ? { requestContext } : {}),
                });
                const restoreMessage = extractRestoreResultText(restoreResult)
                    ?? '已使用 Mastra 官方 timeTravel 恢复到最近 checkpoint。';

                pushUiEvent(events, createRuntimeEvent({
                    type: 'rollback.restore.completed',
                    visibility: 'user',
                    level: 'info',
                    snapshotId,
                    savedAsLatest: true,
                    message: restoreMessage,
                }), options);
                pushUiEvent(events, {
                    type: 'done',
                    result: restoreMessage,
                }, options);

                return {
                    sessionId,
                    events,
                    result: restoreMessage,
                };
            } catch (error) {
                pushUiEvent(events, createRuntimeEvent({
                    type: 'rollback.restore.failed',
                    visibility: 'user',
                    level: 'error',
                    snapshotId,
                    errorMessage: normalizeMastraError(error),
                }), options);

                return createErrorResponse(
                    sessionId,
                    `Mastra 回滚恢复失败：${normalizeMastraError(error)}`,
                    events,
                    options,
                );
            } finally {
                await mcpBundle.disconnectAll();
                await destroyMastraWorkspace(workspace);
            }
        } catch (error) {
            pushUiEvent(events, createRuntimeEvent({
                type: 'rollback.restore.failed',
                visibility: 'user',
                level: 'error',
                snapshotId,
                errorMessage: normalizeMastraError(error),
            }), options);

            return createErrorResponse(
                sessionId,
                `Mastra 回滚恢复失败：${normalizeMastraError(error)}`,
                events,
                options,
            );
        }
    }
}
