import type { Page } from 'playwright';
import { logger } from '@/src/services/logger';
import { updateVisualTrackerStatus, visualClickLocator } from '@/src/crawler/visualTracker';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  getScaledTimeout,
  humanDelay,
  isElementVisible,
} from '../../dutyTimingConfig';
import { assertNoDouyinPageRisk } from './douyinRiskGuard';
import { dismissDouyinNoticeModals } from './douyinModalGuard';
import { getDouyinOrderScope, locateDouyinOrderCard } from './douyinCardLocator';
import {
  isDouyinOrderDetailUrl,
  isDouyinRiskControlText,
} from './douyinOrderParsers';

export interface DouyinDetailInspectorOptions {
  refreshOrderList: (page: Page) => Promise<unknown>;
}

/**
 * 抖音订单详情查看器：负责卡片定位、展开交互、网络响应预拦截与权威原始报文获取
 */
export class DouyinDetailInspector {
  /**
   * 在抖音后台页面定位订单卡片并展开/查看详情，抓取详情原始数据
   * 遵循 Fail-Fast 原则：100% 权威网络接口为源，只返回原始数据，零 DOM 业务数据拼接
   */
  public async inspectOrderDetail(
    page: Page,
    otaOrderId: string,
    options: DouyinDetailInspectorOptions
  ): Promise<Record<string, unknown>> {
    await assertNoDouyinPageRisk(page);

    const cleanOrderId = String(otaOrderId || '').trim();
    if (!cleanOrderId) {
      throw new DutyExecutionError(
        'otaOrderId 不能为空',
        DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        false
      );
    }

    await updateVisualTrackerStatus(page, `🔍 正在定位抖音订单「${cleanOrderId}」卡片并展示详情...`, 'action');
    logger.info(`[抖音详情] 开始定位订单「${cleanOrderId}」卡片并准备抓取权威详情报文`, {
      module: 'DUTY_TASK',
      channelId: 'DOUYIN',
      orderNo: cleanOrderId,
    });

    const scope = getDouyinOrderScope(page);

    // 1. 预先挂载本次查看详情专属的网络响应监听（单次 waitForResponse 弹性等待 + on('response') 兜底记录）
    let capturedDetail: Record<string, unknown> | null = null;
    const diagnosis: {
      observedResponsesCount: number;
      lastObservedUrl?: string;
      lastObservedStatus?: number;
      failureReason?: string;
      waitForResponseError?: string;
    } = {
      observedResponsesCount: 0,
    };

    const isTargetDetail = (url: string) => {
      return (
        isDouyinOrderDetailUrl(url) ||
        url.includes(cleanOrderId) ||
        url.includes('detail') ||
        url.includes('query')
      );
    };

    const parseDetailResponse = async (
      res: { url: () => string; status: () => number; text: () => Promise<string> },
      source: 'waitForResponse' | 'onResponse'
    ): Promise<Record<string, unknown> | null> => {
      if (capturedDetail) return capturedDetail;
      try {
        const url = res.url();
        const status = res.status();
        diagnosis.observedResponsesCount++;
        diagnosis.lastObservedUrl = url;
        diagnosis.lastObservedStatus = status;

        if (status !== 200) {
          diagnosis.failureReason = `详情接口返回异常 HTTP 状态码: ${status}`;
          logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情接口返回非 200 响应 (HTTP ${status}, 来源: ${source})`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
            httpStatus: status,
            apiUrl: url,
          });
          return null;
        }

        const text = await res.text().catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn(`[抖音详情] 订单「${cleanOrderId}」读取详情响应文本失败: ${errMsg}`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
            apiUrl: url,
            meta: { error: errMsg },
          });
          return '';
        });

        if (!text) {
          diagnosis.failureReason = '详情接口响应体为空';
          logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情接口响应体为空 (URL: ${url})`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
            apiUrl: url,
          });
          return null;
        }

        if (isDouyinRiskControlText(text)) {
          diagnosis.failureReason = '详情接口报文命中安全验证/风控特征';
          logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情接口报文命中安全验证/风控特征`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
            apiUrl: url,
          });
          return null;
        }

        if (!text.includes(cleanOrderId)) {
          try {
            const json = JSON.parse(text);
            if (json && typeof json === 'object' && json.status_code !== undefined && json.status_code !== 0) {
              const msg = String(json.status_msg || '无详细错误信息');
              diagnosis.failureReason = `详情接口返回业务错误 (code: ${json.status_code}, msg: ${msg})`;
              logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情接口业务报错: code=${json.status_code}, msg=${msg}`, {
                module: 'DUTY_TASK',
                channelId: 'DOUYIN',
                orderNo: cleanOrderId,
                apiUrl: url,
                meta: { statusCode: json.status_code, statusMsg: msg },
              });
            } else {
              diagnosis.failureReason = `详情接口响应不包含目标单号「${cleanOrderId}」`;
              logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情响应未匹配到目标订单编号 (来源: ${source})`, {
                module: 'DUTY_TASK',
                channelId: 'DOUYIN',
                orderNo: cleanOrderId,
                apiUrl: url,
              });
            }
          } catch {
            diagnosis.failureReason = '详情接口返回非合法 JSON 内容（可能为 HTML 重定向或网关报错）';
            logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情响应非合法 JSON`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              orderNo: cleanOrderId,
              apiUrl: url,
            });
          }
          return null;
        }

        // 仅拦截并返回原始网络报文对象，业务解析解包交由下游清洗层处理
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object') {
            diagnosis.failureReason = '详情接口返回非对象类型的 JSON 报文';
            logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情接口返回非对象 JSON`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              orderNo: cleanOrderId,
              apiUrl: url,
            });
            return null;
          }

          logger.info(`[抖音详情] 订单「${cleanOrderId}」权威详情网络原始报文捕获成功 (来源: ${source})`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
            apiUrl: url,
          });
          return parsed as Record<string, unknown>;
        } catch (err) {
          const parseErrMsg = err instanceof Error ? err.message : String(err);
          diagnosis.failureReason = `详情响应 JSON 反序列化失败: ${parseErrMsg}`;
          logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情 JSON 解析失败: ${parseErrMsg}`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
            apiUrl: url,
            meta: { error: parseErrMsg },
          });
          return null;
        }
      } catch (err) {
        const unhandledErrMsg = err instanceof Error ? err.message : String(err);
        diagnosis.failureReason = `处理详情响应异常: ${unhandledErrMsg}`;
        logger.warn(`[抖音详情] 订单「${cleanOrderId}」处理详情响应抛出异常: ${unhandledErrMsg}`, {
          module: 'DUTY_TASK',
          channelId: 'DOUYIN',
          orderNo: cleanOrderId,
          meta: { error: unhandledErrMsg },
        });
        return null;
      }
    };

    const onResponse = async (res: { url: () => string; status: () => number; text: () => Promise<string> }) => {
      try {
        if (isTargetDetail(res.url())) {
          const extracted = await parseDetailResponse(res, 'onResponse');
          if (extracted) {
            capturedDetail = extracted;
          }
        }
      } catch {
        // 忽略监听异常
      }
    };

    const onFn = (page as { on?: (event: string, handler: typeof onResponse) => void }).on;
    const offFn = (page as { off?: (event: string, handler: typeof onResponse) => void }).off;
    const removeListenerFn = (
      page as { removeListener?: (event: string, handler: typeof onResponse) => void }
    ).removeListener;

    if (typeof onFn === 'function') {
      onFn.call(page, 'response', onResponse);
    }

    const detailResponsePromise = typeof page.waitForResponse === 'function'
      ? page
          .waitForResponse(
            (res) => {
              try {
                if (isTargetDetail(res.url())) {
                  const status = res.status();
                  if (status !== 200) {
                    diagnosis.lastObservedStatus = status;
                    diagnosis.lastObservedUrl = res.url();
                    diagnosis.failureReason = `详情接口返回异常 HTTP 状态码: ${status}`;
                    logger.warn(`[抖音详情] 订单「${cleanOrderId}」收到非 200 响应 (HTTP ${status})`, {
                      module: 'DUTY_TASK',
                      channelId: 'DOUYIN',
                      orderNo: cleanOrderId,
                      httpStatus: status,
                      apiUrl: res.url(),
                    });
                  }
                  return status === 200;
                }
                return false;
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                logger.warn(`[抖音详情] 订单「${cleanOrderId}」判定响应时异常: ${errMsg}`, {
                  module: 'DUTY_TASK',
                  channelId: 'DOUYIN',
                  orderNo: cleanOrderId,
                  meta: { error: errMsg },
                });
                return false;
              }
            },
            { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
          )
          .then((res) => parseDetailResponse(res, 'waitForResponse'))
          .catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            diagnosis.waitForResponseError = errMsg;
            logger.warn(`[抖音详情] 订单「${cleanOrderId}」waitForResponse 监听等待未完成: ${errMsg}`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              orderNo: cleanOrderId,
              meta: { error: errMsg },
            });
            return null;
          })
      : Promise.resolve(null);

    try {
      // 2. 定位目标订单卡片，若未可见先刷新列表确保处于最新视图
      let orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);

      if (!orderCard) {
        await updateVisualTrackerStatus(
          page,
          `🔄 列表中未直接发现订单「${cleanOrderId}」，正在刷新列表...`,
          'action'
        );
        await options.refreshOrderList(page);
        await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
        orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);
      }

      if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
        await assertNoDouyinPageRisk(page);
        throw new DutyExecutionError(
          `待处理列表中未找到抖音订单「${cleanOrderId}」卡片，订单可能已被处理或取消`,
          DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
          false
        );
      }

      // 3. 点击订单卡片或“详情”入口展开详情
      const detailTrigger = orderCard.locator(
        'a:has-text("详情"), button:has-text("详情"), [class*="detail"], a[href*="detail"]'
      ).first();

      if (await isElementVisible(detailTrigger, ACTION_TIMEOUT.ELEMENT)) {
        await visualClickLocator(page, detailTrigger, `点击订单「${cleanOrderId}」详情链接`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      } else {
        await visualClickLocator(page, orderCard, `点击订单「${cleanOrderId}」卡片展开详情`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      }

      // 4. 敏感信息脱敏解除交互（如查看真实姓名/手机号或小眼睛图标）
      try {
        const revealBtn = scope.locator(
          '.reveal-name, [data-test="reveal-name"], button:has-text("查看姓名"), [class*="icon-eye"], [class*="eye-open"]'
        ).first();
        if (await isElementVisible(revealBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
          await visualClickLocator(page, revealBtn, '点击查看脱敏信息');
          await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);
        }
      } catch {
        // 容错脱敏解除
      }

      // 5. 权威网络数据捕获校验（Fail-Fast：详情必须由真实的详情网络接口提供，严禁隐式兜底）
      const rawDetail =
        (await detailResponsePromise) ||
        (capturedDetail as Record<string, unknown> | null);

      if (!rawDetail) {
        let failureDiagnosis = '网络响应超时且未捕获到原始报文';
        if (diagnosis.failureReason) {
          failureDiagnosis = diagnosis.failureReason;
        } else if (diagnosis.lastObservedStatus && diagnosis.lastObservedStatus !== 200) {
          failureDiagnosis = `接口曾返回 HTTP ${diagnosis.lastObservedStatus}`;
        } else if (diagnosis.observedResponsesCount === 0) {
          failureDiagnosis = '未收到任何详情 HTTP 响应包，请求可能未发起或网络挂起';
        } else if (diagnosis.waitForResponseError) {
          failureDiagnosis = `网络等待异常: ${diagnosis.waitForResponseError}`;
        }

        logger.error(`[抖音详情] 抖音订单「${cleanOrderId}」获取详情失败: ${failureDiagnosis}`, {
          module: 'DUTY_TASK',
          channelId: 'DOUYIN',
          orderNo: cleanOrderId,
          details: failureDiagnosis,
          meta: {
            observedCount: diagnosis.observedResponsesCount,
            lastObservedStatus: diagnosis.lastObservedStatus,
            lastObservedUrl: diagnosis.lastObservedUrl,
            waitForResponseError: diagnosis.waitForResponseError,
          },
        });

        await assertNoDouyinPageRisk(page);
        throw new DutyExecutionError(
          `抖音订单「${cleanOrderId}」详情网络响应超时或未捕获到原始报文（诊断原因: ${failureDiagnosis}）`,
          DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
          true
        );
      }

      let resultDetail: Record<string, unknown> = { ...rawDetail };

      // 6. 敏感信息自动解密尝试（对标参考项目：若存在手机号密文则调用官方 decrypt 接口）
      try {
        const rawString = JSON.stringify(rawDetail);
        const hasUnmaskedPhone = /\\?"phone\\?"\s*:\s*\\?"1[3-9]\d{9}\\?"/.test(rawString);
        const cipherMatch = rawString.match(/\\?"phone_ciphertext\\?"\s*:\s*\\?"([^\\"]+)/);
        const ciphertext = cipherMatch ? cipherMatch[1] : '';

        if (ciphertext && !hasUnmaskedPhone && typeof page.evaluate === 'function') {
          const decryptedPhone = await page.evaluate(async (cipher) => {
            try {
              const res = await fetch('/life/trade_view/v1/commmon/decrypt_data', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ encrypted_data: cipher }),
              });
              if (!res.ok) return null;
              const json = await res.json();
              const statusCode = json?.status_code ?? json?.BaseResp?.StatusCode;
              if (statusCode !== 0 && statusCode !== undefined) return null;
              const raw = String(json?.decrypte_data ?? json?.decrypted_data ?? json?.data ?? '').trim();
              const digits = raw.replace(/[^\d]/g, '').replace(/^86(?=1\d{10}$)/, '');
              return /^1\d{10}$/.test(digits) ? digits : null;
            } catch {
              return null;
            }
          }, ciphertext).catch(() => null);

          if (decryptedPhone) {
            logger.info(`[抖音详情] 订单「${cleanOrderId}」密文手机号解密成功`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              orderNo: cleanOrderId,
            });
            // 复制一份副本并挂载 decryptedPhone，不强行侵入业务实体结构
            resultDetail = JSON.parse(JSON.stringify(rawDetail)) as Record<string, unknown>;
            resultDetail.decryptedPhone = decryptedPhone;
            // 若原始数据本身是已解包的单条实体且含 guest_info，顺带更新保持就地一致性
            const guestInfo = (resultDetail.guest_info || {}) as Record<string, unknown>;
            const userList = Array.isArray(guestInfo.user_list) ? guestInfo.user_list : [];
            if (userList[0]) {
              (userList[0] as Record<string, unknown>).phone = decryptedPhone;
            }
          }
        }
      } catch {
        // 容错密文解密，Fail-Fast 保证在后续清洗与入单校验中严格把控
      }

      return resultDetail;
    } finally {
      if (typeof offFn === 'function') {
        offFn.call(page, 'response', onResponse);
      } else if (typeof removeListenerFn === 'function') {
        removeListenerFn.call(page, 'response', onResponse);
      }
      await dismissDouyinNoticeModals(page, scope).catch(() => false);
    }
  }
}
