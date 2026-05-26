<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { Collapsible } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface Props {
  defaultOpen?: boolean;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: true,
  class: '',
});
</script>

<template>
  <Collapsible :default-open="props.defaultOpen" :class="cn('w-full', props.class)" as-child>
    <div>
      <slot />
    </div>
  </Collapsible>
</template>
