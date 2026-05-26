export type TSshContentTab = 'explorer' | 'transfer';

export type TSshPanelTab = TSshContentTab | 'connect';

export type TSshAuthMode = 'key' | 'password';

export type TSshFileKind = 'folder' | 'rust' | 'toml' | 'markdown' | 'lock' | 'file';

export type TSshTransferDirection = 'upload' | 'download';

export type TSshTransferStatus = 'uploading' | 'downloading' | 'done' | 'failed';

export type TSshFooterAction = TSshTransferDirection | 'new-folder';

export interface ISshPathSegment {
  id: string;
  label: string;
  path: string;
}

export interface ISshFileItem {
  id: string;
  name: string;
  kind: TSshFileKind;
  metaLabel: string;
  path: string;
  isDirectory: boolean;
}

export interface ISshTransferItem {
  id: string;
  name: string;
  direction: TSshTransferDirection;
  sizeLabel: string;
  progressLabel: string;
  progress: number;
  status: TSshTransferStatus;
}

export interface ISshRecentConnection {
  id: string;
  name: string;
  username: string;
  host: string;
  port: string;
  authMode: TSshAuthMode;
  identityPath: string;
  lastUsedLabel: string;
  lastUsedAt: string | null;
}

export interface ISshConnectionForm {
  host: string;
  port: string;
  username: string;
  authMode: TSshAuthMode;
  identityPath: string;
  password: string;
}

export interface ISshAuthOption {
  value: TSshAuthMode;
  label: string;
}
