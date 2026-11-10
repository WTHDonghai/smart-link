import { describe, it, expect } from 'vitest';
import { decideDialogDisposition } from '../../../src/utils/agent/dialogActionPolicy';
import type { DutyPageObservation } from '../../../src/types/agent';

/**
 * P4 弹窗处置动作策略(设计 7.4):纯函数 100% 真实逻辑。
 * 红线:风控/验证码/登录类必须 notify_only(零动作授权),白名单外保守不动作。
 */

function observationWith(
  dialogs: Array<{ title: string; bodyText?: string; buttons?: string[] }>
): DutyPageObservation {
  return {
    observedAt: '2026-11-09T12:00:00.000Z',
    pageUrl: 'https://ota.example.com/orders',
    visibleTextExcerpt: '',
    dialogs: dialogs.map((dialog) => ({
      frameUrl: 'https://ota.example.com/orders',
      role: 'dialog',
      title: dialog.title,
      bodyText: dialog.bodyText ?? '',
      buttons: dialog.buttons ?? [],
    })),
  };
}

describe('decideDialogDisposition 动作策略(代码裁决)', () => {
  it('公告类弹窗且有白名单关闭按钮 → close_dialog 并携带定位信息', () => {
    const disposition = decideDialogDisposition(
      observationWith([{ title: '系统公告', bodyText: '今日凌晨系统升级', buttons: ['我知道了'] }])
    );

    expect(disposition.action).toBe('close_dialog');
    expect(disposition.targetDialogTitle).toBe('系统公告');
    expect(disposition.dismissButtonText).toBe('我知道了');
    expect(disposition.reason).toContain('系统公告');
  });

  it('验证码/安全验证类 → notify_only,绝不授权页面动作(越界红线)', () => {
    const captcha = decideDialogDisposition(
      observationWith([{ title: '安全验证', bodyText: '请拖动滑块完成验证', buttons: ['提交验证'] }])
    );
    expect(captcha.action).toBe('notify_only');
    expect(captcha.reason).toContain('安全验证');

    const login = decideDialogDisposition(
      observationWith([{ title: '登录提示', bodyText: '登录已过期,请重新登录', buttons: ['重新登录'] }])
    );
    expect(login.action).toBe('notify_only');
  });

  it('风控优先于白名单:同屏存在公告与验证码弹窗时整体 notify_only', () => {
    const disposition = decideDialogDisposition(
      observationWith([
        { title: '系统公告', buttons: ['我知道了'] },
        { title: '安全验证', bodyText: '请完成滑块验证', buttons: ['提交验证'] },
      ])
    );
    expect(disposition.action).toBe('notify_only');
  });

  it('未知弹窗(标题不在白名单或无标准关闭按钮)→ observe_only 保守不动作', () => {
    const unknownTitle = decideDialogDisposition(
      observationWith([{ title: '会员礼包', bodyText: '开通立减', buttons: ['我知道了'] }])
    );
    expect(unknownTitle.action).toBe('observe_only');

    const noDismissButton = decideDialogDisposition(
      observationWith([{ title: '系统公告', buttons: ['立即开通', '去看看'] }])
    );
    expect(noDismissButton.action).toBe('observe_only');
  });

  it('无弹窗或观察缺失 → observe_only(现场已变化)', () => {
    const empty = decideDialogDisposition(observationWith([]));
    expect(empty.action).toBe('observe_only');
    expect(empty.reason).toContain('现场已变化');

    const missing = decideDialogDisposition(null);
    expect(missing.action).toBe('observe_only');
  });
});
