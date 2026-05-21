import {
    LOCAL_SHELL_COMMAND_CATALOG,
    mergeCommandCatalogs,
} from '@/constants/shell/command-catalog';
import type { IShellCommandNodeSpec } from '@/types/shell-completion';

interface IShellCommandCatalogIndexEntry {
    label: string;
    file: string;
    aliases?: string[];
    detail?: string;
}

interface IShellCommandCatalogIndexFile {
    commands: IShellCommandCatalogIndexEntry[];
}

interface IShellCommandCatalogIndexState {
    entries: IShellCommandCatalogIndexEntry[];
    lookup: Map<string, IShellCommandCatalogIndexEntry>;
}

const shellCatalogModules = import.meta.glob('@/generated/shell-catalog/*.json', {
    import: 'default',
});
const shellCatalogIndexModules = import.meta.glob('@/generated/shell-catalog/index.json', {
    import: 'default',
});

const generatedSpecCache = new Map<string, Promise<IShellCommandNodeSpec | null>>();
const mergedSpecCache = new Map<string, Promise<IShellCommandNodeSpec | null>>();

const getPrimaryName = (entry: Pick<IShellCommandNodeSpec, 'names'>): string => entry.names[0] ?? '';

const toLookupKey = (value: string): string => value.trim().toLowerCase();

const localRootEntriesByAnyName = new Map<string, IShellCommandNodeSpec>();
for (const entry of LOCAL_SHELL_COMMAND_CATALOG) {
    for (const name of entry.names) {
        const normalizedName = toLookupKey(name);
        if (!normalizedName || localRootEntriesByAnyName.has(normalizedName)) {
            continue;
        }

        localRootEntriesByAnyName.set(normalizedName, entry);
    }
}

let indexStatePromise: Promise<IShellCommandCatalogIndexState> | null = null;
let labelListPromise: Promise<string[]> | null = null;

const resolveShellCatalogModule = (fileName: string) =>
    Object.entries(shellCatalogModules).find(
        ([modulePath]) => modulePath.endsWith(`/${fileName}`) && !modulePath.endsWith('/index.json'),
    )?.[1] ?? null;

const loadShellCatalogIndexState = async (): Promise<IShellCommandCatalogIndexState> => {
    if (!indexStatePromise) {
        indexStatePromise = (async () => {
            const indexLoader =
                Object.entries(shellCatalogIndexModules).find(([modulePath]) =>
                    modulePath.endsWith('/index.json'))?.[1] ?? null;

            const indexFile = indexLoader
                ? ((await indexLoader()) as IShellCommandCatalogIndexFile)
                : { commands: [] };
            const entries = Array.isArray(indexFile.commands) ? indexFile.commands : [];
            const lookup = new Map<string, IShellCommandCatalogIndexEntry>();

            for (const entry of entries) {
                const primaryKey = toLookupKey(entry.label);
                if (primaryKey) {
                    lookup.set(primaryKey, entry);
                }

                for (const alias of entry.aliases ?? []) {
                    const aliasKey = toLookupKey(alias);
                    if (aliasKey && !lookup.has(aliasKey)) {
                        lookup.set(aliasKey, entry);
                    }
                }
            }

            return {
                entries,
                lookup,
            };
        })();
    }

    return indexStatePromise;
};

const loadGeneratedShellCommandSpec = async (
    entry: IShellCommandCatalogIndexEntry,
): Promise<IShellCommandNodeSpec | null> => {
    const cacheKey = toLookupKey(entry.label);
    const cachedSpec = generatedSpecCache.get(cacheKey);
    if (cachedSpec) {
        return cachedSpec;
    }

    const specPromise = (async () => {
        const moduleLoader = resolveShellCatalogModule(entry.file);
        if (!moduleLoader) {
            return null;
        }

        return (await moduleLoader()) as IShellCommandNodeSpec;
    })();

    generatedSpecCache.set(cacheKey, specPromise);
    return specPromise;
};

const mergeRootSpecs = (
    generatedSpec: IShellCommandNodeSpec | null,
    localSpec: IShellCommandNodeSpec | null,
): IShellCommandNodeSpec | null => {
    const mergedSpecs = mergeCommandCatalogs(
        generatedSpec ? [generatedSpec] : [],
        localSpec ? [localSpec] : [],
    );

    return mergedSpecs[0] ?? null;
};

export const listShellCommandLabels = async (): Promise<string[]> => {
    if (!labelListPromise) {
        labelListPromise = (async () => {
            const { entries } = await loadShellCatalogIndexState();
            const labels: string[] = [];
            const seenLabels = new Set<string>();

            for (const entry of entries) {
                const normalizedLabel = toLookupKey(entry.label);
                if (!normalizedLabel || seenLabels.has(normalizedLabel)) {
                    continue;
                }

                seenLabels.add(normalizedLabel);
                labels.push(entry.label);
            }

            for (const entry of LOCAL_SHELL_COMMAND_CATALOG) {
                const primaryName = getPrimaryName(entry);
                const normalizedLabel = toLookupKey(primaryName);
                if (!normalizedLabel || seenLabels.has(normalizedLabel)) {
                    continue;
                }

                seenLabels.add(normalizedLabel);
                labels.push(primaryName);
            }

            return labels;
        })();
    }

    return labelListPromise;
};

export const loadShellCommandSpec = async (
    name: string,
): Promise<IShellCommandNodeSpec | null> => {
    const lookupKey = toLookupKey(name);
    if (!lookupKey) {
        return null;
    }

    const cachedSpec = mergedSpecCache.get(lookupKey);
    if (cachedSpec) {
        return cachedSpec;
    }

    const specPromise = (async () => {
        const { lookup } = await loadShellCatalogIndexState();
        const generatedEntry = lookup.get(lookupKey) ?? null;
        const generatedSpec = generatedEntry
            ? await loadGeneratedShellCommandSpec(generatedEntry)
            : null;
        const localSpec =
            localRootEntriesByAnyName.get(lookupKey) ??
            (generatedEntry ? localRootEntriesByAnyName.get(toLookupKey(generatedEntry.label)) ?? null : null);

        return mergeRootSpecs(generatedSpec, localSpec);
    })();

    mergedSpecCache.set(lookupKey, specPromise);
    return specPromise;
};

export const loadAllShellCommandSpecs = async (): Promise<IShellCommandNodeSpec[]> => {
    const labels = await listShellCommandLabels();
    const loadedSpecs = await Promise.all(labels.map((label) => loadShellCommandSpec(label)));

    return loadedSpecs.filter((entry): entry is IShellCommandNodeSpec => Boolean(entry));
};