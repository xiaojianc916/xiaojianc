import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useAiAssistant } from '@/composables/useAiAssistant';
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

    return {
        onChatStream,
        chat,
        chatStream,
        cancel,
        queryIndex,
        proposePatch,
        applyPatch,
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
            cancel.mockClear();
            queryIndex.mockClear();
            proposePatch.mockClear();
            applyPatch.mockClear();
        },
    };
});

vi.mock('@/services/modules/ai', () => ({
    aiService: {
        onChatStream: aiServiceMock.onChatStream,
        chat: aiServiceMock.chat,
        chatStream: aiServiceMock.chatStream,
        cancel: aiServiceMock.cancel,
        queryIndex: aiServiceMock.queryIndex,
        proposePatch: aiServiceMock.proposePatch,
        applyPatch: aiServiceMock.applyPatch,
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

    it('automatically invokes tools in agent mode without waiting for confirmation', async () => {
        const { assistant } = createAssistantHarnessContext({
            analysis: {
                available: true,
                message: null,
                dialect: 'shell',
                diagnostics: [
                    {
                        line: 3,
                        endLine: 3,
                        column: 1,
                        endColumn: 8,
                        level: 'error',
                        code: 'SC2086',
                        message: 'Double quote to prevent globbing and word splitting.',
                    },
                ],
            },
        });

        aiServiceMock.queueStreamResponse(
            '{"type":"tool_call","name":"get_diagnostics","summary":"读取当前诊断","arguments":{}}',
        );
        aiServiceMock.queueStreamResponse(
            '{"type":"final","content":"已根据当前诊断给出修复建议。"}',
        );

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '在当前文件里整理数据库备份示例';

        await assistant.sendMessage();

        expect(assistant.messages.value).toHaveLength(2);
        expect(assistant.messages.value[0]?.role).toBe('user');
        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(2);
        expect(aiServiceMock.chatStream.mock.calls[0]?.[0]?.messages[0]).toEqual(
            expect.objectContaining({
                role: 'system',
            }),
        );
        expect(aiServiceMock.chatStream.mock.calls[1]?.[0]?.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: 'system',
                    content: expect.stringContaining('工具 get_diagnostics 已执行。'),
                }),
            ]),
        );
        expect(assistant.messages.value[1]?.content).toBe('已根据当前诊断给出修复建议。');
        expect(assistant.messages.value[1]?.toolCalls).toEqual([
            {
                id: 'agent-tool-1',
                name: 'get_diagnostics',
                status: 'succeeded',
                summary: '读取当前诊断',
            },
        ]);
        expect(assistant.agentSteps.value).toEqual([
            {
                id: 'agent-tool-1',
                title: '读取当前诊断',
                status: 'completed',
            },
        ]);
    });

    it('silently applies patch in agent mode and keeps the change rollbackable via AED timeline', async () => {
        const { assistant, document } = createAssistantHarnessContext();
        document.value.path = 'D:/test/xiaojianc.sh';
        document.value.name = 'xiaojianc.sh';
        document.value.content = 'echo old';
        document.value.savedContent = 'echo old';
        document.value.lineCount = 1;
        document.value.charCount = 8;

        aiServiceMock.queueStreamResponse(
            JSON.stringify({
                type: 'tool_call',
                name: 'propose_patch',
                summary: '静默写入当前文件',
                arguments: {
                    updatedContent: 'echo new',
                    summary: '修正脚本输出',
                },
            }),
        );
        aiServiceMock.queueStreamResponse(
            JSON.stringify({
                type: 'final',
                content: '脚本已经直接写入，可在 AED 时间线中回滚。',
            }),
        );
        aiServiceMock.proposePatch.mockResolvedValueOnce({
            patch: {
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
            },
        });
        aiServiceMock.applyPatch.mockResolvedValueOnce({
            appliedFiles: [
                {
                    path: String.raw`\\?\D:\test\xiaojianc.sh`,
                    byteSize: 8,
                },
            ],
        });

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '把当前脚本的输出改成 echo new';

        await assistant.sendMessage();

        expect(aiServiceMock.applyPatch).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.applyPatch).toHaveBeenCalledWith(expect.objectContaining({
            patch: expect.objectContaining({
                summary: '修正脚本输出',
            }),
            metadata: expect.objectContaining({
                reason: '修正脚本输出',
                confirmedByUser: true,
            }),
        }));
        expect(document.value.content).toBe('echo new');
        expect(document.value.savedContent).toBe('echo new');
        expect(document.value.isDirty).toBe(false);
        expect(assistant.messages.value[1]?.content).toBe('脚本已经直接写入，可在 AED 时间线中回滚。');
        expect(assistant.messages.value[1]?.toolCalls).toEqual([
            {
                id: 'agent-tool-1',
                name: 'propose_patch',
                status: 'succeeded',
                summary: '静默写入当前文件',
            },
        ]);
        expect(assistant.agentSteps.value).toEqual([
            {
                id: 'agent-tool-1',
                title: '静默写入当前文件',
                status: 'completed',
            },
        ]);
        expect(assistant.proposedPatch.value).toBeNull();
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
            summary: '应用 AI 代码块',
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
});