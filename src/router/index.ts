// @status: active
import { getThemeManager } from '@/themes';
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: { name: 'home' },
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/ShellWorkbenchView.vue'),
    meta: {
      layout: 'workbench',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'home' },
  },
];

const applyDocumentTheme = (mode: 'dark' | 'light'): void => {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
};

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  const theme = to.meta.theme as 'dark' | 'light' | undefined;
  if (theme) {
    applyDocumentTheme(theme);
    return true;
  }

  applyDocumentTheme(getThemeManager().getMode());
  return true;
});

router.afterEach((to) => {
  applyDocumentTheme(getThemeManager().getMode());
});

export default router;
