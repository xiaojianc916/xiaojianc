<script setup lang="ts">
import type { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type ButtonProps = InstanceType<typeof Button>['$props'];

interface Props {
  tooltip?: string;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

const props = withDefaults(defineProps<Props>(), {
  tooltip: undefined,
  label: undefined,
  variant: 'ghost',
  size: 'icon-sm',
});

const buttonProps = {
  variant: props.variant,
  size: props.size,
  type: 'button' as const,
};
</script>

<template>
  <TooltipProvider v-if="props.tooltip">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button v-bind="{ ...buttonProps, ...$attrs }">
          <slot />
          <span class="sr-only"> {{ props.label || props.tooltip }}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{{ props.tooltip }}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>

  <Button v-else v-bind="{ ...buttonProps, ...$attrs }">
    <slot />
    <span class="sr-only">{{ props.label || props.tooltip }}</span>
  </Button>
</template>
