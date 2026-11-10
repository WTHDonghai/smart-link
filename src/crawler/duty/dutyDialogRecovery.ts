/**
 * P4 弹窗处置恢复编排器(设计 7.2 恢复 helper / 7.3 工具集 / 9.5 提交确认闸门)。
 *
 * 语义:在页面步骤失败后执行有界恢复——
 *   观察(observeDutyPage) → 决策(dialogActionPolicy,代码裁决) → 必要时关闭(close_dialog)
 *   → 验证(verify,弹窗确实消失且未重现) → 仅重试该安全步骤一次。
 *
 * 刚性约束:
 * - 风控/验证码/登录类弹窗绝不产生任何页面动作(notify_only 由 P3 通知链负责);
 * - 关闭动作必须先通过关键追踪事件(AGENT_TOOL_STARTED, requiresCommitAck)的
 *   IndexedDB 提交确认,确认失败动作不执行;
 * - 同一弹窗仅处置一次:关闭后若再次出现(verify 失败)不再关闭,转 MANUAL_REVIEW;
 * - 验证失败不重试步骤、不伪造成功;每一步都留 AGENT_* 追踪事件与 failureReason。
 *
 * 首期限制:仅支持关闭主 frame 内的弹窗;子 frame 弹窗转人工并如实说明。
 */

import type { Page } from 'playwright';
import { observeDutyPage } from './dutyPageObserver';
import {
  decideDialogDisposition,
  type DialogDisposition,
  type DialogDispositionAction,
} from '@/src/utils/agent/dialogActionPolicy';
import type { DutyPageObservation } from '@/src/types/agent';
import { AgentTraceEmitter } from '@/src/agent/agentTraceEmitter';
import { describeErrorMessage } from '@/src/utils/errorCauses';
import { randomIdSuffix } from '@/src/utils/randomIdSuffix';

/** 弹窗对话框语义选择器(与 dutyPageObserver 的观察选择器保持一致) */
const DIALOG_SELECTOR = '[role="dialog"], .mtd-modal';

export interface DutyStepRecoveryOptions {
  /** 步骤名(进入追踪事件,如 collect-orders / inspect-order-detail) */
  stepName: string;
  orderId?: string | null;
  /** 关闭后等待弹窗稳定再验证的毫秒数(默认 600,覆盖「关闭后再弹」竞态) */
  verifySettleMs?: number;
}

export interface DutyStepRecoveryOutcome<T = void> {
  stepSucceeded: boolean;
  finalStatus: 'SUCCEEDED' | 'MANUAL_REVIEW' | 'CANCELLED';
  /** 实际执行的处置动作;步骤一次成功时为 'none' */
  action: DialogDispositionAction | 'none';
  /** 实际执行的页面动作次数(红线:风控类必须为 0) */
  pageActionsPerformed: number;
  /** 关闭按钮点击成功执行 */
  closed: boolean;
  /** 关闭后验证通过(弹窗消失且未重现) */
  verified: boolean;
  /** 安全步骤重试次数(0 或 1,验证通过才允许重试) */
  stepRetryCount: 0 | 1;
  /** 步骤成功时的返回值(首次或重试成功) */
  result?: T;
  /** 最后一次步骤抛出的原始错误(保留类型化错误供调用方按原语义上抛,如风控码/可重试标记) */
  lastStepError?: unknown;
  failureReason?: string;
  observation: DutyPageObservation | null;
}

const DEFAULT_VERIFY_SETTLE_MS = 600;

/** 在主 frame 内定位目标弹窗并点击关闭按钮;点击成功返回 true */
async function clickDialogDismissButton(
  page: Page,
  disposition: DialogDisposition
): Promise<boolean> {
  const dialog = page
    .locator(DIALOG_SELECTOR)
    .filter({ hasText: disposition.targetDialogTitle ?? '' })
    .first();
  const dismissButton = dialog.getByRole('button', { name: disposition.dismissButtonText ?? '关闭' });
  await dismissButton.click({ timeout: 5000 });
  return true;
}

/** 验证目标弹窗已消失且未重现(等待稳定窗口后重新观察) */
async function verifyDialogDismissed(
  page: Page,
  dialogTitle: string,
  settleMs: number
): Promise<boolean> {
  await page.waitForTimeout(settleMs);
  const observation = await observeDutyPage(page);
  return !observation.dialogs.some((dialog) => dialog.title.trim() === dialogTitle.trim());
}

/**
 * 执行一个页面步骤;失败时有界恢复(观察→决策→关闭→验证→仅重试一次)。
 * 调用方须已持有页面互斥锁(runWithMutex 区间内),恢复过程不再获取锁。
 */
export async function runDutyStepWithDialogRecovery<T>(
  page: Page,
  stepExecutor: () => Promise<T>,
  options: DutyStepRecoveryOptions
): Promise<DutyStepRecoveryOutcome<T>> {
  // 1. 首次执行步骤:成功则零开销返回,不产生任何追踪事件
  try {
    const result = await stepExecutor();
    return {
      stepSucceeded: true,
      finalStatus: 'SUCCEEDED',
      action: 'none',
      pageActionsPerformed: 0,
      closed: false,
      verified: false,
      stepRetryCount: 0,
      result,
      observation: null,
    };
  } catch (stepError) {
    const stepFailure = describeErrorMessage(stepError);
    return await recoverFromStepFailure<T>(page, stepExecutor, options, stepFailure, stepError);
  }
}

async function recoverFromStepFailure<T>(
  page: Page,
  stepExecutor: () => Promise<T>,
  options: DutyStepRecoveryOptions,
  stepFailure: string,
  stepError: unknown
): Promise<DutyStepRecoveryOutcome<T>> {
  const recoveryId = `recovery-${randomIdSuffix(8)}`;
  const emitter = new AgentTraceEmitter({ traceId: recoveryId, runId: recoveryId });
  const settleMs = options.verifySettleMs ?? DEFAULT_VERIFY_SETTLE_MS;

  emitter.emit({
    kind: 'run',
    phase: 'started',
    summary: `弹窗恢复启动:步骤「${options.stepName}」失败(${options.orderId ?? '-'})`,
    payload: { stepName: options.stepName, orderId: options.orderId, stepFailure: stepFailure.slice(0, 200) },
  });

  // 2. 只读观察现场(证据必须在决策前最先采集)
  const observation = await observeDutyPage(page);
  emitter.emit({
    kind: 'snapshot',
    phase: 'completed',
    summary: observation.dialogs.length > 0 ? `观察到 ${observation.dialogs.length} 个弹窗` : '未观察到弹窗',
    payload: {
      dialogTitles: observation.dialogs.map((dialog) => dialog.title),
      pageUrl: observation.pageUrl,
    },
  });

  // 3. 代码裁决处置动作
  const disposition = decideDialogDisposition(observation);
  emitter.emit({
    kind: 'decision',
    phase: 'completed',
    outcomeCode: disposition.action,
    summary: `处置决策: ${disposition.action}（${disposition.reason}）`,
    payload: { action: disposition.action, reason: disposition.reason, targetDialogTitle: disposition.targetDialogTitle ?? null },
  });

  const finish = (
    outcome: Omit<DutyStepRecoveryOutcome<T>, 'observation'>,
    outcomeCode: string
  ): DutyStepRecoveryOutcome<T> => {
    emitter.emit({
      kind: 'run',
      phase: 'completed',
      outcomeCode,
      summary: `弹窗恢复结束: ${outcomeCode}（${outcome.failureReason ?? '步骤恢复成功'}）`,
      payload: {
        finalStatus: outcome.finalStatus,
        action: outcome.action,
        pageActionsPerformed: outcome.pageActionsPerformed,
        closed: outcome.closed,
        verified: outcome.verified,
        stepRetryCount: outcome.stepRetryCount,
        failureReason: outcome.failureReason ?? null,
      },
    });
    return { ...outcome, observation };
  };

  // 4a. 无弹窗:现场已变化(人工处置/接管),取消恢复,不猜测原因
  if (disposition.action === 'observe_only' && observation.dialogs.length === 0) {
    return finish(
      {
        stepSucceeded: false,
        finalStatus: 'CANCELLED',
        action: disposition.action,
        pageActionsPerformed: 0,
        closed: false,
        verified: false,
        stepRetryCount: 0,
        lastStepError: stepError,
        failureReason: `步骤「${options.stepName}」失败但弹窗已消失,页面现场已变化(可能人工接管),取消自动处置;原始失败: ${stepFailure.slice(0, 160)}`,
      },
      'cancelled_page_changed'
    );
  }

  // 4b. 风控/验证码/登录类或未知弹窗:零页面动作,转人工
  if (disposition.action !== 'close_dialog') {
    return finish(
      {
        stepSucceeded: false,
        finalStatus: 'MANUAL_REVIEW',
        action: disposition.action,
        pageActionsPerformed: 0,
        closed: false,
        verified: false,
        stepRetryCount: 0,
        lastStepError: stepError,
        failureReason: `${disposition.reason};原始失败: ${stepFailure.slice(0, 160)}`,
      },
      disposition.action === 'notify_only' ? 'manual_review_risk_dialog' : 'manual_review_unknown_dialog'
    );
  }

  // 5. 关闭动作闸门(设计 9.5):动作意图事件先落库确认,确认失败动作不执行
  try {
    await emitter.emitCritical({
      kind: 'tool',
      phase: 'started',
      summary: `工具意图: close_dialog「${disposition.targetDialogTitle}」(按钮「${disposition.dismissButtonText}」)`,
      payload: {
        tool: 'close_dialog',
        dialogTitle: disposition.targetDialogTitle,
        dismissButton: disposition.dismissButtonText,
        stepName: options.stepName,
      },
    });
  } catch (ackError) {
    return finish(
      {
        stepSucceeded: false,
        finalStatus: 'MANUAL_REVIEW',
        action: disposition.action,
        pageActionsPerformed: 0,
        closed: false,
        verified: false,
        stepRetryCount: 0,
        lastStepError: stepError,
        failureReason: `关键追踪事件持久化确认失败,关闭动作未执行: ${describeErrorMessage(ackError).slice(0, 160)}`,
      },
      'tool_intent_ack_failed'
    );
  }

  // 6. 执行关闭
  let closed = false;
  try {
    closed = await clickDialogDismissButton(page, disposition);
    emitter.emit({
      kind: 'tool',
      phase: 'completed',
      summary: `已点击弹窗「${disposition.targetDialogTitle}」关闭按钮`,
    });
  } catch (closeError) {
    emitter.emit({
      kind: 'tool',
      phase: 'failed',
      level: 'WARN',
      summary: `点击关闭按钮失败: ${describeErrorMessage(closeError).slice(0, 160)}`,
    });
  }

  // 7. 验证:弹窗确实消失且未重现(同一弹窗仅处置一次,重现即转人工)
  const verified = closed && (await verifyDialogDismissed(page, disposition.targetDialogTitle ?? '', settleMs));
  emitter.emit({
    kind: 'validation',
    phase: 'completed',
    outcomeCode: verified ? 'dialog-dismissed' : 'dialog-still-present',
    summary: verified
      ? `弹窗「${disposition.targetDialogTitle}」已关闭且未重现`
      : `弹窗「${disposition.targetDialogTitle}」关闭后仍存在或再次出现,不再二次处置`,
  });

  if (!verified) {
    return finish(
      {
        stepSucceeded: false,
        finalStatus: 'MANUAL_REVIEW',
        action: disposition.action,
        pageActionsPerformed: closed ? 1 : 0,
        closed,
        verified: false,
        stepRetryCount: 0,
        lastStepError: stepError,
        failureReason: `弹窗「${disposition.targetDialogTitle}」关闭后仍存在或再次出现(同一弹窗仅处置一次),转人工核对`,
      },
      'verify_failed'
    );
  }

  // 8. 验证通过:仅重试该安全步骤一次
  try {
    const retriedResult = await stepExecutor();
    return finish(
      {
        stepSucceeded: true,
        finalStatus: 'SUCCEEDED',
        action: disposition.action,
        pageActionsPerformed: 1,
        closed: true,
        verified: true,
        stepRetryCount: 1,
        result: retriedResult,
      },
      'recovered'
    );
  } catch (retryError) {
    return finish(
      {
        stepSucceeded: false,
        finalStatus: 'MANUAL_REVIEW',
        action: disposition.action,
        pageActionsPerformed: 1,
        closed: true,
        verified: true,
        stepRetryCount: 1,
        lastStepError: retryError,
        failureReason: `弹窗已关闭但步骤重试仍失败(仅重试一次,不循环): ${describeErrorMessage(retryError).slice(0, 160)}`,
      },
      'retry_failed'
    );
  }
}
