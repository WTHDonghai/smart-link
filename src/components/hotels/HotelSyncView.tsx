import React, { useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setFilterChannel,
  setSearchKeyword,
  setSelectedCrawlChannel,
  updateHotelMapping,
  crawlHotelsByChannel,
  syncChromeProfileThunk,
} from '../../store/slices/hotelSlice';
import { updateChannelStoreCrawlUrl } from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import {
  Search,
  RefreshCw,
  ChevronDown,
  Save,
  X,
  Globe,
  CheckCircle2,
  KeyRound,
} from 'lucide-react';
import type { HotelMapping } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../common/StatusBadge';
import { FriendlyErrorAlert } from '../common/FriendlyErrorAlert';
import { normalizeAppError } from '../../utils/errorNormalizer';
import { DEFAULT_MEITUAN_CATALOG_URL } from '../../crawler/collectors/meituan/meituanStoreMapper';

const PMS_HOTEL_OPTIONS = [
  { id: 'PMS-HZ-001', name: '华住全季-杭州湖滨店' },
  { id: 'PMS-SY-099', name: '复星旅文-亚特兰蒂斯(海棠湾)' },
  { id: 'PMS-BJ-012', name: '国贸商务酒店-北京总店' },
  { id: 'PMS-CD-034', name: '花间堂-成都宽窄店' },
  { id: 'PMS-SH-102', name: '万豪瑞吉-上海静安' },
  { id: 'PMS-HZ-028', name: '桔子水晶-杭州武林总店' },
  { id: 'PMS-SZ-045', name: '洲际酒店-深圳湾店' },
  { id: 'PMS-GZ-066', name: '四季酒店-广州塔店' },
  { id: 'PMS-ZG-008', name: '自贡禅驿度假酒店-方特店' },
];

export const HotelSyncView: React.FC = () => {
  const dispatch = useAppDispatch();
  const hotels = useAppSelector((state) => state.hotel.hotels);
  const isScraping = useAppSelector((state) => state.hotel.isScraping);
  const isSyncingProfile = useAppSelector((state) => state.hotel.isSyncingProfile);
  const crawlError = useAppSelector((state) => state.hotel.crawlError);
  const selectedCrawlChannel = useAppSelector((state) => state.hotel.selectedCrawlChannel);
  const lastCrawlSummary = useAppSelector((state) => state.hotel.lastCrawlSummary);
  const filterChannel = useAppSelector((state) => state.hotel.filterChannel);
  const searchKeyword = useAppSelector((state) => state.hotel.searchKeyword);
  const channels = useAppSelector((state) => state.channel.channels);

  const [selectedPmsMap, setSelectedPmsMap] = useState<Record<string, string>>({});
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [customTargetUrl, setCustomTargetUrl] = useState('');
  const [isHeadedMode, setIsHeadedMode] = useState(false);

  // 获取当前选中的采集渠道对象
  const activeChannel = useMemo(() => {
    return channels.find((c) => c.id === selectedCrawlChannel) || channels[0];
  }, [channels, selectedCrawlChannel]);

  // 当前渠道对应的采集目标 URL
  const currentChannelTargetUrl = useMemo(() => {
    if (activeChannel?.storeCrawlUrl) return activeChannel.storeCrawlUrl;
    if (activeChannel?.id === 'meituan' || activeChannel?.id === 'meituanbiz') {
      return DEFAULT_MEITUAN_CATALOG_URL;
    }
    return 'https://me.meituan.com/ebooking/merchant/product/batch-price';
  }, [activeChannel]);

  // 渠道选项列表（用于列表筛选）
  const channelOptions = useMemo(() => [
    { label: '全部渠道', value: 'all' },
    ...channels.map((ch) => ({
      label: ch.name,
      value: ch.id,
      subtext: ch.code,
    })),
  ], [channels]);

  // 支持采集的渠道选项（当前优先美团/美团商旅，可扩展）
  const crawlChannelOptions = useMemo(() => {
    return channels.map((ch) => ({
      label: ch.name,
      value: ch.id,
      subtext: ch.code,
    }));
  }, [channels]);

  // 过滤后的酒店列表
  const filteredHotels = useMemo(() => {
    return hotels.filter((h) => {
      const matchesChannel = filterChannel === 'all' || h.otaChannelId === filterChannel;
      const matchesKeyword =
        !searchKeyword ||
        h.otaHotelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        h.pmsHotelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        h.otaHotelId.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        h.city.toLowerCase().includes(searchKeyword.toLowerCase());
      return matchesChannel && matchesKeyword;
    });
  }, [hotels, filterChannel, searchKeyword]);

  const getHotelOptions = (currentPmsId: string, currentPmsName: string) => {
    if (PMS_HOTEL_OPTIONS.some((opt) => opt.id === currentPmsId)) {
      return PMS_HOTEL_OPTIONS;
    }
    if (currentPmsId) {
      return [{ id: currentPmsId, name: currentPmsName }, ...PMS_HOTEL_OPTIONS];
    }
    return PMS_HOTEL_OPTIONS;
  };

  const handlePmsChange = (hotelId: string, pmsId: string) => {
    setSelectedPmsMap((prev) => ({ ...prev, [hotelId]: pmsId }));
  };

  const handleSaveRow = (hotel: HotelMapping) => {
    const pmsId = selectedPmsMap[hotel.id] ?? hotel.pmsHotelId;
    const options = getHotelOptions(hotel.pmsHotelId, hotel.pmsHotelName);
    const matched = options.find((o) => o.id === pmsId);
    const pmsName = matched ? matched.name : hotel.pmsHotelName;

    dispatch(
      updateHotelMapping({
        id: hotel.id,
        pmsHotelId: pmsId,
        pmsHotelName: pmsName,
      })
    );

    dispatch(
      showToast({
        title: `已保存「${hotel.otaHotelName}」映射`,
        description: `对应中台酒店：${pmsName} (${pmsId})`,
        type: 'success',
      })
    );

    dispatch(
      addLog({
        level: 'INFO',
        channelId: hotel.otaChannelId,
        message: `[HotelSync] Saved mapping for ${hotel.otaHotelName} (${hotel.otaHotelId}) -> ${pmsName} (${pmsId})`,
      })
    );
  };

  const handleStartCrawl = async () => {
    if (isScraping) return;
    const targetUrl = customTargetUrl.trim() || currentChannelTargetUrl;

    dispatch(
      crawlHotelsByChannel({
        channelId: selectedCrawlChannel,
        targetUrl,
        headless: !isHeadedMode,
      })
    );
  };

  const handleSaveCustomUrl = () => {
    if (customTargetUrl.trim() && activeChannel) {
      dispatch(
        updateChannelStoreCrawlUrl({
          channelId: activeChannel.id,
          storeCrawlUrl: customTargetUrl.trim(),
        })
      );
      dispatch(
        showToast({
          title: '已更新采集目标 URL',
          description: `渠道 ${activeChannel.name} 采集地址已更新`,
          type: 'success',
        })
      );
    }
    setIsEditingUrl(false);
  };

  const handleResetFilters = () => {
    dispatch(setSearchKeyword(''));
    dispatch(setFilterChannel('all'));
  };

  return (
    <div className="flex flex-col gap-5 max-w-[1400px] mx-auto w-full p-6 text-[#0b1c30]">
      {/* 1. 统一标准页面头部 */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            门店采集
          </h1>
          <span className="text-xs text-[#737686] ml-2 font-mono">
            共 {hotels.length} 家酒店候选
          </span>
        </div>
      </div>

      {/* 2. 核心操作面板：渠道选择、目标 URL 配置与启动采集 */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[320px]">
            {/* 采集渠道选择 */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#434655] whitespace-nowrap">
                采集渠道:
              </span>
              <div className="w-44">
                <SearchableSelect
                  value={selectedCrawlChannel}
                  onChange={(val) => {
                    dispatch(setSelectedCrawlChannel(val));
                    setCustomTargetUrl('');
                    setIsEditingUrl(false);
                  }}
                  options={crawlChannelOptions}
                  placeholder="选择采集渠道"
                  size="sm"
                  buttonClassName="font-semibold text-[#004ac6]"
                />
              </div>
            </div>

            {/* 目标 URL 显示与快速编辑 */}
            <div className="flex items-center gap-2 flex-1 min-w-[280px]">
              <span className="text-xs font-semibold text-[#434655] whitespace-nowrap flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-[#737686]" />
                目标 URL:
              </span>
              {isEditingUrl ? (
                <div className="flex items-center gap-1.5 flex-1 max-w-lg">
                  <input
                    type="text"
                    value={customTargetUrl}
                    onChange={(e) => setCustomTargetUrl(e.target.value)}
                    placeholder={currentChannelTargetUrl}
                    className="flex-1 h-8 px-2.5 bg-white border border-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomUrl}
                    className="h-8 px-2.5 bg-[#004ac6] text-white rounded-md text-xs font-medium cursor-pointer"
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingUrl(false);
                      setCustomTargetUrl('');
                    }}
                    className="h-8 px-2 text-[#737686] hover:text-[#0b1c30] text-xs cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1 max-w-lg">
                  <span
                    className="text-xs font-mono text-[#434655] bg-[#f8faff] px-2.5 py-1.5 rounded border border-[#e2e8f0] truncate block max-w-md select-text"
                    title={currentChannelTargetUrl}
                  >
                    {currentChannelTargetUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomTargetUrl(currentChannelTargetUrl);
                      setIsEditingUrl(true);
                    }}
                    className="text-xs text-[#004ac6] hover:underline whitespace-nowrap cursor-pointer"
                  >
                    修改
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 右侧动作区：有头模式切换、一键同步日常 Chrome 登录态与采集主行动按钮 */}
          <div className="flex items-center gap-2.5 shrink-0">
            <label className="inline-flex items-center gap-1.5 text-xs text-[#737686] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isHeadedMode}
                onChange={(e) => setIsHeadedMode(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#004ac6] rounded cursor-pointer"
              />
              <span>弹出浏览器窗口 (人工扫码/登录)</span>
            </label>

            <button
              type="button"
              onClick={() => dispatch(syncChromeProfileThunk(selectedCrawlChannel))}
              disabled={isSyncingProfile || isScraping}
              className="h-9 px-3 rounded-lg border border-[#dce9ff] bg-white hover:bg-[#eff4ff] active:bg-[#dce9ff] text-[#004ac6] font-medium text-xs shadow-2xs transition-colors cursor-pointer select-none inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="一键从日常系统 Chrome 同步当前已登录的 Cookies 与授权缓存（免密/免扫码）"
            >
              <KeyRound className={`w-3.5 h-3.5 text-[#004ac6] ${isSyncingProfile ? 'animate-spin' : ''}`} />
              <span>{isSyncingProfile ? '正在同步登录态...' : '同步 Chrome 登录态'}</span>
            </button>

            <button
              type="button"
              onClick={handleStartCrawl}
              disabled={isScraping || isSyncingProfile}
              className={`h-9 px-4 rounded-lg text-white font-semibold text-xs shadow-2xs transition-colors cursor-pointer select-none inline-flex items-center gap-2 ${
                isScraping
                  ? 'bg-[#2170e4] cursor-wait opacity-85'
                  : 'bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80]'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? 'animate-spin' : ''}`} />
              <span>
                {isScraping
                  ? `正在采集「${activeChannel?.name || 'OTA'}」门店...`
                  : `启动「${activeChannel?.name || 'OTA'}」门店采集`}
              </span>
            </button>
          </div>
        </div>

        {/* 3. 错误状态展示 (FriendlyErrorAlert 智能引导) */}
        {crawlError && (
          <div className="pt-2">
            <FriendlyErrorAlert
              error={normalizeAppError(crawlError, 'CRAWLER')}
              onRetry={handleStartCrawl}
            />
          </div>
        )}

        {/* 4. 最近一次采集简报 */}
        {lastCrawlSummary && !crawlError && !isScraping && (
          <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                最近一次采集成功：渠道「<strong>{lastCrawlSummary.channelId}</strong>」共提取到{' '}
                <strong>{lastCrawlSummary.discoveredCount}</strong> 家门店候选 (耗时{' '}
                {(lastCrawlSummary.durationMs / 1000).toFixed(1)} 秒)
              </span>
            </div>
            <span className="font-mono text-emerald-700 text-[11px]">
              完成时间: {lastCrawlSummary.timestamp}
            </span>
          </div>
        )}
      </div>

      {/* 5. 酒店列表主卡片：搜索过滤 + 表格 */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] overflow-hidden divide-y divide-[#edf2f9]">
        {/* 表格内嵌搜索与渠道过滤栏 */}
        <div className="p-3 bg-[#f8faff] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            {/* 搜索输入框 */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686] pointer-events-none" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => dispatch(setSearchKeyword(e.target.value))}
                placeholder="搜索酒店名称、门店ID、PMS酒店或城市..."
                className="w-full h-8.5 pl-8.5 pr-8 bg-white border border-[#dce9ff] rounded-lg text-xs text-[#0b1c30] placeholder-[#94a3b8] outline-hidden focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] transition-colors"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => dispatch(setSearchKeyword(''))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                  title="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 统一渠道选择器 */}
            <div className="w-48">
              <SearchableSelect
                value={filterChannel}
                onChange={(val) => dispatch(setFilterChannel(val))}
                options={channelOptions}
                placeholder="全部渠道"
                searchPlaceholder="搜索渠道名称、代码..."
                size="sm"
                buttonClassName="font-medium text-[#0b1c30]"
              />
            </div>

            {/* 重置条件按钮 */}
            {(searchKeyword || filterChannel !== 'all') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-[#737686] hover:text-[#004ac6] flex items-center gap-1 cursor-pointer shrink-0 ml-1"
              >
                <span>重置条件</span>
              </button>
            )}
          </div>

          <div className="text-xs text-[#737686] font-mono shrink-0">
            共显示 <strong className="text-[#004ac6] font-bold">{filteredHotels.length}</strong> / {hotels.length} 家酒店
          </div>
        </div>

        {/* 酒店列表表格 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 bg-[#f8faff]">
              <tr className="bg-[#f8faff] text-[#434655] text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                <th className="py-2.5 px-6 sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">OTA 渠道与门店名称</th>
                <th className="py-2.5 px-4 w-36 whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">OTA 门店 ID</th>
                <th className="py-2.5 px-4 w-28 whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">状态</th>
                <th className="py-2.5 px-4 min-w-[240px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">中台对应酒店</th>
                <th className="py-2.5 px-4 w-36 whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">采集时间</th>
                <th className="py-2.5 px-6 text-right whitespace-nowrap w-24 sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-sm text-[#0b1c30]">
              {filteredHotels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <EmptyState
                      title="暂无匹配的酒店门店数据"
                      description="可以尝试调整搜索关键字，或点击上方「启动采集」按钮拉取最新数据"
                      actionText={searchKeyword || filterChannel !== 'all' ? '清除过滤条件' : undefined}
                      onAction={handleResetFilters}
                    />
                  </td>
                </tr>
              ) : (
                filteredHotels.map((h) => {
                  const ch = channels.find((c) => c.id === h.otaChannelId);
                  const currentPmsId = selectedPmsMap[h.id] ?? h.pmsHotelId;
                  const options = getHotelOptions(h.pmsHotelId, h.pmsHotelName);
                  const isMapped = !!h.pmsHotelId && h.status === 'mapped';

                  return (
                    <tr key={h.id} className="hover:bg-[#f8faff] transition-colors">
                      {/* 渠道与门店名称 */}
                      <td className="py-3 px-6 border-b border-[#edf2f9]">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-md ${ch?.bgColor || 'bg-blue-100'} ${ch?.textColor || 'text-blue-700'} flex items-center justify-center font-bold text-xs shrink-0`}
                          >
                            {ch?.short || 'OTA'}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs text-[#0b1c30] select-text">
                              {h.otaHotelName}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              {h.city && (
                                <span className="text-[11px] text-[#737686]">{h.city}</span>
                              )}
                              {h.starRating && (
                                <span className="text-[11px] text-[#94a3b8]">{h.starRating}</span>
                              )}
                              {h.partnerId && (
                                <span className="text-[10px] bg-slate-100 text-[#737686] px-1 py-0.5 rounded font-mono">
                                  商户: {h.partnerId}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 门店 ID */}
                      <td className="py-3 px-4 font-mono text-xs text-[#737686] whitespace-nowrap border-b border-[#edf2f9] select-text">
                        {h.otaHotelId}
                      </td>

                      {/* 映射状态 */}
                      <td className="py-3 px-4 whitespace-nowrap border-b border-[#edf2f9]">
                        <StatusBadge
                          variant={isMapped ? 'success' : 'pending'}
                          label={isMapped ? '已关联中台' : '待匹配'}
                        />
                      </td>

                      {/* 中台对应酒店 - 下拉框 */}
                      <td className="py-3 px-4 border-b border-[#edf2f9]">
                        <div className="relative w-full max-w-xs">
                          <select
                            value={currentPmsId}
                            onChange={(e) => handlePmsChange(h.id, e.target.value)}
                            className="w-full h-8.5 pl-3 pr-8 rounded-lg bg-white text-[#0b1c30] text-xs shadow-2xs focus:ring-1 focus:ring-[#004ac6] focus:outline-hidden appearance-none cursor-pointer border border-[#dce9ff] hover:border-[#004ac6]/60 transition-colors font-medium truncate"
                          >
                            <option value="">-- 选择中台酒店 --</option>
                            {options.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.name} ({opt.id})
                              </option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-[#737686]">
                            <ChevronDown className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </td>

                      {/* 上次采集时间 */}
                      <td className="py-3 px-4 text-xs text-[#737686] whitespace-nowrap border-b border-[#edf2f9]">
                        {h.lastScraped}
                      </td>

                      {/* 操作列 */}
                      <td className="py-3 px-6 text-right whitespace-nowrap border-b border-[#edf2f9]">
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleSaveRow(h)}
                            className="inline-flex items-center justify-center gap-1.5 h-7.5 px-3 text-xs font-medium text-white bg-[#004ac6] hover:bg-[#003da6] rounded-md shadow-2xs transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                            title="保存酒店映射"
                          >
                            <Save className="w-3.5 h-3.5 shrink-0" />
                            <span>保存</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
