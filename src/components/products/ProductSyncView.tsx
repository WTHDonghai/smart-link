import React, { useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  setProductFilterChannel, 
  setProductFilterHotel,
  setProductSearch,
  updateProductMapping,
  deleteProduct,
  batchDeleteProducts
} from '../../store/slices/productSlice';
import { showToast } from '../../store/slices/appSlice';
import { logger } from '../../services/logger';
import { 
  Search, 
  X, 
  RefreshCw, 
  Save, 
  Trash2, 
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { ProductMapping } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';
import { StatusBadge } from '../common/StatusBadge';
import { EmptyState } from '../common/EmptyState';
import { Pagination } from '../common/Pagination';

const INTERNAL_ROOM_OPTIONS = [
  '行政大床房（EXK）',
  '经典大床房（DBL）',
  '豪华双床房（TWN）',
  '高级套房（STE）',
  '家庭亲子房（FAM）',
  '商务豪华房（DLX）',
  '特惠大床房（STD）',
  '园景行政套房（EXE-V）'
];

const RATE_CODE_OPTIONS = [
  'RACK155（RACK）',
  'BAR100（BAR最优价）',
  'CORP88（协议价）',
  'PKG200（连住套餐）',
  'MEM90（会员立减价）',
  'EARLY85（早鸟特惠）',
  'PROMO70（大促特价）'
];

const BOOKING_TYPE_OPTIONS = [
  'R01',
  'R02',
  'PKG01',
  'CORP01',
  'VIP01'
];

const CHANNEL_OPTIONS = [
  { label: '美团 (MEITUAN)', value: 'meituan' },
  { label: '抖音生活服务 (DOUYIN)', value: 'douyin' },
  { label: '美团企业版 (MEITUANBIZ)', value: 'meituanbiz' },
  { label: '携程旅行 (CTRIP)', value: 'ctrip' },
  { label: '全部渠道', value: 'all' }
];

export const ProductSyncView: React.FC = () => {
  const dispatch = useAppDispatch();
  const products = useAppSelector((state) => state.product.products);
  const filterChannel = useAppSelector((state) => state.product.filterChannel);
  const filterHotel = useAppSelector((state) => state.product.filterHotel);
  const searchKeyword = useAppSelector((state) => state.product.searchKeyword);
  const hotels = useAppSelector((state) => state.hotel.hotels);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCrawling, setIsCrawling] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [rowEdits, setRowEdits] = useState<Record<string, { internalRoomType?: string; rateCode?: string; bookingType?: string }>>({});

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Available hotels for dropdown
  const hotelOptions = useMemo(() => {
    const list = hotels.map(h => ({
      label: h.otaHotelName,
      value: h.otaHotelName,
      subtext: `${h.city} · ${h.pmsHotelName}`
    }));
    // Include current hotel if not in list
    if (filterHotel && !list.some(h => h.value === filterHotel)) {
      list.unshift({
        label: filterHotel,
        value: filterHotel,
        subtext: '当前选中酒店'
      });
    }
    return list;
  }, [hotels, filterHotel]);

  // Filter products by channel, hotel, status, and search keyword
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Channel filter
      if (filterChannel !== 'all' && p.otaChannelId !== filterChannel) {
        return false;
      }
      // Hotel filter
      if (filterHotel && p.hotelName !== filterHotel) {
        return false;
      }
      // Status filter
      if (filterStatus !== 'all' && p.status !== filterStatus) {
        return false;
      }
      // Search keyword filter
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const matchName = (p.otaProductName || '').toLowerCase().includes(kw);
        const matchCode = (p.otaProductCode || '').toLowerCase().includes(kw);
        const matchPhysical = (p.otaPhysicalRoomName || '').toLowerCase().includes(kw);
        const matchPhysicalCode = (p.otaPhysicalRoomCode || '').toLowerCase().includes(kw);
        const matchInternal = (p.internalRoomType || '').toLowerCase().includes(kw);
        const matchRate = (p.rateCode || '').toLowerCase().includes(kw);
        return matchName || matchCode || matchPhysical || matchPhysicalCode || matchInternal || matchRate;
      }
      return true;
    });
  }, [products, filterChannel, filterHotel, filterStatus, searchKeyword]);

  // Pagination slice metrics
  const totalItems = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // Check if all items on current page are selected
  const isCurrentPageAllSelected =
    paginatedProducts.length > 0 && paginatedProducts.every((p) => selectedIds.includes(p.id));

  const handleToggleSelectAllCurrentPage = (checked: boolean) => {
    const pageIds = paginatedProducts.map((p) => p.id);
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleInvertSelect = () => {
    const pageIdSet = new Set(paginatedProducts.map((p) => p.id));
    const otherPagesSelected = selectedIds.filter((id) => !pageIdSet.has(id));
    const currentSelectedSet = new Set(selectedIds);
    const invertedCurrentPage = paginatedProducts
      .filter((p) => !currentSelectedSet.has(p.id))
      .map((p) => p.id);
    setSelectedIds([...otherPagesSelected, ...invertedCurrentPage]);
  };

  const handleRowValueChange = (
    id: string,
    field: 'internalRoomType' | 'rateCode' | 'bookingType',
    value: string
  ) => {
    setRowEdits((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value
      }
    }));
  };

  const handleSaveRow = (product: ProductMapping) => {
    const currentEdits = rowEdits[product.id] || {};
    const updatedPayload = {
      id: product.id,
      internalRoomType: currentEdits.internalRoomType ?? product.internalRoomType,
      rateCode: currentEdits.rateCode ?? product.rateCode,
      bookingType: currentEdits.bookingType ?? product.bookingType,
      status: 'completed' as const
    };

    dispatch(updateProductMapping(updatedPayload));

    // Clear row draft edits
    setRowEdits((prev) => {
      const next = { ...prev };
      delete next[product.id];
      return next;
    });

    dispatch(
      showToast({
        title: `已保存「${product.otaPhysicalRoomName}」映射`,
        description: `内部房型: ${updatedPayload.internalRoomType} | 房价码: ${updatedPayload.rateCode}`,
        type: 'success'
      })
    );

    logger.track('PRODUCT_MAPPING_MATCH', {
      module: 'PRODUCT',
      level: 'INFO',
      channelId: product.otaChannelId,
      message: `[ProductSync] 已保存房型映射「${product.otaProductName}」(${product.otaProductCode})`,
      details: `内部房型: ${updatedPayload.internalRoomType} | 房价码: ${updatedPayload.rateCode}`,
      meta: { productCode: product.otaProductCode, internalRoomType: updatedPayload.internalRoomType }
    });
  };

  const handleDeleteRow = (product: ProductMapping) => {
    dispatch(deleteProduct(product.id));
    setSelectedIds((prev) => prev.filter((id) => id !== product.id));
    dispatch(
      showToast({
        title: `已删除房型「${product.otaPhysicalRoomName}」映射`,
        description: '该产品映射已从列表移除',
        type: 'info'
      })
    );
    logger.track('PRODUCT_MAPPING_MATCH', {
      module: 'PRODUCT',
      level: 'WARN',
      channelId: product.otaChannelId,
      message: `[ProductSync] 已移除房型映射「${product.otaProductName}」(${product.otaProductCode})`,
      details: `已从当前映射库中删除`
    });
  };

  // 批量保存
  const handleBatchSave = () => {
    if (selectedIds.length === 0) return;

    selectedIds.forEach((id) => {
      const p = products.find((prod) => prod.id === id);
      if (p) {
        const currentEdits = rowEdits[p.id] || {};
        dispatch(
          updateProductMapping({
            id: p.id,
            internalRoomType: currentEdits.internalRoomType ?? p.internalRoomType,
            rateCode: currentEdits.rateCode ?? p.rateCode,
            bookingType: currentEdits.bookingType ?? p.bookingType,
            status: 'completed'
          })
        );
      }
    });

    // Clear saved draft edits
    setRowEdits((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => delete next[id]);
      return next;
    });

    dispatch(
      showToast({
        title: `批量保存成功 (${selectedIds.length} 项)`,
        description: '已将所选房型的内部房型、房价码及预订类型同步生效',
        type: 'success'
      })
    );

    logger.track('PRODUCT_MAPPING_MATCH', {
      module: 'PRODUCT',
      level: 'INFO',
      channelId: filterChannel,
      message: `[ProductSync] 批量保存了 ${selectedIds.length} 个房型产品映射`,
      details: `产品ID: ${selectedIds.join(', ')}`,
      meta: { count: selectedIds.length }
    });
  };

  // 批量删除
  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    dispatch(batchDeleteProducts(selectedIds));
    setSelectedIds([]);

    dispatch(
      showToast({
        title: `批量删除成功 (${count} 项)`,
        description: '所选产品的映射配置已从系统移除',
        type: 'info'
      })
    );

    logger.track('PRODUCT_MAPPING_MATCH', {
      module: 'PRODUCT',
      level: 'WARN',
      channelId: filterChannel,
      message: `[ProductSync] 批量删除了 ${count} 个房型产品映射`,
      meta: { deletedCount: count }
    });
  };

  // 保存所有更改 (包括未勾选但已修改的行)
  const modifiedCount = Object.keys(rowEdits).length;
  const handleSaveAllModified = () => {
    if (modifiedCount === 0) return;
    Object.keys(rowEdits).forEach((id) => {
      const edits = rowEdits[id];
      const product = products.find((p) => p.id === id);
      if (edits && product) {
        dispatch(
          updateProductMapping({
            id,
            internalRoomType: edits.internalRoomType ?? product.internalRoomType,
            rateCode: edits.rateCode ?? product.rateCode,
            bookingType: edits.bookingType ?? product.bookingType,
            status: 'completed'
          })
        );
      }
    });
    setRowEdits({});
    dispatch(
      showToast({
        title: `已保存全部变更 (${modifiedCount} 处)`,
        description: '所有修改均已成功保存并同步',
        type: 'success'
      })
    );
  };

  const handleCrawlOtaProducts = () => {
    if (isCrawling) return;
    setIsCrawling(true);
    dispatch(
      showToast({
        title: '正在启动 OTA 产品采集爬虫...',
        description: `通过 Playwright 抓取「${filterHotel}」最新物理房型与价格计划`,
        type: 'info'
      })
    );

    setTimeout(() => {
      setIsCrawling(false);
      dispatch(
        showToast({
          title: 'OTA 产品采集完成',
          description: `成功同步「${filterHotel}」最新 5 个物理房型与价格日历`,
          type: 'success'
        })
      );
      logger.track('PLAYWRIGHT_PAGE_NAVIGATE', {
        module: 'PLAYWRIGHT',
        level: 'INFO',
        channelId: filterChannel,
        message: `[ProductCrawl] Playwright 完成酒店「${filterHotel}」产品抓取`,
        details: `匹配到 ${filteredProducts.length} 个房型产品条目`,
        meta: { hotelName: filterHotel, matchedCount: filteredProducts.length }
      });
    }, 1500);
  };

  const handleResetFilters = () => {
    dispatch(setProductSearch(''));
    setFilterStatus('all');
    setCurrentPage(1);
  };

  const handleChannelFilterChange = (val: string) => {
    dispatch(setProductFilterChannel(val));
    setCurrentPage(1);
  };

  const handleHotelFilterChange = (val: string) => {
    dispatch(setProductFilterHotel(val));
    setCurrentPage(1);
  };

  const handleSearchChange = (kw: string) => {
    dispatch(setProductSearch(kw));
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (status: 'all' | 'completed' | 'pending') => {
    setFilterStatus(status);
    setCurrentPage(1);
  };

  return (
    <div className="w-full h-full max-w-[1400px] mx-auto flex flex-col p-6 text-[#0b1c30] overflow-hidden min-h-0 gap-3">
      {/* 1. 统一标准页面头部 */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            产品采集
          </h1>
          <span className="text-xs text-[#737686] ml-2 font-mono">
            共 {products.length} 条产品映射
          </span>
        </div>

        {/* 顶部主操作动作组：统一高度 h-8.5 与主要行动按钮风格 */}
        <div className="flex items-center gap-2 shrink-0">
          {modifiedCount > 0 && (
            <button
              type="button"
              onClick={handleSaveAllModified}
              className="h-8.5 px-3 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg shadow-2xs transition-colors inline-flex items-center gap-1.5 cursor-pointer animate-pulse select-none"
              title="一键保存所有尚未保存的行修改"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>保存所有修改 ({modifiedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCrawlOtaProducts}
            disabled={isCrawling}
            className="h-8.5 px-3.5 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] rounded-lg shadow-2xs transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 select-none shrink-0"
          >
            {isCrawling ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>采集同步中...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>采集 OTA 产品</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. 顶部前置控制栏：OTA渠道与酒店选择卡片 */}
      <div className="bg-white rounded-xl p-3.5 border border-[#dce9ff] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 w-full">
          {/* OTA 渠道下拉框 */}
          <div>
            <label className="block text-xs font-bold text-[#0b1c30] mb-1">
              OTA 渠道
            </label>
            <SearchableSelect
              value={filterChannel}
              onChange={handleChannelFilterChange}
              options={CHANNEL_OPTIONS}
              placeholder="请选择 OTA 渠道"
              searchPlaceholder="搜索渠道名称、代码..."
              size="sm"
              buttonClassName="font-semibold text-[#0b1c30]"
            />
          </div>

          {/* 酒店下拉框 */}
          <div>
            <label className="block text-xs font-bold text-[#0b1c30] mb-1">
              对应酒店
            </label>
            <SearchableSelect
              value={filterHotel}
              onChange={handleHotelFilterChange}
              options={hotelOptions}
              placeholder="请选择或搜索酒店..."
              searchPlaceholder="输入酒店名称、城市或关键字过滤..."
              size="sm"
              buttonClassName="font-semibold text-[#0b1c30]"
            />
          </div>
        </div>
      </div>

      {/* 3. 数据与过滤一体化卡片：固定表头 + 内容滚动 + 底部固定分页 */}
      <div className="flex-1 min-h-0 bg-white rounded-xl shadow-xs border border-[#dce9ff] flex flex-col overflow-hidden divide-y divide-[#edf2f9]">
        {/* 表格专属内嵌搜索过滤条件栏 (shrink-0 固定在卡片顶部) */}
        <div className="p-3 bg-[#f8faff] flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* 左侧搜索输入与快速过滤 */}
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            {/* 统一规范搜索输入框 */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-[#737686] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索 OTA产品名称、产品编码、物理房型、房型编码..."
                className="w-full h-8.5 pl-8.5 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs text-[#0b1c30] placeholder-[#94a3b8] transition-colors outline-hidden"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                  title="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 状态快捷过滤分段单选群 */}
            <div className="flex items-center bg-[#edf4ff] p-0.5 rounded-lg text-xs shrink-0 border border-[#dce9ff]">
              <button
                type="button"
                onClick={() => handleStatusFilterChange('all')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'all'
                    ? 'bg-white text-[#004ac6] shadow-2xs font-semibold'
                    : 'text-[#434655] hover:text-[#0b1c30]'
                }`}
              >
                全部状态
              </button>
              <button
                type="button"
                onClick={() => handleStatusFilterChange('completed')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'completed'
                    ? 'bg-white text-emerald-700 shadow-2xs font-semibold'
                    : 'text-[#434655] hover:text-[#0b1c30]'
                }`}
              >
                已完成
              </button>
              <button
                type="button"
                onClick={() => handleStatusFilterChange('pending')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'pending'
                    ? 'bg-white text-amber-800 shadow-2xs font-semibold'
                    : 'text-[#434655] hover:text-[#0b1c30]'
                }`}
              >
                待配置
              </button>
            </div>

            {/* 清除所有搜索过滤 */}
            {(searchKeyword || filterStatus !== 'all') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-[#737686] hover:text-[#004ac6] flex items-center gap-1 cursor-pointer shrink-0 ml-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重置条件</span>
              </button>
            )}
          </div>

          {/* 右侧数据量信息 */}
          <div className="flex items-center gap-2 text-xs text-[#737686] shrink-0 font-mono">
            <span>
              检索到 <strong className="text-[#004ac6] font-bold">{filteredProducts.length}</strong> / {products.length} 条产品
            </span>
          </div>
        </div>

        {/* 批量操作工具条 (shrink-0) */}
        <div
          className={`p-2 transition-all duration-200 shrink-0 ${
            selectedIds.length > 0 ? 'bg-[#eff4ff]' : 'bg-[#fafcff]'
          }`}
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* 左侧批量选择控制 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isCurrentPageAllSelected}
                  onChange={(e) => handleToggleSelectAllCurrentPage(e.target.checked)}
                  className="w-4 h-4 rounded border-[#dce9ff] text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                />
                <span className="text-xs font-bold text-[#0b1c30]">全选当页</span>
              </div>

              <button
                type="button"
                onClick={handleInvertSelect}
                className="text-xs text-[#434655] hover:text-[#004ac6] px-2 py-1 rounded bg-white hover:bg-[#eff4ff] border border-[#dce9ff] transition-colors cursor-pointer"
              >
                反选
              </button>

              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-[#ba1a1a] hover:bg-rose-50 px-2 py-1 rounded bg-white border border-[#ffdad6] transition-colors cursor-pointer"
                >
                  清空选择
                </button>
              )}

              <div className="h-4 w-px bg-[#dce9ff] mx-1" />

              <span className="text-xs text-[#737686] flex items-center gap-1 font-mono">
                已选 <strong className={`text-xs ${selectedIds.length > 0 ? 'text-[#004ac6]' : 'text-[#737686]'}`}>{selectedIds.length}</strong> 项
              </span>
            </div>

            {/* 右侧批量操作动作组 */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* 批量保存按钮 */}
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={handleBatchSave}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] rounded-md transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
                title="批量保存所选行的房型及房价映射"
              >
                <Save className="w-3.5 h-3.5" />
                <span>批量保存</span>
              </button>

              {/* 批量删除按钮 */}
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={handleBatchDelete}
                className="px-3 py-1.5 text-xs font-semibold text-[#ba1a1a] bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
                title="批量移除所选产品的映射"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>批量删除</span>
              </button>
            </div>
          </div>
        </div>

        {/* 产品映射表格列表：支持固定表头与独立滚动 */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-separate border-spacing-0 min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-[#f8faff]">
              <tr className="bg-[#f8faff] text-[#434655] text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                {/* 固定列首：多选框 */}
                <th className="py-2.5 px-4 w-12 text-center sticky top-0 left-0 z-30 bg-[#f8faff] border-b border-[#e5edfa] shadow-[1px_0_0_0_#e5edfa]">
                  <input
                    type="checkbox"
                    checked={isCurrentPageAllSelected}
                    onChange={(e) => handleToggleSelectAllCurrentPage(e.target.checked)}
                    className="w-4 h-4 rounded border-[#dce9ff] text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                  />
                </th>
                {/* 固定列首：OTA 产品 */}
                <th className="py-2.5 px-4 min-w-[280px] w-[280px] sticky top-0 left-12 z-30 bg-[#f8faff] border-b border-[#e5edfa] shadow-[1px_0_0_0_#e5edfa]">
                  OTA 产品
                </th>
                {/* 固定列首：OTA 物理房型 */}
                <th className="py-2.5 px-4 min-w-[200px] w-[200px] sticky top-0 left-[328px] z-30 bg-[#f8faff] border-b border-[#e5edfa] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06),1px_0_0_0_#e5edfa]">
                  OTA 物理房型
                </th>
                <th className="py-2.5 px-4 min-w-[180px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">内部房型</th>
                <th className="py-2.5 px-4 min-w-[160px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">房价码</th>
                <th className="py-2.5 px-4 min-w-[120px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">预订类型</th>
                <th className="py-2.5 px-4 text-center w-20 whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">状态</th>
                {/* 固定列尾：操作列 */}
                <th className="py-2.5 px-6 text-right whitespace-nowrap w-36 sticky top-0 right-0 z-30 bg-[#f8faff] border-b border-[#e5edfa] shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.06),-1px_0_0_0_#e5edfa]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-xs text-[#0b1c30]">
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <EmptyState
                      title="暂无匹配的产品映射数据"
                      description="可以尝试调整搜索关键字或渠道、酒店筛选条件"
                      actionText={searchKeyword || filterStatus !== 'all' ? '清除过滤条件' : undefined}
                      onAction={searchKeyword || filterStatus !== 'all' ? handleResetFilters : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((p) => {
                  const edits = rowEdits[p.id] || {};
                  const currentInternalRoom = edits.internalRoomType ?? p.internalRoomType;
                  const currentRateCode = edits.rateCode ?? p.rateCode;
                  const currentBookingType = edits.bookingType ?? p.bookingType;
                  const isChecked = selectedIds.includes(p.id);
                  const isModified = Boolean(edits.internalRoomType || edits.rateCode || edits.bookingType);

                  return (
                    <tr 
                      key={p.id} 
                      className={`hover:bg-[#f8faff] transition-colors relative group ${
                        isChecked ? 'bg-[#eff4ff]/60' : 'bg-white'
                      }`}
                    >
                      {/* 固定列首：Checkbox */}
                      <td className={`py-3 px-4 text-center sticky left-0 z-10 transition-colors border-b border-[#edf2f9] shadow-[1px_0_0_0_#edf2f9] ${
                        isChecked ? 'bg-[#f0f5ff] group-hover:bg-[#e8f1ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(p.id)}
                          className="w-4 h-4 rounded border-[#dce9ff] text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                        />
                      </td>

                      {/* 固定列首：OTA 产品 */}
                      <td className={`py-3 px-4 min-w-[280px] w-[280px] sticky left-12 z-10 transition-colors border-b border-[#edf2f9] shadow-[1px_0_0_0_#edf2f9] ${
                        isChecked ? 'bg-[#f0f5ff] group-hover:bg-[#e8f1ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#0b1c30] leading-snug">
                            {p.otaProductName}
                          </span>
                          <span className="text-[11px] text-[#737686] mt-1 font-mono">
                            OTA 产品编码： {p.otaProductCode}
                          </span>
                        </div>
                      </td>

                      {/* 固定列首：OTA 物理房型 */}
                      <td className={`py-3 px-4 min-w-[200px] w-[200px] sticky left-[328px] z-10 transition-colors border-b border-[#edf2f9] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06),1px_0_0_0_#edf2f9] ${
                        isChecked ? 'bg-[#f0f5ff] group-hover:bg-[#e8f1ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#0b1c30] leading-snug">
                            {p.otaPhysicalRoomName}
                          </span>
                          <span className="text-[11px] text-[#737686] mt-1 font-mono">
                            OTA 房型编码： {p.otaPhysicalRoomCode}
                          </span>
                        </div>
                      </td>

                      {/* 内部房型（集成带搜索过滤的 SearchableSelect 下拉框） */}
                      <td className="py-3 px-4 border-b border-[#edf2f9]">
                        <div className="w-full max-w-[200px]">
                          <SearchableSelect
                            value={currentInternalRoom}
                            onChange={(val) => handleRowValueChange(p.id, 'internalRoomType', val)}
                            options={INTERNAL_ROOM_OPTIONS}
                            placeholder="请选择内部房型"
                            searchPlaceholder="搜索房型名称、代码..."
                            size="sm"
                          />
                        </div>
                      </td>

                      {/* 房价码（集成带搜索过滤的 SearchableSelect 下拉框） */}
                      <td className="py-3 px-4 border-b border-[#edf2f9]">
                        <div className="w-full max-w-[170px]">
                          <SearchableSelect
                            value={currentRateCode}
                            onChange={(val) => handleRowValueChange(p.id, 'rateCode', val)}
                            options={RATE_CODE_OPTIONS}
                            placeholder="请选择房价码"
                            searchPlaceholder="搜索房价码、BAR..."
                            size="sm"
                          />
                        </div>
                      </td>

                      {/* 预订类型（集成带搜索过滤的 SearchableSelect 下拉框） */}
                      <td className="py-3 px-4 border-b border-[#edf2f9]">
                        <div className="w-full max-w-[120px]">
                          <SearchableSelect
                            value={currentBookingType}
                            onChange={(val) => handleRowValueChange(p.id, 'bookingType', val)}
                            options={BOOKING_TYPE_OPTIONS}
                            placeholder="预订类型"
                            searchPlaceholder="搜索预订类型..."
                            size="sm"
                          />
                        </div>
                      </td>

                      {/* 状态 */}
                      <td className="py-3 px-4 text-center whitespace-nowrap border-b border-[#edf2f9]">
                        <StatusBadge
                          variant={isModified ? 'warning' : 'success'}
                          label={isModified ? '待保存' : '已完成'}
                          size="xs"
                        />
                      </td>

                      {/* 固定列尾：操作 */}
                      <td className={`py-3 px-6 text-right whitespace-nowrap sticky right-0 z-10 transition-colors border-b border-[#edf2f9] shadow-[-1px_0_0_0_#edf2f9] ${
                        isChecked ? 'bg-[#f0f5ff] group-hover:bg-[#e8f1ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <div className="inline-flex items-center justify-end gap-1.5 shrink-0">
                          {/* 保存按钮 */}
                          <button
                            type="button"
                            onClick={() => handleSaveRow(p)}
                            className={`inline-flex items-center justify-center gap-1 h-7.5 px-2.5 text-xs font-medium rounded-md shadow-2xs transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none ${
                              isModified
                                ? 'text-white bg-[#004ac6] hover:bg-[#003da6] ring-2 ring-[#004ac6]/30'
                                : 'text-white bg-[#004ac6] hover:bg-[#003da6]'
                            }`}
                            title="保存当前行映射配置"
                          >
                            <Save className="w-3.5 h-3.5 shrink-0" />
                            <span>保存</span>
                          </button>

                          {/* 删除按钮 */}
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(p)}
                            className="inline-flex items-center justify-center gap-1 h-7.5 px-2.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                            title="删除产品映射"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>删除</span>
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

        {/* 4. 底部标准化分页组件 (shrink-0 固定在卡片底部) */}
        <Pagination
          totalItems={totalItems}
          currentPage={safeCurrentPage}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          pageSizeOptions={[10, 20, 50, 100]}
          itemUnit="条产品"
        />
      </div>
    </div>
  );
};
