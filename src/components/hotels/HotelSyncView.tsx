import React, { useState, useMemo, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setFilterChannel,
  setSearchKeyword,
  setSelectedCrawlChannel,
  crawlHotelsByChannel,
  fetchHotelMappingsThunk,
  saveHotelMappingThunk,
  deleteHotelMappingThunk,
  fetchPlatformPropertiesThunk,
} from '../../store/slices/hotelSlice';
import {
  Search,
  RefreshCw,
  ChevronDown,
  Save,
  X,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import type { HotelMapping } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../common/StatusBadge';
import { FriendlyErrorAlert } from '../common/FriendlyErrorAlert';
import { normalizeAppError } from '../../utils/errorNormalizer';
import { DEFAULT_MEITUAN_CATALOG_URL } from '../../crawler/collectors/meituan/meituanStoreMapper';

export const HotelSyncView: React.FC = () => {
  const dispatch = useAppDispatch();
  const hotels = useAppSelector((state) => state.hotel.hotels);
  const pmsProperties = useAppSelector((state) => state.hotel.pmsProperties);
  const isScraping = useAppSelector((state) => state.hotel.isScraping);
  const isFetching = useAppSelector((state) => state.hotel.isFetching);
  const isSaving = useAppSelector((state) => state.hotel.isSaving);
  const crawlError = useAppSelector((state) => state.hotel.crawlError);
  const fetchError = useAppSelector((state) => state.hotel.fetchError);
  const selectedCrawlChannel = useAppSelector((state) => state.hotel.selectedCrawlChannel);
  const lastCrawlSummary = useAppSelector((state) => state.hotel.lastCrawlSummary);
  const filterChannel = useAppSelector((state) => state.hotel.filterChannel);
  const searchKeyword = useAppSelector((state) => state.hotel.searchKeyword);
  const channels = useAppSelector((state) => state.channel.channels);

  const [selectedPmsMap, setSelectedPmsMap] = useState<Record<string, string>>({});

  // 页面挂载与筛选渠道切换时，自动从文旅中台拉取真实门店映射与中台酒店列表
  useEffect(() => {
    const channelParam = filterChannel === 'all' ? undefined : filterChannel;
    dispatch(fetchHotelMappingsThunk(channelParam));
    dispatch(fetchPlatformPropertiesThunk());
  }, [dispatch, filterChannel]);

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

  // 过滤后的酒店/门店列表
  const filteredHotels = useMemo(() => {
    return hotels.filter((h) => {
      const matchesChannel = filterChannel === 'all' || h.otaChannelId === filterChannel;
      const matchesKeyword =
        !searchKeyword ||
        h.otaHotelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        h.pmsHotelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        h.otaHotelId.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        (h.city && h.city.toLowerCase().includes(searchKeyword.toLowerCase()));
      return matchesChannel && matchesKeyword;
    });
  }, [hotels, filterChannel, searchKeyword]);

  const getHotelOptions = (currentPmsId: string, currentPmsName: string) => {
    const options = [...pmsProperties];
    if (currentPmsId && !options.some((opt) => opt.id === currentPmsId)) {
      options.unshift({
        id: currentPmsId,
        name: currentPmsName || currentPmsId,
      });
    }
    return options;
  };

  const handlePmsChange = (hotelId: string, pmsId: string) => {
    setSelectedPmsMap((prev) => ({ ...prev, [hotelId]: pmsId }));
  };

  const handleSaveRow = async (hotel: HotelMapping) => {
    const pmsId = selectedPmsMap[hotel.id] ?? hotel.pmsHotelId;
    const options = getHotelOptions(hotel.pmsHotelId, hotel.pmsHotelName);
    const matched = options.find((o) => o.id === pmsId);
    const pmsName = matched ? matched.name : hotel.pmsHotelName;

    const otaChannelCode = hotel.otaChannelCode || hotel.otaChannelId.toUpperCase();
    const extUnitCode = hotel.extUnitCode || hotel.otaHotelId;

    await dispatch(
      saveHotelMappingThunk({
        id: hotel.id,
        mappingId: hotel.mappingId,
        otaChannelCode,
        extUnitCode,
        otaHotelName: hotel.otaHotelName,
        unitId: pmsId || undefined,
        unitType: hotel.unitType || 'Property',
        pmsHotelName: pmsName,
      })
    );
  };

  const handleDeleteRow = async (hotel: HotelMapping) => {
    if (!hotel.mappingId) return;
    await dispatch(
      deleteHotelMappingThunk({
        mappingId: hotel.mappingId,
        localId: hotel.id,
        otaHotelName: hotel.otaHotelName,
      })
    );
  };

  const handleStartCrawl = async () => {
    if (isScraping) return;

    dispatch(
      crawlHotelsByChannel({
        channelId: selectedCrawlChannel,
        targetUrl: currentChannelTargetUrl,
      })
    );
  };

  const handleResetFilters = () => {
    dispatch(setSearchKeyword(''));
    dispatch(setFilterChannel('all'));
  };

  const handleRefreshMappings = () => {
    const channelParam = filterChannel === 'all' ? undefined : filterChannel;
    dispatch(fetchHotelMappingsThunk(channelParam));
    dispatch(fetchPlatformPropertiesThunk());
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
            共 {hotels.length} 家门店
          </span>
        </div>
      </div>

      {/* 2. 核心操作面板：渠道选择与启动采集 */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 采集渠道选择 */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#434655] whitespace-nowrap">
              采集渠道:
            </span>
            <div className="w-48">
              <SearchableSelect
                value={selectedCrawlChannel}
                onChange={(val) => {
                  dispatch(setSelectedCrawlChannel(val));
                }}
                options={crawlChannelOptions}
                placeholder="选择采集渠道"
                size="sm"
                buttonClassName="font-semibold text-[#004ac6]"
              />
            </div>
          </div>

          {/* 右侧动作区：采集主行动按钮 */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleStartCrawl}
              disabled={isScraping}
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

        {/* 4. 获取门店映射列表失败提示 */}
        {fetchError && (
          <div className="pt-2">
            <FriendlyErrorAlert
              error={normalizeAppError(fetchError, 'MAPPING')}
              onRetry={handleRefreshMappings}
            />
          </div>
        )}

        {/* 5. 最近一次采集简报 */}
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

      {/* 6. 门店列表主卡片：搜索过滤 + 表格 */}
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
                placeholder="搜索门店名称、OTA 门店 ID、PMS 酒店或城市..."
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

            {/* 刷新远程映射按钮 */}
            <button
              type="button"
              onClick={handleRefreshMappings}
              disabled={isFetching}
              className="text-xs text-[#737686] hover:text-[#004ac6] flex items-center gap-1 cursor-pointer shrink-0 ml-1 disabled:opacity-50"
              title="从文旅中台重新拉取门店映射数据"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </button>

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
            共显示 <strong className="text-[#004ac6] font-bold">{filteredHotels.length}</strong> / {hotels.length} 家门店
          </div>
        </div>

        {/* 门店列表表格 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 z-20 bg-[#f8faff]">
              <tr className="bg-[#f8faff] text-[#434655] text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                <th className="py-2.5 px-6 sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">OTA 渠道与门店名称</th>
                <th className="py-2.5 px-4 w-36 whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">OTA 门店 ID</th>
                <th className="py-2.5 px-4 w-28 whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">状态</th>
                <th className="py-2.5 px-4 min-w-[240px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">中台对应酒店</th>
                <th className="py-2.5 px-6 text-right whitespace-nowrap w-28 sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-sm text-[#0b1c30]">
              {filteredHotels.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <EmptyState
                      title="暂无匹配的门店数据"
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

                      {/* 操作列 */}
                      <td className="py-3 px-6 text-right whitespace-nowrap border-b border-[#edf2f9]">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveRow(h)}
                            disabled={isSaving}
                            className="inline-flex items-center justify-center gap-1.5 h-7.5 px-3 text-xs font-medium text-white bg-[#004ac6] hover:bg-[#003da6] rounded-md shadow-2xs transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none disabled:opacity-50"
                            title="保存门店映射至文旅平台"
                          >
                            <Save className="w-3.5 h-3.5 shrink-0" />
                            <span>保存</span>
                          </button>
                          {h.mappingId && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(h)}
                              className="inline-flex items-center justify-center h-7.5 w-7.5 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md shadow-2xs transition-colors shrink-0 cursor-pointer select-none"
                              title="删除此门店映射记录"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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
