<template>
  <CopilotKitProvider :self-managed-agents="agents" :show-dev-console="false">
    <slot />
  </CopilotKitProvider>
</template>

<script setup lang="ts">
import { CopilotKitProvider } from '@copilotkit/vue';
import { onBeforeUnmount, shallowRef } from 'vue';
import { SidecarAgent } from '@/copilotkit/sidecar-agent';

// Build agents synchronously during setup — the v2 provider registers them
// immediately, so child components can use useAgent/useCopilotKit right away.
const agents = shallowRef<Record<string, SidecarAgent>>({
  default: new SidecarAgent({ agentId: 'default', description: 'Mastra-powered coding agent' }),
});

onBeforeUnmount(() => {
  for (const agent of Object.values(agents.value)) {
    try {
      agent.abortRun();
    } catch {
      /* ignore */
    }
  }
});
</script>
