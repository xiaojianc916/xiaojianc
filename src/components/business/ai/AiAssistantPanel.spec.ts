import AiAssistantPanel from '@/components/business/ai/AiAssistantPanel.vue';
import type {
    IAiChatMessage,
    IAiConfigPayload,
    IAiContextReference,
    IAiPatchSet,
    IAiTaskPlanStep,
    IAiToolConfirmationRequest,
} from '@/types/ai';
import { createPinia, setActivePinia } from 'pinia';
import type {
    IActiveRunSummary,
    IAnalyzeScriptPayload,
    IEditorDocument,
    IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

const useAiAssistantMock = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useAiAssistant', () => ({
    useAiAssistant: useAiAssistantMock,
}));

interface IAiConversationThreadMock {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: IAiChatMessage[];
}

const createAssistantMock = (
    messagesList: IAiChatMessage[],
    historyThreadsList: IAiConversationThreadMock[] = messagesList.length
        ? [{
            id: 'thread-active',
            title: '当前对话',
            createdAt: messagesList[0]?.createdAt ?? '2026-04-28T10:00:00.000Z',
            updatedAt: messagesList.at(-1)?.createdAt ?? '2026-04-28T10:00:00.000Z',
            messages: messagesList,
        }]
        : [],
) => {
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

    const messages = ref<IAiChatMessage[]>(messagesList);
    const historyThreads = ref<IAiConversationThreadMock[]>(historyThreadsList);
    const activeConversationId = ref<string | null>(historyThreadsList.at(-1)?.id ?? null);
    const activeMode = ref<'chat' | 'agent'>('chat');
    const isSettingsOpen = ref(false);
    const isClearDialogOpen = ref(false);
    const isSending = ref(false);
    const draft = ref('');
    const errorMessage = ref('');
    const currentReferences = ref<IAiContextReference[]>([]);
    const agentSteps = ref<IAiTaskPlanStep[]>([]);
    const attachedFiles = ref([] as Array<{ id: string; name: string; sizeLabel: string; kind: 'text' | 'image' }>);
    const proposedPatch = ref<IAiPatchSet | null>(null);
    const isApplyingPatch = ref(false);
    const agentPlanStore = {
        mode: 'chat' as const,
        activeGoal: '',
        steps: [] as IAiTaskPlanStep[],
        classification: null,
        classificationReason: '',
        shouldEnterPlanMode: false,
        isPlanning: false,
        isApproving: false,
        approvedAt: null,
        errorMessage: '',
        hasPlan: false,
        activeRun: null,
        pendingToolConfirmation: null as IAiToolConfirmationRequest | null,
        activeToolActivity: null,
    };

    return {
        config,
        messages,
        historyThreads,
        activeConversationId,
        activeMode,
        isSettingsOpen,
        isClearDialogOpen,
        isSending,
        draft,
        errorMessage,
        currentReferences,
        agentSteps,
        attachedFiles,
        proposedPatch,
        isApplyingPatch,
        agentPlan: {
            store: agentPlanStore,
            classifyTask: vi.fn(),
            createPlan: vi.fn(),
            regeneratePlan: vi.fn(),
            updateStep: vi.fn(),
            removeStep: vi.fn(),
            approvePlan: vi.fn(),
            resetPlan: vi.fn(),
        },
        canPreviewPatch: computed(() => false),
        sendButtonLabel: computed(() => '发送'),
        loadConfig: vi.fn().mockResolvedValue(undefined),
        loadTools: vi.fn().mockResolvedValue(undefined),
        saveConfig: vi.fn().mockResolvedValue(undefined),
        saveCredentials: vi.fn().mockResolvedValue(undefined),
        testProviderConfig: vi.fn().mockResolvedValue('ok'),
        connectProvider: vi.fn().mockResolvedValue('ok'),
        testProvider: vi.fn().mockResolvedValue('ok'),
        previewPatchFromCodeBlock: vi.fn(),
        previewPatchFromLastAnswer: vi.fn(),
        applyProposedPatch: vi.fn(),
        sendMessage: vi.fn(),
        handleMessageAction: vi.fn(),
        stopCurrentRequest: vi.fn(),
        startNewConversation: vi.fn(),
        switchConversation: vi.fn(),
        attachFile: vi.fn(),
        removeAttachedFile: vi.fn(),
        clearConversation: vi.fn(),
    };
};

const createMessage = (index: number): IAiChatMessage => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `第 ${index} 条对话内容\n这是完整内容 ${index}`,
    createdAt: new Date(Date.UTC(2026, 3, 28, 10, index % 60, 0)).toISOString(),
    references: [],
});

const createThread = (index: number): IAiConversationThreadMock => {
    const message = createMessage(index);
    return {
        id: `thread-${index}`,
        title: `第 ${index} 组对话`,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        messages: [message],
    };
};

const createDocument = (): IEditorDocument => ({
    id: 'doc-1',
    path: 'src/app.ts',
    name: 'app.ts',
    kind: 'text',
    content: 'const ready = true;',
    encoding: 'utf-8',
    savedContent: 'const ready = true;',
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

describe('AiAssistantPanel', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('shows plan panel in agent mode when a plan exists', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.activeMode.value = 'agent';
        assistantMock.agentPlan.store.hasPlan = true;
        assistantMock.agentPlan.store.activeGoal = '补齐计划模式 UI 接线';
        assistantMock.agentPlan.store.steps = [
            {
                id: 'plan-step-1',
                index: 0,
                title: '收集上下文',
                goal: '收集上下文',
                kind: 'inspect',
                status: 'pending',
                expectedOutput: '影响范围',
                tools: ['search_text'],
                requiresUserApproval: false,
                riskLevel: 'low',
            },
            {
                id: 'plan-step-2',
                index: 1,
                title: '输出计划',
                goal: '输出计划',
                kind: 'summarize',
                status: 'pending',
                expectedOutput: '可执行计划',
                tools: ['get_diagnostics'],
                requiresUserApproval: true,
                riskLevel: 'medium',
            },
        ];
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        expect(wrapper.find('[data-testid="plan-mode-panel"]').exists()).toBe(true);
    });

    it('shows inline confirmation in agent mode even without an active plan', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.activeMode.value = 'agent';
        assistantMock.agentPlan.store.pendingToolConfirmation = {
            id: 'call-run-command',
            runId: 'agent-tool-loop-test',
            stepId: 'call-run-command',
            toolName: 'run_command',
            question: '允许 Agent 执行 pnpm test 吗？',
            summary: '运行最小验证命令。',
            riskLevel: 'medium',
            impact: '会在当前工作区执行测试命令。',
            reversible: false,
            createdAt: '2026-04-29T00:00:00.000Z',
            options: [
                { id: 'allow-once', label: '允许一次', tone: 'primary' },
                { id: 'deny', label: '拒绝' },
                { id: 'stop', label: '停止', tone: 'danger' },
            ],
        };
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        expect(wrapper.find('[data-testid="plan-mode-panel"]').exists()).toBe(true);
    });

    it('renders a scrollable history view with the latest 20 conversations', async () => {
        const historyThreads = Array.from({ length: 25 }, (_value, index) => createThread(index + 1));
        useAiAssistantMock.mockReturnValue(
            createAssistantMock(historyThreads.at(-1)?.messages ?? [], historyThreads),
        );

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiTaskPlan: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        await wrapper.get('[aria-label="对话记录"]').trigger('click');

        expect(wrapper.findAll('.ai-history-item')).toHaveLength(20);
        expect(wrapper.text()).toContain('最近 20 组');
        expect(wrapper.text()).toContain('第 25 组对话');
        expect(wrapper.text()).not.toContain('第 5 组对话');
        expect(wrapper.find('.ai-history-list').exists()).toBe(true);
    });

    it('starts a new conversation from the header action', async () => {
        const assistantMock = createAssistantMock([]);
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        await wrapper.get('[aria-label="新建对话"]').trigger('click');

        expect(assistantMock.startNewConversation).toHaveBeenCalledTimes(1);
    });

    it('switches to a selected history conversation', async () => {
        const historyThreads = [createThread(1), createThread(2)];
        const assistantMock = createAssistantMock(historyThreads[1]?.messages ?? [], historyThreads);
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        await wrapper.get('[aria-label="对话记录"]').trigger('click');
        await wrapper.findAll('.ai-history-button')[1]?.trigger('click');

        expect(assistantMock.switchConversation).toHaveBeenCalledWith('thread-1');
    });
});
