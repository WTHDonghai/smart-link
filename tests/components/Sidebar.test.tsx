import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../src/store';
import { setUpdateState } from '../../src/store/slices/appSlice';
import { Sidebar } from '../../src/components/sidebar/Sidebar';
import type { AppUpdateState } from '../../src/types/update';

function createUpdateState(overrides: Partial<AppUpdateState>): AppUpdateState {
  return {
    canUpdate: true,
    status: 'idle',
    currentVersion: '1.0.0',
    targetVersion: '',
    progressPercent: null,
    message: '',
    ...overrides,
  };
}

describe('Sidebar update presentation', () => {
  it('shows only the version number while checking for updates', () => {
    const store = createAppStore();
    store.dispatch(setUpdateState(createUpdateState({ status: 'checking' })));

    const markup = renderToStaticMarkup(
      <Provider store={store}>
        <Sidebar />
      </Provider>
    );

    expect(markup).toContain('<span>1.0.0</span>');
    expect(markup).not.toContain('系统更新进度');
    expect(markup).not.toContain('安装系统更新');
  });

  it('shows only the version number when no update is available', () => {
    const store = createAppStore();
    store.dispatch(setUpdateState(createUpdateState({ status: 'idle' })));

    const markup = renderToStaticMarkup(
      <Provider store={store}>
        <Sidebar />
      </Provider>
    );

    expect(markup).toContain('<span>1.0.0</span>');
    expect(markup).not.toContain('检查系统更新');
    expect(markup).not.toContain('安装系统更新');
  });

  it('shows the update action when a new version is available', () => {
    const store = createAppStore();
    store.dispatch(setUpdateState(createUpdateState({
      status: 'available',
      targetVersion: '1.1.0',
    })));

    const markup = renderToStaticMarkup(
      <Provider store={store}>
        <Sidebar />
      </Provider>
    );

    expect(markup).toContain('安装系统更新 1.1.0');
  });
});
