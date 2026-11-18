import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '@/src/store';
import { setUpdateState } from '@/src/store/slices/appSlice';
import { UpdateConfirmModal } from '@/src/components/update/UpdateConfirmModal';
import type { AppUpdateState } from '@/src/types/update';

function createUpdateState(overrides: Partial<AppUpdateState>): AppUpdateState {
  return {
    canUpdate: true,
    status: 'idle',
    currentVersion: '1.0.0',
    targetVersion: '',
    progressPercent: null,
    message: '',
    pendingConfirmation: false,
    confirmDeadlineAt: null,
    ...overrides,
  };
}

function renderModalWithState(state: AppUpdateState): string {
  const store = createAppStore();
  store.dispatch(setUpdateState(state));
  return renderToStaticMarkup(
    <Provider store={store}>
      <UpdateConfirmModal />
    </Provider>
  );
}

describe('UpdateConfirmModal 更新安装确认弹窗', () => {
  it('pendingConfirmation 且状态为 available 时渲染弹窗、目标版本与决策按钮', () => {
    const html = renderModalWithState(createUpdateState({
      status: 'available',
      targetVersion: '1.1.0',
      pendingConfirmation: true,
      confirmDeadlineAt: Date.now() + 10 * 60 * 1000,
    }));

    expect(html).toContain('发现新版本 1.1.0');
    expect(html).toContain('立即安装更新');
    expect(html).toContain('晚点安装');
    expect(html).toContain('值守将在重启后自动恢复');
    expect(html).toContain('后自动顺延');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('pendingConfirmation 为 false 时不渲染弹窗', () => {
    const html = renderModalWithState(createUpdateState({
      status: 'available',
      targetVersion: '1.1.0',
      pendingConfirmation: false,
      confirmDeadlineAt: null,
    }));

    expect(html).not.toContain('发现新版本');
    expect(html).not.toContain('立即安装更新');
  });

  it('状态非 available（如下载中）时不渲染弹窗', () => {
    const html = renderModalWithState(createUpdateState({
      status: 'downloading',
      targetVersion: '1.1.0',
      pendingConfirmation: true,
      confirmDeadlineAt: Date.now() + 10 * 60 * 1000,
      progressPercent: 42,
    }));

    expect(html).not.toContain('发现新版本');
  });

  it('confirmDeadlineAt 缺失时不渲染弹窗（防御残缺状态）', () => {
    const html = renderModalWithState(createUpdateState({
      status: 'available',
      targetVersion: '1.1.0',
      pendingConfirmation: true,
      confirmDeadlineAt: null,
    }));

    expect(html).not.toContain('立即安装更新');
  });

  it('倒计时按截止时间格式化为 mm:ss', () => {
    const html = renderModalWithState(createUpdateState({
      status: 'available',
      targetVersion: '1.1.0',
      pendingConfirmation: true,
      // 9 分 30 秒后截止（SSR 渲染时刻与断言间隔极短，向上取整稳定在 09:30 或 09:29）
      confirmDeadlineAt: Date.now() + 9.5 * 60 * 1000,
    }));

    expect(html).toMatch(/后自动顺延/);
    expect(html).toMatch(/0[89]:[23]\d/);
  });
});
