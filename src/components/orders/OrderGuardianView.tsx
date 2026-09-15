import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  toggleAutoGuarding,
  setOrderFilterStatus, 
  setSearchKeyword, 
  setDateRange, 
  resetFilters,
  retryOrderTransfer,
  importOrderDirectly,
  updateOrder,
  deleteOrder,
  cancelOrder
} from '../../store/slices/orderGuardianSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { GuardianOrder } from '../../types';
import { EditOrderModal } from './EditOrderModal';
import { 
  Calendar, 
  MoreVertical, 
  Edit3, 
  Download, 
  Trash2, 
  Ban, 
  Copy, 
  Play, 
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export const OrderGuardianView: React.FC = () => {
  const dispatch = useAppDispatch();
  const orders = useAppSelector((state) => state.orderGuardian.orders);
  const isAutoGuarding = useAppSelector((state) => state.orderGuardian.isAutoGuarding);
  const stats = useAppSelector((state) => state.orderGuardian.stats);
  const filterStatus = useAppSelector((state) => state.orderGuardian.filterStatus);
  const searchKeyword = useAppSelector((state) => state.orderGuardian.searchKeyword);
  const startDate = useAppSelector((state) => state.orderGuardian.startDate);
  const endDate = useAppSelector((state) => state.orderGuardian.endDate);

  // Local form inputs for query
  const [keywordInput, setKeywordInput] = useState(searchKeyword);
  const [startInput, setStartInput] = useState(startDate);
  const [endInput, setEndInput] = useState(endDate);
  
  // Dropdown menu state
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | null>(null);

  // Edit modal state
  const [editingOrder, setEditingOrder] = useState<GuardianOrder | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(5);
  const [jumpInput, setJumpInput] = useState<string>('');

  // Filter tabs definition matching reference image
  const STATUS_TABS = [
    { label: '全部', value: 'all' },
    { label: '待确认', value: 'pending' },
    { label: '成功', value: 'success' },
    { label: '失败', value: 'failed' },
    { label: '取消', value: 'cancelled' },
    { label: '导入中', value: 'importing' }
  ] as const;

  // Filter calculation
  const filteredOrders = orders.filter((o) => {
    // Status tab filter
    if (filterStatus !== 'all') {
      if (filterStatus === 'success' && o.status !== 'success' && o.status !== 'confirmed' && o.status !== 'transferred') {
        return false;
      }
      if (filterStatus === 'failed' && o.status !== 'failed' && o.status !== 'manual_review') {
        return false;
      }
      if (filterStatus === 'pending' && o.status !== 'pending' && o.status !== 'manual_review') {
        return false;
      }
      if (filterStatus === 'cancelled' && o.status !== 'cancelled') {
        return false;
      }
      if (filterStatus === 'importing' && o.status !== 'importing' && o.status !== 'processing') {
        return false;
      }
    }

    // Keyword filter
    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase();
      const matchNo = o.otaOrderNo.toLowerCase().includes(kw) || o.pmsOrderNo.toLowerCase().includes(kw);
      const matchGuest = o.guestName.toLowerCase().includes(kw) || o.guestPhone.includes(kw);
      const matchHotel = o.hotelName.toLowerCase().includes(kw);
      if (!matchNo && !matchGuest && !matchHotel) return false;
    }

    // Date range filter
    if (startDate && o.checkInDate < startDate) return false;
    if (endDate && o.checkInDate > endDate) return false;

    return true;
  });

  // Calculate pagination metrics
  const totalItems = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  // Paginated records
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(jumpInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      setCurrentPage(target);
      setJumpInput('');
    } else {
      dispatch(showToast({
        title: '页码无效',
        description: `请输入 1 至 ${totalPages} 之间的有效页码`,
        type: 'info'
      }));
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    dispatch(setSearchKeyword(keywordInput));
    dispatch(setDateRange({ startDate: startInput, endDate: endInput }));
  };

  const handleReset = () => {
    setCurrentPage(1);
    setKeywordInput('');
    setStartInput('');
    setEndInput('');
    dispatch(resetFilters());
  };

  const handleTabChange = (status: any) => {
    setCurrentPage(1);
    dispatch(setOrderFilterStatus(status));
  };

  // Generate pagination range with smart ellipsis
  const getPaginationRange = (): (number | string)[] => {
    const delta = 1;
    const range: (number | string)[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= safeCurrentPage - delta && i <= safeCurrentPage + delta)) {
        range.push(i);
      } else if (range[range.length - 1] !== '...') {
        range.push('...');
      }
    }
    return range;
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    dispatch(showToast({
      title: '已复制单号',
      description: text,
      type: 'success'
    }));
    setActiveMenuOrderId(null);
  };

  const handleOpenEdit = (order: GuardianOrder) => {
    setEditingOrder(order);
    setActiveMenuOrderId(null);
  };

  const handleDirectImport = (order: GuardianOrder) => {
    dispatch(importOrderDirectly(order.id));
    dispatch(showToast({
      title: '订单导入成功',
      description: `订单 ${order.otaOrderNo} 已成功推入中台并生成确认号`,
      type: 'success'
    }));
    dispatch(addLog({
      level: 'SUCCESS',
      channelId: order.channelId,
      message: `[OrderGuardian] 用户手动导入订单 ${order.otaOrderNo} 成功`
    }));
    setActiveMenuOrderId(null);
  };

  const handleDeleteOrder = (order: GuardianOrder) => {
    dispatch(deleteOrder(order.id));
    dispatch(showToast({
      title: '已删除订单记录',
      description: `订单 ${order.otaOrderNo} 已从值守列表中移除`,
      type: 'info'
    }));
    setActiveMenuOrderId(null);
  };

  const handleCancelOrder = (order: GuardianOrder) => {
    dispatch(cancelOrder(order.id));
    dispatch(showToast({
      title: '已取消订单',
      description: `订单 ${order.otaOrderNo} 状态已更新为取消`,
      type: 'info'
    }));
    setActiveMenuOrderId(null);
  };

  const handleSaveEditedOrder = (updatedData: Partial<GuardianOrder>, shouldImport: boolean) => {
    if (!editingOrder) return;

    dispatch(updateOrder({
      id: editingOrder.id,
      ...updatedData
    }));

    if (shouldImport) {
      dispatch(importOrderDirectly(editingOrder.id));
      dispatch(showToast({
        title: '订单已保存并导入',
        description: `订单 ${editingOrder.otaOrderNo} 已同步至中台并确认`,
        type: 'success'
      }));
    } else {
      dispatch(showToast({
        title: '订单修改已保存',
        description: `订单 ${editingOrder.otaOrderNo} 预订信息已更新`,
        type: 'success'
      }));
    }

    setEditingOrder(null);
  };

  const handleToggleGuarding = () => {
    dispatch(toggleAutoGuarding());
    if (!isAutoGuarding) {
      dispatch(showToast({
        title: '已开启订单值守',
        description: '系统已启动自动抓单与中台分发守护机制',
        type: 'success'
      }));
      dispatch(addLog({
        level: 'INFO',
        message: '[OrderGuardian] 用户手动开启订单值守服务，自动化搬单守护已启动'
      }));
    } else {
      dispatch(showToast({
        title: '已暂停订单值守',
        description: '系统已停止自动抓单与直推流程',
        type: 'info'
      }));
      dispatch(addLog({
        level: 'WARN',
        message: '[OrderGuardian] 订单值守已暂停'
      }));
    }
  };

  // 格式化同步时间：年月日 时分 (YYYY-MM-DD HH:mm)，无冗余信息
  const formatSyncTime = (val?: string) => {
    if (!val) return '2026-09-14 19:30';
    const clean = val.replace('T', ' ').trim();
    const fullMatch = clean.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
    if (fullMatch) {
      return `${fullMatch[1]} ${fullMatch[2]}`;
    }
    const timeMatch = clean.match(/^(\d{1,2}:\d{2})/);
    if (timeMatch) {
      return `2026-09-14 ${timeMatch[1]}`;
    }
    return clean;
  };

  return (
    <div className="w-full h-full flex flex-col p-5 bg-[#f8f9fc] text-[#0b1c30] overflow-hidden min-h-0">
      {/* 顶部统计卡片（4列简洁布局，精确对标截图） */}
      <div className="grid grid-cols-4 gap-3.5 mb-3 shrink-0">
        {/* 卡片 1: 今日导入 */}
        <div className="bg-[#f8f9fa] rounded-md p-3.5 flex flex-col justify-between h-[74px] border border-[#f0f2f5]">
          <span className="text-2xl font-bold text-[#0b1c30] leading-none">
            {stats.todayImported}
          </span>
          <span className="text-xs text-[#6b7280]">
            今日导入
          </span>
        </div>

        {/* 卡片 2: 待确认 (浅橙米黄底) */}
        <div className="bg-[#fff8ee] rounded-md p-3.5 flex flex-col justify-between h-[74px]">
          <span className="text-2xl font-bold text-[#c2410c] leading-none">
            {stats.pendingConfirm}
          </span>
          <span className="text-xs text-[#78716c]">
            待确认
          </span>
        </div>

        {/* 卡片 3: 已导入 (薄荷浅绿底) */}
        <div className="bg-[#e6f7f0] rounded-md p-3.5 flex flex-col justify-between h-[74px]">
          <span className="text-2xl font-bold text-[#0d9488] leading-none">
            {stats.imported}
          </span>
          <span className="text-xs text-[#047857]">
            已导入
          </span>
        </div>

        {/* 卡片 4: 失败 (浅粉红底) */}
        <div className="bg-[#fdeef0] rounded-md p-3.5 flex flex-col justify-between h-[74px]">
          <span className="text-2xl font-bold text-[#dc2626] leading-none">
            {stats.failed}
          </span>
          <span className="text-xs text-[#991b1b]">
            失败
          </span>
        </div>
      </div>

      {/* 状态切换 Tabs 与开始值守按钮 */}
      <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => {
            const isActive = filterStatus === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => handleTabChange(tab.value)}
                className={`px-3.5 py-1.5 rounded text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#4850e5] text-white shadow-2xs'
                    : 'bg-[#f3f4f6] text-[#374151] hover:bg-[#e5e7eb]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 开始值守按钮 */}
        <button
          type="button"
          onClick={handleToggleGuarding}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
            isAutoGuarding
              ? 'bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0] hover:bg-[#d1fae5]'
              : 'bg-[#10b981] hover:bg-[#059669] text-white active:bg-[#047857]'
          }`}
          title={isAutoGuarding ? '点击可暂停值守' : '点击启动订单全自动值守'}
        >
          {isAutoGuarding ? (
            <>
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
              <span>值守中</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3 fill-current" />
              <span>开始值守</span>
            </>
          )}
        </button>
      </div>

      {/* 搜索与筛选表单行 */}
      <div className="mb-3 shrink-0">
        {/* 上排小标签 */}
        <div className="flex items-center justify-between text-xs text-[#4b5563] mb-1.5 px-0.5">
          <div>订单或客人</div>
          <div className="flex items-center gap-12 pr-44">
            <span>入住开始</span>
            <span className="text-gray-400">至</span>
            <span>入住结束</span>
          </div>
        </div>

        {/* 下排输入控件 */}
        <div className="flex items-center gap-3">
          {/* 宽幅搜索框 */}
          <div className="flex-1">
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索订单号或客人姓名"
              className="w-full h-9 px-3 bg-white border border-[#d1d5db] rounded text-xs text-[#111827] placeholder-[#9ca3af] outline-none focus:border-[#4850e5]"
            />
          </div>

          {/* 入住开始日期 */}
          <div className="relative w-40">
            <input
              type="text"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              placeholder="mm/dd/yyyy"
              className="w-full h-9 pl-3 pr-8 bg-white border border-[#d1d5db] rounded text-xs text-[#111827] placeholder-[#9ca3af] outline-none focus:border-[#4850e5]"
            />
            <Calendar className="w-3.5 h-3.5 text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <span className="text-xs text-[#6b7280]">至</span>

          {/* 入住结束日期 */}
          <div className="relative w-40">
            <input
              type="text"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              placeholder="mm/dd/yyyy"
              className="w-full h-9 pl-3 pr-8 bg-white border border-[#d1d5db] rounded text-xs text-[#111827] placeholder-[#9ca3af] outline-none focus:border-[#4850e5]"
            />
            <Calendar className="w-3.5 h-3.5 text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 查询订单按钮 */}
          <button
            type="button"
            onClick={handleSearch}
            className="h-9 px-5 bg-[#4850e5] hover:bg-[#3d45cf] text-white rounded text-xs font-medium transition-colors cursor-pointer shrink-0"
          >
            查询订单
          </button>

          {/* 重置筛选按钮 */}
          <button
            type="button"
            onClick={handleReset}
            className="h-9 px-4 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[#374151] border border-[#e5e7eb] rounded text-xs font-medium transition-colors cursor-pointer shrink-0"
          >
            重置筛选
          </button>
        </div>
      </div>

      {/* 订单表格容器 (填充剩余空间，固定表头字段行与底部分页行) */}
      <div className="flex-1 min-h-0 bg-white rounded-md border border-[#e5e7eb] flex flex-col overflow-hidden shadow-2xs">
        {/* 表格可滚动区域 (字段行/表头 sticky 固定在顶部，酒店/OTA订单固定在左，操作固定在右) */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-separate border-spacing-0 min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-[#f9fafb]">
              <tr className="text-xs text-[#6b7280] font-normal shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                {/* 固定列：酒店 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 left-0 z-30 w-[180px] min-w-[180px] max-w-[180px] border-b border-[#e5e7eb]">
                  酒店
                </th>
                {/* 固定列：OTA 订单 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 left-[180px] z-30 w-[210px] min-w-[210px] max-w-[210px] border-b border-r border-[#e5e7eb] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                  OTA 订单
                </th>
                {/* 滚动列：同步时间 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[140px] border-b border-[#e5e7eb]">
                  同步时间
                </th>
                {/* 滚动列：抵离日期 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[110px] border-b border-[#e5e7eb]">
                  抵离日期
                </th>
                {/* 滚动列：房型 / 房价 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[240px] max-w-[320px] border-b border-[#e5e7eb]">
                  房型 / 房价
                </th>
                {/* 滚动列：金额 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[90px] border-b border-[#e5e7eb]">
                  金额
                </th>
                {/* 滚动列：状态 */}
                <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[120px] border-b border-[#e5e7eb]">
                  状态
                </th>
                {/* 固定列：操作 */}
                <th className="py-2.5 px-6 font-normal text-right bg-[#f9fafb] whitespace-nowrap sticky top-0 right-0 z-30 w-[84px] min-w-[84px] border-b border-l border-[#e5e7eb] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400 border-b border-[#f3f4f6]">
                    暂无符合条件的订单记录
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((ord, index) => {
                  const isSuccess = ord.status === 'success' || ord.status === 'confirmed' || ord.status === 'transferred';
                  const isCancelled = ord.status === 'cancelled';
                  const isMenuOpen = activeMenuOrderId === ord.id;
                  const isNearBottom = index >= Math.max(0, paginatedOrders.length - 2);

                  return (
                    <tr key={ord.id} className="hover:bg-[#fafafa] transition-colors group">
                      {/* 固定列 1：酒店 */}
                      <td className="py-3.5 px-4 align-top sticky left-0 z-10 bg-white group-hover:bg-[#fafafa] w-[180px] min-w-[180px] max-w-[180px] border-b border-[#f3f4f6]">
                        <div className="flex flex-col">
                          <span className="font-bold text-[#111827] text-xs leading-snug" title={ord.hotelName}>
                            {ord.hotelName}
                          </span>
                          <span className="inline-block mt-1 w-fit text-[11px] px-1.5 py-0.2 bg-gray-100 text-gray-700 rounded font-normal">
                            {ord.channelName}
                          </span>
                        </div>
                      </td>

                      {/* 固定列 2：OTA 订单 */}
                      <td className="py-3.5 px-4 align-top sticky left-[180px] z-10 bg-white group-hover:bg-[#fafafa] w-[210px] min-w-[210px] max-w-[210px] border-b border-r border-[#e5e7eb] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        <div className="flex flex-col">
                          <span 
                            onClick={() => handleCopy(ord.otaOrderNo)}
                            className="font-bold text-[#3b82f6] text-xs hover:underline cursor-pointer tracking-tight truncate"
                            title="点击复制 OTA 订单号"
                          >
                            {ord.otaOrderNo}
                          </span>
                          <span className="text-[11px] text-[#6b7280] mt-0.5 truncate" title={`${ord.guestName} / ${ord.guestPhone}`}>
                            {ord.guestName} / {ord.guestPhone}
                          </span>
                        </div>
                      </td>

                      {/* 同步时间：格式为 年月日 时分，无冗余信息 */}
                      <td className="py-3.5 px-4 align-top whitespace-nowrap min-w-[140px] border-b border-[#f3f4f6]">
                        <span className="text-[#111827] text-xs font-mono font-medium">
                          {formatSyncTime(ord.transferredAt || ord.scrapedAt)}
                        </span>
                      </td>

                      {/* 抵离日期 */}
                      <td className="py-3.5 px-4 align-top min-w-[110px] border-b border-[#f3f4f6]">
                        <div className="flex flex-col">
                          <span className="font-bold text-[#111827] text-xs">
                            {ord.checkInDate}
                          </span>
                          <span className="text-[11px] text-[#6b7280] mt-0.5">
                            {ord.checkOutDate}
                          </span>
                        </div>
                      </td>

                      {/* 房型 / 房价：换行后截断省略，鼠标悬浮显示全部信息 */}
                      <td className="py-3.5 px-4 align-top min-w-[240px] max-w-[320px] border-b border-[#f3f4f6]">
                        <div 
                          className="relative group/room cursor-help"
                          title={`${ord.roomTypeName}\n房价方案: ${ord.ratePlanCode || 'OTA标准价'}${ord.remark ? ` (${ord.remark})` : ''}`}
                        >
                          <div className="flex flex-col">
                            <span className="font-bold text-[#111827] text-xs leading-relaxed line-clamp-2 break-all">
                              {ord.roomTypeName}
                            </span>
                            <span className="text-[11px] text-[#6b7280] mt-0.5 truncate">
                              {ord.ratePlanCode || 'OTA'}
                            </span>
                          </div>

                          {/* 悬浮气泡提示卡：显示完整房型与房价计划 */}
                          <div 
                            className={`absolute left-0 z-50 hidden group-hover/room:block pointer-events-none ${
                              isNearBottom ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                            } w-80 p-3 bg-gray-900/95 backdrop-blur-xs text-white rounded-lg shadow-2xl border border-gray-700 text-xs leading-relaxed animate-in fade-in duration-150`}
                          >
                            <div className="text-[11px] text-gray-400 mb-1 flex items-center justify-between">
                              <span>完整房型 / 房价信息</span>
                              <span className="text-amber-400 font-mono">{ord.channelName}</span>
                            </div>
                            <div className="font-medium text-white mb-2 break-words">
                              {ord.roomTypeName}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-gray-300 pt-1.5 border-t border-gray-700/80">
                              <span className="text-gray-400">房价方案:</span>
                              <span className="text-amber-300 font-medium">{ord.ratePlanCode || 'OTA标准价'}</span>
                            </div>
                            {ord.remark && (
                              <div className="text-[11px] text-gray-400 mt-1.5 pt-1.5 border-t border-gray-800 break-words">
                                备注: {ord.remark}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 金额 */}
                      <td className="py-3.5 px-4 align-top min-w-[90px] border-b border-[#f3f4f6]">
                        <span className="font-bold text-[#111827] text-xs">
                          ¥{typeof ord.otaPrice === 'number' ? (ord.otaPrice % 1 === 0 ? ord.otaPrice : ord.otaPrice.toFixed(2)) : ord.otaPrice}
                        </span>
                      </td>

                      {/* 状态 */}
                      <td className="py-3.5 px-4 align-top min-w-[120px] border-b border-[#f3f4f6]">
                        <div className="flex flex-col">
                          {isSuccess ? (
                            <>
                              <span className="inline-block w-fit text-[11px] px-2 py-0.2 rounded-full bg-[#f0fdf4] text-[#16a34a] border border-[#bbf7d0] font-normal">
                                成功
                              </span>
                              <span className="text-[11px] text-[#16a34a] font-mono mt-0.5">
                                {ord.pmsOrderNo || '已入账确认'}
                              </span>
                            </>
                          ) : isCancelled ? (
                            <>
                              <span className="inline-block w-fit text-[11px] px-2 py-0.2 rounded-full bg-gray-100 text-gray-600 border border-gray-200 font-normal">
                                取消
                              </span>
                              <span className="text-[11px] text-gray-500 mt-0.5">
                                {ord.failureReason || '已取消预订'}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="inline-block w-fit text-[11px] px-2 py-0.2 rounded-full bg-[#fef2f2] text-[#ef4444] border border-[#fecaca] font-normal">
                                失败
                              </span>
                              <span className="text-[11px] text-[#ef4444] mt-0.5">
                                {ord.failureReason || '预订类型不存在'}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* 固定列：操作 (与截图一致的微圆角方框三点按钮，支持下拉菜单) */}
                      <td className={`py-3 px-6 align-top text-right sticky right-0 bg-white group-hover:bg-[#fafafa] w-[84px] min-w-[84px] border-b border-l border-[#e5e7eb] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] ${isMenuOpen ? 'z-40' : 'z-10'}`}>
                        <div className="inline-block text-left relative">
                          <button
                            type="button"
                            onClick={() => setActiveMenuOrderId(isMenuOpen ? null : ord.id)}
                            className={`w-7 h-7 flex items-center justify-center rounded border transition-colors cursor-pointer shadow-2xs ${
                              isMenuOpen 
                                ? 'bg-gray-100 border-gray-400 text-gray-900' 
                                : 'bg-white border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}
                            title="操作菜单"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {/* 优雅操作下拉菜单（风格对标参考图 1，包含编辑、导入、删除、取消） */}
                          {isMenuOpen && (
                            <>
                              {/* 遮罩层，点击空白处关闭菜单 */}
                              <div 
                                className="fixed inset-0 z-20" 
                                onClick={() => setActiveMenuOrderId(null)} 
                              />

                              <div 
                                className="absolute right-0 top-8 w-28 bg-white rounded-lg shadow-xl border border-gray-200 py-1.5 z-30 text-xs text-left animate-in fade-in zoom-in-95 duration-100"
                              >
                                {/* 编辑 */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(ord)}
                                  className="w-full px-3.5 py-1.5 text-gray-800 hover:bg-gray-100 flex items-center gap-2 cursor-pointer font-medium"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-gray-500" />
                                  <span>编辑</span>
                                </button>

                                {/* 导入 */}
                                <button
                                  type="button"
                                  onClick={() => handleDirectImport(ord)}
                                  className="w-full px-3.5 py-1.5 text-gray-800 hover:bg-gray-100 flex items-center gap-2 cursor-pointer font-medium"
                                >
                                  <Download className="w-3.5 h-3.5 text-gray-500" />
                                  <span>导入</span>
                                </button>

                                {/* 删除 (红色字体) */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOrder(ord)}
                                  className="w-full px-3.5 py-1.5 text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer font-medium"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                  <span>删除</span>
                                </button>

                                {/* 取消 (灰阶字体) */}
                                <button
                                  type="button"
                                  onClick={() => handleCancelOrder(ord)}
                                  disabled={isCancelled}
                                  className={`w-full px-3.5 py-1.5 flex items-center gap-2 font-medium ${
                                    isCancelled 
                                      ? 'text-gray-300 cursor-not-allowed' 
                                      : 'text-gray-500 hover:bg-gray-100 cursor-pointer'
                                  }`}
                                >
                                  <Ban className="w-3.5 h-3.5 text-gray-400" />
                                  <span>取消</span>
                                </button>
                              </div>
                            </>
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

        {/* 表格底部分页工具栏 (永久固定于底部，不随数据滚动) */}
        <div className="shrink-0 bg-white border-t border-[#e5e7eb] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#4b5563] z-10">
          {/* 左侧：条数信息与每页选择 */}
          <div className="flex items-center gap-3">
            <span>
              共 <span className="font-semibold text-[#111827]">{totalItems}</span> 条订单
            </span>
            <span className="text-gray-300">|</span>
            <span>
              显示第 <span className="text-[#111827] font-medium">{totalItems === 0 ? 0 : startIndex + 1}</span> 至{' '}
              <span className="text-[#111827] font-medium">{endIndex}</span> 条
            </span>
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-gray-500">每页</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="h-7 px-2 border border-[#d1d5db] rounded bg-white text-xs text-[#374151] outline-none focus:border-[#4850e5] cursor-pointer"
              >
                <option value={5}>5 条</option>
                <option value={10}>10 条</option>
                <option value={20}>20 条</option>
                <option value={50}>50 条</option>
              </select>
            </div>
          </div>

          {/* 右侧：翻页按钮与跳转 */}
          <div className="flex items-center gap-1.5">
            {/* 上一页 */}
            <button
              type="button"
              disabled={safeCurrentPage <= 1}
              onClick={() => handlePageChange(safeCurrentPage - 1)}
              className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
                safeCurrentPage <= 1
                  ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
                  : 'border-[#d1d5db] text-[#374151] bg-white hover:bg-gray-50 hover:border-gray-400 cursor-pointer shadow-2xs'
              }`}
              title="上一页"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* 页码序列 */}
            {getPaginationRange().map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`dots-${idx}`} className="w-6 text-center text-gray-400 select-none">
                    ...
                  </span>
                );
              }
              const isCurrent = p === safeCurrentPage;
              return (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={() => handlePageChange(p as number)}
                  className={`min-w-7 h-7 px-2 flex items-center justify-center rounded text-xs font-medium transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-[#4850e5] text-white border border-[#4850e5] shadow-2xs'
                      : 'bg-white text-[#374151] border border-[#d1d5db] hover:bg-gray-50 hover:border-gray-400'
                  }`}
                >
                  {p}
                </button>
              );
            })}

            {/* 下一页 */}
            <button
              type="button"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => handlePageChange(safeCurrentPage + 1)}
              className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
                safeCurrentPage >= totalPages
                  ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
                  : 'border-[#d1d5db] text-[#374151] bg-white hover:bg-gray-50 hover:border-gray-400 cursor-pointer shadow-2xs'
              }`}
              title="下一页"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {/* 跳至指定页 */}
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 ml-2">
              <span className="text-gray-500">跳至</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                placeholder={`${safeCurrentPage}`}
                className="w-11 h-7 text-center border border-[#d1d5db] rounded text-xs text-[#111827] outline-none focus:border-[#4850e5]"
              />
              <span className="text-gray-500">页</span>
              <button
                type="submit"
                className="h-7 px-2.5 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[#374151] border border-[#d1d5db] rounded text-xs font-medium transition-colors cursor-pointer"
              >
                跳转
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 订单编辑弹窗 (结构参考图 2，视觉保持全站设计语言一致) */}
      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          isOpen={Boolean(editingOrder)}
          onClose={() => setEditingOrder(null)}
          onSave={handleSaveEditedOrder}
        />
      )}
    </div>
  );
};
