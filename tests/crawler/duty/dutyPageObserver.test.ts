import { describe, it, expect } from 'vitest';
import { observeDutyPage } from '../../../src/crawler/duty/dutyPageObserver';
import type { DutyPageDialogObservation } from '../../../src/types/agent';

/**
 * 页面观察器：仅注入外部 I/O（Playwright frame.evaluate），观察编排、脱敏、
 * 截断与跨域容错为真实逻辑。
 */

interface FakeFrame {
  url: () => string;
  isMain: boolean;
  evaluate: (fn: unknown, arg: unknown) => Promise<unknown>;
}

function buildFakePage(frames: FakeFrame[], pageUrl = 'https://ota.example.com/orders') {
  const mainFrame = frames.find((frame) => frame.isMain)!;
  return {
    url: () => pageUrl,
    mainFrame: () => mainFrame,
    frames: () => frames,
  } as never;
}

function frameWithDialogs(
  frameUrl: string,
  dialogs: DutyPageDialogObservation[],
  options?: { fail?: Error; isMain?: boolean }
): FakeFrame {
  return {
    url: () => frameUrl,
    isMain: options?.isMain ?? true,
    evaluate: (fn: unknown) => {
      if (options?.fail) return Promise.reject(options.fail);
      const isTextExtractor = typeof fn === 'function' && fn.toString().includes('document.body');
      if (isTextExtractor) return Promise.resolve('页面可见文本 张三 13812345678');
      return Promise.resolve(
        dialogs.map((dialog) => ({
          role: dialog.role,
          title: dialog.title,
          bodyText: dialog.bodyText,
          buttons: dialog.buttons,
        }))
      );
    },
  } as never;
}

describe('observeDutyPage 观察编排', () => {
  it('聚合各 frame 的浮层并脱敏截断正文与按钮', async () => {
    const page = buildFakePage([
      frameWithDialogs('https://ota.example.com/orders', [
        {
          frameUrl: '',
          role: 'dialog',
          title: '系统公告',
          bodyText: `${'很长的公告内容'.repeat(60)} 联系电话 13812345678`,
          buttons: ['我知道了', '查看详情', '确定', '取消', '关闭', '稍后', '不再提示', '好的', '知道了', '刷新', '第11个按钮'],
        },
      ]),
    ]);

    const observation = await observeDutyPage(page);

    expect(observation.pageUrl).toBe('https://ota.example.com/orders');
    expect(observation.dialogs).toHaveLength(1);
    expect(observation.dialogs[0].title).toBe('系统公告');
    // 长文本截断 + 手机号脱敏
    expect(observation.dialogs[0].bodyText.length).toBeLessThanOrEqual(301);
    expect(observation.dialogs[0].bodyText).not.toContain('13812345678');
    expect(observation.dialogs[0].buttons).toHaveLength(10);
    // 主 frame 可见文本摘录同样脱敏
    expect(observation.visibleTextExcerpt).toContain('138****5678');
    expect(observation.note).toBeUndefined();
  });

  it('跨域/不可访问 frame 的失败如实记入 note，不中断整体观察', async () => {
    const page = buildFakePage([
      frameWithDialogs('https://ota.example.com/orders', []),
      frameWithDialogs('https://cross.example.com/child', [], { fail: new Error('Cross-origin script denied'), isMain: false }),
    ]);

    const observation = await observeDutyPage(page);

    expect(observation.note).toContain('观察失败');
    expect(observation.note).toContain('Cross-origin script denied');
  });

  it('主 frame 文本提取失败也记入 note', async () => {
    const mainFrame: FakeFrame = {
      url: () => 'https://ota.example.com/orders',
      isMain: true,
      evaluate: () => Promise.reject(new Error('detached frame')),
    };
    const page = buildFakePage([mainFrame]);

    const observation = await observeDutyPage(page);
    expect(observation.visibleTextExcerpt).toBe('');
    expect(observation.note).toContain('主 frame 文本提取失败');
  });
});
