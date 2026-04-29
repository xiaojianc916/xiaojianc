import { computed, ref, type Ref } from 'vue';

import { useAiAgentPlan } from '@/composables/useAiAgentPlan';
import { useAiStream } from '@/composables/useAiStream';
import { aiService } from '@/services/modules/ai';
import {
  buildActiveRunReference,
  buildCurrentFileReference,
  buildDiagnosticsReference,
  buildGitDiffReference,
  buildSelectionReference,
} from '@/services/modules/ai-context';
import { tauriService } from '@/services/tauri';
import { useAiConversationStore } from '@/store/aiConversation';

import type {
  IAiChatMessage,
  IAiChatStreamEventPayload,
  IAiConfigPayload,
  IAiContextReference,
  IAiPatchSet,
  IAiProviderConnectionRequest,
  IAiToolDefinitionPayload,
  TAiChatMessageActionId,
} from '@/types/ai';
import type { IAiCodeBlock } from '@/types/ai-code';
import type {
  IActiveRunSummary,
  IAnalyzeScriptPayload,
  IEditorDocument,
  IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';

import { toErrorMessage } from '@/utils/error';
import { areFileSystemPathsEqual, normalizeFileSystemPath } from '@/utils/path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type TAiQuickActionId = 'explain' | 'fix' | 'review';

type TAiAssistantMode = 'chat' | 'agent';

type TAiAttachmentKind = 'text' | 'image';

type TAgentToolName =
  | 'read_current_file'
  | 'read_selected_text'
  | 'search_files'
  | 'search_text'
  | 'search_symbols'
  | 'get_diagnostics'
  | 'get_git_diff'
  | 'get_terminal_log'
  | 'propose_patch';

type TAgentExecutionStepStatus =
  | 'pending'
  | 'running'
  | 'failed'
  | 'cancelled'
  | 'done'
  | 'skipped';

interface IAiImageDimensions {
  width: number;
  height: number;
}

interface IAgentToolCallEnvelope {
  type: 'tool_call';
  name: TAgentToolName;
  summary?: string;
  arguments?: Record<string, unknown>;
}

interface IAgentFinalEnvelope {
  type: 'final';
  content: string;
}

interface IAgentToolExecutionResult {
  summary: string;
  content: string;
  status: 'succeeded' | 'failed';
}

interface IAgentExecutionStep {
  id: string;
  title: string;
  status: TAgentExecutionStepStatus;
}

export interface IAiAttachedFile {
  id: string;
  name: string;
  sizeLabel: string;
  kind: TAiAttachmentKind;
  detailLabel?: string;
  reference: IAiContextReference;
}

export interface IAiQuickAction {
  id: TAiQuickActionId;
  label: string;
}

export interface IUseAiAssistantOptions {
  document: Ref<IEditorDocument>;
  activeRun: Ref<IActiveRunSummary | null>;
  analysis: Ref<IAnalyzeScriptPayload>;
  selection: Ref<IEditorSelectionSummary | null>;
  gitStatus: Ref<IGitRepositoryStatusPayload>;
  workspaceRootPath: Ref<string | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_CHARS = 12_000;
const MAX_TEXT_ATTACHMENT_BYTES = 128 * 1024;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const TEXT_ATTACHMENT_PATTERN =
  /^(application\/(json|xml|x-sh|x-shellscript|javascript|typescript)|text\/)/i;

const TEXT_ATTACHMENT_EXTENSION_PATTERN =
  /\.(bash|cjs|conf|css|csv|env|js|json|jsx|log|md|mjs|ps1|py|rs|sh|sql|toml|ts|tsx|txt|vue|xml|yaml|yml|zsh)$/i;

const IMAGE_ATTACHMENT_PATTERN = /^image\//i;

const IMAGE_ATTACHMENT_EXTENSION_PATTERN =
  /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;

const CONTEXT_TOKEN_PATTERN =
  /(^|\s)@(file|current-file|selection|terminal|log|diagnostics|shellcheck|git-diff|git|project|folder|search|symbol)(?=\s|$)/gi;

const CODE_BLOCK_PATTERN = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/;

const PROJECT_SEARCH_TOKENS = ['project', 'folder', 'search', 'symbol'] as const;

const MAX_AGENT_TOOL_ROUNDS = 6;
const MAX_AGENT_TOOL_RESULT_CHARS = 6_000;

const AGENT_TOOL_LABELS: Record<TAgentToolName, string> = {
  read_current_file: '读取当前文件',
  read_selected_text: '读取当前选区',
  search_files: '搜索文件名',
  search_text: '搜索文本内容',
  search_symbols: '搜索符号',
  get_diagnostics: '读取诊断',
  get_git_diff: '读取 Git 变更',
  get_terminal_log: '读取终端日志',
  propose_patch: '静默写入当前文件',
};

const FALLBACK_AGENT_TOOLS: IAiToolDefinitionPayload[] = [
  { name: 'read_current_file', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'read_selected_text', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'search_files', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'search_text', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'search_symbols', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'get_diagnostics', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'get_git_diff', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'get_terminal_log', readOnly: true, destructive: false, requiresConfirmation: false },
  { name: 'propose_patch', readOnly: false, destructive: false, requiresConfirmation: false },
];

const MSG_STREAM_CANCELLED = 'AI 流已被取消';
const MSG_STREAM_ERROR = 'AI 响应出错';
const MSG_CALL_FAILED = 'AI 调用失败';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const createMessageId = (role: IAiChatMessage['role']): string =>
  `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizePatchDisplayPath = (path: string): string => {
  const normalized = normalizeFileSystemPath(path, {
    collapseDuplicateSeparators: true,
    trimTrailingSeparator: true,
    foldWindowsCase: false,
  });

  return normalized || path;
};

const materializePatchedContent = (patchFile: IAiPatchSet['files'][number]): string | null => {
  const output: string[] = [];

  for (const hunk of patchFile.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') || line.startsWith(' ')) {
        output.push(line.slice(1));
        continue;
      }

      if (line.startsWith('-')) {
        continue;
      }

      return null;
    }
  }

  return output.join('\n');
};

const countDocumentLines = (content: string): number => {
  if (!content.length) {
    return 1;
  }

  return content.split('\n').length;
};

const syncPatchedDocument = (
  document: IEditorDocument,
  patch: IAiPatchSet,
  appliedPaths: string[],
): void => {
  if (!document.path || document.kind !== 'text') {
    return;
  }

  const patchFile = patch.files.find((file) => areFileSystemPathsEqual(file.path, document.path));

  if (!patchFile) {
    return;
  }

  const wasApplied = appliedPaths.some((path) => areFileSystemPathsEqual(path, patchFile.path));

  if (!wasApplied) {
    return;
  }

  const nextContent = materializePatchedContent(patchFile);

  if (nextContent === null) {
    return;
  }

  document.path = normalizePatchDisplayPath(patchFile.path);
  document.content = nextContent;
  document.savedContent = nextContent;
  document.isDirty = false;
  document.lineCount = countDocumentLines(nextContent);
  document.charCount = [...nextContent].length;
};

const clipText = (value: string, limit: number): string => {
  const chars = [...value];

  if (chars.length <= limit) {
    return value;
  }

  return `${chars.slice(0, limit).join('')}\n\n[内容已截断，仅发送前 ${limit} 个字符]`;
};

const clipAgentToolResult = (value: string): string => clipText(value, MAX_AGENT_TOOL_RESULT_CHARS);

const extractAgentJsonCandidate = (value: string): string => {
  const trimmed = value.trim();

  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed
      .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    if (withoutFence) {
      return withoutFence;
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
};

const isAgentToolName = (value: unknown): value is TAgentToolName =>
  typeof value === 'string' && value in AGENT_TOOL_LABELS;

const parseAgentEnvelope = (value: string): IAgentToolCallEnvelope | IAgentFinalEnvelope => {
  const candidate = extractAgentJsonCandidate(value);

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;

    if (parsed.type === 'tool_call' && isAgentToolName(parsed.name)) {
      return {
        type: 'tool_call',
        name: parsed.name,
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined,
        arguments:
          parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
            ? parsed.arguments as Record<string, unknown>
            : {},
      };
    }

    if (parsed.type === 'final' && typeof parsed.content === 'string') {
      return {
        type: 'final',
        content: parsed.content.trim(),
      };
    }
  } catch {
    // noop: fallback below turns non-JSON output into final answer text.
  }

  return {
    type: 'final',
    content: value.trim(),
  };
};

const getStringArgument = (argumentsMap: Record<string, unknown>, key: string): string =>
  typeof argumentsMap[key] === 'string' ? argumentsMap[key].trim() : '';

const getPositiveLimitArgument = (
  argumentsMap: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const rawValue = argumentsMap[key];
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), 20);
};

const countPatchHunks = (patch: IAiPatchSet): number =>
  patch.files.reduce((total, file) => total + file.hunks.length, 0);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const isTextAttachment = (file: File): boolean =>
  TEXT_ATTACHMENT_PATTERN.test(file.type) || TEXT_ATTACHMENT_EXTENSION_PATTERN.test(file.name);

const isImageAttachment = (file: File): boolean =>
  IMAGE_ATTACHMENT_PATTERN.test(file.type) || IMAGE_ATTACHMENT_EXTENSION_PATTERN.test(file.name);

const inferImageExtension = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();

  if (normalized === 'image/jpeg') {
    return 'jpg';
  }

  if (normalized === 'image/svg+xml') {
    return 'svg';
  }

  if (normalized.startsWith('image/')) {
    return normalized.slice('image/'.length);
  }

  return 'png';
};

const normalizeAttachmentName = (file: File): string => {
  const normalizedName = file.name.trim();

  if (normalizedName) {
    return normalizedName;
  }

  if (isImageAttachment(file)) {
    return `pasted-image.${inferImageExtension(file.type)}`;
  }

  return 'pasted-attachment.txt';
};

const formatImageDimensions = (dimensions: IAiImageDimensions | null): string | null => {
  if (!dimensions) {
    return null;
  }

  return `${dimensions.width} × ${dimensions.height}`;
};

const readImageDimensions = async (file: File): Promise<IAiImageDimensions | null> => {
  if (typeof globalThis.createImageBitmap !== 'function') {
    return null;
  }

  try {
    const bitmap = await globalThis.createImageBitmap(file);

    const dimensions = {
      width: bitmap.width,
      height: bitmap.height,
    };

    bitmap.close?.();

    return dimensions;
  } catch {
    return null;
  }
};

const mapStreamStatus = (
  status: ReturnType<typeof useAiStream>['status']['value'],
): NonNullable<IAiChatMessage['stream']>['status'] => {
  if (status === 'cancelled') {
    return 'cancelled';
  }

  if (status === 'completed') {
    return 'completed';
  }

  return 'streaming';
};

const mapToolExecutionStatus = (
  status: IAgentToolExecutionResult['status'],
): Extract<TAgentExecutionStepStatus, 'done' | 'failed'> =>
  status === 'succeeded' ? 'done' : 'failed';

// ---------------------------------------------------------------------------
// Public quick actions
// ---------------------------------------------------------------------------

export const AI_QUICK_ACTIONS: IAiQuickAction[] = [
  { id: 'explain', label: '解释当前脚本' },
  { id: 'fix', label: '修复报错' },
  { id: 'review', label: '代码审查' },
];

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export const useAiAssistant = (options: IUseAiAssistantOptions) => {
  const conversationStore = useAiConversationStore();

  const config = ref<IAiConfigPayload>({
    providerType: 'mock',
    selectedModel: 'mock-ide-assistant',
    baseUrl: null,
    isBaseUrlConfigured: false,
    hasCredentials: false,
    isConfigured: true,
    inlineCompletionEnabled: false,
    chatEnabled: true,
    agentEnabled: false,
  });

  const messages = computed<IAiChatMessage[]>({
    get: () => conversationStore.activeMessages,
    set: (nextMessages) => {
      conversationStore.replaceMessages(nextMessages);
    },
  });

  const historyThreads = computed(() => conversationStore.historyThreads);
  const activeConversationId = computed(() => conversationStore.activeThreadId);

  const draft = ref('');
  const isSending = ref(false);
  const errorMessage = ref('');
  const isSettingsOpen = ref(false);
  const isClearDialogOpen = ref(false);
  const currentReferences = ref<IAiContextReference[]>([]);
  const proposedPatch = ref<IAiPatchSet | null>(null);
  const isApplyingPatch = ref(false);
  const activeMode = ref<TAiAssistantMode>('chat');
  const agentSteps = ref<IAgentExecutionStep[]>([]);
  const toolDefinitions = ref<IAiToolDefinitionPayload[]>([]);
  const attachedFiles = ref<IAiAttachedFile[]>([]);
  const activeAbortController = ref<AbortController | null>(null);
  const activeStreamId = ref<string | null>(null);
  const activeAgentMessageId = ref<string | null>(null);
  const activeStreamResolve = ref<(() => void) | null>(null);
  const activeAssistantMessage = ref<IAiChatMessage | null>(null);
  const activeAssistantBaseMessages = ref<IAiChatMessage[]>([]);

  const aiStream = useAiStream();
  const agentPlan = useAiAgentPlan();

  const replaceMessageById = (
    messageId: string,
    updater: (message: IAiChatMessage) => IAiChatMessage,
  ): IAiChatMessage[] => {
    const nextMessages = messages.value.map((message) => (
      message.id === messageId ? updater(message) : message
    ));

    messages.value = nextMessages;

    return nextMessages;
  };

  const createAgentExecutionSystemMessage = (goal: string): IAiChatMessage => ({
    id: createMessageId('system'),
    role: 'system',
    content: [
      '你现在处于 IDE Agent 模式。不要再询问用户是否开始执行；你需要直接依据任务自动选择工具。',
      '如果需要更多上下文，请优先调用工具，而不是先向用户反问。',
      '如果需要修改当前打开文件，调用 propose_patch 后会直接静默写入；写入操作会自动进入 AED 时间线，用户之后可以回滚。',
      '响应协议必须严格遵守：',
      '1. 需要调用工具时，只返回一个 JSON 对象，不要使用 Markdown 代码块：',
      '{"type":"tool_call","name":"search_text","summary":"搜索错误关键词","arguments":{"query":"...","limit":8}}',
      '2. 已经可以给最终答复时，只返回一个 JSON 对象：',
      '{"type":"final","content":"...给用户的最终答复..."}',
      '3. 除以上 JSON 外不要输出任何多余前缀、解释或代码块。',
      '可用工具：',
      ...((toolDefinitions.value.length ? toolDefinitions.value : FALLBACK_AGENT_TOOLS)
        .filter((tool): tool is IAiToolDefinitionPayload & { name: TAgentToolName } =>
          isAgentToolName(tool.name))
        .map((tool) => {
          const suffix = tool.name === 'propose_patch'
            ? '参数：updatedContent（完整新文件内容），summary（可选）；执行后会直接写盘并可回滚'
            : tool.name.startsWith('search_')
              ? '参数：query，limit（可选）'
              : tool.name === 'read_current_file'
                ? '参数：path（可选，默认当前文件）'
                : '参数：无';

          return `- ${tool.name}：${AGENT_TOOL_LABELS[tool.name]}；${suffix}`;
        })),
      `当前任务：${goal}`,
    ].join('\n'),
    createdAt: new Date().toISOString(),
    references: [],
  });

  const updateAgentStep = (
    stepId: string,
    title: string,
    status: TAgentExecutionStepStatus,
  ): void => {
    const existing = agentSteps.value.find((step) => step.id === stepId);

    if (existing) {
      agentSteps.value = agentSteps.value.map((step) => (
        step.id === stepId
          ? {
            ...step,
            title,
            status,
          }
          : step
      ));

      return;
    }

    agentSteps.value = [
      ...agentSteps.value,
      {
        id: stepId,
        title,
        status,
      },
    ];
  };

  const updateAgentExecutionMessage = (
    messageId: string,
    content: string,
    toolCalls: IAiChatMessage['toolCalls'] = [],
  ): void => {
    replaceMessageById(messageId, (message) => ({
      ...message,
      content,
      toolCalls,
    }));
  };

  const formatLoadedScript = (
    path: string,
    name: string,
    content: string,
    isDirty: boolean,
  ): string => [
    `文件名：${name}`,
    `路径：${path}`,
    `状态：${isDirty ? '有未保存修改' : '已保存'}`,
    '脚本内容：',
    '```sh',
    clipText(content, MAX_CONTEXT_CHARS),
    '```',
  ].join('\n');

  const executeAgentTool = async (
    call: IAgentToolCallEnvelope,
  ): Promise<IAgentToolExecutionResult> => {
    const argumentsMap = call.arguments ?? {};
    const summary = call.summary?.trim() || AGENT_TOOL_LABELS[call.name];

    try {
      switch (call.name) {
        case 'read_current_file': {
          const document = options.document.value;
          const requestedPath = getStringArgument(argumentsMap, 'path');

          const shouldReadCurrentDocument =
            !requestedPath ||
            (document.path
              ? areFileSystemPathsEqual(requestedPath, document.path)
              : requestedPath === document.name);

          if (shouldReadCurrentDocument) {
            if (document.kind !== 'text') {
              return {
                summary,
                content: '当前没有可读取的文本文件。',
                status: 'failed',
              };
            }

            return {
              summary,
              content: formatLoadedScript(
                document.path ?? document.name,
                document.name,
                document.content,
                document.isDirty,
              ),
              status: 'succeeded',
            };
          }

          const payload = await tauriService.loadScript(requestedPath);

          return {
            summary,
            content: formatLoadedScript(
              payload.path,
              payload.name,
              payload.content,
              false,
            ),
            status: 'succeeded',
          };
        }

        case 'read_selected_text': {
          const selection = options.selection.value;
          const document = options.document.value;

          if (!selection?.text.trim()) {
            return {
              summary,
              content: '当前没有选中的文本片段。',
              status: 'failed',
            };
          }

          return {
            summary,
            content: [
              `文件：${document.name}`,
              `范围：${selection.startLine}-${selection.endLine}`,
              '选区内容：',
              '```text',
              clipText(selection.text, MAX_CONTEXT_CHARS),
              '```',
            ].join('\n'),
            status: 'succeeded',
          };
        }

        case 'search_files':
        case 'search_text':
        case 'search_symbols': {
          const workspaceRootPath = options.workspaceRootPath.value;
          const query = getStringArgument(argumentsMap, 'query');

          if (!workspaceRootPath) {
            return {
              summary,
              content: '当前没有可搜索的工作区根目录。',
              status: 'failed',
            };
          }

          if (!query) {
            return {
              summary,
              content: '搜索关键词不能为空。',
              status: 'failed',
            };
          }

          const scope = call.name === 'search_files'
            ? 'file-name'
            : call.name === 'search_symbols'
              ? 'symbol'
              : 'content';

          const payload = await tauriService.searchWorkspace({
            workspaceRootPath,
            query,
            scope,
            matchCase: false,
            wholeWord: false,
            useRegex: false,
            includePatterns: [],
            excludePatterns: [],
            limit: getPositiveLimitArgument(argumentsMap, 'limit', 8),
          });

          return {
            summary,
            content: payload.results.length === 0
              ? `未在工作区中找到与“${query}”相关的结果。`
              : [
                `工作区：${payload.rootPath}`,
                `扫描文件：${payload.scannedFileCount}`,
                `命中结果：${payload.results.length}`,
                '',
                ...payload.results.map((item) => [
                  `${item.relativePath}${item.lineNumber ? `:${item.lineNumber}` : ''}`,
                  item.lineText ?? item.name,
                ].join('\n')),
              ].join('\n---\n'),
            status: 'succeeded',
          };
        }

        case 'get_diagnostics': {
          const reference = buildDiagnosticsReference(
            options.analysis.value,
            options.document.value,
          );

          return {
            summary,
            content: reference?.contentPreview || '当前没有可用的诊断信息。',
            status: reference ? 'succeeded' : 'failed',
          };
        }

        case 'get_git_diff': {
          const reference = buildGitDiffReference(options.gitStatus.value);

          return {
            summary,
            content: reference?.contentPreview || '当前没有 Git 变更信息。',
            status: reference ? 'succeeded' : 'failed',
          };
        }

        case 'get_terminal_log': {
          const reference = buildActiveRunReference(options.activeRun.value);

          return {
            summary,
            content: reference?.contentPreview || '当前没有可读取的终端运行记录。',
            status: reference ? 'succeeded' : 'failed',
          };
        }

        case 'propose_patch': {
          const document = options.document.value;
          const requestedPath = getStringArgument(argumentsMap, 'path');
          const updatedContent = getStringArgument(argumentsMap, 'updatedContent');
          const patchSummary =
            getStringArgument(argumentsMap, 'summary') || 'Agent 自动静默写盘';

          if (document.kind !== 'text' || !document.path) {
            return {
              summary,
              content: '当前文件尚未保存，无法静默写盘。',
              status: 'failed',
            };
          }

          if (requestedPath && !areFileSystemPathsEqual(requestedPath, document.path)) {
            return {
              summary,
              content: '当前只支持对已打开的当前文件静默写盘。',
              status: 'failed',
            };
          }

          if (!updatedContent) {
            return {
              summary,
              content: 'propose_patch 需要提供 updatedContent（完整新文件内容）。',
              status: 'failed',
            };
          }

          const payload = await aiService.proposePatch({
            path: document.path,
            originalContent: document.content,
            updatedContent,
            summary: patchSummary,
          });

          const result = await aiService.applyPatch({
            patch: payload.patch,
            metadata: {
              taskId: activeConversationId.value,
              turnId:
                activeAgentMessageId.value ??
                messages.value.at(-1)?.id ??
                activeConversationId.value,
              reason: payload.patch.summary,
              toolCallId: `agent-tool:${summary}`,
              confirmedByUser: true,
            },
          });

          const appliedPaths = result.appliedFiles.map((file) => file.path);

          syncPatchedDocument(document, payload.patch, appliedPaths);

          proposedPatch.value = null;

          return {
            summary,
            content: [
              `已静默写入 ${document.name}。`,
              `摘要：${payload.patch.summary}`,
              `文件数：${payload.patch.files.length}`,
              `Hunk 数：${countPatchHunks(payload.patch)}`,
              `已写入路径：${appliedPaths
                .map((path) => normalizePatchDisplayPath(path))
                .join('、')}`,
            ].join('\n'),
            status: 'succeeded',
          };
        }
      }
    } catch (error) {
      return {
        summary,
        content: toErrorMessage(error, `${AGENT_TOOL_LABELS[call.name]}失败`),
        status: 'failed',
      };
    }
  };

  const requestAgentAssistantMessage = async (
    requestMessages: IAiChatMessage[],
    references: IAiContextReference[],
  ): Promise<string> => {
    let unlisten: (() => void) | null = null;
    let collectedContent = '';
    let isSettled = false;
    let localStreamId: string | null = null;

    const cleanup = (): void => {
      unlisten?.();
      unlisten = null;
      activeStreamResolve.value = null;
      activeStreamId.value = null;
    };

    return new Promise<string>((resolve, reject) => {
      const settle = (handler: () => void): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        cleanup();
        handler();
      };

      const fail = (message: string): void => {
        settle(() => reject(new Error(message)));
      };

      const run = async (): Promise<void> => {
        try {
          unlisten = await aiService.onChatStream((event) => {
            if (!localStreamId && event.kind === 'start') {
              localStreamId = event.streamId;
              activeStreamId.value = event.streamId;
              return;
            }

            if (localStreamId && event.streamId !== localStreamId) {
              return;
            }

            if (event.kind === 'delta' && event.delta) {
              collectedContent += event.delta;
              return;
            }

            if (event.kind === 'done') {
              settle(() => resolve(collectedContent.trim()));
              return;
            }

            if (event.kind === 'cancelled') {
              fail(event.message ?? MSG_STREAM_CANCELLED);
              return;
            }

            if (event.kind === 'error') {
              fail(event.message ?? MSG_STREAM_ERROR);
            }
          });

          const stream = await aiService.chatStream({
            threadId: null,
            messages: requestMessages,
            references,
          });

          localStreamId = stream.streamId;
          activeStreamId.value = stream.streamId;
          activeStreamResolve.value = () => fail(MSG_STREAM_CANCELLED);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      void run();
    });
  };

  const executeAgentRequest = async (
    visibleMessages: IAiChatMessage[],
    messageContent: string,
    references: IAiContextReference[],
  ): Promise<void> => {
    errorMessage.value = '';
    isSending.value = true;
    agentSteps.value = [];

    const placeholderMessageId = createMessageId('assistant');

    const placeholderMessage: IAiChatMessage = {
      id: placeholderMessageId,
      role: 'assistant',
      content: 'AI 正在自动分析并按需调用工具…',
      createdAt: new Date().toISOString(),
      references: [],
      toolCalls: [],
    };

    messages.value = [...visibleMessages, placeholderMessage];
    activeAgentMessageId.value = placeholderMessageId;
    activeAbortController.value = new AbortController();

    const transcript: IAiChatMessage[] = [
      createAgentExecutionSystemMessage(messageContent),
      ...visibleMessages,
    ];

    const toolCalls: NonNullable<IAiChatMessage['toolCalls']> = [];

    try {
      for (let round = 0; round < MAX_AGENT_TOOL_ROUNDS; round += 1) {
        const modelContent = await requestAgentAssistantMessage(transcript, references);
        const envelope = parseAgentEnvelope(modelContent);

        if (envelope.type === 'final') {
          updateAgentExecutionMessage(
            placeholderMessageId,
            envelope.content || 'Agent 已完成，但模型没有返回额外说明。',
            toolCalls,
          );

          attachedFiles.value = [];
          return;
        }

        const toolCallId = `agent-tool-${round + 1}`;
        const toolLabel = envelope.summary?.trim() || AGENT_TOOL_LABELS[envelope.name];

        toolCalls.push({
          id: toolCallId,
          name: envelope.name,
          status: 'running',
          summary: toolLabel,
        });

        updateAgentStep(toolCallId, toolLabel, 'running');

        updateAgentExecutionMessage(
          placeholderMessageId,
          `AI 正在自动使用工具：${toolLabel}`,
          toolCalls,
        );

        const result = await executeAgentTool(envelope);
        const nextStatus = mapToolExecutionStatus(result.status);
        const toolCall = toolCalls.find((item) => item.id === toolCallId);

        if (toolCall) {
          toolCall.status = nextStatus;
        }

        updateAgentStep(
          toolCallId,
          toolLabel,
          nextStatus,
        );

        updateAgentExecutionMessage(
          placeholderMessageId,
          `AI 已自动完成工具调用：${toolLabel}`,
          [...toolCalls],
        );

        transcript.push({
          id: createMessageId('assistant'),
          role: 'assistant',
          content: modelContent,
          createdAt: new Date().toISOString(),
          references: [],
        });

        transcript.push({
          id: createMessageId('system'),
          role: 'system',
          content: [
            `工具 ${envelope.name} 已执行。`,
            `摘要：${result.summary}`,
            `状态：${result.status}`,
            '结果：',
            clipAgentToolResult(result.content),
          ].join('\n'),
          createdAt: new Date().toISOString(),
          references: [],
        });
      }

      updateAgentExecutionMessage(
        placeholderMessageId,
        'Agent 已达到本轮最大工具调用次数，请缩小问题范围后重试。',
        [...toolCalls],
      );
    } catch (error) {
      const wasAborted = activeAbortController.value?.signal.aborted;

      if (!wasAborted) {
        updateAgentExecutionMessage(
          placeholderMessageId,
          `Agent 执行失败：${toErrorMessage(error, MSG_CALL_FAILED)}`,
          [...toolCalls],
        );

        errorMessage.value = toErrorMessage(error, MSG_CALL_FAILED);
        draft.value = messageContent;
      }
    } finally {
      activeAbortController.value = null;
      activeAgentMessageId.value = null;
      isSending.value = false;
    }
  };

  // -----------------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------------

  const providerLabel = computed(() =>
    config.value.chatEnabled
      ? `${config.value.providerType} · ${config.value.selectedModel ?? 'mock-ide-assistant'}`
      : '未启用 Chat',
  );

  const sendButtonLabel = computed(() => (isSending.value ? '发送中…' : '发送'));

  const latestAssistantCodeBlock = computed(() => {
    const message = [...messages.value].reverse().find((item) => item.role === 'assistant');
    const match = message?.content.match(CODE_BLOCK_PATTERN);

    return match?.[1] ?? '';
  });

  const canPreviewPatch = computed(() => {
    const document = options.document.value;

    return Boolean(
      document.path &&
      document.kind === 'text' &&
      latestAssistantCodeBlock.value.trim(),
    );
  });

  // -----------------------------------------------------------------------
  // Context builders
  // -----------------------------------------------------------------------

  const buildDocumentContext = (): string => {
    const document = options.document.value;

    if (!document.id || document.kind !== 'text') {
      return '当前没有可用的文本脚本文档。';
    }

    return [
      `文件名：${document.name}`,
      `路径：${document.path ?? '未保存'}`,
      `状态：${document.isDirty ? '有未保存修改' : '已保存'}`,
      '脚本内容：',
      '```sh',
      clipText(document.content, MAX_CONTEXT_CHARS),
      '```',
    ].join('\n');
  };

  const buildRunContext = (): string => {
    const activeRun = options.activeRun.value;

    if (!activeRun) {
      return '当前没有正在运行或最近触发的运行记录。';
    }

    return [
      `运行文件：${activeRun.documentName}`,
      `命令：${activeRun.commandLine}`,
      `执行器：${activeRun.executorLabel}`,
      `开始时间：${activeRun.startedAt}`,
      `临时文件：${activeRun.usedTempFile ? '是' : '否'}`,
    ].join('\n');
  };

  const buildQuickPrompt = (actionId: TAiQuickActionId): string => {
    const documentContext = buildDocumentContext();

    if (actionId === 'explain') {
      return `请解释当前脚本的执行流程、关键变量、外部依赖和潜在风险。\n\n${documentContext}`;
    }

    if (actionId === 'fix') {
      return `请根据当前脚本和运行上下文定位问题根因，并给出最小修改方案。如果上下文不足，请列出还需要哪些信息。\n\n${documentContext}\n\n运行上下文：\n${buildRunContext()}`;
    }

    return `请按安全、参数可靠性、可维护性、边界条件和可验证性审查当前脚本。请只给出基于代码能确认的问题。\n\n${documentContext}`;
  };

  const resolveContextTokens = (prompt: string): Set<string> => {
    const tokens = new Set<string>();

    for (const match of prompt.matchAll(CONTEXT_TOKEN_PATTERN)) {
      const token = match[2]?.toLowerCase();

      if (token) {
        tokens.add(token);
      }
    }

    return tokens;
  };

  const shouldIncludeReference = (
    tokens: Set<string>,
    aliases: readonly string[],
  ): boolean =>
    tokens.size === 0 || aliases.some((alias) => tokens.has(alias));

  const buildProjectSearchReference = async (
    prompt: string,
  ): Promise<IAiContextReference | null> => {
    const tokens = resolveContextTokens(prompt);
    const shouldSearchProject = PROJECT_SEARCH_TOKENS.some((item) => tokens.has(item));
    const workspaceRootPath = options.workspaceRootPath.value;

    if (!shouldSearchProject || !workspaceRootPath) {
      return null;
    }

    const query = prompt
      .replace(CONTEXT_TOKEN_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    if (!query) {
      return null;
    }

    const payload = await aiService.queryIndex({
      workspaceRootPath,
      query,
      limit: 8,
    });

    if (payload.results.length === 0) {
      return null;
    }

    return {
      id: `search-result:${workspaceRootPath}:${query}`,
      kind: 'search-result',
      label: `项目搜索 · ${query}`,
      path: workspaceRootPath,
      range: null,
      contentPreview: payload.results
        .map((item) =>
          `${item.path}${item.lineNumber ? `:${item.lineNumber}` : ''}\n${item.preview}`)
        .join('\n---\n'),
      redacted: false,
    };
  };

  const buildReferences = async (prompt = ''): Promise<IAiContextReference[]> => {
    const tokens = resolveContextTokens(prompt);

    const currentFile = buildCurrentFileReference(options.document.value);
    const selection = buildSelectionReference(options.selection.value, options.document.value);
    const activeRun = buildActiveRunReference(options.activeRun.value);
    const diagnostics = buildDiagnosticsReference(
      options.analysis.value,
      options.document.value,
    );
    const gitDiff = buildGitDiffReference(options.gitStatus.value);
    const projectSearch = await buildProjectSearchReference(prompt).catch(() => null);

    const candidates: ReadonlyArray<readonly [IAiContextReference | null, readonly string[]]> = [
      [currentFile, ['file', 'current-file']],
      [selection, ['selection']],
      [activeRun, ['terminal', 'log']],
      [diagnostics, ['diagnostics', 'shellcheck']],
      [gitDiff, ['git-diff', 'git']],
      [projectSearch, PROJECT_SEARCH_TOKENS],
    ];

    const references = candidates
      .filter(([, aliases]) => shouldIncludeReference(tokens, aliases))
      .map(([reference]) => reference)
      .filter((item): item is IAiContextReference => item !== null);

    return [
      ...references,
      ...attachedFiles.value.map((file) => file.reference),
    ];
  };

  // -----------------------------------------------------------------------
  // Config / tools / credentials
  // -----------------------------------------------------------------------

  const loadConfig = async (): Promise<void> => {
    config.value = await aiService.getConfig();
  };

  const loadTools = async (): Promise<void> => {
    toolDefinitions.value = await aiService.listTools();
  };

  const saveConfig = async (nextConfig: IAiConfigPayload): Promise<void> => {
    config.value = await aiService.saveConfig({
      providerType: nextConfig.providerType,
      selectedModel: nextConfig.selectedModel,
      baseUrl: nextConfig.baseUrl,
      inlineCompletionEnabled: nextConfig.inlineCompletionEnabled,
      chatEnabled: nextConfig.chatEnabled,
      agentEnabled: nextConfig.agentEnabled,
    });
  };

  const saveCredentials = async (
    apiKey: string,
    providerType = config.value.providerType,
  ): Promise<void> => {
    config.value = await aiService.saveCredentials({
      providerType,
      apiKey,
    });
  };

  const createProviderConnectionRequest = (
    nextConfig: IAiConfigPayload,
    apiKey: string,
  ): IAiProviderConnectionRequest => ({
    providerType: nextConfig.providerType,
    selectedModel: nextConfig.selectedModel,
    baseUrl: nextConfig.baseUrl,
    inlineCompletionEnabled: nextConfig.inlineCompletionEnabled,
    chatEnabled: nextConfig.chatEnabled,
    agentEnabled: nextConfig.agentEnabled,
    apiKey: apiKey.trim() || null,
  });

  const testProviderConfig = async (
    nextConfig: IAiConfigPayload,
    apiKey: string,
  ): Promise<string> => {
    const result = await aiService.testProviderConfig(
      createProviderConnectionRequest(nextConfig, apiKey),
    );

    if (!result.ok) {
      errorMessage.value = result.message;
      throw new Error(result.message);
    }

    return result.message;
  };

  const connectProvider = async (
    nextConfig: IAiConfigPayload,
    apiKey: string,
  ): Promise<string> => {
    const result = await aiService.connectProvider(
      createProviderConnectionRequest(nextConfig, apiKey),
    );

    config.value = result.config;

    return result.test.message;
  };

  const testProvider = async (): Promise<string> => {
    const result = await aiService.testProvider();

    if (!result.ok) {
      errorMessage.value = result.message;
      throw new Error(result.message);
    }

    return result.message;
  };

  // -----------------------------------------------------------------------
  // Quick actions / attachments
  // -----------------------------------------------------------------------

  const applyQuickAction = (action: IAiQuickAction): void => {
    draft.value = buildQuickPrompt(action.id);

    void buildReferences(draft.value).then((references) => {
      currentReferences.value = references;
    });

    errorMessage.value = '';
  };

  const attachFile = async (file: File): Promise<void> => {
    const normalizedName = normalizeAttachmentName(file);

    if (isTextAttachment(file)) {
      if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
        errorMessage.value = `附件超过 ${formatBytes(MAX_TEXT_ATTACHMENT_BYTES)}，请先拆分或只粘贴关键片段。`;
        return;
      }

      const content = await file.text().catch((): null => null);

      if (content === null) {
        errorMessage.value = '读取附件失败，请确认文件可访问后重试。';
        return;
      }

      const id = `attachment:${normalizedName}:${file.lastModified}:${file.size}`;

      const reference: IAiContextReference = {
        id,
        kind: 'search-result',
        label: `附件 · ${normalizedName}`,
        path: normalizedName,
        range: null,
        contentPreview: [
          `文件名：${normalizedName}`,
          `大小：${formatBytes(file.size)}`,
          '内容：',
          clipText(content, MAX_CONTEXT_CHARS),
        ].join('\n'),
        redacted: false,
      };

      attachedFiles.value = [
        ...attachedFiles.value.filter((item) => item.id !== id),
        {
          id,
          name: normalizedName,
          sizeLabel: formatBytes(file.size),
          kind: 'text',
          reference,
        },
      ];

      currentReferences.value = await buildReferences(draft.value);
      errorMessage.value = '';

      return;
    }

    if (isImageAttachment(file)) {
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        errorMessage.value = `图片超过 ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}，请压缩后再试。`;
        return;
      }

      const dimensions = await readImageDimensions(file);
      const dimensionsLabel = formatImageDimensions(dimensions);
      const id = `attachment:${normalizedName}:${file.lastModified}:${file.size}`;

      const reference: IAiContextReference = {
        id,
        kind: 'image-attachment',
        label: `图片附件 · ${normalizedName}`,
        path: normalizedName,
        range: null,
        contentPreview: [
          `文件名：${normalizedName}`,
          `类型：${file.type || 'image/*'}`,
          `大小：${formatBytes(file.size)}`,
          ...(dimensionsLabel ? [`尺寸：${dimensionsLabel}`] : []),
          '说明：这是用户在 AI 输入框里粘贴或添加的图片附件。当前会把图片元信息作为上下文发送。',
        ].join('\n'),
        redacted: false,
      };

      attachedFiles.value = [
        ...attachedFiles.value.filter((item) => item.id !== id),
        {
          id,
          name: normalizedName,
          sizeLabel: formatBytes(file.size),
          kind: 'image',
          detailLabel: dimensionsLabel ?? undefined,
          reference,
        },
      ];

      currentReferences.value = await buildReferences(draft.value);
      errorMessage.value = '';

      return;
    }

    errorMessage.value = '当前只支持文本文件和图片作为 AI 上下文附件。';
  };

  const removeAttachedFile = (id: string): void => {
    attachedFiles.value = attachedFiles.value.filter((item) => item.id !== id);

    void buildReferences(draft.value).then((references) => {
      currentReferences.value = references;
    });
  };

  // -----------------------------------------------------------------------
  // Streaming pipeline
  // -----------------------------------------------------------------------

  interface IStreamPipeline {
    readonly handleEvent: (event: IAiChatStreamEventPayload) => void;
    readonly startAssistantStream: (streamId: string, assistantMessageId: string) => void;
    readonly cleanupRaf: () => void;
  }

  const createStreamPipeline = (
    assistantMessage: IAiChatMessage,
    messageContent: string,
    settle: () => void,
  ): IStreamPipeline => {
    let pendingDelta = '';
    let animationFrameId: number | null = null;
    let isStreamClosed = false;
    let hasStartedStream = false;

    const syncAssistantMessage = (): void => {
      const current = activeAssistantMessage.value;

      if (!current) {
        return;
      }

      current.content = aiStream.content.value;
      current.stream = {
        stableContent: aiStream.stableContent.value,
        openBlock: aiStream.openCodeBlock.value,
        status: mapStreamStatus(aiStream.status.value),
      };

      messages.value = [
        ...activeAssistantBaseMessages.value,
        { ...current },
      ];
    };

    const flushPendingDelta = (): void => {
      animationFrameId = null;

      if (!pendingDelta || isStreamClosed) {
        return;
      }

      const chunk = pendingDelta;
      pendingDelta = '';

      aiStream.append(chunk);
      syncAssistantMessage();
    };

    const scheduleDelta = (delta: string): void => {
      if (isStreamClosed) {
        return;
      }

      pendingDelta += delta;

      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(flushPendingDelta);
    };

    const cleanupRaf = (): void => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    const startAssistantStream = (
      streamId: string,
      assistantMessageId: string,
    ): void => {
      if (hasStartedStream) {
        return;
      }

      hasStartedStream = true;
      activeStreamId.value = streamId;
      assistantMessage.id = assistantMessageId;

      aiStream.start({ messageId: assistantMessageId });
      syncAssistantMessage();
    };

    const handleEvent = (event: IAiChatStreamEventPayload): void => {
      if (!activeStreamId.value && event.kind === 'start') {
        startAssistantStream(event.streamId, event.assistantMessageId);
        return;
      }

      if (event.streamId !== activeStreamId.value) {
        return;
      }

      if (event.kind === 'delta' && event.delta) {
        scheduleDelta(event.delta);
        return;
      }

      cleanupRaf();
      flushPendingDelta();
      isStreamClosed = true;

      if (event.kind === 'done') {
        aiStream.complete();
        syncAssistantMessage();
        attachedFiles.value = [];
        settle();
        return;
      }

      if (event.kind === 'cancelled') {
        aiStream.stop();
        syncAssistantMessage();
        errorMessage.value = event.message ?? MSG_STREAM_CANCELLED;
        settle();
        return;
      }

      if (event.kind === 'error') {
        aiStream.stop();
        syncAssistantMessage();
        errorMessage.value = event.message ?? MSG_STREAM_ERROR;
        draft.value = messageContent;
        settle();
      }
    };

    return {
      handleEvent,
      startAssistantStream,
      cleanupRaf,
    };
  };

  const executeAiRequest = async (
    requestMessages: IAiChatMessage[],
    visibleMessages: IAiChatMessage[],
    messageContent: string,
    references: IAiContextReference[],
  ): Promise<void> => {
    errorMessage.value = '';
    isSending.value = true;

    const assistantMessage: IAiChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      references: [],
      stream: {
        stableContent: '',
        openBlock: null,
        status: 'streaming',
      },
    };

    activeAssistantMessage.value = assistantMessage;
    activeAssistantBaseMessages.value = visibleMessages;
    messages.value = [...visibleMessages, assistantMessage];

    let unlisten: (() => void) | null = null;
    let hasSettledStream = false;

    const settle = (): void => {
      hasSettledStream = true;
      activeStreamResolve.value?.();
    };

    const pipeline = createStreamPipeline(
      assistantMessage,
      messageContent,
      settle,
    );

    try {
      unlisten = await aiService.onChatStream(pipeline.handleEvent);

      const stream = await aiService.chatStream({
        threadId: null,
        messages: requestMessages,
        references,
      });

      pipeline.startAssistantStream(
        stream.streamId,
        stream.assistantMessageId,
      );

      await new Promise<void>((resolve) => {
        if (hasSettledStream) {
          resolve();
          return;
        }

        activeStreamResolve.value = resolve;
      });
    } finally {
      pipeline.cleanupRaf();
      unlisten?.();

      activeStreamResolve.value = null;
      activeStreamId.value = null;
      activeAbortController.value = null;
      activeAssistantMessage.value = null;
      activeAssistantBaseMessages.value = [];
      isSending.value = false;
    }
  };

  // -----------------------------------------------------------------------
  // sendMessage / planAgentTask
  // -----------------------------------------------------------------------

  const handleMessageAction = async (
    _messageId: string,
    _actionId: TAiChatMessageActionId,
  ): Promise<void> => {
    void _messageId;
    void _actionId;

    return Promise.resolve();
  };

  const sendMessage = async (): Promise<void> => {
    const content = draft.value.trim();

    if ((!content && attachedFiles.value.length === 0) || isSending.value) {
      return;
    }

    if (!config.value.chatEnabled) {
      errorMessage.value = '请先启用 AI Chat。';
      isSettingsOpen.value = true;
      return;
    }

    if (!config.value.isConfigured) {
      errorMessage.value = 'AI Provider 还没配置完整，请先保存当前厂商配置和 API Key。';
      isSettingsOpen.value = true;
      return;
    }

    const messageContent = content || '请分析我添加的附件内容。';
    const references = await buildReferences(messageContent);

    currentReferences.value = references;

    const userMessage: IAiChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: messageContent,
      createdAt: new Date().toISOString(),
      references,
    };

    const nextMessages = [...messages.value, userMessage];

    messages.value = nextMessages;
    draft.value = '';
    errorMessage.value = '';

    if (activeMode.value === 'agent') {
      try {
        await agentPlan.classifyTask(messageContent, references);

        if (agentPlan.store.shouldEnterPlanMode) {
          const steps = await agentPlan.createPlan(
            messageContent,
            references,
          );

          agentSteps.value = steps.map((step) => ({
            id: step.id,
            title: step.title,
            status: step.status,
          }));

          const planLines = steps.map((step) =>
            `${step.index + 1}. ${step.title}`,
          );

          const planMessage: IAiChatMessage = {
            id: createMessageId('assistant'),
            role: 'assistant',
            content: [
              '已进入 Plan Mode，请先确认计划：',
              '',
              ...planLines,
            ].join('\n'),
            createdAt: new Date().toISOString(),
            references,
          };

          messages.value = [...nextMessages, planMessage];

          return;
        }

        await executeAiRequest(
          nextMessages,
          nextMessages,
          messageContent,
          references,
        );

        return;
      } catch (error) {
        errorMessage.value = toErrorMessage(error, '生成计划失败。');
        draft.value = messageContent;
        return;
      }
    }

    try {
      await executeAiRequest(
        nextMessages,
        nextMessages,
        messageContent,
        references,
      );
    } catch (error) {
      errorMessage.value = toErrorMessage(error, MSG_CALL_FAILED);
      draft.value = messageContent;
    }
  };

  // -----------------------------------------------------------------------
  // Conversation / patch
  // -----------------------------------------------------------------------

  const resetConversationUiState = (): void => {
    draft.value = '';
    currentReferences.value = [];
    proposedPatch.value = null;
    agentSteps.value = [];

    agentPlan.resetPlan();

    attachedFiles.value = [];
    errorMessage.value = '';
    activeAssistantMessage.value = null;
    activeAssistantBaseMessages.value = [];
    activeAgentMessageId.value = null;
    isClearDialogOpen.value = false;
  };

  const clearConversation = (): void => {
    conversationStore.clearActiveThread();
    resetConversationUiState();
  };

  const startNewConversation = (): void => {
    conversationStore.startNewThread();
    resetConversationUiState();
  };

  const switchConversation = (threadId: string): void => {
    conversationStore.switchThread(threadId);
    resetConversationUiState();
  };

  const previewPatchFromLastAnswer = async (): Promise<void> => {
    const document = options.document.value;
    const updatedContent = latestAssistantCodeBlock.value;

    if (!document.path || document.kind !== 'text' || !updatedContent.trim()) {
      errorMessage.value = '没有可预览的代码块，或当前文件尚未保存。';
      return;
    }

    const payload = await aiService.proposePatch({
      path: document.path,
      originalContent: document.content,
      updatedContent,
      summary: '应用 AI 回复中的代码块',
    });

    proposedPatch.value = payload.patch;
    errorMessage.value = '';
  };

  const previewPatchFromCodeBlock = async (
    block: IAiCodeBlock,
  ): Promise<void> => {
    const document = options.document.value;

    if (!document.path || document.kind !== 'text') {
      errorMessage.value = '当前文件尚未保存，无法生成 Patch 预览。';
      return;
    }

    if (block.fence.meta.filePath && block.fence.meta.filePath !== document.path) {
      errorMessage.value = '代码块目标文件不是当前文件，暂不能直接生成 Patch 预览。';
      return;
    }

    if (!block.content.trim()) {
      errorMessage.value = '代码块内容为空，无法生成 Patch 预览。';
      return;
    }

    try {
      const payload = await aiService.proposePatch({
        path: document.path,
        originalContent: document.content,
        updatedContent: block.content,
        summary: '应用 AI 代码块',
      });

      proposedPatch.value = payload.patch;
      errorMessage.value = '';
    } catch (error) {
      errorMessage.value = toErrorMessage(error, 'Patch 预览失败');
    }
  };

  const applyProposedPatch = async (): Promise<void> => {
    const patch = proposedPatch.value;

    if (!patch || isApplyingPatch.value) {
      return;
    }

    isApplyingPatch.value = true;

    try {
      const result = await aiService.applyPatch({
        patch,
        metadata: {
          taskId: activeConversationId.value,
          turnId: messages.value.at(-1)?.id ?? activeConversationId.value,
          reason: patch.summary,
          toolCallId: null,
          confirmedByUser: true,
        },
      });

      const appliedPaths = result.appliedFiles.map((file) => file.path);

      syncPatchedDocument(options.document.value, patch, appliedPaths);

      messages.value = [
        ...messages.value,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          content: `Patch 已应用：${appliedPaths
            .map((file) => normalizePatchDisplayPath(file))
            .join('、')}`,
          createdAt: new Date().toISOString(),
          references: [],
        },
      ];

      proposedPatch.value = null;
      errorMessage.value = '';
    } catch (error) {
      errorMessage.value = toErrorMessage(error, 'Patch 应用失败');
    } finally {
      isApplyingPatch.value = false;
    }
  };

  const stopCurrentRequest = (): void => {
    const streamId = activeStreamId.value;

    if (streamId) {
      void aiService.cancel({ streamId });
    }

    activeAbortController.value?.abort();
    activeAbortController.value = null;

    activeStreamId.value = null;
    activeStreamResolve.value?.();
    activeStreamResolve.value = null;

    aiStream.stop();

    if (activeAssistantMessage.value) {
      activeAssistantMessage.value.stream = {
        stableContent: aiStream.stableContent.value,
        openBlock: aiStream.openCodeBlock.value,
        status: 'cancelled',
      };
      activeAssistantMessage.value.content = aiStream.content.value;

      messages.value = [
        ...activeAssistantBaseMessages.value,
        { ...activeAssistantMessage.value },
      ];
    }

    if (activeAgentMessageId.value) {
      updateAgentExecutionMessage(
        activeAgentMessageId.value,
        'Agent 执行已取消。',
      );
      activeAgentMessageId.value = null;
    }

    isSending.value = false;
    errorMessage.value = MSG_STREAM_CANCELLED;
  };

  // -----------------------------------------------------------------------
  // Public surface
  // -----------------------------------------------------------------------

  return {
    agentPlan,
    config,
    messages,
    historyThreads,
    activeConversationId,
    draft,
    isSending,
    errorMessage,
    isSettingsOpen,
    isClearDialogOpen,
    currentReferences,
    proposedPatch,
    isApplyingPatch,
    activeMode,
    agentSteps,
    toolDefinitions,
    attachedFiles,
    providerLabel,
    sendButtonLabel,
    canPreviewPatch,
    loadConfig,
    loadTools,
    saveConfig,
    saveCredentials,
    testProviderConfig,
    connectProvider,
    testProvider,
    applyQuickAction,
    attachFile,
    removeAttachedFile,
    executeAgentRequest,
    sendMessage,
    handleMessageAction,
    stopCurrentRequest,
    previewPatchFromLastAnswer,
    previewPatchFromCodeBlock,
    applyProposedPatch,
    clearConversation,
    startNewConversation,
    switchConversation,
  };
};