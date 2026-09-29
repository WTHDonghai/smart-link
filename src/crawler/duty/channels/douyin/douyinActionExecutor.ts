import type { Page } from 'playwright';
import { updateVisualTrackerStatus, visualClickLocator } from '@/src/crawler/visualTracker';
import type { DutyActionDryRunOptions, DutyActionVerificationResult } from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  humanDelay,
  getScaledKeystrokeDelay,
  isElementVisible,
  isModalVisible,
} from '../../dutyTimingConfig';
import { assertNoDouyinPageRisk } from './douyinRiskGuard';
import { getDouyinOrderScope, locateDouyinOrderCard } from './douyinCardLocator';
import { DutyOrderStatus } from '../../dutyTaskContext';

export interface DouyinActionExecutorOptions extends DutyActionDryRunOptions {
  refreshOrderList: (page: Page, orderStatus?: DutyOrderStatus) => Promise<unknown>;
}

/**
 * 抖音订单动作执行器：负责确认号回填（接单）与确认取消（我知道了/同意退款）操作
 */
export class DouyinActionExecutor {
  /**
   * 在抖音后台回填确认号（基于订单卡片交互，防串单严格校验，支持安全演练 dryRun）
   */
  public async confirmImport(
    page: Page,
    confirmNo: string,
    otaOrderId: string,
    options: DouyinActionExecutorOptions & { dryRun: true }
  ): Promise<DutyActionVerificationResult>;
  public async confirmImport(
    page: Page,
    confirmNo: string,
    otaOrderId: string,
    options: DouyinActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void>;
  public async confirmImport(
    page: Page,
    confirmNo: string,
    otaOrderId: string,
    options: DouyinActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void> {
    await assertNoDouyinPageRisk(page);

    const cleanConfirmNo = String(confirmNo || '').trim();
    if (!cleanConfirmNo) {
      throw new DutyExecutionError('确认号不能为空', DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND, false);
    }

    const cleanOrderId = String(otaOrderId || '').trim();
    if (!cleanOrderId) {
      throw new DutyExecutionError('otaOrderId 不能为空', DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND, false);
    }

    await updateVisualTrackerStatus(
      page,
      options.dryRun
        ? `🛡️ 正在以【安全演练模式】验证抖音订单「${cleanOrderId}」卡片与确认号「${cleanConfirmNo}」输入框...`
        : `📝 正在抖音订单「${cleanOrderId}」卡片内回填确认号「${cleanConfirmNo}」...`,
      'action'
    );

    const scope = getDouyinOrderScope(page);

    // 1. 定位目标订单卡片，若不可见先刷新待处理列表
    let orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);
    if (!orderCard) {
      await options.refreshOrderList(page, DutyOrderStatus.NEW);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);
    }

    if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
      await assertNoDouyinPageRisk(page);
      throw new DutyExecutionError(
        `未找到抖音订单「${cleanOrderId}」卡片，无法回填确认号`,
        DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        false
      );
    }

    // 2. 定位「接单」或「填写确认号」操作按钮并点击，触发模态弹窗
    const acceptBtn = orderCard.locator(
      'button:has-text("接单"), ' +
      'button:has-text("填写酒店确认号"), ' +
      'button:has-text("填写确认号"), ' +
      'button.byted-btn-primary:has-text("接单"), ' +
      'button.semi-button-primary:has-text("接单"), ' +
      '[data-action="accept_book"], ' +
      '[data-action="fill_confirm_number"]'
    ).first();

    if (!await isElementVisible(acceptBtn)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」未找到「接单/填写确认号」操作按钮`,
        DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    await visualClickLocator(page, acceptBtn, `点击订单「${cleanOrderId}」接单按钮弹出确认回填框`);
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 3. 等待并严格限定确认号回填模态弹窗
    const dialog = scope.locator(
      '.byted-modal, .semi-modal, div[role="dialog"]'
    ).filter({ hasText: /确认号|接单/ }).first();

    if (!await isModalVisible(dialog)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」未弹出或未找到确认号回填弹窗`,
        DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        false
      );
    }

    // 4. 在弹窗内定位确认号输入框，执行防串单校验与读回校验
    const targetInput = dialog.locator(
      'input.byted-input, input.semi-input, input[placeholder*="确认号"], input[placeholder*="填写"], input'
    ).first();

    if (!await isElementVisible(targetInput)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」接单弹窗内未找到确认号输入框`,
        DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        false
      );
    }

    const currentValue = (await targetInput.inputValue().catch(() => '')).trim();
    if (currentValue && currentValue !== cleanConfirmNo) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」输入框已存在其他确认号「${currentValue}」，系统已停止覆盖以防串单`,
        DouyinDutyErrorCode.CONFIRM_INPUT_ALREADY_FILLED,
        false
      );
    }

    if (currentValue !== cleanConfirmNo) {
      if (typeof targetInput.pressSequentially === 'function') {
        if (typeof targetInput.fill === 'function') {
          await targetInput.fill('').catch(() => {});
        }
        await targetInput.click().catch(() => {});
        await targetInput.pressSequentially(cleanConfirmNo, {
          delay: getScaledKeystrokeDelay(),
        });
      } else if (typeof targetInput.fill === 'function') {
        await targetInput.fill(cleanConfirmNo);
      }
      const readBack = (await targetInput.inputValue().catch(() => '')).trim();
      if (readBack !== cleanConfirmNo) {
        throw new DutyExecutionError(
          `订单「${cleanOrderId}」确认号填入后读回校验不一致 (写入: ${cleanConfirmNo}, 读回: ${readBack})`,
          DouyinDutyErrorCode.CONFIRM_VALUE_MISMATCH,
          false
        );
      }
    }

    // 5. 定位弹窗中的提交操作按钮
    const dialogConfirmBtn = dialog.locator(
      '.byted-modal-footer button.byted-btn-primary, ' +
      '.semi-modal-footer button.semi-button-primary, ' +
      'button:has-text("确定"), ' +
      'button:has-text("确认"), ' +
      'button:has-text("接单"), ' +
      'button:has-text("保存")'
    ).first();

    if (!await isElementVisible(dialogConfirmBtn)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」接单弹窗内未找到提交确认按钮`,
        DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    // 安全演练模式处理：安全关闭弹窗并返回验证结果，杜绝真实提交
    if (options.dryRun) {
      await updateVisualTrackerStatus(page, '🛑 【安全演练收尾】正在点击「取消」按钮关闭弹窗，确保不提交任何数据...', 'action');
      const cancelBtn = dialog.locator(
        'button:has-text("取消"), .byted-modal-close, .semi-modal-close, [aria-label="Close"]'
      ).first();
      if (await isElementVisible(cancelBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
        await visualClickLocator(page, cancelBtn, '安全演练收尾：取消弹窗');
      } else {
        await page.keyboard.press('Escape');
      }
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      await updateVisualTrackerStatus(page, '✅ 确认号回填流程演练验证完毕，已安全关闭弹窗', 'success');
      return {
        verified: true,
        orderId: cleanOrderId,
        action: 'confirmImport',
        dryRun: true,
        verifiedSteps: [
          'locate_order_card',
          'click_accept_btn',
          'verify_modal_dialog',
          'fill_confirm_no',
          'verify_submit_btn',
          'close_dialog_safely',
        ],
        fieldValues: { confirmNo: cleanConfirmNo },
      };
    }

    await visualClickLocator(page, dialogConfirmBtn, `点击弹窗确认提交按钮确认订单「${cleanOrderId}」`);
    await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
  }

  /**
   * 在抖音后台确认取消（我知道了 / 同意退款，支持安全演练 dryRun）
   */
  public async confirmCancel(
    page: Page,
    otaOrderId: string,
    options: DouyinActionExecutorOptions & { dryRun: true }
  ): Promise<DutyActionVerificationResult>;
  public async confirmCancel(
    page: Page,
    otaOrderId: string,
    options: DouyinActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void>;
  public async confirmCancel(
    page: Page,
    otaOrderId: string,
    options: DouyinActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void> {
    if (!otaOrderId || !otaOrderId.trim()) {
      throw new DutyExecutionError('otaOrderId 不能为空', DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND, false);
    }
    const cleanOrderId = otaOrderId.trim();

    await updateVisualTrackerStatus(
      page,
      options.dryRun
        ? `🛡️ 正在以【安全演练模式】定位抖音订单「${cleanOrderId}」卡片与确认取消按钮...`
        : `🛑 在抖音后台确认取消订单「${cleanOrderId}」...`,
      'action'
    );
    const scope = getDouyinOrderScope(page);

    // 1. 定位订单卡片
    let orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);
    if (!orderCard) {
      await options.refreshOrderList(page, DutyOrderStatus.CANCEL);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);
    }

    if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `未在抖音订单列表中找到已取消订单「${cleanOrderId}」卡片`,
        DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        false
      );
    }

    // 2. 定位操作按钮（「我知道了」或「确认取消」或「同意退款」）
    const ackBtn = orderCard.locator(
      'button:has-text("我知道了"), ' +
      'button:has-text("确认取消"), ' +
      'button:has-text("同意退款"), ' +
      'button:has-text("确认"), ' +
      '[data-action="clear_wait_confirm"]'
    ).first();

    if (!await isElementVisible(ackBtn)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」未找到「我知道了/确认取消」操作按钮`,
        DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    // 安全演练模式处理：断言可见后安全退出，杜绝真实提交
    if (options.dryRun) {
      await updateVisualTrackerStatus(page, '✅ 取消确认按钮定位验证完毕，演练模式未执行点击', 'success');
      return {
        verified: true,
        orderId: cleanOrderId,
        action: 'confirmCancel',
        dryRun: true,
        verifiedSteps: [
          'locate_order_card',
          'locate_ack_btn',
          'assert_ack_btn_visible',
        ],
        message: `抖音订单「${cleanOrderId}」操作按钮定位验证完毕，演练模式未执行点击`,
      };
    }

    // 3. 点击按钮执行取消确认
    await visualClickLocator(page, ackBtn, `点击按钮确认取消订单「${cleanOrderId}」`);
    await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
  }
}
