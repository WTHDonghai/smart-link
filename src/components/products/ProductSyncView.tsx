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
import { addLog } from '../../store/slices/systemLogSlice';
import { 
  Search, 
  X, 
  RefreshCw, 
  Save, 
  Trash2, 
  Filter, 
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { ProductMapping } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';

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

  const allSelected = filteredProducts.length > 0 && selectedIds.length === filteredProducts.length;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(filteredProducts.map(p => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleInvertSelect = () => {
    const currentSelectedSet = new Set(selectedIds);
    const newSelected = filteredProducts
      .filter(p => !currentSelectedSet.has(p.id))
      .map(p => p.id);
    setSelectedIds(newSelected);
  };

  const handleRowValueChange = (id: string, field: 'internalRoomType' | 'rateCode' | 'bookingType', value: string) => {
    setRowEdits(prev => ({
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
    setRowEdits(prev => {
      const next = { ...prev };
      delete next[product.id];
      return next;
    });

    dispatch(showToast({
      title: `已保存「${product.otaPhysicalRoomName}」映射`,
      description: `内部房型: ${updatedPayload.internalRoomType} | 房价码: ${updatedPayload.rateCode}`,
      type: 'success'
    }));

    dispatch(addLog({
      level: 'INFO',
      channelId: product.otaChannelId,
      message: `[ProductSync] Saved product mapping for ${product.otaProductName} (${product.otaProductCode})`
    }));
  };

  const handleDeleteRow = (product: ProductMapping) => {
    dispatch(deleteProduct(product.id));
    setSelectedIds(prev => prev.filter(id => id !== product.id));
    dispatch(showToast({
      title: `已删除房型「${product.otaPhysicalRoomName}」映射`,
      description: '该产品映射已从列表移除',
      type: 'info'
    }));
    dispatch(addLog({
      level: 'WARN',
      channelId: product.otaChannelId,
      message: `[ProductSync] Deleted product mapping ${product.otaProductName} (${product.otaProductCode})`
    }));
  };

  // 批量保存
  const handleBatchSave = () => {
    if (selectedIds.length === 0) return;

    selectedIds.forEach(id => {
      const p = products.find(prod => prod.id === id);
      if (p) {
        const currentEdits = rowEdits[p.id] || {};
        dispatch(updateProductMapping({
          id: p.id,
          internalRoomType: currentEdits.internalRoomType ?? p.internalRoomType,
          rateCode: currentEdits.rateCode ?? p.rateCode,
          bookingType: currentEdits.bookingType ?? p.bookingType,
          status: 'completed'
        }));
      }
    });

    // Clear saved draft edits
    setRowEdits(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => delete next[id]);
      return next;
    });

    dispatch(showToast({
      title: `批量保存成功 (${selectedIds.length} 项)`,
      description: '已将所选房型的内部房型、房价码及预订类型同步生效',
      type: 'success'
    }));

    dispatch(addLog({
      level: 'INFO',
      channelId: filterChannel,
      message: `[ProductSync] Batch saved ${selectedIds.length} products: ${selectedIds.join(', ')}`
    }));
  };

  // 批量删除
  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    dispatch(batchDeleteProducts(selectedIds));
    setSelectedIds([]);
    
    dispatch(showToast({
      title: `批量删除成功 (${count} 项)`,
      description: '所选产品的映射配置已从系统移除',
      type: 'info'
    }));

    dispatch(addLog({
      level: 'WARN',
      channelId: filterChannel,
      message: `[ProductSync] Batch deleted ${count} products`
    }));
  };

  // 保存所有更改 (包括未勾选但已修改的行)
  const modifiedCount = Object.keys(rowEdits).length;
  const handleSaveAllModified = () => {
    if (modifiedCount === 0) return;
    Object.keys(rowEdits).forEach((id) => {
      const edits = rowEdits[id];
      if (edits) {
        dispatch(updateProductMapping({
          id,
          internalRoomType: edits.internalRoomType,
          rateCode: edits.rateCode,
          bookingType: edits.bookingType,
          status: 'completed'
        }));
      }
    });
    setRowEdits({});
    dispatch(showToast({
      title: `已保存全部变更 (${modifiedCount} 处)`,
      description: '所有修改均已成功保存并同步',
      type: 'success'
    }));
  };

  const handleCrawlOtaProducts = () => {
    if (isCrawling) return;
    setIsCrawling(true);
    dispatch(showToast({
      title: '正在启动 OTA 产品采集爬虫...',
      description: `通过 Playwright 抓取「${filterHotel}」最新物理房型与价格计划`,
      type: 'info'
    }));

    setTimeout(() => {
      setIsCrawling(false);
      dispatch(showToast({
        title: 'OTA 产品采集完成',
        description: `成功同步「${filterHotel}」最新 5 个物理房型与价格日历`,
        type: 'success'
      }));
      dispatch(addLog({
        level: 'INFO',
        channelId: filterChannel,
        message: `[ProductCrawl] Playwright crawled products for hotel ${filterHotel}, total matched: ${filteredProducts.length}`
      }));
    }, 1500);
  };

  const handleResetFilters = () => {
    dispatch(setProductSearch(''));
    setFilterStatus('all');
  };

  return (
    <div className="flex flex-col gap-4 max-w-[1440px] mx-auto w-full p-6">
      {/* 1. 顶部控制栏：OTA渠道与酒店 + 采集OTA产品主操作按钮（操作前置，直观高效） */}
      <div className="bg-white rounded-xl p-4 border border-[#e2e8f0] shadow-2xs flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
          {/* OTA 渠道下拉框 */}
          <div>
            <label className="block text-xs font-bold text-[#0b1c30] mb-1.5">
              OTA 渠道
            </label>
            <SearchableSelect
              value={filterChannel}
              onChange={(val) => dispatch(setProductFilterChannel(val))}
              options={CHANNEL_OPTIONS}
              placeholder="请选择 OTA 渠道"
              searchPlaceholder="搜索渠道名称、代码..."
              size="md"
              buttonClassName="font-semibold text-[#0b1c30]"
            />
          </div>

          {/* 酒店下拉框 */}
          <div>
            <label className="block text-xs font-bold text-[#0b1c30] mb-1.5">
              酒店
            </label>
            <SearchableSelect
              value={filterHotel}
              onChange={(val) => dispatch(setProductFilterHotel(val))}
              options={hotelOptions}
              placeholder="请选择或搜索酒店..."
              searchPlaceholder="输入酒店名称、城市或关键字过滤..."
              size="md"
              buttonClassName="font-semibold text-[#0b1c30] border-[#004ac6]"
            />
          </div>
        </div>

        {/* 右侧主动作组：包含保存所有修改与采集OTA产品按钮 */}
        <div className="flex items-center gap-2 shrink-0 md:pb-0.5">
          {modifiedCount > 0 && (
            <button
              type="button"
              onClick={handleSaveAllModified}
              className="h-10 px-3.5 text-xs font-semibold text-[#b45309] bg-[#fffbeb] hover:bg-[#fef3c7] border border-[#fde68a] rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer animate-pulse"
              title="一键保存所有尚未保存的行修改"
            >
              <Sparkles className="w-4 h-4 text-[#d97706]" />
              <span>保存所有修改 ({modifiedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCrawlOtaProducts}
            disabled={isCrawling}
            className="h-10 px-4 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003ea8] active:bg-[#003590] rounded-lg shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60 shrink-0"
          >
            {isCrawling ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>采集 OTA 产品中...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>采集 OTA 产品</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. 数据与过滤一体化卡片：过滤条件 + 批量操作工具栏 + 产品列表一体成型 */}
      <div className="bg-white rounded-xl shadow-xs border border-[#e2e8f0] overflow-visible flex flex-col divide-y divide-[#e2e8f0]">
        {/* 表格专属内嵌搜索过滤条件栏 */}
        <div className="p-3.5 bg-[#fafafa] flex flex-wrap items-center justify-between gap-3">
          {/* 左侧搜索输入与快速过滤 */}
          <div className="flex items-center gap-3 flex-1 min-w-[300px]">
            {/* 关键字搜索输入框 */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#737686] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => dispatch(setProductSearch(e.target.value))}
                placeholder="搜索 OTA产品名称、产品编码、物理房型、房型编码..."
                className="w-full h-9 pl-9 pr-8 bg-white rounded-lg border border-[#dce9ff] focus:border-[#004ac6] focus:outline-hidden text-xs text-[#0b1c30] placeholder-[#a0aec0] transition-colors"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => dispatch(setProductSearch(''))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#a0aec0] hover:text-[#525f7f] p-0.5 cursor-pointer"
                  title="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 状态快捷过滤单选群 */}
            <div className="flex items-center bg-[#f1f5f9] p-0.5 rounded-lg text-xs shrink-0">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'all'
                    ? 'bg-white text-[#004ac6] shadow-2xs font-semibold'
                    : 'text-[#64748b] hover:text-[#0b1c30]'
                }`}
              >
                全部状态
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('completed')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'completed'
                    ? 'bg-white text-[#52c41a] shadow-2xs font-semibold'
                    : 'text-[#64748b] hover:text-[#0b1c30]'
                }`}
              >
                已完成
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('pending')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'pending'
                    ? 'bg-white text-[#d48806] shadow-2xs font-semibold'
                    : 'text-[#64748b] hover:text-[#0b1c30]'
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
          <div className="flex items-center gap-2 text-xs text-[#737686] shrink-0">
            <span>检索到 <strong className="text-[#004ac6] font-bold">{filteredProducts.length}</strong> / {products.length} 条产品</span>
          </div>
        </div>

        {/* 批量操作工具条（无缝衔接在过滤栏与表格之间） */}
        <div className={`p-2.5 transition-all duration-200 ${
          selectedIds.length > 0 
            ? 'bg-[#eff6ff]' 
            : 'bg-[#fafafa]/80'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* 左侧批量选择控制 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                />
                <span className="text-xs font-bold text-[#0b1c30]">全选</span>
              </div>

              <button
                type="button"
                onClick={handleInvertSelect}
                className="text-xs text-[#525f7f] hover:text-[#004ac6] px-2 py-1 rounded bg-white hover:bg-[#f1f5f9] border border-gray-200 transition-colors cursor-pointer"
              >
                反选
              </button>

              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-[#525f7f] hover:text-[#ba1a1a] px-2 py-1 rounded bg-white hover:bg-[#fff1f0] border border-gray-200 transition-colors cursor-pointer"
                >
                  清空选择
                </button>
              )}

              <div className="h-4 w-px bg-gray-300 mx-1" />

              <span className="text-xs text-[#525f7f] flex items-center gap-1">
                已选 <strong className={`text-xs ${selectedIds.length > 0 ? 'text-[#004ac6]' : 'text-[#737686]'}`}>{selectedIds.length}</strong> 项
              </span>
            </div>

            {/* 右侧批量操作动作组：仅保留批量保存和批量删除 */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* 批量保存按钮 */}
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={handleBatchSave}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003ea8] rounded-md transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="px-3 py-1.5 text-xs font-semibold text-[#ba1a1a] bg-[#fff1f0] hover:bg-[#ffdad6] border border-[#ffccc7] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="批量移除所选产品的映射"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>批量删除</span>
              </button>
            </div>
          </div>
        </div>

        {/* 产品映射表格列表：支持列首固定（选择框）与列尾固定（操作列） */}
        <div className="overflow-x-auto min-h-[360px] pb-12">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fafafa] text-[#0b1c30] text-xs font-semibold border-b border-[#e5edfa]">
                {/* 固定列首：多选框 (left: 0, 宽度 48px) */}
                <th className="py-3 px-4 w-12 text-center sticky left-0 z-20 bg-[#fafafa] shadow-[1px_0_0_0_#e5edfa]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                  />
                </th>
                {/* 固定列首：OTA 产品 (left: 48px, 宽度 280px) */}
                <th className="py-3 px-4 min-w-[280px] w-[280px] sticky left-12 z-20 bg-[#fafafa] shadow-[1px_0_0_0_#e5edfa]">
                  OTA 产品
                </th>
                {/* 固定列首：OTA 物理房型 (left: 328px, 宽度 200px) */}
                <th className="py-3 px-4 min-w-[200px] w-[200px] sticky left-[328px] z-20 bg-[#fafafa] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06),1px_0_0_0_#e5edfa]">
                  OTA 物理房型
                </th>
                <th className="py-3 px-4 min-w-[180px]">内部房型</th>
                <th className="py-3 px-4 min-w-[160px]">房价码</th>
                <th className="py-3 px-4 min-w-[120px]">预订类型</th>
                <th className="py-3 px-4 text-center w-20 whitespace-nowrap">状态</th>
                {/* 固定列尾：操作列 */}
                <th className="py-3 px-6 text-right whitespace-nowrap w-36 sticky right-0 z-20 bg-[#fafafa] shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.06),-1px_0_0_0_#e5edfa]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-xs text-[#0b1c30]">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Filter className="w-8 h-8 text-gray-300" />
                      <p className="text-xs text-[#737686]">暂无匹配的产品映射数据</p>
                      {(searchKeyword || filterStatus !== 'all') && (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="mt-1 px-3 py-1 text-xs text-[#004ac6] bg-[#edf4ff] hover:bg-[#dce9ff] rounded cursor-pointer transition-colors"
                        >
                          清除过滤条件
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
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
                        isChecked ? 'bg-[#f0f6ff]/45' : 'bg-white'
                      }`}
                    >
                      {/* 固定列首：Checkbox (left: 0) */}
                      <td className={`py-3.5 px-4 text-center sticky left-0 z-10 transition-colors shadow-[1px_0_0_0_#edf3fc] ${
                        isChecked ? 'bg-[#f4f8ff] group-hover:bg-[#f0f5ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(p.id)}
                          className="w-4 h-4 rounded border-gray-300 text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                        />
                      </td>

                      {/* 固定列首：OTA 产品 (left: 48px) */}
                      <td className={`py-3.5 px-4 min-w-[280px] w-[280px] sticky left-12 z-10 transition-colors shadow-[1px_0_0_0_#edf3fc] ${
                        isChecked ? 'bg-[#f4f8ff] group-hover:bg-[#f0f5ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#0b1c30] leading-snug">
                            {p.otaProductName}
                          </span>
                          <span className="text-[11px] text-[#737686] mt-1 font-sans">
                            OTA 产品编码： {p.otaProductCode}
                          </span>
                        </div>
                      </td>

                      {/* 固定列首：OTA 物理房型 (left: 328px) */}
                      <td className={`py-3.5 px-4 min-w-[200px] w-[200px] sticky left-[328px] z-10 transition-colors shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06),1px_0_0_0_#edf3fc] ${
                        isChecked ? 'bg-[#f4f8ff] group-hover:bg-[#f0f5ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#0b1c30] leading-snug">
                            {p.otaPhysicalRoomName}
                          </span>
                          <span className="text-[11px] text-[#737686] mt-1 font-sans">
                            OTA 物理房型编码： {p.otaPhysicalRoomCode}
                          </span>
                        </div>
                      </td>

                      {/* 内部房型（集成带搜索过滤的 SearchableSelect 下拉框） */}
                      <td className="py-3.5 px-4">
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
                      <td className="py-3.5 px-4">
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
                      <td className="py-3.5 px-4">
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
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {isModified ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#fffbe6] text-[#d48806] border border-[#ffe58f] shrink-0 select-none">
                            待保存
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#f6ffed] text-[#52c41a] border border-[#b7eb8f] shrink-0 select-none">
                            已完成
                          </span>
                        )}
                      </td>

                      {/* 固定列尾：操作（包含 保存 与 删除 按钮） */}
                      <td className={`py-3.5 px-6 text-right whitespace-nowrap sticky right-0 z-10 transition-colors shadow-[-1px_0_0_0_#edf3fc] ${
                        isChecked ? 'bg-[#f4f8ff] group-hover:bg-[#f0f5ff]' : 'bg-white group-hover:bg-[#f8faff]'
                      }`}>
                        <div className="inline-flex items-center justify-end gap-1.5 shrink-0">
                          {/* 保存按钮 */}
                          <button
                            type="button"
                            onClick={() => handleSaveRow(p)}
                            className={`inline-flex items-center justify-center gap-1 h-7.5 px-2.5 text-xs font-medium rounded-md shadow-2xs transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none ${
                              isModified
                                ? 'text-white bg-[#004ac6] hover:bg-[#003ea8] ring-2 ring-[#004ac6]/30'
                                : 'text-white bg-[#004ac6] hover:bg-[#003ea8]'
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
                            className="inline-flex items-center justify-center gap-1 h-7.5 px-2.5 text-xs font-medium text-[#ff4d4f] bg-[#fff1f0] hover:bg-[#ffccc7] border border-[#ffa39e]/60 rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
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
      </div>
    </div>
  );
};
