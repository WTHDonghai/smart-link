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
  X,
  CheckCircle2,
} from 'lucide-react';
import type { HotelMapping } from '../../types';
import { logger } from '../../services/logger';
import { SearchableSelect } from '../common/SearchableSelect';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../common/StatusBadge';
import { FriendlyErrorAlert } from '../common/FriendlyErrorAlert';
import { TableRowActions } from '../common/TableRowActions';
import { ChannelBadge } from '../common/ChannelBadge';
import { normalizeAppError } from '../../utils/errorNormalizer';

export const HotelSyncView: React.FC = () => {
  const dispatch = useAppDispatch();
  const hotels = useAppSelector((state) => state.hotel.hotels);
  const pmsProperties = useAppSelector((state) => state.hotel.pmsProperties);
  const isScraping = useAppSelector((state) => state.hotel.isScraping);
  const isFetching = useAppSelector((state) => state.hotel.isFetching);
  const isSaving = useAppSelector((state) => state.hotel.isSaving);
  const savingHotelId = useAppSelector((state) => state.hotel.savingHotelId);
  const deletingHotelId = useAppSelector((state) => state.hotel.deletingHotelId);
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
    setSelectedPmsMap({});
    const channelParam = filterChannel === 'all' ? undefined : filterChannel;
    dispatch(fetchHotelMappingsThunk(channelParam));
    dispatch(fetchPlatformPropertiesThunk());
  }, [dispatch, filterChannel]);

  // 获取当前选中的采集渠道对象（无默认预选，以大写 channelCode 匹配）
  const activeChannel = useMemo(() => {
    if (!selectedCrawlChannel) return null;
    const targetCode = selectedCrawlChannel.trim().toUpperCase();
    return (
      channels.find(
        (c) =>
          (c.code && c.code.toUpperCase() === targetCode) ||
          (c.id && c.id.toUpperCase() === targetCode) ||
          (c.code && c.code.replace(/[-_]/g, '').toUpperCase() === targetCode.replace(/[-_]/g, ''))
      ) || null
    );
  }, [channels, selectedCrawlChannel]);

  // 是否禁用采集按钮：未明确选择渠道、找不到渠道或当前正在采集中
  const isStartDisabled = !selectedCrawlChannel || !activeChannel || isScraping;

  // 渠道选项列表（用于列表筛选）
  const channelOptions = useMemo(() => [
    { label: '全部渠道', value: 'all' },
    ...channels.map((ch) => ({
      label: ch.name,
      value: ch.id,
      subtext: ch.code,
    })),
  ], [channels]);

  // 支持采集的渠道选项（统一以大写 channelCode 作为 value）
  const crawlChannelOptions = useMemo(() => {
    return channels.map((ch) => {
      const code = (ch.code || ch.id).toUpperCase();
      return {
        label: ch.name,
        value: code,
        subtext: code,
      };
    });
  }, [channels]);

  // 过滤后的酒店/门店列表（智能兼容渠道 ID 与 CODE 规范化匹配）
  const filteredHotels = useMemo(() => {
    return hotels.filter((h) => {
      const matchesChannel =
        filterChannel === 'all' ||
        h.otaChannelId?.toLowerCase() === filterChannel.toLowerCase() ||
        h.otaChannelCode?.toUpperCase() === filterChannel.toUpperCase() ||
        h.otaChannelId?.replace(/[-_]/g, '').toLowerCase() === filterChannel.replace(/[-_]/g, '').toLowerCase() ||
        h.otaChannelCode?.replace(/[-_]/g, '').toLowerCase() === filterChannel.replace(/[-_]/g, '').toLowerCase();

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
    const pmsName = pmsId ? (matched ? matched.name : hotel.pmsHotelName) : '';

    const otaChannelCode = hotel.otaChannelCode || hotel.otaChannelId.toUpperCase();
    const extUnitCode = hotel.extUnitCode || hotel.otaHotelId;

    const result = await dispatch(
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

    if (saveHotelMappingThunk.fulfilled.match(result)) {
      setSelectedPmsMap((prev) => {
        const next = { ...prev };
        delete next[hotel.id];
        return next;
      });
      const channelParam = filterChannel === 'all' ? undefined : filterChannel;
      dispatch(fetchHotelMappingsThunk(channelParam));

      logger.track('HOTEL_SYNC_SUCCESS', {
        module: 'HOTEL',
        level: 'INFO',
        channelId: hotel.otaChannelId,
        message: `[HotelSync] 已保存酒店映射「${hotel.otaHotelName}」-> ${pmsName} (${pmsId})`,
        details: `OTA酒店ID: ${hotel.otaHotelId} | PMS酒店ID: ${pmsId}`,
        meta: { otaHotelId: hotel.otaHotelId, pmsHotelId: pmsId }
      });
    }
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
    if (isScraping || !selectedCrawlChannel || !activeChannel) return;
    const channelCode = (activeChannel.code || activeChannel.id).trim().toUpperCase();

    logger.track('PLAYWRIGHT_WORKER_START', {
      module: 'PLAYWRIGHT',
      level: 'PLAYWRIGHT',
      message: `[Playwright:Crawler] 启动渠道 ${channelCode} 自动化采集任务`,
      details: `渠道: ${activeChannel.name} (${channelCode})`,
    });

    dispatch(
      crawlHotelsByChannel({
        channelCode,
      })
    );
  };

  const handleResetFilters = () => {
    dispatch(setSearchKeyword(''));
    dispatch(setFilterChannel('all'));
  };

  const handleRefreshMappings = () => {
    setSelectedPmsMap({});
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

      {/* 2. 核心操作面板：渠道选择与启动采集紧密联动 */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#434655] whitespace-nowrap">
              采集渠道:
            </span>
            <div className="w-52">
              <SearchableSelect
                value={selectedCrawlChannel}
                onChange={(val) => {
                  dispatch(setSelectedCrawlChannel(val));
                }}
                options={crawlChannelOptions}
                placeholder="请选择采集渠道..."
                size="sm"
                disabled={isScraping}
                buttonClassName="font-semibold text-[#004ac6]"
              />
            </div>
          </div>

          {/* 紧邻的动态关联主行动按钮 */}
          <button
            type="button"
            onClick={handleStartCrawl}
            disabled={isStartDisabled}
            title={
              !selectedCrawlChannel
                ? '请先在左侧选择要采集的渠道'
                : isScraping
                ? '采集任务正在运行中...'
                : `点击立即启动「${activeChannel?.name}」门店采集`
            }
            className={`h-9 px-4 rounded-lg font-semibold text-xs shadow-2xs transition-all select-none inline-flex items-center gap-2 ${
              isStartDisabled && !isScraping
                ? 'bg-[#f1f5f9] text-[#94a3b8] border border-[#e2e8f0] cursor-not-allowed opacity-85'
                : isScraping
                ? 'bg-[#2170e4] text-white cursor-wait opacity-85'
                : 'bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white cursor-pointer hover:shadow-xs'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? 'animate-spin' : ''}`} />
            <span>
              {isScraping
                ? `正在采集「${activeChannel?.name || ''}」门店...`
                : activeChannel
                ? `启动「${activeChannel.name}」门店采集`
                : '请先选择采集渠道'}
            </span>
          </button>
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
                <th className="py-2.5 px-6 text-right whitespace-nowrap w-36 sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">操作</th>
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
                  const currentPmsId = selectedPmsMap[h.id] ?? h.pmsHotelId;
                  const options = getHotelOptions(h.pmsHotelId, h.pmsHotelName);
                  const isMapped = !!h.pmsHotelId && h.status === 'mapped';
                  const isUnsaved = Boolean(
                    selectedPmsMap[h.id] !== undefined && selectedPmsMap[h.id] !== h.pmsHotelId
                  );
                  const isRowSaving = isSaving && savingHotelId === h.id;
                  const isRowDeleting = deletingHotelId === h.id;

                  return (
                    <tr key={h.id} className="hover:bg-[#f8faff] transition-colors">
                      {/* 渠道与门店名称 */}
                      <td className="py-3 px-6 border-b border-[#edf2f9]">
                        <div className="flex items-center gap-2.5">
                          <ChannelBadge channel={h} channels={channels} size="sm" />
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
                        {isUnsaved ? (
                          <StatusBadge
                            variant="pending"
                            label="待保存"
                            icon={true}
                            size="xs"
                          />
                        ) : (
                          <StatusBadge
                            variant={isMapped ? 'success' : 'pending'}
                            label={isMapped ? '已关联中台' : '待匹配'}
                            icon={isMapped}
                            size="xs"
                          />
                        )}
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
                        <TableRowActions
                          onSave={() => handleSaveRow(h)}
                          isSaving={isRowSaving}
                          isUnsaved={isUnsaved}
                          saveAriaLabel={`保存 ${h.otaHotelName} 门店映射`}
                          onDelete={h.mappingId ? () => handleDeleteRow(h) : undefined}
                          canDelete={Boolean(h.mappingId)}
                          isDeleting={isRowDeleting}
                          deleteTitle="删除门店映射"
                          deleteAriaLabel={`删除 ${h.otaHotelName} 门店映射`}
                        />
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
