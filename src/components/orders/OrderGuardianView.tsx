import React, { useState, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/src/store';
import {
  fetchOrdersThunk,
  fetchStatisticsThunk,
  executeOrderActionThunk,
  loadOrderEditorThunk,
  saveOrderDraftThunk,
  syncDutyStatusThunk,
  patchFilters,
  setPagination,
  resetFilters,
  closeEditDrawer,
} from '@/src/store/slices/orderGuardianSlice';
import { fetchHotelMappingsThunk, fetchPlatformPropertiesThunk } from '@/src/store/slices/hotelSlice';
import { ALL_CHANNELS_CATALOG } from '@/src/store/slices/channelSlice';
import type { ToolkitOrder, ToolkitOrderDraft } from '@/src/types';
import { buildOrderHotelOptions, buildOrderChannelOptions } from '@/src/utils/orderHelpers';
import { ChannelDutyPanel } from './ChannelDutyPanel';
import { logger } from '@/src/services/logger';
import { OrderStatsCards } from './OrderStatsCards';
import { OrderFilterBar, type OrderFilterValues } from './OrderFilterBar';
import { OrderTable } from './OrderTable';
import { EditOrderDrawer } from './EditOrderDrawer';
import { Pagination } from '../common/Pagination';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { showToast } from '@/src/store/slices/appSlice';

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
  const channels = useAppSelector((state) => state.channel.channels);
  const hotels = useAppSelector((state) => state.hotel.hotels);
  const pmsProperties = useAppSelector((state) => state.hotel.pmsProperties);
  const drawerLoading = useAppSelector((state) => state.orderGuardian.drawerLoading);
  const drawerSaving = useAppSelector((state) => state.orderGuardian.drawerSaving);
  const drawerError = useAppSelector((state) => state.orderGuardian.drawerError);

  // Local search inputs
  const [localFilters, setLocalFilters] = useState<OrderFilterValues>({
    unitId: filters.unitId,
    otaChannel: filters.otaChannel,
    status: filters.status,
    orderType: filters.orderType,
    otaOrderId: filters.otaOrderId,
    contactName: filters.contactName,
    createdStart: filters.createdStart,
    createdEnd: filters.createdEnd,
  });

  // Drawer read-only mode state
  const [isDrawerReadOnly, setIsDrawerReadOnly] = useState<boolean>(false);

  // Initial fetch on mount
  useEffect(() => {
    void dispatch(fetchOrdersThunk());
    void dispatch(fetchStatisticsThunk());
    void dispatch(syncDutyStatusThunk());
    void dispatch(fetchHotelMappingsThunk());
    void dispatch(fetchPlatformPropertiesThunk());
  }, [dispatch]);

  // Synchronize local filter inputs if filters change externally or reset
  useEffect(() => {
    setLocalFilters({
      unitId: filters.unitId,
      otaChannel: filters.otaChannel,
      status: filters.status,
      orderType: filters.orderType,
      otaOrderId: filters.otaOrderId,
      contactName: filters.contactName,
      createdStart: filters.createdStart,
      createdEnd: filters.createdEnd,
    });
  }, [
    filters.unitId,
    filters.otaChannel,
    filters.status,
    filters.orderType,
    filters.otaOrderId,
    filters.contactName,
    filters.createdStart,
    filters.createdEnd,
  ]);

  const hotelOptions = useMemo(
    () => buildOrderHotelOptions(hotels, orders, pmsProperties),
    [hotels, orders, pmsProperties]
  );

  const channelOptions = useMemo(
    () => buildOrderChannelOptions(channels, ALL_CHANNELS_CATALOG),
    [channels]
  );

  const handleFilterChange = (patch: Partial<OrderFilterValues>) => {
    setLocalFilters((prev) => ({ ...prev, ...patch }));
  };

  // Handlers for filter bar
  const handleSearch = () => {
    if (
      localFilters.createdStart &&
      localFilters.createdEnd &&
      localFilters.createdStart > localFilters.createdEnd
    ) {
      dispatch(
        showToast({
          type: 'error',
          title: '日期区间无效',
          description: '搬单开始日期不能晚于结束日期',
        })
      );
      return;
    }
    dispatch(patchFilters({ ...localFilters, page: 1 }));
    void dispatch(
      fetchOrdersThunk({
        ...localFilters,
        page: 1,
      })
    );
  };

  const handleReset = () => {
    dispatch(resetFilters());
    void dispatch(
      fetchOrdersThunk({
        page: 1,
        unitId: '',
        otaChannel: '',
        status: '',
        orderType: '',
        otaOrderId: '',
        contactName: '',
        createdStart: '',
        createdEnd: '',
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
  const handleViewDetail = (order: ToolkitOrder) => {
    setIsDrawerReadOnly(true);
    void dispatch(loadOrderEditorThunk(order.id));
  };

  const handleEdit = (order: ToolkitOrder) => {
    setIsDrawerReadOnly(false);
    void dispatch(loadOrderEditorThunk(order.id));
  };

  const handleImport = (order: ToolkitOrder) => {
    logger.track('ORDER_TRANSFER_PMS_SUCCESS', {
      module: 'ORDER',
      level: 'INFO',
      channelId: order.otaChannel,
      orderNo: order.otaOrderId,
      taskActionStage: 'order-import-submit',
      message: `[OrderGuardian] 用户手动导入订单 ${order.otaOrderId}`,
      details: `酒店: ${order.unitName} | 房型: ${order.booking.roomType} | 客人: ${order.contact.name}`,
      meta: { otaOrderId: order.otaOrderId, pmsOrderId: order.pmsOrderId, price: order.booking.totalPrice },
    });
    void dispatch(executeOrderActionThunk({ id: order.id, action: 'IMPORT', order }));
  };

  const handleDelete = (order: ToolkitOrder) => {
    logger.track('ORDER_DELETE_CONFIRM', {
      module: 'ORDER',
      level: 'WARN',
      channelId: order.otaChannel,
      orderNo: order.otaOrderId,
      message: `[OrderGuardian] 用户确认删除失败订单 ${order.otaOrderId}`,
    });
    void dispatch(executeOrderActionThunk({ id: order.id, action: 'DELETE' }));
  };

  const handleCancel = (order: ToolkitOrder) => {
    logger.track('ORDER_CANCEL_CONFIRM', {
      module: 'ORDER',
      level: 'INFO',
      channelId: order.otaChannel,
      orderNo: order.otaOrderId,
      message: `[OrderGuardian] 用户发起取消中台订单 ${order.otaOrderId}`,
    });
    void dispatch(executeOrderActionThunk({ id: order.id, action: 'CANCEL' }));
  };

  const handleSaveDraft = (id: string, draft: ToolkitOrderDraft) => {
    logger.track('ORDER_DRAFT_SAVE', {
      module: 'ORDER',
      level: 'INFO',
      orderNo: draft.otaOrderId,
      message: `[OrderGuardian] 用户保存订单草稿 ${draft.otaOrderId}`,
      details: `房型: ${draft.booking.roomType} | 房价码: ${draft.booking.rateCode} | 入住人: ${draft.contact.name}`,
    });
    void dispatch(saveOrderDraftThunk({ id, draft, order: activeEditOrder || undefined }));
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

      {/* 模块 3: 多维条件筛选与搜索 */}
      <OrderFilterBar
        filters={localFilters}
        onFilterChange={handleFilterChange}
        hotelOptions={hotelOptions}
        channelOptions={channelOptions}
        onSearch={handleSearch}
        onReset={handleReset}
        loading={loading}
      />

      {/* 模块 4: 高密订单表格 */}
      <OrderTable
        orders={orders}
        total={total}
        channels={channels}
        hotels={hotels}
        pmsProperties={pmsProperties}
        actionLoadingId={actionLoadingId}
        onViewDetail={handleViewDetail}
        onEdit={handleEdit}
        onImport={handleImport}
        onDelete={handleDelete}
        onCancel={handleCancel}
        onCopy={(orderNo, success) => {
          if (success) {
            dispatch(showToast({ type: 'success', title: `订单号已复制: ${orderNo}` }));
          } else {
            dispatch(showToast({ type: 'error', title: '复制失败，请手动选择复制' }));
          }
        }}
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

      {/* 模块 6: 订单详情 / 编辑抽屉 */}
      <EditOrderDrawer
        order={activeEditOrder}
        channels={channels}
        productOptions={productOptions}
        isOpen={!!activeEditOrder}
        isLoading={drawerLoading}
        isSaving={drawerSaving}
        isReadOnly={isDrawerReadOnly}
        error={drawerError}
        onClose={() => {
          setIsDrawerReadOnly(false);
          dispatch(closeEditDrawer());
        }}
        onSave={handleSaveDraft}
        onSwitchToEdit={() => setIsDrawerReadOnly(false)}
      />
    </div>
  );
};
