<script setup lang="ts">
import type { SelectRootProps } from 'reka-ui';
import { Select } from '@/components/ui/select';

const props = defineProps<SelectRootProps>();
</script>

<template>
  <Select v-bind="props">
    <slot />
  </Select>
</template>
