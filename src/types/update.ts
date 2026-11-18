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
  /** true 时渲染层应弹出安装确认弹窗（自动安装策略检测到用户在场） */
  pendingConfirmation: boolean;
  /** 弹窗决策截止时间戳（ms），超时未决策由主进程自动顺延；无挂起决策时为 null */
  confirmDeadlineAt: number | null;
}

export interface AppUpdateDescriptor {
  version: string;
  feedUrl: string;
}

export interface AppUpdateBridgeApi {
  getState(): Promise<AppUpdateState>;
  checkForUpdate(): Promise<AppUpdateState>;
  installUpdate(): Promise<AppUpdateState>;
  /** 弹窗「立刻安装」：清除确认挂起态并执行下载安装 */
  confirmInstall(): Promise<AppUpdateState>;
  /** 弹窗「晚点安装」：本轮放弃，等待下一轮周期检查重新决策 */
  deferInstall(): Promise<AppUpdateState>;
  /** 渲染层用户输入活跃心跳（更新安装时机的前台判定依据），单向通知无返回 */
  notifyUserInput(): void;
  onUpdateState(listener: (state: AppUpdateState) => void): () => void;
}
