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
import { addLog } from '../../store/slices/systemLogSlice';
import { GuardianOrder, OrderStatus } from '../../types';
import { isOrderSuccess } from '../../utils/orderHelpers';
import { EditOrderModal } from './EditOrderModal';
import { OrderStatsCards } from './OrderStatsCards';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderBatchBar } from './OrderBatchBar';
import { OrderTable } from './OrderTable';
import { OrderPagination } from './OrderPagination';

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
  const [jumpInput, setJumpInput] = useState('');

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

  const handleTabChange = (status: 'all' | OrderStatus) => {
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
    dispatch(addLog({
      level: 'SUCCESS',
      channelId: order.channelId,
      message: `[OrderGuardian] 用户手动导入订单 ${order.otaOrderNo} 成功`
    }));
  };

  const handleRetryOrder = (order: GuardianOrder) => {
    dispatch(retryOrderTransfer(order.id));
    dispatch(showToast({
      title: '已触发直连重推',
      description: `订单 ${order.otaOrderNo} 正在向文旅中台重新推送`,
      type: 'info'
    }));
    dispatch(addLog({
      level: 'PLAYWRIGHT',
      channelId: order.channelId,
      message: `[OrderGuardian] 直连重推订单 ${order.otaOrderNo} 到中台`
    }));
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
      dispatch(addLog({
        level: 'INFO',
        message: '[OrderGuardian] 启动全自动订单值守监听器'
      }));
    } else {
      dispatch(showToast({
        title: '自动订单值守已暂停',
        description: '后台自动抓取与搬单监听已暂停',
        type: 'info'
      }));
      dispatch(addLog({
        level: 'WARN',
        message: '[OrderGuardian] 订单值守已暂停'
      }));
    }
  };

  return (
    <div className="w-full h-full flex flex-col p-5 bg-[#f8f9fc] text-[#0b1c30] overflow-hidden min-h-0">
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

      {/* 订单表格容器 */}
      <div className="flex-1 min-h-0 bg-white rounded-md border border-[#e5e7eb] flex flex-col overflow-hidden shadow-2xs">
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
        <OrderPagination
          totalItems={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
          safeCurrentPage={safeCurrentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          paginationRange={getPaginationRange()}
          jumpInput={jumpInput}
          setJumpInput={setJumpInput}
          onJumpSubmit={handleJumpSubmit}
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
