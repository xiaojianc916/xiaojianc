<script setup lang="ts">
import type { DropdownMenuRootProps } from 'reka-ui';
import { DropdownMenuRoot } from '@/components/ui/dropdown-menu';

const props = defineProps<DropdownMenuRootProps>();
</script>

<template>
  <DropdownMenuRoot v-bind="props">
    <slot />
  </DropdownMenuRoot>
</template>
