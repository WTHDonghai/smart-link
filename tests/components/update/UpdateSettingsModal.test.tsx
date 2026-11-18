import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateSettingsModal } from '@/src/components/update/UpdateSettingsModal';

// SSR 渲染不执行 effect，设置加载态不可达，弹窗稳定渲染 null——
// 此处验证空态安全（不崩溃、无残缺 DOM）；开关交互逻辑由
// updateSettingsStore 单测（持久化读写）与 desktopUpdateService 单测
// （readAutoInstallEnabled 动态生效）分层覆盖
describe('UpdateSettingsModal 更新设置弹窗', () => {
  it('isOpen 为 false 时不渲染', () => {
    const html = renderToStaticMarkup(
      <UpdateSettingsModal isOpen={false} onClose={() => {}} onToast={() => {}} />
    );

    expect(html).toBe('');
  });

  it('设置尚未加载完成（effect 未执行）时不渲染任何内容，无残缺开关', () => {
    const html = renderToStaticMarkup(
      <UpdateSettingsModal isOpen onClose={() => {}} onToast={() => {}} />
    );

    expect(html).toBe('');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('自动更新');
  });
});
