import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import {
  KeyRound,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  startDeviceLogin,
  cancelDeviceLogin,
} from '../../store/slices/authSlice';
import { showToast } from '../../store/slices/appSlice';
import { logger } from '../../services/logger';
import { XiruanLogoMark } from '../common/XiruanLogo';
import { FriendlyErrorAlert } from '../common/FriendlyErrorAlert';
import { normalizeAppError } from '../../utils/errorNormalizer';

export const PlatformLoginView: React.FC = () => {
  const dispatch = useAppDispatch();
  const {
    platformBaseUrl,
    deviceCodeInfo,
    isAuthorizing,
    failureReason,
  } = useAppSelector((state) => state.auth);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleStartLogin = useCallback(async () => {
    abortControllerRef.current = new AbortController();

    try {
      logger.track('AUTH_LOGIN_START', {
        module: 'AUTH',
        level: 'INFO',
        message: '[Auth] 正在向文旅大中台申请设备授权凭证...',
        details: `请求网关: ${platformBaseUrl}`,
      });

      const resultAction = await dispatch(
        startDeviceLogin({
          baseUrl: platformBaseUrl,
          signal: abortControllerRef.current.signal,
        })
      );

      if (startDeviceLogin.fulfilled.match(resultAction)) {
        logger.track('AUTH_LOGIN_SUCCESS', {
          module: 'AUTH',
          level: 'SUCCESS',
          message: `[Auth] 文旅平台授权成功 (租户: ${resultAction.payload.tenantId})`,
          details: `已获取有效 AccessToken 并持久化，租户: ${resultAction.payload.tenantId}`,
          meta: { tenantId: resultAction.payload.tenantId },
        });

        dispatch(
          showToast({
            title: '授权成功',
            description: `文旅平台已成功连接 (租户: ${resultAction.payload.tenantId})`,
            type: 'success',
          })
        );
      } else if (startDeviceLogin.rejected.match(resultAction)) {
        const errorText = resultAction.payload || '授权请求失败';
        logger.track('AUTH_LOGIN_FAILED', {
          module: 'AUTH',
          level: 'ERROR',
          message: `[Auth] 文旅平台授权失败: ${errorText}`,
          details: errorText,
          meta: { errorText },
        });
      }
    } catch {
      // 错误已由 Redux extraReducer 记录并在界面展现
    }
  }, [dispatch, platformBaseUrl]);

  const handleCancelLogin = useCallback(() => {
    abortControllerRef.current?.abort();
    dispatch(cancelDeviceLogin());
  }, [dispatch]);

  const handleOpenBrowser = useCallback(() => {
    if (!deviceCodeInfo?.verificationUri) return;
    window.open(deviceCodeInfo.verificationUri, '_blank', 'noopener,noreferrer');
  }, [deviceCodeInfo]);

  // 基于单一可信错误源 failureReason 派生标准错误对象，严格杜绝双重冗余与隐式兜底
  const displayError = useMemo(
    () => (failureReason ? normalizeAppError(failureReason, 'AUTH') : null),
    [failureReason]
  );

  return (
    <div className="min-h-screen w-full bg-[#f8f9ff] flex flex-col justify-between items-center p-4 sm:p-6 antialiased selection:bg-[#004ac6] selection:text-white">
      {/* 顶部极简品牌条 */}
      <header className="w-full max-w-5xl flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <XiruanLogoMark className="w-9 h-9 text-[#004ac6] shadow-sm rounded-xl" />
          <div>
            <h1 className="text-base font-bold text-[#0b1c30] tracking-tight font-headline">
              Smart Link
            </h1>
            <p className="text-[11px] text-[#737686]">
              西软智能 OTA 搬单后台系统
            </p>
          </div>
        </div>
      </header>

      {/* 主登录门禁卡片 */}
      <main className="w-full max-w-md my-auto">
        <div className="bg-white border border-[#e2e8f0] rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
          {/* 卡片头部说明 */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#eff4ff] text-[#004ac6] border border-[#dce9ff] mb-1">
              <KeyRound className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-[#0b1c30] font-headline">
              {isAuthorizing ? '等待授权完成' : '登录文旅平台'}
            </h2>
            <p className="text-xs text-[#737686] leading-relaxed">
              {isAuthorizing
                ? '已在外部浏览器打开授权页面，请在网页中完成登录并确认授权。'
                : '连接西软文旅平台，开启订单与房态自动同步。'}
            </p>
          </div>

          {/* 统一规范的异常提示卡片 */}
          {displayError && !isAuthorizing && (
            <FriendlyErrorAlert
              error={displayError}
              onRetry={handleStartLogin}
            />
          )}

          {/* 状态一：准备授权，仅放置单一核心授权登录按钮 */}
          {!isAuthorizing && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleStartLogin}
                className="w-full h-11 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] rounded-xl transition-all cursor-pointer shadow-sm shadow-blue-500/20"
              >
                <KeyRound className="w-4 h-4" />
                授权登录
              </button>
            </div>
          )}

          {/* 状态二：正在等待外部浏览器授权确认 - 简洁干净的 loading 动效 */}
          {isAuthorizing && (
            <div className="space-y-6 animate-fadeIn pt-2">
              <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
                <Loader2 className="w-7 h-7 text-[#004ac6] animate-spin" />
                <p className="text-xs text-[#737686]">
                  正在等待授权结果，完成后将自动进入系统...
                </p>
              </div>

              {/* 辅助操作：重新打开网页与取消操作 */}
              <div className="space-y-2 pt-2 border-t border-[#f1f5f9]">
                <button
                  type="button"
                  onClick={handleOpenBrowser}
                  className="w-full h-10 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-[#004ac6] bg-[#eff4ff] hover:bg-[#dce9ff] active:bg-[#d0e2ff] rounded-xl transition-all cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  重新打开授权页
                </button>

                <button
                  type="button"
                  onClick={handleCancelLogin}
                  className="w-full h-8 inline-flex items-center justify-center text-xs text-[#737686] hover:text-[#0b1c30] transition-colors cursor-pointer"
                >
                  取消授权并返回
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

    </div>
  );
};
