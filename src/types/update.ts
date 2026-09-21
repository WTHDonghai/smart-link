export type AppUpdateStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

export interface AppUpdateState {
  canUpdate: boolean;
  status: AppUpdateStatus;
  currentVersion: string;
  targetVersion: string;
  progressPercent: number | null;
  message: string;
}

export interface AppUpdateDescriptor {
  version: string;
  feedUrl: string;
}

export interface AppUpdateBridgeApi {
  getState(): Promise<AppUpdateState>;
  checkForUpdate(): Promise<AppUpdateState>;
  installUpdate(): Promise<AppUpdateState>;
  onUpdateState(listener: (state: AppUpdateState) => void): () => void;
}
