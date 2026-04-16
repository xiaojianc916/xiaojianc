<template>
  <span
    class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium"
    :class="toneClass"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      :class="dotClass"
    />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}>();

const toneClass = computed(() => {
  switch (props.tone) {
    case 'success':
      return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
    case 'warning':
      return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
    case 'danger':
      return 'border-rose-400/20 bg-rose-400/10 text-rose-200';
    default:
      return 'border-white/10 bg-white/5 text-[var(--text-secondary)]';
  }
});

const dotClass = computed(() => {
  switch (props.tone) {
    case 'success':
      return 'bg-emerald-400';
    case 'warning':
      return 'bg-amber-400';
    case 'danger':
      return 'bg-rose-400';
    default:
      return 'bg-[var(--text-tertiary)]';
  }
});
</script>
