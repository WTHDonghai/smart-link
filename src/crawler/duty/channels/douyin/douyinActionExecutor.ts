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
} from '../../dutyTimingConfig';
import { assertNoDouyinPageRisk } from './douyinRiskGuard';
import { getDouyinOrderScope, locateDouyinOrderCard } from './douyinCardLocator';
import { DutyOrderStatus } from '../../dutyTaskContext';

export interface DouyinActionExecutorOptions extends DutyActionDryRunOptions {
  refreshOrderList: (page: Page, orderStatus?: DutyOrderStatus) => Promise<unknown>;
}

/**
 * 抖音订单动作执行器：负责确认号回填（接单）与确认取消（我知道了）操作
 *
 * 遵循真实工作台 DOM 层次规范：
 * 1. 列表卡片 (.hotel-book-list-order-card) 仅承载文本与点击激活，卡片上无操作按钮；
 * 2. 必须点击卡片后，在详情区或触发的气泡框内执行操作；
 * 3. 填写确认号采用行内气泡确认框 (Popover Confirm)，而非模态弹窗。
 */
export class DouyinActionExecutor {
  /**
   * 在抖音后台回填确认号（基于订单卡片与详情气泡交互，防串单严格校验，支持安全演练 dryRun）
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
        : `📝 正在抖音订单「${cleanOrderId}」详情区回填确认号「${cleanConfirmNo}」...`,
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

    // 2. 必须先点击卡片展开详情展示
    await visualClickLocator(page, orderCard, `点击订单「${cleanOrderId}」卡片激活详情展示`);
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 3. 检查是否已经填入确认号 (Idempotency 幂等核对与防串单校验，对齐 smart-link-auto-queue-split confirmationStateSelector)
    const existingStateLocator = scope.locator(
      '#detailSection .max-w-\\[200px\\], .max-w-\\[200px\\]'
    ).first();

    const targetState = existingStateLocator;
    if (targetState && (await isElementVisible(targetState, ACTION_TIMEOUT.PROBE))) {
      const existingText = (await targetState.innerText().catch(() => '') || '').trim();
      if (existingText === cleanConfirmNo) {
        await updateVisualTrackerStatus(page, `✅ 抖音订单「${cleanOrderId}」已存在相同确认号「${cleanConfirmNo}」，无需重复回填`, 'success');
        if (options.dryRun) {
          return {
            verified: true,
            orderId: cleanOrderId,
            action: 'confirmImport',
            dryRun: true,
            verifiedSteps: [
              'locate_order_card',
              'activate_order_detail',
              'check_existing_confirmation',
              'already_completed',
            ],
            fieldValues: { confirmNo: cleanConfirmNo },
            message: `订单「${cleanOrderId}」已存在相同确认号「${cleanConfirmNo}」，无需重复操作`,
          };
        }
        return;
      } else if (existingText && existingText !== cleanConfirmNo) {
        throw new DutyExecutionError(
          `订单「${cleanOrderId}」已存在其他确认号「${existingText}」，系统已停止覆盖以防串单`,
          DouyinDutyErrorCode.CONFIRM_INPUT_ALREADY_FILLED,
          false
        );
      }
    }

    // 4. 定位“填写确认号”触发按钮
    const triggerBtn = scope.locator(
      '.byted-popper-trigger.byted-confirm button, ' +
      '.byted-popper-trigger.byted-confirm, ' +
      'button:has-text("填写确认号")'
    ).first();

    const isTriggerDirectlyVisible = await isElementVisible(triggerBtn, ACTION_TIMEOUT.QUICK_ACTION);

    // 若触发按钮尚未出现，检查是否处于“待接单”状态，需要先执行「接单」确认
    if (!isTriggerDirectlyVisible) {
      const acceptBtn = scope.locator(
        'button:has-text("接单"), ' +
        '[role="button"]:has-text("接单")'
      ).first();

      const isAcceptVisible = await isElementVisible(acceptBtn, ACTION_TIMEOUT.QUICK_ACTION);

      if (isAcceptVisible) {
        await updateVisualTrackerStatus(page, `🛎️ 订单「${cleanOrderId}」处于待接单状态，正在执行「接单」操作...`, 'action');

        if (options.dryRun) {
          await visualClickLocator(page, acceptBtn, `点击订单「${cleanOrderId}」接单按钮展开接单确认气泡`);
          await humanDelay(page, ...HUMAN_DELAY.SHORT);

          const acceptPopover = scope.locator('.byted-popover-confirm-inner, .byted-popover-confirm-container').first();
          const cancelBtn = acceptPopover.locator('.byted-confirm-cancel, button:has-text("取消")').first();

          if (await isElementVisible(cancelBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
            await visualClickLocator(page, cancelBtn, '安全演练收尾：取消接单气泡');
          } else if (page.keyboard && typeof page.keyboard.press === 'function') {
            await page.keyboard.press('Escape');
          }
          await humanDelay(page, ...HUMAN_DELAY.SHORT);

          return {
            verified: true,
            orderId: cleanOrderId,
            action: 'confirmImport',
            dryRun: true,
            verifiedSteps: [
              'locate_order_card',
              'activate_order_detail',
              'locate_accept_btn',
              'click_accept_btn',
              'verify_accept_popover',
              'close_popover_safely',
            ],
            fieldValues: { confirmNo: cleanConfirmNo },
            message: `订单「${cleanOrderId}」接单按钮与确认气泡验证完毕，演练模式已安全关闭`,
          };
        }

        // 真实接单流程：点击接单 -> 气泡点击确定接单
        await visualClickLocator(page, acceptBtn, `点击订单「${cleanOrderId}」接单按钮展开接单确认气泡`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);

        const acceptPopover = scope.locator('.byted-popover-confirm-inner, .byted-popover-confirm-container').first();
        if (!await isElementVisible(acceptPopover, ACTION_TIMEOUT.QUICK_ACTION)) {
          throw new DutyExecutionError(
            `订单「${cleanOrderId}」点击接单后未弹出接单确认气泡`,
            DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
            false
          );
        }

        const acceptOkBtn = acceptPopover.locator('.byted-confirm-ok, button:has-text("确定")').first();
        if (!await isElementVisible(acceptOkBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
          throw new DutyExecutionError(
            `订单「${cleanOrderId}」接单气泡内未找到确定按钮`,
            DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
            false
          );
        }

        await visualClickLocator(page, acceptOkBtn, '点击确定完成接单');
        await humanDelay(page, ...HUMAN_DELAY.SHORT);

        // 接单成功后等待填写确认号按钮出现
        await isElementVisible(triggerBtn, ACTION_TIMEOUT.QUICK_ACTION);
      }
    }

    if (!await isElementVisible(triggerBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」未找到「填写确认号/接单」触发按钮`,
        DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    await visualClickLocator(page, triggerBtn, `点击订单「${cleanOrderId}」填写确认号触发按钮`);
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 5. 定位行内气泡确认框容器 (Popover Confirm)
    const popover = scope.locator(
      '.byted-popover-confirm-inner, .byted-popover-confirm-container'
    ).first();

    if (!await isElementVisible(popover, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」未弹出或未找到确认号回填气泡`,
        DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        false
      );
    }

    // 6. 在气泡容器内定位确认号输入框，执行防串单校验与读回校验
    const targetInput = popover.locator(
      'input.byted-input[placeholder*="确认号"], input.byted-input, input[placeholder*="确认号"]'
    ).first();

    if (!await isElementVisible(targetInput, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」气泡内未找到确认号输入框`,
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

    // 7. 定位确认与取消按钮
    const confirmBtn = popover.locator('.byted-confirm-ok, button:has-text("确定")').first();
    const cancelBtn = popover.locator('.byted-confirm-cancel, button:has-text("取消")').first();

    if (!await isElementVisible(confirmBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」气泡内未找到确定提交按钮`,
        DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    // 安全演练模式处理：点击取消按钮关闭气泡并返回验证结果，杜绝真实提交
    if (options.dryRun) {
      await updateVisualTrackerStatus(page, '🛑 【安全演练收尾】正在关闭确认气泡，确保不提交任何数据...', 'action');
      if (await isElementVisible(cancelBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
        await visualClickLocator(page, cancelBtn, '安全演练收尾：取消气泡');
      } else if (page.keyboard && typeof page.keyboard.press === 'function') {
        await page.keyboard.press('Escape');
      }
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      await updateVisualTrackerStatus(page, '✅ 确认号回填流程演练验证完毕，已安全关闭气泡', 'success');
      return {
        verified: true,
        orderId: cleanOrderId,
        action: 'confirmImport',
        dryRun: true,
        verifiedSteps: [
          'locate_order_card',
          'activate_order_detail',
          'click_trigger_btn',
          'verify_popover',
          'fill_confirm_no',
          'verify_submit_btn',
          'close_popover_safely',
        ],
        fieldValues: { confirmNo: cleanConfirmNo },
      };
    }

    await visualClickLocator(page, confirmBtn, `点击气泡确定提交按钮确认订单「${cleanOrderId}」`);
    await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
  }

  /**
   * 在抖音后台确认取消（我知道了，支持安全演练 dryRun）
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

    await assertNoDouyinPageRisk(page);

    await updateVisualTrackerStatus(
      page,
      options.dryRun
        ? `🛡️ 正在以【安全演练模式】定位抖音已取消订单「${cleanOrderId}」卡片与确认取消按钮...`
        : `🛑 在抖音后台确认取消订单「${cleanOrderId}」...`,
      'action'
    );
    const scope = getDouyinOrderScope(page);

    // 1. 定位订单卡片，若未找到则以 DutyOrderStatus.CANCEL 刷新重试
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

    // 2. 必须先点击卡片展开详情
    await visualClickLocator(page, orderCard, `点击已取消订单「${cleanOrderId}」卡片激活详情展示`);
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 3. 校验订单状态是否属于已取消/已退款集合 (对齐 smart-link-auto-queue-split cancelledStatusTexts 契约)
    const statusTextLocator = scope.locator(
      '#detailSection .trade_cell_label:has-text("订单状态") + .cell_content, ' +
      '#detailSection .byted-tag, ' +
      '#detailSection span:has-text("已取消"), ' +
      '#detailSection span:has-text("已退款")'
    ).first();

    if (await isElementVisible(statusTextLocator, ACTION_TIMEOUT.PROBE)) {
      const statusText = (await statusTextLocator.innerText().catch(() => '')).trim();
      const isCancelledOrRefunded = statusText.includes('已取消') || statusText.includes('已退款');
      if (statusText && !isCancelledOrRefunded && (
        statusText.includes('待接单') ||
        statusText.includes('已确认') ||
        statusText.includes('已接待') ||
        statusText.includes('待处理')
      )) {
        throw new DutyExecutionError(
          `订单「${cleanOrderId}」当前状态为「${statusText}」，不属于已取消或已退款订单，无法执行取消确认`,
          DouyinDutyErrorCode.ORDER_STATUS_NOT_MATCHED,
          false
        );
      }
    }

    // 4. 定位确认取消按钮（在详情中，真实 DOM 确定性文案为「我知道了」）
    const ackBtn = scope.locator(
      'button:has-text("我知道了"), ' +
      '[role="button"]:has-text("我知道了")'
    ).first();

    if (!await isElementVisible(ackBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」未找到「我知道了」操作按钮`,
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
          'activate_order_detail',
          'locate_ack_btn',
          'assert_ack_btn_visible',
        ],
        message: `抖音订单「${cleanOrderId}」操作按钮定位验证完毕，演练模式未执行点击`,
      };
    }

    // 5. 点击按钮执行取消确认
    await visualClickLocator(page, ackBtn, `点击按钮确认取消订单「${cleanOrderId}」`);
    await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
  }
}
