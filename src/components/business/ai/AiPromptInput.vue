<script setup lang="ts">
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInput,
} from '@/components/ai-elements/prompt-input';
import { Brain, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-vue-next';
import { computed, defineComponent, watch } from 'vue';

type TAiPromptInputMode = 'chat' | 'agent' | 'plan';

interface IAiPromptModeOption {
  key: TAiPromptInputMode;
  label: string;
}

const modelValue = defineModel<string>({ required: true });

const props = defineProps<{
  disabled: boolean;
  errorMessage: string;
  submitLabel: string;
  activeMode: TAiPromptInputMode;
  providerLabel: string;
  attachments: readonly {
    id: string;
    name: string;
    sizeLabel: string;
    kind: 'text' | 'image';
    detailLabel?: string;
  }[];
  hasAttachments: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  stop: [];
  fileSelected: [file: File];
  removeFile: [id: string];
  selectMode: [mode: TAiPromptInputMode];
}>();

const isBrowserFile = (value: unknown): value is File =>
  typeof File !== 'undefined' && value instanceof File;

const PromptInputModelBridge = defineComponent({
  name: 'PromptInputModelBridge',
  props: {
    modelValue: {
      type: String,
      required: true,
    },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
    fileSelected: (file: File) => isBrowserFile(file),
  },
  setup(bridgeProps, { emit: bridgeEmit }) {
    const { textInput, setTextInput, files, clearFiles } = usePromptInput();

    watch(
      () => bridgeProps.modelValue,
      (value) => {
        if (textInput.value !== value) {
          setTextInput(value);
        }
      },
      { immediate: true },
    );

    watch(textInput, (value) => {
      if (value !== bridgeProps.modelValue) {
        bridgeEmit('update:modelValue', value);
      }
    });

    watch(
      files,
      (items) => {
        if (items.length === 0) {
          return;
        }

        for (const item of items) {
          if (isBrowserFile(item.file)) {
            bridgeEmit('fileSelected', item.file);
          }
        }

        clearFiles();
      },
      { flush: 'sync' },
    );

    return () => null;
  },
});

const modeLabel = computed(() => {
  switch (props.activeMode) {
    case 'chat':
      return 'Chat';
    case 'plan':
      return 'Plan';
    default:
      return 'Agent';
  }
});

const modeOptions = computed<IAiPromptModeOption[]>(() => [
  {
    key: 'chat',
    label: 'Chat',
  },
  {
    key: 'agent',
    label: 'Agent',
  },
  {
    key: 'plan',
    label: 'Plan',
  },
]);

const isPlanModeActive = computed(() => props.activeMode === 'plan');
const chainOfThoughtTitle = computed(() =>
  isPlanModeActive.value ? '当前为 Plan 模式' : '切换到 Plan 模式',
);
const canSubmit = computed(() => modelValue.value.trim().length > 0 || props.hasAttachments);

const handlePromptSubmit = (message: PromptInputMessage): void => {
  if (props.disabled || (!message.text.trim() && !props.hasAttachments)) {
    return;
  }

  if (modelValue.value !== message.text) {
    modelValue.value = message.text;
  }

  emit('submit');
};

const handleModeSelect = (value: unknown): void => {
  if (value === 'chat' || value === 'agent' || value === 'plan') {
    emit('selectMode', value);
  }
};

const handlePlanShortcutClick = (): void => {
  emit('selectMode', 'plan');
};
</script>

<template>
  <footer class="ai-composer">
    <p v-if="errorMessage" class="ai-error">{{ errorMessage }}</p>
    <PromptInput
      class="ai-composer-surface"
      :class="{ 'is-disabled': disabled, 'has-attachments': attachments.length > 0 }"
      :initial-input="modelValue"
      multiple
      @submit="handlePromptSubmit"
    >
      <PromptInputModelBridge
        :model-value="modelValue"
        @update:model-value="modelValue = $event"
        @file-selected="emit('fileSelected', $event)"
      />

      <PromptInputBody>
        <div v-if="attachments.length" class="ai-attachment-strip" aria-label="已添加附件">
          <span v-for="attachment in attachments" :key="attachment.id" class="ai-attachment-chip">
            <ImageIcon v-if="attachment.kind === 'image'" aria-hidden="true" />
            <FileText v-else aria-hidden="true" />
            <span class="ai-attachment-name">{{ attachment.name }}</span>
            <span
              v-if="attachment.kind !== 'image' && attachment.detailLabel"
              class="ai-attachment-detail"
            >
              {{ attachment.detailLabel }}
            </span>
            <button
              type="button"
              aria-label="移除附件"
              title="移除附件"
              @click="emit('removeFile', attachment.id)"
            >
              <X aria-hidden="true" />
            </button>
          </span>
        </div>

        <PromptInputTextarea
          class="ai-prompt-textarea"
          placeholder="输入消息…"
          aria-label="输入消息"
          :disabled="disabled"
        />
      </PromptInputBody>

      <PromptInputFooter class="ai-toolbar-row">
        <PromptInputTools class="ai-toolbar-group ai-toolbar-tools">
          <PromptInputActionMenu v-if="!disabled">
            <PromptInputActionMenuTrigger
              class="ai-tool-button ai-tool-button-attachment"
              title="添加附件"
            >
              <Paperclip class="ai-tool-button-icon" aria-hidden="true" />
              <span class="ai-tool-button-label">Attachments</span>
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent align="start">
              <PromptInputActionAddAttachments label="添加附件" />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <PromptInputButton
            v-else
            class="ai-tool-button ai-tool-button-attachment disabled"
            disabled
            title="添加附件"
          >
            <Paperclip class="ai-tool-button-icon" aria-hidden="true" />
            <span class="ai-tool-button-label">Attachments</span>
          </PromptInputButton>

          <PromptInputButton
            class="ai-tool-button ai-tool-button-thought"
            :class="{ 'is-active': isPlanModeActive }"
            :aria-label="chainOfThoughtTitle"
            :aria-pressed="isPlanModeActive"
            :disabled="disabled"
            :title="chainOfThoughtTitle"
            @click="handlePlanShortcutClick"
          >
            <Brain class="ai-tool-button-icon" aria-hidden="true" />
            <span class="ai-tool-button-label">Chain of Thought</span>
          </PromptInputButton>
        </PromptInputTools>

        <div class="ai-toolbar-group is-end">
          <PromptInputSelect :model-value="activeMode" @update:model-value="handleModeSelect">
            <PromptInputSelectTrigger
              class="ai-mode-button"
              :title="providerLabel"
              aria-label="选择 AI 模式"
            >
              <PromptInputSelectValue class="ai-mode-button-copy">
                <span class="ai-mode-button-mode">{{ modeLabel }}</span>
              </PromptInputSelectValue>
            </PromptInputSelectTrigger>
            <PromptInputSelectContent align="end">
              <PromptInputSelectItem
                v-for="option in modeOptions"
                :key="option.key"
                :value="option.key"
              >
                {{ option.label }}
              </PromptInputSelectItem>
            </PromptInputSelectContent>
          </PromptInputSelect>

          <PromptInputSubmit
            v-if="disabled"
            class="ai-send-button is-stop"
            status="streaming"
            aria-label="停止"
            title="停止"
            @click.stop.prevent="emit('stop')"
          />
          <PromptInputSubmit
            v-else
            class="ai-send-button"
            :aria-label="submitLabel"
            :title="submitLabel"
            :disabled="!canSubmit"
          />
        </div>
      </PromptInputFooter>
    </PromptInput>
  </footer>
</template>

<style scoped>
.ai-composer {
  flex: 0 0 auto;
  display: grid;
  align-self: stretch;
  gap: 6px;
  min-width: 0;
  width: auto;
  max-width: none;
  box-sizing: border-box;
  margin-inline: 16px;
  padding: 0 10px 10px;
}

.ai-error {
  margin: 0 4px;
  color: var(--danger);
  font-size: 12px;
  line-height: 18px;
}

.ai-composer-surface {
  display: block;
  min-width: 0;
}

.ai-composer-surface :deep([data-slot='input-group']) {
  display: flex;
  min-width: 0;
  height: auto;
  min-height: 0;
  align-items: stretch;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-bg) 94%, var(--surface-soft));
  box-shadow: none;
  padding: 0 10px 8px;
  transition: background-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-composer-surface.has-attachments :deep([data-slot='input-group']) {
  padding-top: 8px;
}

.ai-composer-surface.is-disabled :deep([data-slot='input-group']) {
  opacity: 0.94;
}

.ai-attachment-strip {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-attachment-chip {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  height: 24px;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 22px;
  padding: 0 5px 0 7px;
}

.ai-attachment-chip > svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  stroke-width: 1.75;
}

.ai-attachment-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-attachment-detail {
  flex: 0 0 auto;
  color: var(--text-quaternary);
}

.ai-attachment-chip button {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 5px;
  color: var(--text-quaternary);
}

.ai-attachment-chip button:hover {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-attachment-chip button svg {
  width: 12px;
  height: 12px;
  stroke-width: 1.75;
}

.ai-prompt-textarea {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  min-height: 44px;
  max-height: 44px;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.01em;
  outline: 0;
  overflow-y: auto;
  padding: 6px 0 0;
  resize: none;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--shell-divider) 72%, transparent) transparent;
  box-shadow: none;
}

.ai-prompt-textarea::placeholder {
  color: var(--text-quaternary);
}

.ai-prompt-textarea::-webkit-scrollbar {
  width: 8px;
}

.ai-prompt-textarea::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
  background-color: color-mix(in srgb, var(--shell-divider) 72%, transparent);
}

.ai-toolbar-row {
  display: flex;
  min-width: 0;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0;
}

.ai-toolbar-group {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.ai-toolbar-tools {
  flex-wrap: wrap;
  gap: 8px;
}

.ai-toolbar-group.is-end {
  margin-left: auto;
}

.ai-tool-button {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--text-secondary);
  padding: 0 10px;
  transition:
    border-color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    background-color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-button:hover {
  color: var(--text-primary);
}

.ai-tool-button:active {
  transform: scale(0.98);
}

.ai-tool-button.disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.ai-tool-button-attachment {
  border-color: transparent;
  background: transparent;
  padding-inline: 2px 4px;
}

.ai-tool-button-thought {
  border-color: color-mix(in srgb, var(--shell-divider) 86%, transparent);
  background: color-mix(in srgb, var(--surface-soft) 92%, var(--panel-bg));
}

.ai-tool-button-thought.is-active {
  border-color: color-mix(in srgb, var(--accent-strong) 28%, var(--shell-divider));
  background: color-mix(in srgb, var(--accent-strong) 10%, var(--surface-soft));
  color: var(--text-primary);
}

.ai-tool-button-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.ai-tool-button-label {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-mode-button {
  display: inline-flex;
  min-width: 0;
  max-width: none;
  height: auto;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  padding: 0 2px;
  transition:
    color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-mode-button:hover {
  background: transparent;
  color: var(--text-primary);
}

.ai-mode-button:active {
  transform: scale(0.985);
}

.ai-mode-button-copy {
  display: grid;
  min-width: 0;
  flex: 1;
  text-align: left;
}

.ai-mode-button-mode {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 14px;
  text-transform: uppercase;
}

.ai-send-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  flex: 0 0 auto;
  background: transparent;
  color: var(--text-quaternary);
  padding: 0 2px;
  transition:
    color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-send-button:hover:not(:disabled) {
  background: transparent;
  color: var(--text-primary);
}

.ai-send-button:active:not(:disabled) {
  transform: scale(0.97);
}

.ai-send-button.is-stop {
  color: var(--text-primary);
}

.ai-send-button:disabled {
  cursor: default;
  color: var(--text-quaternary);
}

.ai-send-button svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.8;
}
</style>
