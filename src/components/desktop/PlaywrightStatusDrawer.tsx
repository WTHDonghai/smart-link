import React from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  setPlaywrightModalOpen, 
  togglePlaywrightRunning, 
  updatePlaywrightConfig, 
  showToast 
} from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { 
  X, 
  Bot, 
  Cpu, 
  KeyRound, 
  RefreshCw, 
  Play, 
  Pause, 
  CheckCircle2, 
  AlertCircle,
  Sparkles
} from 'lucide-react';

export const PlaywrightStatusDrawer: React.FC = () => {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.app.playwrightModalOpen);
  const config = useAppSelector((state) => state.app.playwrightConfig);

  if (!isOpen) return null;

  const handleToggleRunning = () => {
    dispatch(togglePlaywrightRunning());
    dispatch(showToast({
      title: !config.isRunning ? 'Playwright 自动化采集服务已启动' : 'Playwright 自动化采集服务已休眠',
      description: !config.isRunning ? 'Chromium 4 线程长轮询守护已恢复' : '各 OTA 渠道抓取轮询已挂起',
      type: !config.isRunning ? 'success' : 'info'
    }));
  };

  const handleRefreshCookies = (channelId: string, accountName: string) => {
    dispatch(showToast({
      title: `刷新「${accountName}」登录态`,
      description: 'Playwright 无头浏览器正在执行自动维持心跳与 Session 续约...',
      type: 'info'
    }));
    setTimeout(() => {
      dispatch(showToast({
        title: `「${accountName}」Session 续约成功`,
        description: '有效时长延长 72 小时，自动搬单无阻碍',
        type: 'success'
      }));
      dispatch(addLog({
        level: 'PLAYWRIGHT',
        channelId,
        message: `[Playwright:SessionKeeper] Cookie renewal completed for ${accountName}. Session token updated.`
      }));
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#dce9ff] w-full max-w-2xl overflow-hidden flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-[#eff4ff] bg-[#f8f9ff] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#004ac6] text-white flex items-center justify-center shadow-xs">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0b1c30]">
                Playwright OTA 自动采集引擎配置
              </h2>
              <p className="text-xs text-[#434655]">
                基于 Playwright Headless Chromium 的无感订单拦截与房态爬虫守护核心
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dispatch(setPlaywrightModalOpen(false))}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#737686] hover:bg-[#dce9ff] hover:text-[#0b1c30]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          {/* Main Toggle Banner */}
          <div className="p-4 rounded-xl border border-[#dce9ff] bg-[#eff4ff]/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                {config.isRunning ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                )}
              </span>
              <div>
                <span className="text-sm font-bold text-[#0b1c30]">
                  守护采集引擎当前状态：{config.isRunning ? '正在持续轮询' : '已暂停'}
                </span>
                <p className="text-xs text-[#737686]">
                  {config.isRunning ? '后台 4 组 Chromium Context 持续监听 OTA 商家端消息与 Webhook' : '暂停时不会自动抓单'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleRunning}
              className={`px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all cursor-pointer flex items-center gap-1.5 ${
                config.isRunning ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#004ac6] hover:bg-[#2563eb]'
              }`}
            >
              {config.isRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>暂停采集</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>启动采集</span>
                </>
              )}
            </button>
          </div>

          {/* Engine Parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl border border-[#dce9ff] bg-white space-y-2">
              <label className="text-xs font-semibold text-[#0b1c30] flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-[#004ac6]" />
                <span>Chromium 进程并发数</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={config.workerCount}
                  onChange={(e) => dispatch(updatePlaywrightConfig({ workerCount: Number(e.target.value) }))}
                  className="flex-1 accent-[#004ac6]"
                />
                <span className="text-xs font-mono font-bold bg-[#eff4ff] text-[#004ac6] px-2 py-0.5 rounded">
                  {config.workerCount} 线程
                </span>
              </div>
              <p className="text-[11px] text-[#737686]">多线程隔离各平台 Cookie，避免风控关联</p>
            </div>

            <div className="p-3.5 rounded-xl border border-[#dce9ff] bg-white space-y-2">
              <label className="text-xs font-semibold text-[#0b1c30] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#004ac6]" />
                <span>智能滑块与验证码自动过检</span>
              </label>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-[#434655]">极验 / 美团双向轨迹算法</span>
                <input
                  type="checkbox"
                  checked={config.autoCaptchaSolver}
                  onChange={(e) => dispatch(updatePlaywrightConfig({ autoCaptchaSolver: e.target.checked }))}
                  className="w-4 h-4 accent-[#004ac6]"
                />
              </div>
              <p className="text-[11px] text-[#737686]">毫秒级光学边缘匹配，免人工扫码</p>
            </div>
          </div>

          {/* Channel Sessions Keep-Alive */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#0b1c30] flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-[#004ac6]" />
                <span>各 OTA 平台商户端 Playwright 会话保活状态</span>
              </label>
              <span className="text-[11px] text-[#737686]">持久化 Chromium UserDataDir</span>
            </div>

            <div className="border border-[#dce9ff] rounded-xl overflow-hidden divide-y divide-[#eff4ff]">
              {config.sessions.map((sess) => (
                <div key={sess.channelId} className="p-3 bg-white flex items-center justify-between hover:bg-[#f8f9ff]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-md bg-[#eff4ff] text-[#004ac6] flex items-center justify-center font-bold text-xs">
                      {sess.channelId.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-[#0b1c30]">{sess.accountName}</div>
                      <div className="text-[11px] text-[#737686]">最后探针心跳: {sess.lastPing}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {sess.cookieStatus === 'valid' ? (
                      <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Session 正常
                      </span>
                    ) : (
                      <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        即将过期
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRefreshCookies(sess.channelId, sess.accountName)}
                      className="text-xs text-[#004ac6] hover:bg-[#eff4ff] px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>刷新</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#eff4ff] bg-[#f8f9ff] flex justify-end">
          <button
            type="button"
            onClick={() => dispatch(setPlaywrightModalOpen(false))}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#2563eb] rounded-lg shadow-xs"
          >
            完成配置
          </button>
        </div>
      </div>
    </div>
  );
};
