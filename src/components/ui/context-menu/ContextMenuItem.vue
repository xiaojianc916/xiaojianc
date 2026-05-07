<script setup lang="ts">
import { cn } from '@/lib/utils';
import { reactiveOmit } from '@vueuse/core';
import type { ContextMenuItemProps } from 'reka-ui';
import { ContextMenuItem, useForwardProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(defineProps<ContextMenuItemProps & {
    class?: HTMLAttributes['class'];
    inset?: boolean;
    variant?: 'default' | 'destructive';
}>(), {
    class: undefined,
    variant: 'default',
});

const delegatedProps = reactiveOmit(props, 'inset', 'variant', 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
    <ContextMenuItem
data-slot="context-menu-item" :data-inset="inset ? '' : undefined" :data-variant="variant"
        v-bind="forwardedProps"
        :class="cn('focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'text-\'])]:text-muted-foreground [&_svg:not([class*=\'size-\'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive!', props.class)">
        <slot />
    </ContextMenuItem>
</template>