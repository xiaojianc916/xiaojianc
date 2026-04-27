<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { tauriService } from '@/services/tauri';
import type { IAiChatMessagePayload } from '@/types/tauri';
import type { IActiveRunSummary, IEditorDocument } from '@/types/editor';
import { toErrorMessage } from '@/utils/error';

type TAiMessageRole = 'assistant' | 'user' | 'system';
type TAiQuickActionId = 'explain' | 'fix' | 'review';

interface IAiChatMessage {
  id: string;
  role: TAiMessageRole;
  content: string;
}

interface IAiQuickAction {
  id: TAiQuickActionId;
  label: string;
}

const props = defineProps<{
  document: IEditorDocument;
  activeRun: IActiveRunSummary | null;
}>();

const AI_QUICK_ACTIONS: IAiQuickAction[] = [
  { id: 'explain', label: '解释当前脚本' },
  { id: 'fix', label: '修复报错' },
  { id: 'review', label: '代码审查' },
];
const MAX_CONTEXT_CHARS = 12_000;
const MAX_HISTORY_MESSAGES = 16;

const initialMessages: IAiChatMessage[] = [
  {
    id: 'assistant-ready',
    role: 'assistant',
    content: '已接入 OpenAI-Compatible 聊天接口。配置 API 地址、模型和 Key 后，可以直接发送问题。',
  },
];

const messages = ref<IAiChatMessage[]>(initialMessages);
const draft = ref('');
const providerName = ref('OpenAI Compatible');
const modelName = ref('gpt-4.1-mini');
const apiEndpoint = ref('');
const apiKey = ref('');
const systemPrompt = ref('你是一个谨慎的中文编程助手。回答必须基于用户提供的真实代码和上下文；不确定时明确说明，不编造接口、路径或结果。');
const isSettingsOpen = ref(false);
const isClearDialogOpen = ref(false);
const isSending = ref(false);
const errorMessage = ref('');
const draftInputRef = ref<HTMLTextAreaElement | null>(null);

const hasProviderConfig = computed(() =>
  Boolean(apiEndpoint.value.trim() && apiKey.value.trim() && modelName.value.trim()),
);
const providerLabel = computed(() =>
  hasProviderConfig.value ? `${providerName.value} · ${modelName.value}` : '未配置模型服务',
);
const sendButtonLabel = computed(() => {
  if (isSending.value) {
    return '发送中…';
  }
  return hasProviderConfig.value ? '发送' : '配置后发送';
});

const createMessageId = (role: TAiMessageRole): string => `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const clipText = (value: string, limit: number): string => {
  const chars = [...value];
  if (chars.length <= limit) {
    return value;
  }
  return `${chars.slice(0, limit).join('')}\n\n[内容已截断，仅发送前 ${limit} 个字符]`;
};

const buildDocumentContext = (): string => {
  if (!props.document.id || props.document.kind !== 'text') {
    return '当前没有可用的文本脚本文档。';
  }

  return [
    `文件名：${props.document.name}`,
    `路径：${props.document.path ?? '未保存'}`,
    `状态：${props.document.isDirty ? '有未保存修改' : '已保存'}`,
    '脚本内容：',
    '```sh',
    clipText(props.document.content, MAX_CONTEXT_CHARS),
    '```',
  ].join('\n');
};

const buildRunContext = (): string => {
  if (!props.activeRun) {
    return '当前没有正在运行或最近触发的运行记录。';
  }

  return [
    `运行文件：${props.activeRun.documentName}`,
    `命令：${props.activeRun.commandLine}`,
    `执行器：${props.activeRun.executorLabel}`,
    `开始时间：${props.activeRun.startedAt}`,
    `临时文件：${props.activeRun.usedTempFile ? '是' : '否'}`,
  ].join('\n');
};

const buildQuickPrompt = (actionId: TAiQuickActionId): string => {
  const documentContext = buildDocumentContext();
  const runContext = buildRunContext();

  if (actionId === 'explain') {
    return `请解释当前脚本的执行流程、关键变量、外部依赖和潜在风险。\n\n${documentContext}`;
  }

  if (actionId === 'fix') {
    return `请根据当前脚本和运行上下文定位问题根因，并给出最小修改方案。不要编造不存在的日志；如果上下文不足，请列出还需要哪些信息。\n\n${documentContext}\n\n运行上下文：\n${runContext}`;
  }

  return `请按安全、类型/参数可靠性、可维护性、边界条件和可验证性审查当前脚本。请只给出基于代码能确认的问题。\n\n${documentContext}`;
};

const focusDraft = async (): Promise<void> => {
  await nextTick();
  draftInputRef.value?.focus();
};

const applyQuickAction = async (action: IAiQuickAction): Promise<void> => {
  draft.value = buildQuickPrompt(action.id);
  errorMessage.value = '';
  await focusDraft();
};

const openSettings = (): void => {
  isSettingsOpen.value = true;
};

const closeSettings = (): void => {
  isSettingsOpen.value = false;
};

const openClearDialog = (): void => {
  isClearDialogOpen.value = true;
};

const closeClearDialog = (): void => {
  isClearDialogOpen.value = false;
};

const clearConversation = (): void => {
  messages.value = initialMessages;
  errorMessage.value = '';
  closeClearDialog();
};

const toAiPayloadMessages = (items: IAiChatMessage[]): IAiChatMessagePayload[] =>
  items
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

const sendMessage = async (): Promise<void> => {
  const content = draft.value.trim();
  if (!content || isSending.value) {
    return;
  }

  if (!hasProviderConfig.value) {
    errorMessage.value = '请先配置 API 地址、模型和 API Key。';
    openSettings();
    return;
  }

  const userMessage: IAiChatMessage = {
    id: createMessageId('user'),
    role: 'user',
    content,
  };
  const nextMessages = [...messages.value, userMessage];
  messages.value = nextMessages;
  draft.value = '';
  errorMessage.value = '';
  isSending.value = true;

  try {
    const response = await tauriService.sendAiChat({
      endpoint: apiEndpoint.value.trim(),
      apiKey: apiKey.value.trim(),
      model: modelName.value.trim(),
      systemPrompt: systemPrompt.value,
      messages: toAiPayloadMessages(nextMessages),
    });

    messages.value = [
      ...nextMessages,
      {
        id: createMessageId('assistant'),
        role: 'assistant',
        content: response.content,
      },
    ];
  } catch (error) {
    errorMessage.value = toErrorMessage(error, 'AI 请求失败');
    draft.value = content;
  } finally {
    isSending.value = false;
    await focusDraft();
  }
};
</script>

<template>
  <section class="ai-sidebar-panel" aria-label="AI 助手面板">
    <header class="ai-panel-header">
      <div>
        <h2>AI 助手</h2>
        <p>{{ providerLabel }}</p>
      </div>
      <button type="button" class="ai-icon-button" aria-label="AI 设置" @click="openSettings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3" />
          <path d="M12 19v3" />
          <path d="M4.22 4.22l2.12 2.12" />
          <path d="M17.66 17.66l2.12 2.12" />
          <path d="M2 12h3" />
          <path d="M19 12h3" />
          <path d="M4.22 19.78l2.12-2.12" />
          <path d="M17.66 6.34l2.12-2.12" />
        </svg>
      </button>
    </header>

    <div class="ai-quick-actions" aria-label="AI 快捷任务">
      <button
        v-for="action in AI_QUICK_ACTIONS"
        :key="action.id"
        type="button"
        class="ai-quick-action"
        @click="applyQuickAction(action)"
      >
        {{ action.label }}
      </button>
    </div>

    <div class="ai-chat-list" aria-label="AI 对话记录">
      <article
        v-for="message in messages"
        :key="message.id"
        class="ai-message"
        :class="`is-${message.role}`"
      >
        <div class="ai-message-role">
          {{ message.role === 'user' ? '你' : message.role === 'assistant' ? '助手' : '系统' }}
        </div>
        <p>{{ message.content }}</p>
      </article>
    </div>

    <footer class="ai-composer">
      <p v-if="errorMessage" class="ai-error">{{ errorMessage }}</p>
      <textarea
        ref="draftInputRef"
        v-model="draft"
        placeholder="输入问题，或选择上方快捷任务…"
        rows="4"
        :disabled="isSending"
        @keydown.meta.enter.prevent="sendMessage"
        @keydown.ctrl.enter.prevent="sendMessage"
      />
      <div class="ai-composer-actions">
        <button type="button" class="ai-button is-ghost" :disabled="isSending" @click="openClearDialog">清空</button>
        <button type="button" class="ai-button is-primary" :disabled="!draft.trim() || isSending" @click="sendMessage">
          {{ sendButtonLabel }}
        </button>
      </div>
    </footer>

    <Teleport to="body">
      <div v-if="isSettingsOpen" class="ai-dialog-backdrop" @click.self="closeSettings">
        <form class="ai-dialog" @submit.prevent="closeSettings">
          <div class="ai-dialog-copy">
            <h3>AI 服务配置</h3>
            <p>使用 OpenAI-Compatible /v1/chat/completions 接口。API Key 仅保存在当前界面状态中，不写入文件。</p>
          </div>
          <label class="ai-field">
            <span>服务类型</span>
            <input v-model="providerName" autocomplete="off" />
          </label>
          <label class="ai-field">
            <span>API 地址</span>
            <input v-model="apiEndpoint" placeholder="https://api.example.com/v1" autocomplete="off" />
          </label>
          <label class="ai-field">
            <span>模型</span>
            <input v-model="modelName" autocomplete="off" />
          </label>
          <label class="ai-field">
            <span>API Key</span>
            <input v-model="apiKey" type="password" autocomplete="off" />
          </label>
          <label class="ai-field">
            <span>系统提示词</span>
            <textarea v-model="systemPrompt" rows="3" />
          </label>
          <div class="ai-dialog-actions">
            <button type="button" class="ai-button is-ghost" @click="closeSettings">取消</button>
            <button type="submit" class="ai-button is-primary">保存</button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="isClearDialogOpen" class="ai-dialog-backdrop" @click.self="closeClearDialog">
        <section class="ai-dialog is-compact" role="alertdialog" aria-modal="true">
          <div class="ai-dialog-copy">
            <h3>清空当前对话？</h3>
            <p>这只会清空面板里的临时对话记录，不会删除任何文件。</p>
          </div>
          <div class="ai-dialog-actions">
            <button type="button" class="ai-button is-ghost" @click="closeClearDialog">取消</button>
            <button type="button" class="ai-button is-danger" @click="clearConversation">清空</button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.ai-sidebar-panel {
  display: flex;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background: var(--sidebar-bg);
  color: var(--text-primary);
}

.ai-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--shell-divider);
}

.ai-panel-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.ai-panel-header p {
  margin: 3px 0 0;
  color: var(--text-quaternary);
  font-size: 11px;
}

.ai-icon-button {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition:
    background-color 80ms linear,
    color 80ms linear;
}

.ai-icon-button:hover {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-icon-button svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.8;
}

.ai-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--shell-divider);
}

.ai-quick-action,
.ai-button {
  height: 28px;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 80ms linear,
    color 80ms linear,
    border-color 80ms linear;
}

.ai-quick-action {
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  background: color-mix(in srgb, var(--surface-soft) 80%, transparent);
  color: var(--text-secondary);
}

.ai-quick-action:hover {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-chat-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 10px 12px;
}

.ai-message {
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 66%, transparent);
  padding: 8px 10px;
}

.ai-message.is-user {
  border-color: color-mix(in srgb, var(--accent-strong) 26%, var(--shell-divider));
  background: color-mix(in srgb, var(--accent-strong) 12%, transparent);
}

.ai-message.is-system {
  border-style: dashed;
}

.ai-message-role {
  color: var(--text-quaternary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.ai-message p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.ai-composer {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--shell-divider);
}

.ai-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
}

.ai-composer textarea,
.ai-field input,
.ai-field textarea {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface-soft) 80%, transparent);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.ai-composer textarea {
  min-height: 82px;
  resize: none;
  padding: 8px 9px;
}

.ai-composer textarea:focus,
.ai-field input:focus,
.ai-field textarea:focus {
  border-color: color-mix(in srgb, var(--accent-strong) 70%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-strong) 22%, transparent);
}

.ai-composer-actions,
.ai-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.ai-button.is-ghost {
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  background: transparent;
  color: var(--text-tertiary);
}

.ai-button.is-ghost:hover:not(:disabled) {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-button.is-primary {
  border: 0;
  background: var(--accent-strong);
  color: #fff;
}

.ai-button.is-danger {
  border: 0;
  background: var(--danger);
  color: #fff;
}

.ai-button:disabled,
.ai-composer textarea:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.ai-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.28);
}

.ai-dialog {
  display: grid;
  width: min(380px, calc(100vw - 32px));
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 100%, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-bg) 96%, var(--sidebar-bg));
  box-shadow:
    0 14px 36px rgba(0, 0, 0, 0.46),
    inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent);
  padding: 16px;
}

.ai-dialog.is-compact {
  width: min(340px, calc(100vw - 32px));
}

.ai-dialog-copy h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.ai-dialog-copy p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.55;
}

.ai-field {
  display: grid;
  gap: 6px;
}

.ai-field span {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
}

.ai-field input {
  height: 30px;
  padding: 0 9px;
}

.ai-field textarea {
  resize: vertical;
  padding: 8px 9px;
}
</style>
