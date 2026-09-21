import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../../src/store';
import { RemarkTemplateModal } from '../../../src/components/channels/RemarkTemplateModal';
import {
  saveRemarkTemplateAsync,
  setSelectedChannelForTemplate,
  addChannelById,
} from '../../../src/store/slices/channelSlice';
import { saveTokensToStorage } from '../../../src/services/platformAuth';
import type { PlatformAuthTokens } from '../../../src/types';

const createMockTokens = (): PlatformAuthTokens => ({
  accessToken: 'test-token',
  refreshToken: 'test-refresh-token',
  expiresAt: Date.now() + 3600 * 1000,
  tokenType: 'bearer',
  platformBaseUrl: 'https://pms.example.com',
  tenantId: 'XR-01',
  authenticatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const renderModal = (store: ReturnType<typeof createAppStore>): string =>
  renderToStaticMarkup(
    <Provider store={store}>
      <RemarkTemplateModal />
    </Provider>
  );

describe('RemarkTemplateModal 保存按钮加载', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    saveTokensToStorage(createMockTokens());
  });

  it('保存 pending 时仅在保存按钮展示加载态，保持编辑与关闭入口可用', async () => {
    let resolveFetch!: (response: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    globalThis.fetch = vi.fn().mockReturnValue(pendingFetch);

    const store = createAppStore();
    store.dispatch(addChannelById('meituan'));
    store.dispatch(setSelectedChannelForTemplate('meituan'));
    const saveRequest = store.dispatch(
      saveRemarkTemplateAsync({
        channelId: 'meituan',
        otaChannelCode: 'MEITUAN',
        template: '【保存中模板】{美团单号}',
      })
    );

    const html = renderModal(store);
    const textareaTag = html.match(/<textarea[^>]*>/)?.[0] ?? '';

    expect(store.getState().channel.isSavingTemplate).toBe(true);
    expect(textareaTag).not.toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*aria-label="关闭"[^>]*>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="关闭"[^>]*>/);
    expect(html).toMatch(/<button[^>]*>取消<\/button>/);
    expect(html).toMatch(/<button[^>]*>清空模板<\/button>/);
    expect(html).toMatch(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*\{美团单号\}/
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*保存中\.\.\./
    );

    resolveFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        code: 0,
        msg: '模板保存成功',
        data: { otaChannelCode: 'MEITUAN', remarkTemplate: '【远端模板】{美团单号}' },
      }),
    } as unknown as Response);
    await saveRequest;
  });

  it('保存失败后恢复编辑与关闭操作，保留错误供原地重试', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ code: 500, msg: '远端模板保存失败' }),
    } as unknown as Response);

    const store = createAppStore();
    store.dispatch(addChannelById('meituan'));
    store.dispatch(setSelectedChannelForTemplate('meituan'));
    await store.dispatch(
      saveRemarkTemplateAsync({
        channelId: 'meituan',
        otaChannelCode: 'MEITUAN',
        template: '【待重试模板】{美团单号}',
      })
    );

    const html = renderModal(store);
    const textareaTag = html.match(/<textarea[^>]*>/)?.[0] ?? '';
    const closeButtonTag = html.match(/<button[^>]*aria-label="关闭"[^>]*>/)?.[0] ?? '';
    const variableButtonTag =
      html.match(/<button[^>]*title="美团平台订单唯一流水号[^>]*>/)?.[0] ?? '';

    expect(store.getState().channel.isSavingTemplate).toBe(false);
    expect(store.getState().channel.templateSaveError).toContain('远端模板保存失败');
    expect(html).toContain('模板保存失败');
    expect(textareaTag).not.toContain('disabled=""');
    expect(closeButtonTag).not.toContain('disabled=""');
    expect(variableButtonTag).not.toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*>取消<\/button>/);
    expect(html).toMatch(/<button[^>]*>清空模板<\/button>/);
    expect(html).toMatch(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*保存模板/
    );
  });
});
