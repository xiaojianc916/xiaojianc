/**
 * useCopilotAgentBridge — CopilotKit chat bridge. Gracefully degrades
 * to no-op when CopilotKitProvider is not in the component tree.
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

const noopFn = (): void => {};
const noopAsync = async (): Promise<void> => {};

const createNoop = (): IUseCopilotAgentBridgeResult => ({
  messages: shallowRef([]),
  isRunning: ref(false),
  errorMessage: ref(''),
  sendMessage: noopAsync,
  stop: noopFn,
  clearMessages: noopFn,
});

export const useCopilotAgentBridge = (): IUseCopilotAgentBridgeResult => {
  let agent: ReturnType<typeof useAgent>['agent'];

  try {
    ({ agent } = useAgent({ agentId: 'default' }));
  } catch {
    return createNoop();
  }

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
      agent.value.addMessage({ id: createEventId('user-msg'), role: 'user', content } as Message);
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
