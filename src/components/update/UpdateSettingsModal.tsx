import React from 'react';
import { Settings2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import type { AppUpdateSettings } from '../../types/update';

interface UpdateSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (toast: { title: string; description?: string; type: 'success' | 'error' }) => void;
}

/**
 * 更新设置弹窗：自动安装开关。开关经主进程持久化，下一次安装决策立即生效。
 */
export const UpdateSettingsModal: React.FC<UpdateSettingsModalProps> = ({ isOpen, onClose, onToast }) => {
  const [settings, setSettings] = React.useState<AppUpdateSettings | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const updateApi = window.host?.update;
    if (!updateApi) {
      return;
    }
    let isActive = true;
    void updateApi.getSettings().then((loaded) => {
      if (isActive) {
        setSettings(loaded);
      }
    });
    return () => {
      isActive = false;
    };
  }, [isOpen]);

  const handleToggle = async (enabled: boolean) => {
    const updateApi = window.host?.update;
    if (!updateApi || saving) {
      return;
    }
    setSaving(true);
    try {
      const result = await updateApi.setAutoInstallEnabled(enabled);
      if (result.success) {
        setSettings({ autoInstallEnabled: enabled });
        onToast({
          title: enabled ? '已开启自动更新' : '已关闭自动更新',
          type: 'success',
        });
      } else {
        onToast({
          title: '保存设置失败',
          description: result.error,
          type: 'error',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="sm"
      icon={<Settings2 className="w-4 h-4" />}
      title="更新设置"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs font-semibold text-[#434655] hover:bg-[#eff4ff] rounded-lg transition-colors cursor-pointer"
        >
          关闭
        </button>
      }
    >
      <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
        <span className="text-sm text-[#0b1c30]">自动更新</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.autoInstallEnabled}
          disabled={saving}
          onClick={() => void handleToggle(!settings.autoInstallEnabled)}
          className={`relative w-10 h-6 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
            settings.autoInstallEnabled ? 'bg-[#004ac6]' : 'bg-[#c3c6d7]'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              settings.autoInstallEnabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
      </label>
    </Modal>
  );
};
