export type TThemeMode = 'dark' | 'light';

export const THEME_MODES = ['dark', 'light'] as const satisfies ReadonlyArray<TThemeMode>;

export type TWorkbenchSidebarView =
    | 'explorer'
    | 'search'
    | 'source-control'
    | 'run'
    | 'extensions';

export const WORKBENCH_SIDEBAR_VIEWS = [
    'explorer',
    'search',
    'source-control',
    'run',
    'extensions',
] as const satisfies ReadonlyArray<TWorkbenchSidebarView>;