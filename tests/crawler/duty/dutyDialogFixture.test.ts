import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { observeDutyPage } from '../../../src/crawler/duty/dutyPageObserver';
import {
  startDutyDialogFixtureServer,
  type DutyDialogFixture,
} from './fixture/dutyDialogFixtureServer';

/**
 * P4 弹窗处置验收基建验证(今日即真实执行):
 * 用真实 headless 浏览器驱动 fixture 仿真页,断言既有观察器 observeDutyPage
 * 能精确识别各场景弹窗,且 fixture 的关闭/再弹/顽固行为与场景定义一致。
 * 该文件全绿是六项 P4 验收用例(dialogRecoveryAcceptance.test.ts)可用的前提。
 */

describe('dutyDialogFixture 基建验证(真实浏览器 + 真实观察器)', () => {
  let fixture: DutyDialogFixture;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    fixture = await startDutyDialogFixtureServer();
    // 与生产运行时一致使用系统 Chrome(channel),不依赖 playwright 下载的 headless-shell
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
    await fixture.close();
  });

  it('clean 场景:无弹窗,页面文本可观察(阴性对照)', async () => {
    await page.goto(fixture.urlFor('clean'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const observation = await observeDutyPage(page);
    expect(observation.dialogs).toHaveLength(0);
    expect(observation.visibleTextExcerpt).toContain('待处理订单');
  });

  it('ad 场景:观察器识别「系统公告」广告弹窗;点击「我知道了」后弹窗消失', async () => {
    await page.goto(fixture.urlFor('ad'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const before = await observeDutyPage(page);
    expect(before.dialogs).toHaveLength(1);
    expect(before.dialogs[0].title).toBe('系统公告');
    expect(before.dialogs[0].bodyText).toContain('系统升级');
    expect(before.dialogs[0].buttons).toContain('我知道了');

    await page.getByRole('button', { name: '我知道了' }).click();
    await page.waitForTimeout(300);
    const after = await observeDutyPage(page);
    expect(after.dialogs).toHaveLength(0);
  });

  it('captcha 场景:识别「安全验证」验证码弹窗,提交按钮不关闭弹窗(越界红线形态)', async () => {
    await page.goto(fixture.urlFor('captcha'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const before = await observeDutyPage(page);
    expect(before.dialogs).toHaveLength(1);
    expect(before.dialogs[0].title).toBe('安全验证');
    expect(before.dialogs[0].buttons).toContain('提交验证');

    // 即使误点提交,弹窗仍然存在:确保 P4 的「禁止绕过验证」用例有真实靶子
    await page.getByRole('button', { name: '提交验证' }).click();
    await page.waitForTimeout(300);
    const after = await observeDutyPage(page);
    expect(after.dialogs).toHaveLength(1);
    expect(after.dialogs[0].title).toBe('安全验证');
  });

  it('ad-retry 场景:首次关闭后 500ms 再弹一次,二次关闭后彻底消失', async () => {
    await page.goto(fixture.urlFor('ad-retry'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    expect((await observeDutyPage(page)).dialogs).toHaveLength(1);

    await page.getByRole('button', { name: '我知道了' }).click();
    await page.waitForTimeout(900); // 跨过 500ms 再弹窗口
    expect((await observeDutyPage(page)).dialogs).toHaveLength(1);

    await page.getByRole('button', { name: '我知道了' }).click();
    await page.waitForTimeout(300);
    expect((await observeDutyPage(page)).dialogs).toHaveLength(0);
  });

  it('persistent 场景:点击关闭后弹窗不消失(校验失败路径的真实靶子)', async () => {
    await page.goto(fixture.urlFor('persistent'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    expect((await observeDutyPage(page)).dialogs).toHaveLength(1);

    await page.getByRole('button', { name: '我知道了' }).click();
    await page.waitForTimeout(500);
    const after = await observeDutyPage(page);
    expect(after.dialogs).toHaveLength(1);
    expect(after.dialogs[0].title).toBe('系统公告');
  });
});
