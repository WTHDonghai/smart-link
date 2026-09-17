import React, { useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  toggleAutoGuarding, 
  setOrderFilterStatus, 
  retryOrderTransfer,
  importOrderDirectly, 
  deleteOrder, 
  cancelOrder, 
  updateOrder,
  setSearchKeyword, 
  setDateRange, 
  resetFilters,
  selectGuardianStats 
} from '../../store/slices/orderGuardianSlice';
import { showToast } from '../../store/slices/appSlice';
import { logger } from '../../services/logger';
import { GuardianOrder, OrderStatus } from '../../types';
import { isOrderSuccess } from '../../utils/orderHelpers';
import { EditOrderModal } from './EditOrderModal';
import { OrderStatsCards } from './OrderStatsCards';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderBatchBar } from './OrderBatchBar';
import { OrderTable } from './OrderTable';
import { Pagination } from '../common/Pagination';

export const OrderGuardianView: React.FC = () => {
  const dispatch = useAppDispatch();
  const orders = useAppSelector((state) => state.orderGuardian.orders);
  const stats = useAppSelector(selectGuardianStats);
  const isAutoGuarding = useAppSelector((state) => state.orderGuardian.isAutoGuarding);
  const filterStatus = useAppSelector((state) => state.orderGuardian.filterStatus);
  const searchKeyword = useAppSelector((state) => state.orderGuardian.searchKeyword);
  const startDate = useAppSelector((state) => state.orderGuardian.startDate);
  const endDate = useAppSelector((state) => state.orderGuardian.endDate);

  // Local Filter Form States
  const [keywordInput, setKeywordInput] = useState(searchKeyword);
  const [startInput, setStartInput] = useState(startDate);
  const [endInput, setEndInput] = useState(endDate);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Selection states for batch actions
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // Active editing modal state
  const [editingOrder, setEditingOrder] = useState<GuardianOrder | null>(null);

  // Filter orders with useMemo
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (filterStatus !== 'all') {
        if (filterStatus === 'success') {
          if (!isOrderSuccess(o.status)) return false;
        } else if (filterStatus === 'pending') {
          if (o.status !== 'pending') return false;
        } else if (filterStatus === 'failed') {
          if (o.status !== 'failed') return false;
        } else if (filterStatus === 'cancelled') {
          if (o.status !== 'cancelled') return false;
        } else {
          if (o.status !== filterStatus) return false;
        }
      }

      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase();
        const matchNo = o.otaOrderNo.toLowerCase().includes(kw);
        const matchPms = o.pmsOrderNo.toLowerCase().includes(kw);
        const matchGuest = o.guestName.toLowerCase().includes(kw);
        const matchPhone = o.guestPhone.includes(kw);
        const matchHotel = o.hotelName.toLowerCase().includes(kw);
        if (!matchNo && !matchPms && !matchGuest && !matchPhone && !matchHotel) {
          return false;
        }
      }

      if (startDate && o.checkInDate < startDate) return false;
      if (endDate && o.checkInDate > endDate) return false;

      return true;
    });
  }, [orders, filterStatus, searchKeyword, startDate, endDate]);

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

  const handleTabChange = (status: 'all' | OrderStatus) => {
    setCurrentPage(1);
    dispatch(setOrderFilterStatus(status));
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    dispatch(showToast({
      title: '已复制单号',
      description: text,
      type: 'success'
    }));
  };

  const handleToggleSelectAll = () => {
    const currentPageIds = paginatedOrders.map(o => o.id);
    const allSelected = currentPageIds.every(id => selectedOrderIds.includes(id));
    if (allSelected) {
      setSelectedOrderIds(prev => prev.filter(id => !currentPageIds.includes(id)));
    } else {
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...currentPageIds])));
    }
  };

  const handleToggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleDirectImport = (order: GuardianOrder) => {
    dispatch(importOrderDirectly(order.id));
    dispatch(showToast({
      title: '订单导入成功',
      description: `订单 ${order.otaOrderNo} 已成功推入中台并生成确认号`,
      type: 'success'
    }));
    logger.track('ORDER_TRANSFER_PMS_SUCCESS', {
      module: 'ORDER',
      level: 'SUCCESS',
      channelId: order.channelId,
      orderNo: order.otaOrderNo,
      message: `[OrderGuardian] 用户手动导入订单 ${order.otaOrderNo} 成功入账`,
      details: `酒店: ${order.hotelName} | 房型: ${order.roomTypeName} | 客人: ${order.guestName}`,
      meta: { otaOrderNo: order.otaOrderNo, pmsOrderNo: order.pmsOrderNo, price: order.otaPrice }
    });
  };

  const handleRetryOrder = (order: GuardianOrder) => {
    dispatch(retryOrderTransfer(order.id));
    dispatch(showToast({
      title: '已触发直连重推',
      description: `订单 ${order.otaOrderNo} 正在向文旅中台重新推送`,
      type: 'info'
    }));
    logger.track('ORDER_BATCH_RETRY', {
      module: 'ORDER',
      level: 'PLAYWRIGHT',
      channelId: order.channelId,
      orderNo: order.otaOrderNo,
      message: `[OrderGuardian] 直连重推订单 ${order.otaOrderNo} 到文旅中台`,
      details: `重试渠道: ${order.channelName} | 状态置为 processing`,
      meta: { otaOrderNo: order.otaOrderNo, channelId: order.channelId }
    });
  };

  const handleDeleteOrder = (order: GuardianOrder) => {
    dispatch(deleteOrder(order.id));
    setSelectedOrderIds(prev => prev.filter(id => id !== order.id));
    dispatch(showToast({
      title: '已删除订单记录',
      description: `订单 ${order.otaOrderNo} 已从值守列表中移除`,
      type: 'info'
    }));
  };

  const handleCancelOrder = (order: GuardianOrder) => {
    dispatch(cancelOrder(order.id));
    dispatch(showToast({
      title: '已取消订单',
      description: `订单 ${order.otaOrderNo} 状态已更新为取消`,
      type: 'info'
    }));
  };

  // Batch operations
  const handleBatchRetry = () => {
    selectedOrderIds.forEach(id => {
      dispatch(retryOrderTransfer(id));
    });
    dispatch(showToast({
      title: '已批量直连重推',
      description: `已向中台重新推送选中的 ${selectedOrderIds.length} 笔订单`,
      type: 'success'
    }));
    setSelectedOrderIds([]);
  };

  const handleBatchImport = () => {
    selectedOrderIds.forEach(id => {
      dispatch(importOrderDirectly(id));
    });
    dispatch(showToast({
      title: '已批量强制导入',
      description: `已直接导入选中的 ${selectedOrderIds.length} 笔订单`,
      type: 'success'
    }));
    setSelectedOrderIds([]);
  };

  const handleBatchCancel = () => {
    selectedOrderIds.forEach(id => {
      dispatch(cancelOrder(id));
    });
    dispatch(showToast({
      title: '已批量取消订单',
      description: `已取消选中的 ${selectedOrderIds.length} 笔订单`,
      type: 'info'
    }));
    setSelectedOrderIds([]);
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
        title: '订单信息已更新',
        description: `已保存对订单 ${editingOrder.otaOrderNo} 的修改`,
        type: 'info'
      }));
    }
    setEditingOrder(null);
  };

  const handleToggleGuarding = () => {
    dispatch(toggleAutoGuarding());
    if (!isAutoGuarding) {
      dispatch(showToast({
        title: '自动订单值守已启动',
        description: '系统将每 30 秒轮询 OTA 平台新订单并自动入账',
        type: 'success'
      }));
      logger.track('ORDER_POLL_START', {
        module: 'ORDER',
        level: 'INFO',
        message: '[OrderGuardian] 启动全自动订单值守监听器 (轮询间隔 30s)'
      });
    } else {
      dispatch(showToast({
        title: '自动订单值守已暂停',
        description: '后台自动抓取与搬单监听已暂停',
        type: 'info'
      }));
      logger.track('ORDER_POLL_SUCCESS', {
        module: 'ORDER',
        level: 'WARN',
        message: '[OrderGuardian] 订单值守监听器已暂停'
      });
    }
  };

  return (
    <div className="w-full h-full max-w-[1400px] mx-auto flex flex-col p-6 text-[#0b1c30] overflow-hidden min-h-0">
      {/* 统一页面头部 */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0] shrink-0 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            订单值守
          </h1>
          <span className="text-xs text-[#737686] ml-2 font-mono">
            共 {orders.length} 笔订单
          </span>
        </div>
      </div>

      {/* 顶部统计卡片 */}
      <OrderStatsCards stats={stats} />

      {/* 搜索与筛选区域 */}
      <OrderFilterBar
        filterStatus={filterStatus}
        onTabChange={handleTabChange}
        isAutoGuarding={isAutoGuarding}
        onToggleGuarding={handleToggleGuarding}
        keywordInput={keywordInput}
        setKeywordInput={setKeywordInput}
        startInput={startInput}
        setStartInput={setStartInput}
        endInput={endInput}
        setEndInput={setEndInput}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      {/* 批量操作工具条 */}
      <OrderBatchBar
        selectedCount={selectedOrderIds.length}
        onClearSelection={() => setSelectedOrderIds([])}
        onBatchRetry={handleBatchRetry}
        onBatchImport={handleBatchImport}
        onBatchCancel={handleBatchCancel}
      />

      {/* 订单表格与分页一体化容器 */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-[#dce9ff] flex flex-col overflow-hidden shadow-xs">
        <OrderTable
          orders={paginatedOrders}
          selectedOrderIds={selectedOrderIds}
          onToggleSelectAll={handleToggleSelectAll}
          onToggleSelectOrder={handleToggleSelectOrder}
          onCopy={handleCopy}
          onOpenEdit={(ord) => setEditingOrder(ord)}
          onRetry={handleRetryOrder}
          onDirectImport={handleDirectImport}
          onDeleteOrder={handleDeleteOrder}
          onCancelOrder={handleCancelOrder}
        />

        {/* 底部分页条 */}
        <Pagination
          totalItems={totalItems}
          currentPage={safeCurrentPage}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={[5, 10, 20, 50]}
          itemUnit="条订单"
        />
      </div>

      {/* 订单编辑弹窗 */}
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
