/**
 * P4 弹窗处置动作策略(设计 7.4:未知弹窗的识别与动作策略)。
 *
 * 纯函数、零副作用:输入一次页面观察结果,输出处置决策。
 * 红线(设计 7.1 失败类型表 + 16.2):
 * - 风控/验证码/登录类弹窗 → notify_only,绝不产生任何页面动作;
 * - 白名单公告/广告类弹窗(有明确关闭按钮)→ close_dialog;
 * - 未知弹窗 → observe_only,首期保守不动作;
 * - 无弹窗 → observe_only(现场已变化,可能人工接管)。
 * 决策优先级:风控 > 白名单 > 未知。
 */

import type { DutyPageDialogObservation, DutyPageObservation } from '@/src/types/agent';

export type DialogDispositionAction = 'close_dialog' | 'notify_only' | 'observe_only';

export interface DialogDisposition {
  action: DialogDispositionAction;
  /** action=close_dialog 时:目标弹窗标题(用于定位与验证) */
  targetDialogTitle?: string;
  /** action=close_dialog 时:点击的关闭按钮文本 */
  dismissButtonText?: string;
  /** 人类可读决策依据(进入追踪事件,供审计) */
  reason: string;
}

/** 风控/验证码/登录特征(标题与正文命中即判越界,绝不动作) */
const RISK_PATTERNS: readonly RegExp[] = [
  /验证码|安全验证|滑块|拖动|拖拽/,
  /登录|login/i,
  /风控|风险|异常操作|操作频繁/,
];

/** 白名单公告类标题特征 */
const BENIGN_TITLE_PATTERNS: readonly RegExp[] = [/公告|通知|活动|升级|温馨提示|提醒/];

/** 白名单弹窗允许点击的关闭按钮文本(精确匹配) */
const BENIGN_DISMISS_BUTTONS: readonly string[] = ['我知道了', '知道了', '关闭', '取消', '确定'];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  const normalized = text.trim();
  return patterns.some((pattern) => pattern.test(normalized));
}

function isRiskDialog(dialog: DutyPageDialogObservation): boolean {
  return matchesAny(dialog.title, RISK_PATTERNS) || matchesAny(dialog.bodyText, RISK_PATTERNS);
}

function findDismissButton(dialog: DutyPageDialogObservation): string | undefined {
  return dialog.buttons.find((button) => BENIGN_DISMISS_BUTTONS.includes(button.trim()));
}

/**
 * 对一次页面观察结果作出处置决策(代码裁决,不依赖模型)。
 * 首期策略完全确定性:模型诊断属 P3 通知链,不参与动作授权。
 */
export function decideDialogDisposition(observation: DutyPageObservation | null): DialogDisposition {
  if (!observation || observation.dialogs.length === 0) {
    return {
      action: 'observe_only',
      reason: '页面现场已变化(未观察到弹窗,可能已被人工处置或人工接管)',
    };
  }

  const riskDialog = observation.dialogs.find(isRiskDialog);
  if (riskDialog) {
    return {
      action: 'notify_only',
      reason: `弹窗「${riskDialog.title.slice(0, 30)}」命中风控/验证/登录特征,禁止自动化处置,仅通知人工`,
    };
  }

  const benignDialog = observation.dialogs.find(
    (dialog) => matchesAny(dialog.title, BENIGN_TITLE_PATTERNS) && findDismissButton(dialog) !== undefined
  );
  if (benignDialog) {
    return {
      action: 'close_dialog',
      targetDialogTitle: benignDialog.title,
      dismissButtonText: findDismissButton(benignDialog),
      reason: `弹窗「${benignDialog.title.slice(0, 30)}」为公告类且存在关闭按钮「${findDismissButton(benignDialog)}」,允许关闭后重试步骤`,
    };
  }

  return {
    action: 'observe_only',
    reason: `弹窗「${observation.dialogs[0].title.slice(0, 30) || '未命名'}」不在白名单,首期保守不动作,转人工核对`,
  };
}
