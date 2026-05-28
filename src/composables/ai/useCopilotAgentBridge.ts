/**
 * useCopilotAgentBridge — full CopilotKit chat bridge using useAgent.
 * Provides sendMessage / stop with reactive messages, ready to eventually
 * replace useAiAssistant for the core send-receive cycle.
 */
import type { Message } from '@ag-ui/core';
import { useAgent } from '@copilotkit/vue';
import { computed, type Ref, readonly, ref, shallowRef } from 'vue';
import { createEventId } from '@/copilotkit/event-adapter';

export interface IUseCopilotAgentBridgeResult {
  messages: Ref<readonly Message[]>;
  isRunning: Ref<boolean>;
  errorMessage: Ref<string>;
  sendMessage: (content: string) => Promise<void>;
  stop: () => void;
  clearMessages: () => void;
}

export const useCopilotAgentBridge = (): IUseCopilotAgentBridgeResult => {
  const { agent } = useAgent({ agentId: 'default' });

  const messages = shallowRef<readonly Message[]>([]);
  const errorMessage = ref('');
  const isRunning = computed(() => agent.value?.isRunning ?? false);

  const sync = (): void => {
    if (agent.value) messages.value = agent.value.messages;
  };

  const sendMessage = async (content: string): Promise<void> => {
    if (!agent.value || isRunning.value) return;
    errorMessage.value = '';

    try {
      agent.value.addMessage({
        id: createEventId('user-msg'),
        role: 'user',
        content,
      } as Message);
      sync();

      await agent.value.runAgent();
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Agent run failed';
    } finally {
      sync();
    }
  };

  const stop = (): void => {
    agent.value?.abortRun();
    sync();
  };

  const clearMessages = (): void => {
    agent.value?.setMessages([]);
    messages.value = [];
  };

  return {
    messages,
    isRunning,
    errorMessage: readonly(errorMessage),
    sendMessage,
    stop,
    clearMessages,
  };
};
