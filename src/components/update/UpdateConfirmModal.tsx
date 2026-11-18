import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useAppSelector } from '../../store';
import { useAppUpdate } from '../../hooks/useAppUpdate';

/** 距确认截止的剩余秒数倒计时刷新间隔 */
const COUNTDOWN_TICK_MS = 1000;

function formatRemainSeconds(remainMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 系统更新安装确认弹窗：自动安装策略检测到用户正在前台操作时，
 * 由主进程推送 pendingConfirmation 状态触发弹窗，交由用户决策安装时机。
 * 超时未决策由主进程自动按「晚点安装」顺延，弹窗随状态刷新自动关闭。
 */
export const UpdateConfirmModal: React.FC = () => {
  const update = useAppSelector((state) => state.app.update);
  const { confirmInstall, deferInstall } = useAppUpdate();
  const [nowTs, setNowTs] = React.useState(() => Date.now());

  const visible = update.pendingConfirmation
    && update.status === 'available'
    && update.confirmDeadlineAt !== null;

  // 倒计时每秒刷新一次，仅在弹窗可见期间运行
  React.useEffect(() => {
    if (!visible) {
      return;
    }
    setNowTs(Date.now());
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, COUNTDOWN_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const remainMs = (update.confirmDeadlineAt ?? 0) - nowTs;

  return (
    <Modal
      isOpen
      onClose={deferInstall}
      maxWidth="sm"
      closeOnBackdrop={false}
      icon={<RefreshCw className="w-4 h-4" />}
      title={`发现新版本 ${update.targetVersion}`}
      subtitle="系统更新已就绪，需要确认安装时机"
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <span className="text-xs text-[#737686]">
            如无操作，将于 {formatRemainSeconds(remainMs)} 后自动顺延
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={deferInstall}
              className="px-4 py-2 text-xs font-semibold text-[#434655] hover:bg-[#eff4ff] rounded-lg transition-colors cursor-pointer"
            >
              晚点安装
            </button>
            <button
              type="button"
              onClick={confirmInstall}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] rounded-lg shadow-2xs transition-all cursor-pointer"
            >
              立即安装更新
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[#0b1c30] leading-6">
          新版本 <span className="font-mono font-semibold">{update.targetVersion}</span> 已就绪。
          安装需要停止值守任务并重启应用（约 1 分钟），值守将在重启后自动恢复。
        </p>
        <p className="text-xs text-[#737686] leading-5">
          若暂不方便，可选择「晚点安装」，系统将在下一轮检查时再次询问。
        </p>
      </div>
    </Modal>
  );
};
