import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fetchOrdersThunk,
  fetchStatisticsThunk,
  executeOrderActionThunk,
  loadOrderEditorThunk,
  saveOrderDraftThunk,
  syncDutyStatusThunk,
  setFilterStatus,
  setFilterQuery,
  setDateRange,
  setPagination,
  resetFilters,
  closeEditDrawer,
} from '../../store/slices/orderGuardianSlice';
import type { ToolkitOrder, ToolkitOrderDraft } from '../../types';
import { ChannelDutyPanel } from './ChannelDutyPanel';
import { OrderStatsCards } from './OrderStatsCards';
import { OrderFilterBar } from './OrderFilterBar';
import { OrderTable } from './OrderTable';
import { EditOrderDrawer } from './EditOrderDrawer';
import { Pagination } from '../common/Pagination';
import { Modal } from '../common/Modal';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  isDanger?: boolean;
  onConfirm: () => void;
}

export const OrderGuardianView: React.FC = () => {
  const dispatch = useAppDispatch();

  // State selectors
  const orders = useAppSelector((state) => state.orderGuardian.orders);
  const total = useAppSelector((state) => state.orderGuardian.total);
  const loading = useAppSelector((state) => state.orderGuardian.loading);
  const error = useAppSelector((state) => state.orderGuardian.error);
  const actionLoadingId = useAppSelector((state) => state.orderGuardian.actionLoadingId);

  const statistics = useAppSelector((state) => state.orderGuardian.statistics);
  const statsLoading = useAppSelector((state) => state.orderGuardian.statsLoading);
  const filters = useAppSelector((state) => state.orderGuardian.filters);

  const activeEditOrder = useAppSelector((state) => state.orderGuardian.activeEditOrder);
  const productOptions = useAppSelector((state) => state.orderGuardian.productOptions);
  const drawerLoading = useAppSelector((state) => state.orderGuardian.drawerLoading);
  const drawerSaving = useAppSelector((state) => state.orderGuardian.drawerSaving);
  const drawerError = useAppSelector((state) => state.orderGuardian.drawerError);

  // Local search inputs
  const [localQuery, setLocalQuery] = useState(filters.query);
  const [localArrivalStart, setLocalArrivalStart] = useState(filters.arrivalStart);
  const [localArrivalEnd, setLocalArrivalEnd] = useState(filters.arrivalEnd);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  // Initial fetch on mount
  useEffect(() => {
    void dispatch(fetchOrdersThunk());
    void dispatch(fetchStatisticsThunk());
    void dispatch(syncDutyStatusThunk());
  }, [dispatch]);

  // Synchronize local filter inputs if filters reset
  useEffect(() => {
    setLocalQuery(filters.query);
    setLocalArrivalStart(filters.arrivalStart);
    setLocalArrivalEnd(filters.arrivalEnd);
  }, [filters.query, filters.arrivalStart, filters.arrivalEnd]);

  // Handlers for filter bar
  const handleStatusChange = (status: string) => {
    dispatch(setFilterStatus(status));
    void dispatch(fetchOrdersThunk({ status, page: 1 }));
  };

  const handleSearch = () => {
    dispatch(setFilterQuery(localQuery));
    dispatch(setDateRange({ startDate: localArrivalStart, endDate: localArrivalEnd }));
    void dispatch(
      fetchOrdersThunk({
        query: localQuery,
        arrivalStart: localArrivalStart,
        arrivalEnd: localArrivalEnd,
        page: 1,
      })
    );
  };

  const handleReset = () => {
    dispatch(resetFilters());
    setLocalQuery('');
    setLocalArrivalStart('');
    setLocalArrivalEnd('');
    void dispatch(
      fetchOrdersThunk({
        page: 1,
        status: 'all',
        query: '',
        arrivalStart: '',
        arrivalEnd: '',
      })
    );
  };

  // Handlers for pagination
  const handlePageChange = (newPage: number) => {
    dispatch(setPagination({ page: newPage }));
    void dispatch(fetchOrdersThunk({ page: newPage }));
  };

  const handlePageSizeChange = (newSize: number) => {
    dispatch(setPagination({ page: 1, pageSize: newSize }));
    void dispatch(fetchOrdersThunk({ page: 1, pageSize: newSize }));
  };

  // Handlers for order actions
  const handleEdit = (order: ToolkitOrder) => {
    void dispatch(loadOrderEditorThunk(order.id));
  };

  const handleImport = (order: ToolkitOrder) => {
    void dispatch(executeOrderActionThunk({ id: order.id, action: 'IMPORT' }));
  };

  const handleDelete = (order: ToolkitOrder) => {
    setConfirmModal({
      isOpen: true,
      title: '确认删除失败订单',
      message: `确定要删除 OTA 订单「${order.otaOrderId}」吗？此操作不可逆。`,
      isDanger: true,
      onConfirm: () => {
        void dispatch(executeOrderActionThunk({ id: order.id, action: 'DELETE' }));
      },
    });
  };

  const handleCancel = (order: ToolkitOrder) => {
    setConfirmModal({
      isOpen: true,
      title: '确认取消订单',
      message: `确定要在中台发起取消订单「${order.otaOrderId}」吗？`,
      isDanger: false,
      onConfirm: () => {
        void dispatch(executeOrderActionThunk({ id: order.id, action: 'CANCEL' }));
      },
    });
  };

  const handleSaveDraft = (id: string, draft: ToolkitOrderDraft) => {
    void dispatch(saveOrderDraftThunk({ id, draft }));
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#f8f9ff] p-4 gap-3">
      {/* 模块 1: 渠道自动化值守面板 */}
      <ChannelDutyPanel />

      {/* 模块 2: 订单 4 项核心指标统计 */}
      <OrderStatsCards statistics={statistics} loading={statsLoading} />

      {/* 错误告警横幅 */}
      {error && (
        <div className="px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-700 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => dispatch(fetchOrdersThunk())}
            className="flex items-center gap-1 font-semibold hover:underline cursor-pointer ml-4"
          >
            <RefreshCw className="w-3 h-3" />
            <span>重试</span>
          </button>
        </div>
      )}

      {/* 模块 3: 多维状态筛选与搜索 */}
      <OrderFilterBar
        status={filters.status}
        onStatusChange={handleStatusChange}
        query={localQuery}
        onQueryChange={setLocalQuery}
        arrivalStart={localArrivalStart}
        arrivalEnd={localArrivalEnd}
        onArrivalStartChange={setLocalArrivalStart}
        onArrivalEndChange={setLocalArrivalEnd}
        onSearch={handleSearch}
        onReset={handleReset}
        loading={loading}
      />

      {/* 模块 4: 高密订单表格 */}
      <OrderTable
        orders={orders}
        actionLoadingId={actionLoadingId}
        onEdit={handleEdit}
        onImport={handleImport}
        onDelete={handleDelete}
        onCancel={handleCancel}
      />

      {/* 模块 5: 底部分页控件 */}
      <div className="shrink-0 bg-white p-2.5 rounded-xl border border-[#e2e8f0] shadow-2xs">
        <Pagination
          totalItems={total}
          currentPage={filters.page}
          pageSize={filters.pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={[10, 20, 50, 100]}
          itemUnit="笔订单"
        />
      </div>

      {/* 模块 6: 编辑抽屉 */}
      <EditOrderDrawer
        order={activeEditOrder}
        productOptions={productOptions}
        isOpen={!!activeEditOrder}
        isLoading={drawerLoading}
        isSaving={drawerSaving}
        error={drawerError}
        onClose={() => dispatch(closeEditDrawer())}
        onSave={handleSaveDraft}
      />

      {/* 模块 7: 二次确认对话框 */}
      {confirmModal && (
        <Modal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(null)}
          title={confirmModal.title}
          maxWidth="sm"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3.5 py-1.5 bg-white hover:bg-[#eff4ff] border border-[#dce9ff] text-[#434655] rounded-lg text-xs font-medium cursor-pointer transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className={`px-3.5 py-1.5 text-white rounded-lg text-xs font-semibold shadow-2xs cursor-pointer transition-colors ${
                  confirmModal.isDanger
                    ? 'bg-[#ba1a1a] hover:bg-[#93000a]'
                    : 'bg-[#004ac6] hover:bg-[#003da6]'
                }`}
              >
                确认
              </button>
            </div>
          }
        >
          <p className="text-xs text-[#434655] leading-relaxed py-2">
            {confirmModal.message}
          </p>
        </Modal>
      )}
    </div>
  );
};
