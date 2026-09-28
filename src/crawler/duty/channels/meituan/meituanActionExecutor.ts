import type { Page, Response } from 'playwright';
import { updateVisualTrackerStatus, visualClickLocator } from '@/src/crawler/visualTracker';
import type { DutyActionDryRunOptions, DutyActionVerificationResult } from '../../dutyContracts';
import {
  MeituanDutyErrorCode,
  DutyExecutionError,
} from './meituanDutyContracts';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  humanDelay,
  isProbeVisible,
  isElementVisible,
  isModalVisible,
} from '../../dutyTimingConfig';
import { assertNoMeituanPageRisk } from './meituanRiskGuard';
import { getMeituanOrderScope, locateMeituanOrderCard } from './meituanCardLocator';

export interface ActionExecutorOptions extends DutyActionDryRunOptions {
  refreshOrderList: (page: Page) => Promise<Response>;
}

/**
 * 美团订单动作执行器：负责确认号回填（接单）与确认取消（我已知晓）操作
 */
export class MeituanActionExecutor {
  /**
   * 在美团后台回填确认号（基于订单卡片/详情内联交互，防串单严格校验，支持安全演练 dryRun）
   */
  public async confirmImport(
    page: Page,
    confirmNo: string,
    otaOrderId: string,
    options: ActionExecutorOptions & { dryRun: true }
  ): Promise<DutyActionVerificationResult>;
  public async confirmImport(
    page: Page,
    confirmNo: string,
    otaOrderId: string,
    options: ActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void>;
  public async confirmImport(
    page: Page,
    confirmNo: string,
    otaOrderId: string,
    options: ActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void> {
    await assertNoMeituanPageRisk(page);

    const cleanConfirmNo = String(confirmNo || '').trim();
    if (!cleanConfirmNo) {
      throw new DutyExecutionError('确认号不能为空', MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND, false);
    }

    await updateVisualTrackerStatus(
      page,
      options.dryRun
        ? `🛡️ 正在以【安全演练模式】验证订单「${otaOrderId}」卡片与确认号「${cleanConfirmNo}」输入框...`
        : `📝 正在订单「${otaOrderId}」卡片内回填确认号「${cleanConfirmNo}」...`,
      'action'
    );

    const scope = getMeituanOrderScope(page);

    // 1. 定位目标订单卡片，若不可见先刷新待确认列表
    let orderCard = await locateMeituanOrderCard(page, scope, otaOrderId);
    if (!orderCard) {
      await options.refreshOrderList(page);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      orderCard = await locateMeituanOrderCard(page, scope, otaOrderId);
    }

    if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
      await assertNoMeituanPageRisk(page);
      throw new DutyExecutionError(
        `未找到美团订单「${otaOrderId}」卡片，无法回填确认号`,
        MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND,
        false
      );
    }

    // 2. 确保右侧详情已就绪展示该订单；若未展示，点击卡片切换详情
    const isCurrentDetail = await isProbeVisible(
      scope.locator(`.detail-header:has-text("${otaOrderId}")`).first()
    );
    if (!isCurrentDetail) {
      await visualClickLocator(page, orderCard, `点击订单「${otaOrderId}」卡片激活详情展示`);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
    }

    // 3. 定位详情头部「接受」接单操作按钮并点击，触发展开模态确认对话框
    const acceptBtn = scope.locator(
      '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"), ' +
      '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"), ' +
      '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")'
    ).first();

    if (!await isElementVisible(acceptBtn)) {
      throw new DutyExecutionError(
        `订单「${otaOrderId}」未找到「接受」接单操作按钮`,
        MeituanDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    await visualClickLocator(page, acceptBtn, `点击订单「${otaOrderId}」接受按钮弹出确认回填框`);
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 4. 等待并严格限定「确认号回填」模态弹窗（必须包含“酒店确认号”，杜绝匹配到页面其他业务弹窗）
    const dialog = scope.locator(
      '.mtd-modal-wrapper:not([style*="display: none"]) .modal-container:has-text("酒店确认号"), ' +
      '.modal-container:has-text("酒店确认号")'
    ).first();

    if (!await isModalVisible(dialog)) {
      throw new DutyExecutionError(
        `订单「${otaOrderId}」未弹出或未找到「酒店确认号」接单弹窗`,
        MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        false
      );
    }

    // 5. 严格限定在接单弹窗内部定位「酒店确认号」输入框，执行防串单校验与读回校验
    const targetInput = dialog.locator(
      '.modal-container-content div:has(span:has-text("酒店确认号")) input.mtd-input, ' +
      '.modal-container-content input.mtd-input'
    ).first();

    if (!await isElementVisible(targetInput)) {
      throw new DutyExecutionError(
        `订单「${otaOrderId}」接单弹窗内未找到酒店确认号输入框`,
        MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        false
      );
    }

    const currentValue = (await targetInput.inputValue().catch(() => '')).trim();
    if (currentValue && currentValue !== cleanConfirmNo) {
      throw new DutyExecutionError(
        `订单「${otaOrderId}」输入框已存在其他确认号「${currentValue}」，系统已停止覆盖以防串单`,
        MeituanDutyErrorCode.CONFIRM_INPUT_ALREADY_FILLED,
        false
      );
    }

    if (currentValue !== cleanConfirmNo) {
      if (typeof targetInput.pressSequentially === 'function') {
        await targetInput.click().catch(() => {});
        await targetInput.pressSequentially(cleanConfirmNo, {
          delay: 35 + Math.floor(Math.random() * 40),
        });
      } else {
        await targetInput.fill(cleanConfirmNo);
      }
      const readBack = (await targetInput.inputValue().catch(() => '')).trim();
      if (readBack !== cleanConfirmNo) {
        throw new DutyExecutionError(
          `订单「${otaOrderId}」确认号填入后读回校验不一致 (写入: ${cleanConfirmNo}, 读回: ${readBack})`,
          MeituanDutyErrorCode.CONFIRM_VALUE_MISMATCH,
          false
        );
      }
    }

    // 6. 严格限定在接单弹窗底部（.modal-container-footer）定位「确认接受」按钮
    const dialogConfirmBtn = dialog.locator(
      '.modal-container-footer button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")'
    ).first();

    if (!await isElementVisible(dialogConfirmBtn)) {
      throw new DutyExecutionError(
        `订单「${otaOrderId}」接单弹窗内未找到「确认接受」操作按钮`,
        MeituanDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        false
      );
    }

    // 安全演练模式处理：安全关闭弹窗并返回验证结果，杜绝真实提交
    if (options.dryRun) {
      await updateVisualTrackerStatus(page, '🛑 【安全演练收尾】正在点击「取消」按钮关闭弹窗，确保不提交任何数据...', 'action');
      const cancelBtn = dialog.locator('.modal-container-footer button:has-text("取消"), .mtd-modal-close').first();
      if (await isElementVisible(cancelBtn, ACTION_TIMEOUT.QUICK_ACTION)) {
        await visualClickLocator(page, cancelBtn, '安全演练收尾：取消弹窗');
      } else {
        await page.keyboard.press('Escape');
      }
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      await updateVisualTrackerStatus(page, '✅ 确认号回填流程演练验证完毕，已安全关闭弹窗', 'success');
      return {
        verified: true,
        orderId: otaOrderId,
        action: 'confirmImport',
        dryRun: true,
        verifiedSteps: [
          'locate_order_card',
          'open_detail',
          'click_accept_btn',
          'verify_modal_dialog',
          'fill_confirm_no',
          'verify_submit_btn',
          'close_dialog_safely',
        ],
        fieldValues: { confirmNo: cleanConfirmNo },
      };
    }

    await visualClickLocator(page, dialogConfirmBtn, `点击弹窗「确认接受」按钮确认订单「${otaOrderId}」`);
    await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
  }

  /**
   * 在美团后台确认取消（我已知晓，支持安全演练 dryRun）
   */
  public async confirmCancel(
    page: Page,
    otaOrderId: string,
    options: ActionExecutorOptions & { dryRun: true }
  ): Promise<DutyActionVerificationResult>;
  public async confirmCancel(
    page: Page,
    otaOrderId: string,
    options: ActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void>;
  public async confirmCancel(
    page: Page,
    otaOrderId: string,
    options: ActionExecutorOptions
  ): Promise<DutyActionVerificationResult | void> {
    if (!otaOrderId || !otaOrderId.trim()) {
      throw new DutyExecutionError('otaOrderId 不能为空', MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND, false);
    }
    const cleanOrderId = otaOrderId.trim();

    await updateVisualTrackerStatus(
      page,
      options.dryRun
        ? `🛡️ 正在以【安全演练模式】定位美团订单「${cleanOrderId}」卡片与「我已知晓」按钮...`
        : `🛑 在美团后台确认取消订单「${cleanOrderId}」（我已知晓）...`,
      'action'
    );
    const scope = getMeituanOrderScope(page);

    // 1. 定位订单卡片
    let orderCard = await locateMeituanOrderCard(page, scope, cleanOrderId);
    if (!orderCard) {
      await options.refreshOrderList(page);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
      orderCard = await locateMeituanOrderCard(page, scope, cleanOrderId);
    }

    if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
      throw new DutyExecutionError(
        `未在美团订单列表中找到已取消订单「${cleanOrderId}」卡片`,
        MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND,
        true
      );
    }

    // 2. 检查右侧详情是否已就绪展示该订单；若未展示，点击卡片切换详情
    const isCurrentDetail = await isProbeVisible(
      scope.locator(`.detail-header:has-text("${cleanOrderId}")`).first()
    );
    if (!isCurrentDetail) {
      await visualClickLocator(page, orderCard, `点击订单「${cleanOrderId}」卡片激活详情展示`);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);
    }

    // 3. 定位详情头部操作按钮区域中的「我已知晓」按钮
    const ackBtn = scope.locator(
      '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓"), ' +
      '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓"), ' +
      '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")'
    ).first();

    if (!await isElementVisible(ackBtn)) {
      throw new DutyExecutionError(
        `订单「${cleanOrderId}」详情头部未找到「我已知晓」确认取消操作按钮（请确认该订单是否为已取消订单）`,
        MeituanDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
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
          'open_detail',
          'locate_ack_btn',
          'assert_ack_btn_visible',
        ],
        message: `订单「${cleanOrderId}」详情「我已知晓」操作按钮定位验证完毕，演练模式未执行点击`,
      };
    }

    // 4. 点击「我已知晓」执行取消确认
    await visualClickLocator(page, ackBtn, `点击「我已知晓」按钮确认取消订单「${cleanOrderId}」`);
    await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
  }
}
