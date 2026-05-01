<script setup lang="ts">
import { AI_PROVIDER_ICON_DEFINITIONS } from '@/constants/ai-provider-icons';
import type { TAiServicePlatformId } from '@/constants/ai-providers';
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  platformId: TAiServicePlatformId;
  title?: string;
  decorative?: boolean;
}>(), {
  title: '',
  decorative: false,
});

const iconDefinition = computed(() => AI_PROVIDER_ICON_DEFINITIONS[props.platformId]);
const titleText = computed(() => props.title.trim() || iconDefinition.value.label);
</script>

<template>
  <svg
    class="ai-provider-icon"
    :viewBox="iconDefinition.viewBox"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : titleText"
    :aria-hidden="decorative ? 'true' : undefined"
    :style="{ color: iconDefinition.color }"
  >
    <path
      v-for="path in iconDefinition.paths"
      :key="path.d"
      :d="path.d"
      :fill="path.fill ?? 'currentColor'"
    />
  </svg>
</template>

<style scoped>
.ai-provider-icon {
  display: block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
}
</style>
