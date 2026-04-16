<template>
  <div class="app-surface h-screen">
    <div class="app-window-shell linear-shell flex h-full flex-col overflow-hidden">
      <WindowTitleBar />

      <div class="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)_340px] overflow-hidden">
        <div class="border-r border-white/[0.06]">
          <slot name="sidebar" />
        </div>
        <div class="flex min-h-0 flex-col">
          <slot name="header" />
          <main class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_320px]">
            <section class="min-h-0">
              <slot />
            </section>
            <section class="border-t border-white/[0.06]">
              <slot name="terminal" />
            </section>
          </main>
        </div>
        <div class="border-l border-white/[0.06]">
          <slot name="inspector" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import WindowTitleBar from '@/components/common/WindowTitleBar.vue';
</script>
