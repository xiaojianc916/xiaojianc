import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useAiAssistant } from '@/composables/useAiAssistant';
import { useAiAgentStore } from '@/store/aiAgent';
import { useAiConversationStore } from '@/store/aiConversation';
import type { IAiChatStreamEventPayload } from '@/types/ai';
import type { IAnalyzeScriptPayload, IEditorDocument } from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STREAM_ID = 'stream-1' as const;
const ASSISTANT_MESSAGE_ID = 'assistant-1' as const;
const MOCK_MODEL = 'mock-ide-assistant' as const;
const WORKSPACE_ROOT = 'd:/com.xiaojianc/my_desktop_app' as const;

// ---------------------------------------------------------------------------
// AI service mock (hoisted so vi.mock factory can reach it)
// ---------------------------------------------------------------------------

const aiServiceMock = vi.hoisted(() => {
    type StreamHandler = (payload: IAiChatStreamEventPayload) => void;

    let streamHandler: StreamHandler | null = null;
    let streamSequence = 0;
    const queuedStreamResponses: Array<{
        streamId: string;
        assistantMessageId: string;
        content: string;
        terminalKind: 'done' | 'error';
        terminalMessage: string | null;
    }> = [];

    const onChatStream = vi.fn(async (handler: StreamHandler) => {
        streamHandler = handler;
        return vi.fn(); // unsubscribe
    });

    const chatStream = vi.fn(async () => {
        const queued = queuedStreamResponses.shift();
        if (!queued) {
            return {
                streamId: STREAM_ID,
                assistantMessageId: ASSISTANT_MESSAGE_ID,
                providerType: 'mock',
                model: MOCK_MODEL,
            };
        }

        queueMicrotask(() => {
            streamHandler?.({
                streamId: queued.streamId,
                assistantMessageId: queued.assistantMessageId,
                kind: 'start',
                delta: null,
                message: null,
                model: MOCK_MODEL,
            });
            for (const chunk of queued.content.match(/.{1,24}/g) ?? []) {
                streamHandler?.({
                    streamId: queued.streamId,
                    assistantMessageId: queued.assistantMessageId,
                    kind: 'delta',
                    delta: chunk,
                    message: null,
                    model: MOCK_MODEL,
                });
            }
            streamHandler?.({
                streamId: queued.streamId,
                assistantMessageId: queued.assistantMessageId,
                kind: queued.terminalKind,
                delta: null,
                message: queued.terminalMessage,
                model: MOCK_MODEL,
            });
        });

        return {
            streamId: queued.streamId,
            assistantMessageId: queued.assistantMessageId,
            providerType: 'mock',
            model: MOCK_MODEL,
        };
    });

    const chat = vi.fn(async () => ({
        message: {
            id: ASSISTANT_MESSAGE_ID,
            role: 'assistant',
            content: '{"type":"final","content":"mock agent final"}',
            createdAt: '2026-04-29T00:00:00.000Z',
            references: [],
        },
        providerType: 'mock',
        model: MOCK_MODEL,
    }));

    const toolLoopChat = vi.fn(async () => ({
        content: '已按简单任务直接给出处理结论。',
        model: MOCK_MODEL,
        stopReason: 'completed' as const,
        turns: 1,
        pendingDecisionKey: null,
        pendingConfirmation: null,
        toolResults: [],
    }));

    const cancel = vi.fn(async (payload: { streamId: string }) => {
        void payload;
    });

    const queryIndex = vi.fn(async () => ({
        rootPath: WORKSPACE_ROOT,
        results: [],
    }));

    const proposePatch = vi.fn(async () => ({
        patch: {
            summary: 'mock patch',
            files: [],
        },
    }));

    const applyPatch = vi.fn(async () => ({
        appliedFiles: [],
    }));

    const classifyTask = vi.fn(async () => ({
        classification: 'complex',
        shouldEnterPlanMode: true,
        reason: '任务影响面较大，需先进入计划模式。',
    }));

    const planTask = vi.fn(async () => ({
        steps: [
            {
                id: 'plan-step-1',
                index: 0,
                title: '收集上下文',
                goal: '收集上下文',
                kind: 'inspect',
                status: 'pending',
                expectedOutput: '产出影响范围',
                tools: ['search_text'],
                requiresUserApproval: false,
                riskLevel: 'low',
            },
            {
                id: 'plan-step-2',
                index: 1,
                title: '输出实施计划',
                goal: '输出实施计划',
                kind: 'summarize',
                status: 'pending',
                expectedOutput: '产出可执行计划',
                tools: ['get_diagnostics'],
                requiresUserApproval: true,
                riskLevel: 'medium',
            },
        ],
    }));

    const approvePlan = vi.fn(async () => ({
        approvedAt: '2026-04-29T00:00:00.000Z',
        stepCount: 2,
    }));

    return {
        onChatStream,
        chat,
        chatStream,
        toolLoopChat,
        cancel,
        queryIndex,
        proposePatch,
        applyPatch,
        classifyTask,
        planTask,
        approvePlan,
        queueStreamResponse(content: string, terminalKind: 'done' | 'error' = 'done', terminalMessage: string | null = null): void {
            streamSequence += 1;
            queuedStreamResponses.push({
                streamId: `${STREAM_ID}-${streamSequence}`,
                assistantMessageId: `${ASSISTANT_MESSAGE_ID}-${streamSequence}`,
                content,
                terminalKind,
                terminalMessage,
            });
        },
        emit(event: IAiChatStreamEventPayload): void {
            streamHandler?.(event);
        },
        emitDelta(delta: string): void {
            streamHandler?.({
                streamId: STREAM_ID,
                assistantMessageId: ASSISTANT_MESSAGE_ID,
                kind: 'delta',
                delta,
                message: null,
                model: MOCK_MODEL,
            });
        },
        reset(): void {
            streamHandler = null;
            streamSequence = 0;
            queuedStreamResponses.length = 0;
            onChatStream.mockClear();
            chat.mockClear();
            chatStream.mockClear();
            toolLoopChat.mockClear();
            cancel.mockClear();
            queryIndex.mockClear();
            proposePatch.mockClear();
            applyPatch.mockClear();
            classifyTask.mockClear();
            planTask.mockClear();
            approvePlan.mockClear();
        },
    };
});

vi.mock('@/services/modules/ai', () => ({
    aiService: {
        onChatStream: aiServiceMock.onChatStream,
        chat: aiServiceMock.chat,
        chatStream: aiServiceMock.chatStream,
        toolLoopChat: aiServiceMock.toolLoopChat,
        cancel: aiServiceMock.cancel,
        queryIndex: aiServiceMock.queryIndex,
        proposePatch: aiServiceMock.proposePatch,
        applyPatch: aiServiceMock.applyPatch,
        classifyTask: aiServiceMock.classifyTask,
        planTask: aiServiceMock.planTask,
        approvePlan: aiServiceMock.approvePlan,
    },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const waitForStartedStream = async (
    resolveMessageId: () => string | undefined,
    expectedId: string = ASSISTANT_MESSAGE_ID,
    maxAttempts = 8,
): Promise<void> => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (resolveMessageId() === expectedId) {
            return;
        }
        await flushMicrotasks();
    }
    throw new Error(
        `assistant stream did not start in time (expected id="${expectedId}" within ${maxAttempts} ticks)`,
    );
};

const createDocument = (): IEditorDocument => ({
    id: 'doc-1',
    path: 'src/app.ts',
    name: 'app.ts',
    kind: 'text',
    content: 'const start = true;',
    encoding: 'utf-8',
    savedContent: 'const start = true;',
    savedEncoding: 'utf-8',
    isDirty: false,
    lineCount: 1,
    charCount: 19,
});

const createAnalysis = (): IAnalyzeScriptPayload => ({
    available: true,
    message: null,
    dialect: 'typescript',
    diagnostics: [],
});

const createGitStatus = (): IGitRepositoryStatusPayload => ({
    available: false,
    message: null,
    repositoryRootPath: null,
    repositoryName: null,
    gitDirPath: null,
    headBranchName: null,
    headShortName: null,
    headShortOid: null,
    isDetached: false,
    isClean: true,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    files: [],
    lastCommit: null,
});

const createAssistantHarness = (): ReturnType<typeof useAiAssistant> =>
    createAssistantHarnessContext().assistant;

const createAssistantHarnessContext = (
    overrides: {
        analysis?: IAnalyzeScriptPayload;
    } = {},
) => {
    const document = ref(createDocument());
    const assistant = useAiAssistant({
        document,
        activeRun: ref(null),
        analysis: ref(overrides.analysis ?? createAnalysis()),
        selection: ref(null),
        gitStatus: ref(createGitStatus()),
        workspaceRootPath: ref(WORKSPACE_ROOT),
    });

    return {
        assistant,
        document,
    };
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useAiAssistant streaming integration', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        aiServiceMock.reset();
        vi.stubGlobal(
            'requestAnimationFrame',
            (callback: FrameRequestCallback): number => {
                callback(0);
                return 1;
            },
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('pipes streaming delta through the fence parser into message.stream', async () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '解释这段代码';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emitDelta('前文 **markdown**\n\n```ts\nconst pending = true;');
        await flushMicrotasks();

        const assistantMessage = assistant.messages.value.at(-1);
        expect(assistantMessage?.content).toBe(
            '前文 **markdown**\n\n```ts\nconst pending = true;',
        );
        expect(assistantMessage?.stream?.stableContent).toBe('前文 **markdown**\n\n');
        expect(assistantMessage?.stream?.status).toBe('streaming');
        expect(assistantMessage?.stream?.openBlock?.id).toBe(`${ASSISTANT_MESSAGE_ID}:0`);
        expect(assistantMessage?.stream?.openBlock?.content).toBe('const pending = true;');
        expect(assistantMessage?.stream?.openBlock?.streamState).toBe('open');

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('marks the open block cancelled immediately on stop and ignores late delta', async () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '继续';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emitDelta('```ts\nconst pending = true;\n');
        await flushMicrotasks();

        assistant.stopCurrentRequest();

        const cancelledMessage = assistant.messages.value.at(-1);
        expect(aiServiceMock.cancel).toHaveBeenCalledWith({ streamId: STREAM_ID });
        expect(cancelledMessage?.stream?.status).toBe('cancelled');
        expect(cancelledMessage?.stream?.openBlock?.streamState).toBe('cancelled');
        expect(cancelledMessage?.stream?.openBlock?.content).toBe('const pending = true;\n');

        const contentBeforeLateDelta = cancelledMessage?.content;

        // Late delta arriving after cancel must not mutate the message.
        aiServiceMock.emitDelta('```\n不应该进入消息');
        await flushMicrotasks();

        expect(assistant.messages.value.at(-1)?.content).toBe(contentBeforeLateDelta);

        await sendPromise;
    });

    it('accepts image attachments and includes them in outgoing references', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
            width: 640,
            height: 480,
            close: vi.fn(),
        })));

        const assistant = createAssistantHarness();
        const image = new File(['image-bytes'], 'pasted-image.png', { type: 'image/png' });

        await assistant.attachFile(image);

        expect(assistant.attachedFiles.value).toHaveLength(1);
        expect(assistant.attachedFiles.value[0]?.kind).toBe('image');
        expect(assistant.attachedFiles.value[0]?.detailLabel).toBe('640 × 480');
        expect(assistant.attachedFiles.value[0]?.reference.kind).toBe('image-attachment');
        expect(assistant.attachedFiles.value[0]?.reference.content).toBeUndefined();

        assistant.draft.value = '';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.chatStream.mock.calls[0]?.[0]?.references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'image-attachment',
                    label: '图片附件 · pasted-image.png',
                }),
            ]),
        );

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('starts a new conversation by clearing draft and transient state', () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '还没发送的内容';
        assistant.messages.value = [{
            id: 'assistant-1',
            role: 'assistant',
            content: '旧会话消息',
            createdAt: '2026-04-28T10:00:00.000Z',
            references: [],
        }];
        assistant.currentReferences.value = [{
            id: 'ref-1',
            kind: 'current-file',
            label: '当前文件',
            path: 'src/app.ts',
            range: null,
            contentPreview: 'const start = true;',
            redacted: false,
        }];
        assistant.errorMessage.value = '旧错误';

        assistant.startNewConversation();

        expect(assistant.draft.value).toBe('');
        expect(assistant.messages.value).toHaveLength(0);
        expect(assistant.historyThreads.value).toHaveLength(1);
        expect(assistant.historyThreads.value[0]?.messages[0]?.id).toBe('assistant-1');
        expect(assistant.currentReferences.value).toHaveLength(0);
        expect(assistant.errorMessage.value).toBe('');
    });

    it('hydrates persisted messages from the conversation store', () => {
        const conversationStore = useAiConversationStore();

        conversationStore.replaceMessages([
            {
                id: 'persisted-message',
                role: 'assistant',
                content: '持久化历史消息',
                createdAt: '2026-04-28T10:00:00.000Z',
                references: [],
            },
        ]);

        const assistant = createAssistantHarness();

        expect(assistant.messages.value).toHaveLength(1);
        expect(assistant.messages.value[0]?.id).toBe('persisted-message');
    });

    it('enters plan mode first for complex tasks in agent mode', async () => {
        const { assistant } = createAssistantHarnessContext();

        aiServiceMock.classifyTask.mockResolvedValueOnce({
            classification: 'complex',
            shouldEnterPlanMode: true,
            reason: '任务影响面较大，需先进入计划模式。',
        });
        aiServiceMock.planTask.mockResolvedValueOnce({
            steps: [
                {
                    id: 'plan-step-1',
                    index: 0,
                    title: '收集上下文',
                    goal: '收集上下文',
                    kind: 'inspect',
                    status: 'pending',
                    expectedOutput: '产出影响范围',
                    tools: ['search_text'],
                    requiresUserApproval: false,
                    riskLevel: 'low',
                },
                {
                    id: 'plan-step-2',
                    index: 1,
                    title: '输出实施计划',
                    goal: '输出实施计划',
                    kind: 'summarize',
                    status: 'pending',
                    expectedOutput: '产出可执行计划',
                    tools: ['get_diagnostics'],
                    requiresUserApproval: true,
                    riskLevel: 'medium',
                },
            ],
        });

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '在当前文件里整理数据库备份示例';

        await assistant.sendMessage();

        expect(assistant.messages.value).toHaveLength(1);
        expect(assistant.messages.value[0]?.role).toBe('user');
        expect(aiServiceMock.classifyTask).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.planTask).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(0);
        expect(assistant.agentSteps.value).toHaveLength(2);
        expect(assistant.agentPlan.store.steps).toHaveLength(2);
    });

    it('uses provider tool loop when task is classified as simple in agent mode', async () => {
        const { assistant } = createAssistantHarnessContext();

        aiServiceMock.classifyTask.mockResolvedValueOnce({
            classification: 'simple',
            shouldEnterPlanMode: false,
            reason: '简单任务，可直接执行。',
        });

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '解释当前脚本';

        await assistant.sendMessage();

        expect(aiServiceMock.classifyTask).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.planTask).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.toolLoopChat).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.applyPatch).toHaveBeenCalledTimes(0);
        expect(assistant.messages.value[1]?.content).toContain('已按简单任务直接给出处理结论');
    });

    it('updates the current assistant message when provider tool activity streams in', async () => {
        const { assistant } = createAssistantHarnessContext();
        let resolveToolLoop!: (value: Awaited<ReturnType<typeof aiServiceMock.toolLoopChat>>) => void;
        const toolLoopPromise = new Promise<Awaited<ReturnType<typeof aiServiceMock.toolLoopChat>>>((resolve) => {
            resolveToolLoop = resolve;
        });

        aiServiceMock.classifyTask.mockResolvedValueOnce({
            classification: 'simple',
            shouldEnterPlanMode: false,
            reason: '简单任务，可直接执行。',
        });
        aiServiceMock.toolLoopChat.mockImplementationOnce(async () => toolLoopPromise);

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '@current-file · test.sh\n丰富一下目前的脚本内容';

        const sendPromise = assistant.sendMessage();
        for (let attempt = 0; attempt < 8 && aiServiceMock.toolLoopChat.mock.calls.length === 0; attempt += 1) {
            await flushMicrotasks();
        }

        const request = aiServiceMock.toolLoopChat.mock.calls[0]?.[0];
        expect(request?.runId).toBeTruthy();

        assistant.applyProviderToolActivity(request?.runId ?? '', {
            id: 'activity-read-file',
            stepId: 'tool-call-step:read_file:call-read',
            toolName: 'read_file',
            state: 'running',
            label: '正在读取 test.sh…',
            startedAt: '2026-04-29T00:00:00.000Z',
        });

        expect(assistant.messages.value[1]?.toolCalls?.[0]).toMatchObject({
            name: 'read_file',
            status: 'running',
            summary: '正在读取 test.sh…',
        });

        resolveToolLoop({
            content: '我已经读取 test.sh，并给出增强方案。',
            model: MOCK_MODEL,
            stopReason: 'completed' as const,
            turns: 2,
            pendingDecisionKey: null,
            pendingConfirmation: null,
            toolResults: [{
                id: 'call-read',
                runId: request?.runId ?? '',
                stepId: 'tool-call-step:read_file:call-read',
                toolName: 'read_file',
                status: 'succeeded' as const,
                requiresUserConfirmation: false,
                summary: 'Read file content for test.sh (21 bytes).',
                outputRef: 'agent-tool-output:read_file:test',
                startedAt: '2026-04-29T00:00:00.000Z',
                endedAt: '2026-04-29T00:00:01.000Z',
            }],
        });
        await sendPromise;

        expect(assistant.messages.value[1]?.content).toContain('增强方案');
        expect(assistant.messages.value[1]?.toolCalls?.[0]?.status).toBe('succeeded');
    });

    it('continues provider tool loop after inline tool confirmation is approved', async () => {
        const { assistant } = createAssistantHarnessContext();
        const agentStore = useAiAgentStore();
        const timestamp = '2026-04-29T00:00:00.000Z';

        aiServiceMock.classifyTask.mockResolvedValueOnce({
            classification: 'simple',
            shouldEnterPlanMode: false,
            reason: '简单任务，可直接执行。',
        });
        aiServiceMock.toolLoopChat
            .mockResolvedValueOnce({
                content: '',
                model: MOCK_MODEL,
                stopReason: 'tool-confirmation-required' as const,
                turns: 1,
                pendingDecisionKey: 'call-run-command',
                pendingConfirmation: {
                    id: 'call-run-command',
                    runId: 'agent-tool-loop-test',
                    stepId: 'call-run-command',
                    toolName: 'run_command',
                    question: '允许 Agent 执行 pnpm test 吗？',
                    summary: '运行最小验证命令。',
                    riskLevel: 'medium',
                    impact: '会在当前工作区执行测试命令。',
                    reversible: false,
                    createdAt: timestamp,
                    options: [
                        { id: 'allow-once', label: '允许一次', tone: 'primary' },
                        { id: 'deny', label: '拒绝' },
                        { id: 'stop', label: '停止', tone: 'danger' },
                    ],
                },
                toolResults: [
                    {
                        id: 'call-run-command',
                        runId: 'agent-tool-loop-test',
                        stepId: 'call-run-command',
                        toolName: 'run_command',
                        status: 'failed' as const,
                        requiresUserConfirmation: true,
                        summary: '等待用户确认。',
                        startedAt: timestamp,
                        endedAt: timestamp,
                    },
                ],
            })
            .mockResolvedValueOnce({
                content: '验证已完成。',
                model: MOCK_MODEL,
                stopReason: 'completed' as const,
                turns: 2,
                pendingDecisionKey: null,
                pendingConfirmation: null,
                toolResults: [
                    {
                        id: 'call-run-command',
                        runId: 'agent-tool-loop-test',
                        stepId: 'call-run-command',
                        toolName: 'run_command',
                        status: 'succeeded' as const,
                        requiresUserConfirmation: false,
                        summary: '测试命令执行完成。',
                        startedAt: timestamp,
                        endedAt: timestamp,
                    },
                ],
            });

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '运行一次最小验证';

        await assistant.sendMessage();

        expect(agentStore.pendingToolConfirmation?.id).toBe('call-run-command');
        expect(assistant.messages.value[1]?.content).toContain('Agent 正在等待确认');

        await assistant.resolveProviderToolLoopConfirmation('allow-once');

        expect(aiServiceMock.toolLoopChat).toHaveBeenCalledTimes(2);
        expect(aiServiceMock.toolLoopChat.mock.calls[1]?.[0]?.toolDecisions).toMatchObject({
            'call-run-command': 'allow-once',
            run_command: 'allow-once',
        });
        expect(agentStore.pendingToolConfirmation).toBeNull();
        expect(assistant.messages.value[1]?.content).toContain('验证已完成');
    });

    it('applies patch by normalizing the returned path and syncing the current document', async () => {
        const { assistant, document } = createAssistantHarnessContext();
        document.value.path = 'D:/test/xiaojianc.sh';
        document.value.name = 'xiaojianc.sh';
        document.value.content = 'echo old';
        document.value.savedContent = 'echo old';
        document.value.lineCount = 1;
        document.value.charCount = 8;

        assistant.proposedPatch.value = {
            summary: '修正脚本输出',
            files: [
                {
                    path: 'D:/test/xiaojianc.sh',
                    originalHash: 'fnv64:test',
                    hunks: [
                        {
                            oldStart: 1,
                            oldLines: 1,
                            newStart: 1,
                            newLines: 1,
                            lines: ['-echo old', '+echo new'],
                        },
                    ],
                },
            ],
        };

        aiServiceMock.applyPatch.mockResolvedValueOnce({
            appliedFiles: [
                {
                    path: String.raw`\\?\D:\test\xiaojianc.sh`,
                    byteSize: 8,
                },
            ],
        });

        await assistant.applyProposedPatch();

        expect(document.value.path).toBe('D:/test/xiaojianc.sh');
        expect(document.value.content).toBe('echo new');
        expect(document.value.savedContent).toBe('echo new');
        expect(document.value.isDirty).toBe(false);
        expect(document.value.lineCount).toBe(1);
        expect(document.value.charCount).toBe(8);
        expect(assistant.messages.value.at(-1)?.content).toBe('Patch 已应用：D:/test/xiaojianc.sh');
        expect(assistant.proposedPatch.value).toBeNull();
    });

    it('passes Agent run and step metadata when tool-loop applies a patch', async () => {
        const { assistant, document } = createAssistantHarnessContext();
        const agentStore = useAiAgentStore();

        document.value.path = 'D:/test/xiaojianc.sh';
        document.value.name = 'xiaojianc.sh';
        document.value.content = 'echo old';
        document.value.savedContent = 'echo old';

        agentStore.upsertRun({
            id: 'run-1',
            goal: '更新当前脚本',
            status: 'running-step',
            currentStepId: 'step-1',
            createdAt: '2026-04-29T10:00:00.000Z',
            updatedAt: '2026-04-29T10:00:00.000Z',
            startedAt: '2026-04-29T10:00:00.000Z',
            completedAt: null,
            errorMessage: null,
            steps: [
                {
                    id: 'step-1',
                    index: 0,
                    title: '应用 patch',
                    goal: '应用 patch',
                    kind: 'edit',
                    status: 'running',
                    expectedOutput: '当前文件已更新',
                    tools: ['propose_patch'],
                    requiresUserApproval: true,
                    riskLevel: 'medium',
                },
                {
                    id: 'step-2',
                    index: 1,
                    title: '验证修改',
                    goal: '验证修改',
                    kind: 'verify',
                    status: 'pending',
                    expectedOutput: '验证结果',
                    tools: ['get_diagnostics'],
                    requiresUserApproval: false,
                    riskLevel: 'low',
                },
            ],
        });

        aiServiceMock.queueStreamResponse(JSON.stringify({
            type: 'tool_call',
            name: 'propose_patch',
            summary: '应用当前脚本 patch',
            arguments: {
                updatedContent: 'echo new',
                summary: '更新输出',
            },
        }));
        aiServiceMock.queueStreamResponse(JSON.stringify({
            type: 'final',
            content: '已完成。',
        }));
        aiServiceMock.proposePatch.mockResolvedValueOnce({
            patch: {
                summary: '更新输出',
                files: [
                    {
                        path: 'D:/test/xiaojianc.sh',
                        originalHash: 'fnv64:test',
                        hunks: [
                            {
                                oldStart: 1,
                                oldLines: 1,
                                newStart: 1,
                                newLines: 1,
                                lines: ['-echo old', '+echo new'],
                            },
                        ],
                    },
                ],
            },
        });
        aiServiceMock.applyPatch.mockResolvedValueOnce({
            appliedFiles: [
                {
                    path: 'D:/test/xiaojianc.sh',
                    byteSize: 8,
                },
            ],
        });

        await assistant.executeAgentRequest([], '更新当前脚本', []);

        expect(aiServiceMock.applyPatch).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                agentRunId: 'run-1',
                agentStepId: 'step-1',
                confirmedByUser: true,
            }),
        }));
        expect(agentStore.getPatchSummaries('run-1')).toHaveLength(0);
    });
});
