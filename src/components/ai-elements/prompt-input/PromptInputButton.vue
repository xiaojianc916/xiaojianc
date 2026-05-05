<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { InputGroupButtonVariants } from '@/components/ui/input-group';
import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { Comment, computed, Text, toRef, useSlots } from 'vue';

type TPromptInputButtonVariant = 'default' | 'outline' | 'ghost';

interface Props {
  class?: HTMLAttributes['class'];
  variant?: TPromptInputButtonVariant;
  size?: InputGroupButtonVariants['size'];
}

const props = withDefaults(defineProps<Props>(), {
  class: undefined,
  size: undefined,
  variant: 'ghost',
});

const slots = useSlots();

const computedSize = computed(() => {
  if (props.size) return props.size;

  const slotNodes = slots.default?.();

  if (!slotNodes) return 'icon-sm';

  const validChildren = slotNodes.filter((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text && !node.children?.toString().trim()) return false;
    return true;
  });

  return validChildren.length > 1 ? 'sm' : 'icon-sm';
});

const variant = toRef(props, 'variant');
</script>

<template>
  <InputGroupButton
    type="button"
    :size="computedSize"
    :class="cn($props.class)"
    :variant="variant"
    v-bind="$attrs"
  >
    <slot />
  </InputGroupButton>
</template>
