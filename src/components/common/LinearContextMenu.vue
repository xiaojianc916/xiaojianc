<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="linear-context-menu-root"
      :class="{
        'is-light': props.theme === 'light',
        'is-submenu-left': props.submenuDirection === 'left',
      }"
      @contextmenu.prevent
    >
      <div class="cmx linear-context-menu" :style="rootStyle">
        <template v-for="(group, groupIndex) in props.groups" :key="group.key">
          <div class="cmx-hd">{{ group.title }}</div>

          <template v-for="item in group.items" :key="item.key">
            <div
              v-if="item.children?.length"
              class="cmx-sub"
              @mouseenter="handleItemMouseEnter(item)"
            >
              <button
                type="button"
                class="cmx-i"
                :class="{ disabled: item.disabled, active: activeSubmenuKey === item.key }"
                :disabled="item.disabled"
                @click.stop="handleItemSelect(item)"
              >
                <span class="ic">
                  <LinearContextMenuIcon :icon="item.icon" />
                </span>
                <span class="lb">{{ item.label }}</span>
                <span class="arr" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </span>
              </button>

              <div v-if="activeSubmenuKey === item.key" class="cmx-fly">
                <div class="cmx">
                  <button
                    v-for="child in item.children"
                    :key="child.key"
                    type="button"
                    class="cmx-i"
                    :class="{ disabled: child.disabled }"
                    :disabled="child.disabled"
                    @click.stop="handleItemSelect(child)"
                  >
                    <span class="ic">
                      <LinearContextMenuIcon :icon="child.icon" />
                    </span>
                    <span class="lb">{{ child.label }}</span>
                    <span v-if="child.shortcut?.length" class="kh" aria-hidden="true">
                      <kbd v-for="key in child.shortcut" :key="`${child.key}-${key}`">{{ key }}</kbd>
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <button
              v-else
              type="button"
              class="cmx-i"
              :class="{ disabled: item.disabled }"
              :disabled="item.disabled"
              @mouseenter="handleItemMouseEnter(item)"
              @click.stop="handleItemSelect(item)"
            >
              <span class="ic">
                <LinearContextMenuIcon :icon="item.icon" />
              </span>
              <span class="lb">{{ item.label }}</span>
              <span v-if="item.shortcut?.length" class="kh" aria-hidden="true">
                <kbd v-for="key in item.shortcut" :key="`${item.key}-${key}`">{{ key }}</kbd>
              </span>
            </button>
          </template>

          <div v-if="groupIndex < props.groups.length - 1" class="cmx-sep" />
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type {
  ILinearContextMenuGroup,
  ILinearContextMenuItem,
} from '@/components/common/linear-context-menu.types';
import LinearContextMenuIcon from '@/components/common/LinearContextMenuIcon.vue';
import type { TThemeMode } from '@/types/app';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  groups: ILinearContextMenuGroup[];
  theme: TThemeMode;
  submenuDirection: 'left' | 'right';
}>();

const emit = defineEmits<{
  select: [item: ILinearContextMenuItem];
}>();

const activeSubmenuKey = ref<string | null>(null);

const rootStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
}));

const handleItemMouseEnter = (item: ILinearContextMenuItem): void => {
  activeSubmenuKey.value = item.children?.length && !item.disabled ? item.key : null;
};

const handleItemSelect = (item: ILinearContextMenuItem): void => {
  if (item.disabled) {
    return;
  }

  if (item.children?.length) {
    activeSubmenuKey.value = item.key;
    return;
  }

  emit('select', item);
};

watch(
  () => props.open,
  (open) => {
    if (!open) {
      activeSubmenuKey.value = null;
    }
  },
);
</script>

<style scoped>
.linear-context-menu-root {
  --bg: #08090a;
  --bg-1: #0f1011;
  --bg-2: #1a1b1e;
  --bg-3: #232428;
  --bg-h: rgba(255, 255, 255, 0.045);
  --bg-sel: rgba(94, 106, 210, 0.16);
  --fg: #f7f8f8;
  --fg-1: #d0d6e0;
  --fg-2: #8a8f98;
  --fg-3: #62666d;
  --fg-4: #3e4248;
  --bd: rgba(255, 255, 255, 0.06);
  --bd-st: rgba(255, 255, 255, 0.1);
  --ac: #5e6ad2;
  --ac-fg: #eef0ff;
  --ff:
    -apple-system, 'Inter Variable', 'Inter', 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  --fm: ui-monospace, 'Berkeley Mono', 'SF Mono', 'JetBrains Mono', Menlo, monospace;
  --r: 8px;
  --rs: 6px;
  --sh:
    0 10px 38px -10px rgba(0, 0, 0, 0.7),
    0 10px 20px -15px rgba(0, 0, 0, 0.5),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  position: fixed;
  inset: 0;
  z-index: 1600;
  pointer-events: none;
  font: 400 13px/1.5 var(--ff);
  letter-spacing: -0.003em;
  -webkit-font-smoothing: antialiased;
}

.linear-context-menu-root.is-light {
  --bg-2: #ffffff;
  --bg-3: #eef2f8;
  --bg-h: rgba(15, 23, 42, 0.045);
  --bg-sel: rgba(76, 111, 255, 0.14);
  --fg: #111827;
  --fg-1: #334155;
  --fg-2: #64748b;
  --fg-3: #94a3b8;
  --fg-4: #cbd5e1;
  --bd: rgba(15, 23, 42, 0.08);
  --bd-st: rgba(15, 23, 42, 0.12);
  --ac: #4c6fff;
  --ac-fg: #0f172a;
  --sh:
    0 14px 40px -16px rgba(15, 23, 42, 0.18),
    0 10px 18px -14px rgba(15, 23, 42, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.92);
}

.cmx {
  min-width: 224px;
  border: 1px solid var(--bd-st);
  border-radius: var(--r);
  background: var(--bg-2);
  padding: 4px;
  box-shadow: var(--sh);
  user-select: none;
  color: var(--fg-1);
  position: relative;
  pointer-events: auto;
}

.linear-context-menu {
  position: fixed;
}

.cmx-hd {
  padding: 8px 10px 4px;
  color: var(--fg-3);
  font: 500 10.5px/1.3 var(--ff);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.cmx-i {
  display: flex;
  min-height: 28px;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: var(--rs);
  background: transparent;
  padding: 6px 10px;
  color: var(--fg-1);
  text-align: left;
  cursor: default;
  transition:
    background 80ms ease,
    color 80ms ease;
}

.cmx-i:hover,
.cmx-i:focus-visible,
.cmx-i.active {
  background: var(--bg-h);
  color: var(--fg);
  outline: none;
}

.cmx-i.disabled {
  color: var(--fg-4);
  pointer-events: none;
}

.ic {
  width: 16px;
  height: 16px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-2);
}

.cmx-i:hover .ic,
.cmx-i:focus-visible .ic,
.cmx-i.active .ic {
  color: currentColor;
}

.ic :deep(svg) {
  width: 14px;
  height: 14px;
}

.lb {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kh {
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
  flex: none;
}

.kh kbd {
  min-width: 17px;
  border: none;
  border-radius: 3.5px;
  background: rgba(255, 255, 255, 0.06);
  padding: 2.5px 5px;
  color: var(--fg-2);
  font: 500 10.5px/1 var(--fm);
  letter-spacing: 0;
  text-align: center;
  box-shadow: none;
}

.linear-context-menu-root.is-light .kh kbd {
  background: rgba(15, 23, 42, 0.05);
}

.cmx-i:hover .kh kbd,
.cmx-i:focus-visible .kh kbd {
  background: rgba(255, 255, 255, 0.09);
  color: var(--fg-1);
}

.linear-context-menu-root.is-light .cmx-i:hover .kh kbd,
.linear-context-menu-root.is-light .cmx-i:focus-visible .kh kbd {
  background: rgba(15, 23, 42, 0.08);
}

.arr {
  margin-left: auto;
  width: 12px;
  height: 12px;
  display: inline-flex;
  color: var(--fg-3);
}

.arr svg {
  width: 12px;
  height: 12px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cmx-i:hover .arr,
.cmx-i.active .arr {
  color: currentColor;
}

.cmx-sep {
  height: 1px;
  margin: 4px -4px;
  background: var(--bd);
}

.cmx-sub {
  position: relative;
}

.cmx-fly {
  position: absolute;
  top: -4px;
  left: calc(100% + 2px);
  z-index: 1;
}

.linear-context-menu-root.is-submenu-left .cmx-fly {
  left: auto;
  right: calc(100% + 2px);
}

@media (prefers-reduced-motion: reduce) {
  .cmx-i {
    transition: none;
  }
}
</style>
