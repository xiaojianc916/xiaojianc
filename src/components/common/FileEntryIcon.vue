<template>
  <component
    :is="iconComponent"
    theme="outline"
    fill="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    :stroke-width="3"
    :style="iconStyle"
  />
</template>

<script setup lang="ts">
import { isImageAssetPath } from '@/utils/file-assets';
import {
    DocDetail,
    FileCode,
    FileText,
    FolderClose,
    FolderOpen,
    Page,
    Picture,
} from '@icon-park/vue-next';
import type { CSSProperties, Component } from 'vue';
import { computed } from 'vue';

type TEntryKind = 'file' | 'directory';
type TIconTone =
  | 'folder'
  | 'image'
  | 'vue'
  | 'typescript'
  | 'javascript'
  | 'rust'
  | 'style'
  | 'markup'
  | 'config'
  | 'shell'
  | 'document'
  | 'default';

const props = withDefaults(
  defineProps<{
    kind: TEntryKind;
    path?: string | null;
    expanded?: boolean;
  }>(),
  {
    path: null,
    expanded: false,
  },
);

const TYPESCRIPT_EXTENSIONS = new Set(['ts', 'tsx', 'mts', 'cts']);
const JAVASCRIPT_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs']);
const RUST_EXTENSIONS = new Set(['rs']);
const STYLE_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less', 'styl', 'pcss']);
const MARKUP_EXTENSIONS = new Set(['html', 'htm', 'xml']);
const CONFIG_EXTENSIONS = new Set([
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'config',
  'lock',
]);
const SHELL_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'fish', 'ps1', 'cmd', 'bat']);
const DOCUMENT_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rtf']);
const CONFIG_FILENAMES = new Set([
  '.editorconfig',
  '.env',
  '.eslintrc',
  '.gitattributes',
  '.gitignore',
  '.prettierrc',
  'dockerfile',
  'makefile',
]);

const getFileName = (path: string | null | undefined): string => {
  if (!path) {
    return '';
  }

  const normalizedPath = path.replace(/\\/g, '/');
  const segments = normalizedPath.split('/');
  return (segments[segments.length - 1] ?? '').toLowerCase();
};

const getFileExtension = (path: string | null | undefined): string => {
  const fileName = getFileName(path);
  if (!fileName) {
    return '';
  }

  const extension = fileName.split('.').pop();
  return extension && extension !== fileName ? extension.toLowerCase() : '';
};

const resolveIconTone = (path: string | null | undefined): TIconTone => {
  if (isImageAssetPath(path)) {
    return 'image';
  }

  const fileName = getFileName(path);
  const extension = getFileExtension(path);

  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return 'config';
  }

  if (fileName.endsWith('rc') || CONFIG_FILENAMES.has(fileName)) {
    return 'config';
  }

  if (extension === 'vue') {
    return 'vue';
  }

  if (TYPESCRIPT_EXTENSIONS.has(extension)) {
    return 'typescript';
  }

  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    return 'javascript';
  }

  if (RUST_EXTENSIONS.has(extension)) {
    return 'rust';
  }

  if (STYLE_EXTENSIONS.has(extension)) {
    return 'style';
  }

  if (MARKUP_EXTENSIONS.has(extension)) {
    return 'markup';
  }

  if (CONFIG_EXTENSIONS.has(extension)) {
    return 'config';
  }

  if (SHELL_EXTENSIONS.has(extension)) {
    return 'shell';
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return 'document';
  }

  return 'default';
};

const iconTone = computed<TIconTone>(() => {
  if (props.kind === 'directory') {
    return 'folder';
  }

  return resolveIconTone(props.path);
});

const iconComponent = computed<Component>(() => {
  if (props.kind === 'directory') {
    return props.expanded ? FolderOpen : FolderClose;
  }

  switch (iconTone.value) {
    case 'image':
      return Picture;
    case 'config':
      return DocDetail;
    case 'document':
      return FileText;
    case 'markup':
      return Page;
    case 'default':
      return Page;
    default:
      return FileCode;
  }
});

const iconColor = computed((): string => {
  if (props.kind === 'directory') {
    return props.expanded ? '#f2b84b' : '#d89a2d';
  }

  switch (iconTone.value) {
    case 'vue':
      return '#42b883';
    case 'typescript':
      return '#3178c6';
    case 'javascript':
      return '#f0c23c';
    case 'rust':
      return '#f97316';
    case 'style':
      return '#38bdf8';
    case 'markup':
      return '#fb7185';
    case 'config':
      return '#a855f7';
    case 'shell':
      return '#22c55e';
    case 'image':
      return '#ec4899';
    case 'document':
      return '#94a3b8';
    default:
      return '#7c8aa5';
  }
});

const iconStyle = computed<CSSProperties>(() => ({
  color: iconColor.value,
}));
</script>