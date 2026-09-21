import React, { useState, useMemo, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setProductFilterChannel,
  setProductFilterHotel,
  setProductSearch,
  deleteProduct,
  loadProductMappingsAndOptions,
  saveProductMappingsThunk,
  deleteProductMappingThunk,
  crawlOtaProductsThunk,
  getProductIdentityKey,
} from '../../store/slices/productSlice';
import { showToast } from '../../store/slices/appSlice';
import { fetchChannelMappingData } from '../../store/slices/channelSlice';
import { fetchHotelMappingsThunk } from '../../store/slices/hotelSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import {
  Search,
  X,
  RefreshCw,
  Save,
  Trash2,
  RotateCcw,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { ProductMapping, SaveProductMappingPayloadItem } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';
import { StatusBadge } from '../common/StatusBadge';
import { EmptyState } from '../common/EmptyState';
import { Pagination } from '../common/Pagination';

export const ProductSyncView: React.FC = () => {
  const dispatch = useAppDispatch();

  // Redux 状态
  const channels = useAppSelector((state) => state.channel.channels);
  const isChannelLoading = useAppSelector((state) => state.channel.isLoading);
  const hotels = useAppSelector((state) => state.hotel.hotels);
  const isHotelFetching = useAppSelector((state) => state.hotel.isFetching);
  const {
    filterChannel,
    filterExtUnitCode,
    filterHotelName,
    filterUnitId,
    filterUnitType,
    searchKeyword,
    products,
    roomTypes,
    rateCodes,
    reservationTypes,
    isLoading,
    isSaving,
    isCrawling,
    error: productError,
  } = useAppSelector((state) => state.product);

  // 本地交互状态
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [rowEdits, setRowEdits] = useState<
    Record<string, { roomType?: string; rateCode?: string; payType?: string }>
  >({});

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 1. 渠道门禁：只能选择已经完成渠道映射的 OTA 渠道
  const mappedChannels = useMemo(() => {
    return channels.filter((c) => c.isMapped && Boolean(c.channelCode));
  }, [channels]);

  const channelOptions = useMemo(() => {
    return mappedChannels.map((c) => ({
      label: `${c.name} (${c.code})`,
      value: c.code,
      subtext: `文旅渠道: ${c.channelName || c.channelCode}`,
    }));
  }, [mappedChannels]);

  // 当前选中的已映射渠道对象
  const activeChannel = useMemo(() => {
    return mappedChannels.find(
      (c) => c.code.toUpperCase() === filterChannel.toUpperCase()
    );
  }, [mappedChannels, filterChannel]);

  // 2. 酒店门禁：只能选择当前渠道下已经完成门店映射的酒店 (有 unitId / pmsHotelId)
  const mappedHotels = useMemo(() => {
    if (!filterChannel) return [];
    return hotels.filter(
      (h) =>
        (h.status === 'mapped' || Boolean(h.unitId || h.unitCode || h.pmsHotelId)) &&
        h.otaChannelCode?.toUpperCase() === filterChannel.toUpperCase()
    );
  }, [hotels, filterChannel]);

  const hotelOptions = useMemo(() => {
    return mappedHotels.map((h) => ({
      label: h.otaHotelName,
      value: h.extUnitCode || h.otaHotelId,
      subtext: `${h.city ? `${h.city} · ` : ''}${h.pmsHotelName || h.unitId || '已绑定'}`,
    }));
  }, [mappedHotels]);

  // 当前选中的酒店对象
  const activeHotel = useMemo(() => {
    if (!filterExtUnitCode) return null;
    return mappedHotels.find(
      (h) => (h.extUnitCode || h.otaHotelId) === filterExtUnitCode
    );
  }, [mappedHotels, filterExtUnitCode]);

  // 3. 页面挂载时：主动拉取渠道映射数据（确保渠道可用状态实时同步）
  useEffect(() => {
    void dispatch(fetchChannelMappingData());
  }, [dispatch]);

  // 4. 当渠道变化（或初始挂载时已有渠道/未选渠道）：主动发起网络请求拉取对应渠道的门店列表
  useEffect(() => {
    const channelParam = filterChannel ? filterChannel : undefined;
    void dispatch(fetchHotelMappingsThunk(channelParam));
  }, [dispatch, filterChannel]);

  // 5. 渠道数据就绪后：若未选择渠道且仅有 1 个已完成映射的渠道，自动预选该渠道
  useEffect(() => {
    if (!filterChannel && mappedChannels.length === 1) {
      dispatch(setProductFilterChannel(mappedChannels[0].code));
    }
  }, [dispatch, filterChannel, mappedChannels]);

  // 6. 门店数据就绪后：若已选渠道但未选门店，且该渠道下仅有 1 家已绑定门店，自动预选该门店
  useEffect(() => {
    if (filterChannel && !filterExtUnitCode && mappedHotels.length === 1) {
      const onlyHotel = mappedHotels[0];
      dispatch(
        setProductFilterHotel({
          extUnitCode: onlyHotel.extUnitCode || onlyHotel.otaHotelId,
          hotelName: onlyHotel.otaHotelName,
          unitId: onlyHotel.unitId || onlyHotel.pmsHotelId || '',
          unitType: onlyHotel.unitType || 'Property',
        })
      );
    }
  }, [dispatch, filterChannel, filterExtUnitCode, mappedHotels]);

  // 7. 构造稳定 key，防止后台门店更新导致草稿与选区丢失
  const activeHotelUnitId = activeHotel?.unitId || activeHotel?.pmsHotelId;
  const activeHotelExtCode = activeHotel?.extUnitCode || activeHotel?.otaHotelId;
  const activeHotelKey = activeChannel?.channelCode && activeHotelUnitId && activeHotelExtCode
    ? `${activeChannel.channelCode}_${activeHotelUnitId}_${activeHotelExtCode}`
    : '';
  const activeChannelRef = React.useRef(activeChannel);
  const activeHotelRef = React.useRef(activeHotel);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
    activeHotelRef.current = activeHotel;
  }, [activeChannel, activeHotel]);

  // 当用户切换选定渠道或酒店后，自动加载远程映射和字典选项
  useEffect(() => {
    const channel = activeChannelRef.current;
    const hotel = activeHotelRef.current;
    const unitId = hotel?.unitId || hotel?.pmsHotelId;
    const extCode = hotel?.extUnitCode || hotel?.otaHotelId;

    if (activeHotelKey && channel?.channelCode && hotel && unitId && extCode) {
      dispatch(
        loadProductMappingsAndOptions({
          channelCode: channel.channelCode,
          extUnitCode: extCode,
          unitId: String(unitId),
          unitType: hotel.unitType || 'Property',
          hotelName: hotel.otaHotelName,
        })
      );
      setSelectedKeys([]);
      setRowEdits({});
      setCurrentPage(1);
    }
  }, [dispatch, activeHotelKey]);

  // 字典选项转换
  const roomTypeOptions = useMemo(() => {
    const list = roomTypes.map((rt) => ({
      label: rt.displayLabel || rt.name || rt.code,
      value: rt.code,
      subtext: rt.code && rt.name !== rt.code ? rt.code : undefined,
    }));
    return [{ label: '未关联 / 留空', value: '' }, ...list];
  }, [roomTypes]);

  const rateCodeOptions = useMemo(() => {
    const list = rateCodes.map((rc) => ({
      label: rc.displayLabel || rc.rateName || rc.rateCode,
      value: rc.rateCode,
      subtext: rc.rateCode && rc.rateName !== rc.rateCode ? rc.rateCode : undefined,
    }));
    return [{ label: '未关联 / 留空', value: '' }, ...list];
  }, [rateCodes]);

  const reservationTypeOptions = useMemo(() => {
    const list = reservationTypes.map((res) => ({
      label: res.displayLabel || res.label || res.code,
      value: res.code,
      subtext: res.code && res.label !== res.code ? res.code : undefined,
    }));
    return [{ label: '未关联 / 留空', value: '' }, ...list];
  }, [reservationTypes]);

  // 过滤产品列表
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // 状态筛选
      if (filterStatus !== 'all') {
        if (filterStatus === 'completed' && p.status !== 'completed') return false;
        if (filterStatus === 'pending' && p.status !== 'pending') return false;
      }

      // 关键词筛选
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const matchName = (p.otaRoomTypeName || p.otaProductName || '').toLowerCase().includes(kw);
        const matchCode = (p.otaRoomTypeId || p.otaProductCode || '').toLowerCase().includes(kw);
        const matchPhysical = (p.otaBasicRoomName || p.otaPhysicalRoomName || '').toLowerCase().includes(kw);
        const matchPhysicalCode = (p.otaBasicRoomId || p.otaPhysicalRoomCode || '').toLowerCase().includes(kw);
        const matchRoomType = (p.roomType || p.internalRoomType || '').toLowerCase().includes(kw);
        const matchRate = (p.rateCode || '').toLowerCase().includes(kw);
        return matchName || matchCode || matchPhysical || matchPhysicalCode || matchRoomType || matchRate;
      }

      return true;
    });
  }, [products, filterStatus, searchKeyword]);

  // 分页计算
  const totalItems = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // 全选/反选逻辑
  const isCurrentPageAllSelected =
    paginatedProducts.length > 0 &&
    paginatedProducts.every((p) => selectedKeys.includes(getProductIdentityKey(p)));

  const handleToggleSelectAllCurrentPage = (checked: boolean) => {
    const pageKeys = paginatedProducts.map((p) => getProductIdentityKey(p));
    if (checked) {
      setSelectedKeys((prev) => Array.from(new Set([...prev, ...pageKeys])));
    } else {
      setSelectedKeys((prev) => prev.filter((k) => !pageKeys.includes(k)));
    }
  };

  const handleToggleSelect = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const handleInvertSelect = () => {
    const pageKeySet = new Set(paginatedProducts.map((p) => getProductIdentityKey(p)));
    const otherKeys = selectedKeys.filter((k) => !pageKeySet.has(k));
    const currentSelectedSet = new Set(selectedKeys);
    const invertedCurrent = paginatedProducts
      .filter((p) => !currentSelectedSet.has(getProductIdentityKey(p)))
      .map((p) => getProductIdentityKey(p));
    setSelectedKeys([...otherKeys, ...invertedCurrent]);
  };

  // 行编辑草稿更新
  const handleRowValueChange = (
    key: string,
    field: 'roomType' | 'rateCode' | 'payType',
    value: string
  ) => {
    setRowEdits((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: value,
      },
    }));
  };

  // 渠道切换处理：切换渠道时立即主动发起网络请求获取新渠道的门店列表
  const handleChannelFilterChange = (val: string) => {
    dispatch(setProductFilterChannel(val));
    setSelectedKeys([]);
    setRowEdits({});
    setCurrentPage(1);
    if (val) {
      void dispatch(fetchHotelMappingsThunk(val));
    }
  };

  // 全量主动刷新当前页面所有数据
  const handleRefreshAll = async () => {
    await dispatch(fetchChannelMappingData());
    const channelParam = filterChannel ? filterChannel : undefined;
    await dispatch(fetchHotelMappingsThunk(channelParam));
    if (activeChannel?.channelCode && activeHotel && (activeHotel.unitId || activeHotel.pmsHotelId)) {
      const unitId = String(activeHotel.unitId || activeHotel.pmsHotelId);
      const unitType = activeHotel.unitType || 'Property';
      const extUnitCode = activeHotel.extUnitCode || activeHotel.otaHotelId;
      await dispatch(
        loadProductMappingsAndOptions({
          channelCode: activeChannel.channelCode,
          extUnitCode,
          unitId,
          unitType,
          hotelName: activeHotel.otaHotelName,
        })
      );
    }
    dispatch(
      showToast({
        title: '数据已刷新',
        description: '已成功同步最新渠道、门店映射及产品数据',
        type: 'success',
      })
    );
  };

  // 酒店切换处理
  const handleHotelFilterChange = (val: string) => {
    const targetHotel = mappedHotels.find(
      (h) => (h.extUnitCode || h.otaHotelId) === val
    );
    if (targetHotel) {
      dispatch(
        setProductFilterHotel({
          extUnitCode: targetHotel.extUnitCode || targetHotel.otaHotelId,
          hotelName: targetHotel.otaHotelName,
          unitId: targetHotel.unitId || targetHotel.pmsHotelId || '',
          unitType: targetHotel.unitType || 'Property',
        })
      );
    }
  };

  // 采集 OTA 产品 (前置校验已映射门禁)
  const canCrawl = Boolean(activeChannel && activeHotel && filterUnitId);

  const handleCrawlOtaProducts = async () => {
    if (!canCrawl || isCrawling) return;
    if (!activeChannel?.channelCode) {
      dispatch(
        showToast({
          title: '无法启动产品采集',
          description: '当前所选 OTA 渠道尚未完成渠道映射配置',
          type: 'warning',
        })
      );
      return;
    }
    if (!activeHotel || !filterExtUnitCode) {
      dispatch(
        showToast({
          title: '无法启动产品采集',
          description: '请先在上方下拉框选择已完成映射的酒店',
          type: 'warning',
        })
      );
      return;
    }

    dispatch(
      showToast({
        title: '正在启动 OTA 产品采集...',
        description: `抓取渠道「${activeChannel.name}」门店「${filterHotelName}」最新商品列表`,
        type: 'info',
      })
    );

    try {
      const res = await dispatch(
        crawlOtaProductsThunk({
          channelCode: activeChannel.code,
          pmsChannelCode: activeChannel.channelCode,
          extUnitCode: filterExtUnitCode,
          otaHotelName: filterHotelName,
          poiId: activeHotel.extUnitCode || activeHotel.otaHotelId,
          partnerId: activeHotel.partnerId,
        })
      ).unwrap();

      dispatch(
        showToast({
          title: 'OTA 产品采集完成',
          description: `成功采集到 ${res.candidates.length} 项商品，已与平台映射合并展示`,
          type: 'success',
        })
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTimeoutOrNavigating = /timeout|navigating/i.test(errorMsg);
      const displayDesc = isTimeoutOrNavigating
        ? '页面响应超时，美团后台可能受到网络波动或安全拦截影响，请检查网络或重新登录后重试。'
        : errorMsg;

      dispatch(
        showToast({
          title: '产品采集失败',
          description: displayDesc,
          type: 'error',
        })
      );
    }
  };

  // 批量保存 (核心特性：允许 roomType, rateCode, payType 为空字符串提交)
  const handleBatchSave = async () => {
    if (selectedKeys.length === 0 || !activeChannel?.channelCode || !filterUnitId) return;

    const itemsToSave: SaveProductMappingPayloadItem[] = [];

    for (const key of selectedKeys) {
      const p = products.find((item) => getProductIdentityKey(item) === key);
      if (!p) continue;

      const edits = rowEdits[key] || {};
      const roomType = edits.roomType !== undefined ? edits.roomType : (p.roomType || '');
      const rateCode = edits.rateCode !== undefined ? edits.rateCode : (p.rateCode || '');
      const payType = edits.payType !== undefined ? edits.payType : (p.payType || '');

      itemsToSave.push({
        id: p.id,
        channelCode: activeChannel.channelCode,
        extUnitCode: filterExtUnitCode,
        unitId: filterUnitId,
        unitType: filterUnitType || 'Property',
        otaRoomTypeId: p.otaRoomTypeId,
        otaRoomTypeName: p.otaRoomTypeName,
        otaBasicRoomId: p.otaBasicRoomId,
        otaBasicRoomName: p.otaBasicRoomName,
        otaRateCodeId: p.otaRateCodeId,
        otaPayType: p.otaPayType || 'PP',
        roomType: roomType.trim(),
        rateCode: rateCode.trim(),
        payType: payType.trim(),
        otaProductPresent: p.otaProductPresent ?? true,
      });
    }

    if (itemsToSave.length === 0) return;

    try {
      await dispatch(saveProductMappingsThunk(itemsToSave)).unwrap();

      // 清除已保存行的草稿
      setRowEdits((prev) => {
        const next = { ...prev };
        for (const k of selectedKeys) {
          delete next[k];
        }
        return next;
      });

      dispatch(
        showToast({
          title: '批量保存成功',
          description: `已向文旅平台同步保存 ${itemsToSave.length} 条产品映射（已兼容未填房型/房价）`,
          type: 'success',
        })
      );

      dispatch(
        addLog({
          level: 'INFO',
          module: 'PRODUCT',
          message: `[ProductSync] 批量保存了 ${itemsToSave.length} 条产品映射`,
          details: `渠道: ${activeChannel.channelCode} | 酒店: ${filterExtUnitCode}`,
        })
      );

      // 保存后重新拉取远程映射绑定 ID，确保后续删除触发后端 DELETE
      await dispatch(
        loadProductMappingsAndOptions({
          channelCode: activeChannel.channelCode,
          extUnitCode: filterExtUnitCode,
          unitId: filterUnitId,
          unitType: filterUnitType || 'Property',
          hotelName: filterHotelName,
        })
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      dispatch(
        showToast({
          title: '保存产品映射失败',
          description: errorMsg,
          type: 'error',
        })
      );
    }
  };

  // 单行保存
  const handleSaveRow = async (p: ProductMapping) => {
    if (!activeChannel?.channelCode || !filterUnitId) return;

    const key = getProductIdentityKey(p);
    const edits = rowEdits[key] || {};
    const roomType = edits.roomType !== undefined ? edits.roomType : (p.roomType || '');
    const rateCode = edits.rateCode !== undefined ? edits.rateCode : (p.rateCode || '');
    const payType = edits.payType !== undefined ? edits.payType : (p.payType || '');

    const payloadItem: SaveProductMappingPayloadItem = {
      id: p.id,
      channelCode: activeChannel.channelCode,
      extUnitCode: filterExtUnitCode,
      unitId: filterUnitId,
      unitType: filterUnitType || 'Property',
      otaRoomTypeId: p.otaRoomTypeId,
      otaRoomTypeName: p.otaRoomTypeName,
      otaBasicRoomId: p.otaBasicRoomId,
      otaBasicRoomName: p.otaBasicRoomName,
      otaRateCodeId: p.otaRateCodeId,
      otaPayType: p.otaPayType || 'PP',
      roomType: roomType.trim(),
      rateCode: rateCode.trim(),
      payType: payType.trim(),
      otaProductPresent: p.otaProductPresent ?? true,
    };

    try {
      await dispatch(saveProductMappingsThunk([payloadItem])).unwrap();

      setRowEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      dispatch(
        showToast({
          title: `已保存「${p.otaRoomTypeName}」映射`,
          description: '已成功向文旅平台同步生效',
          type: 'success',
        })
      );

      // 保存后重新拉取远程映射绑定 ID，确保后续删除触发后端 DELETE
      await dispatch(
        loadProductMappingsAndOptions({
          channelCode: activeChannel.channelCode,
          extUnitCode: filterExtUnitCode,
          unitId: filterUnitId,
          unitType: filterUnitType || 'Property',
          hotelName: filterHotelName,
        })
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      dispatch(
        showToast({
          title: '保存映射失败',
          description: errorMsg,
          type: 'error',
        })
      );
    }
  };

  // 删除单行
  const handleDeleteRow = async (p: ProductMapping) => {
    const key = getProductIdentityKey(p);
    try {
      if (p.id) {
        await dispatch(
          deleteProductMappingThunk({
            mappingId: p.id,
            otaRoomTypeId: p.otaRoomTypeId,
            otaBasicRoomId: p.otaBasicRoomId,
          })
        ).unwrap();
      } else {
        // 未持久化的当次采集行，精准复合移除
        dispatch(
          deleteProduct({
            otaRoomTypeId: p.otaRoomTypeId,
            otaBasicRoomId: p.otaBasicRoomId,
          })
        );
      }

      setSelectedKeys((prev) => prev.filter((k) => k !== key));
      setRowEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      dispatch(
        showToast({
          title: `已删除「${p.otaRoomTypeName}」映射`,
          description: '产品映射已成功移除',
          type: 'info',
        })
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      dispatch(
        showToast({
          title: '删除产品映射失败',
          description: errorMsg,
          type: 'error',
        })
      );
    }
  };

  // 保存所有已修改的行
  const modifiedCount = Object.keys(rowEdits).length;
  const handleSaveAllModified = async () => {
    if (modifiedCount === 0 || !activeChannel?.channelCode || !filterUnitId) return;

    const itemsToSave: SaveProductMappingPayloadItem[] = [];

    for (const [key, edits] of Object.entries(rowEdits)) {
      const p = products.find((item) => getProductIdentityKey(item) === key);
      if (!p) continue;

      const roomType = edits.roomType !== undefined ? edits.roomType : (p.roomType || '');
      const rateCode = edits.rateCode !== undefined ? edits.rateCode : (p.rateCode || '');
      const payType = edits.payType !== undefined ? edits.payType : (p.payType || '');

      itemsToSave.push({
        id: p.id,
        channelCode: activeChannel.channelCode,
        extUnitCode: filterExtUnitCode,
        unitId: filterUnitId,
        unitType: filterUnitType || 'Property',
        otaRoomTypeId: p.otaRoomTypeId,
        otaRoomTypeName: p.otaRoomTypeName,
        otaBasicRoomId: p.otaBasicRoomId,
        otaBasicRoomName: p.otaBasicRoomName,
        otaRateCodeId: p.otaRateCodeId,
        otaPayType: p.otaPayType || 'PP',
        roomType: roomType.trim(),
        rateCode: rateCode.trim(),
        payType: payType.trim(),
        otaProductPresent: p.otaProductPresent ?? true,
      });
    }

    if (itemsToSave.length === 0) return;

    try {
      await dispatch(saveProductMappingsThunk(itemsToSave)).unwrap();
      setRowEdits({});
      dispatch(
        showToast({
          title: `已保存全部修改 (${itemsToSave.length} 项)`,
          description: '所有更改均已同步至文旅平台',
          type: 'success',
        })
      );

      // 保存后重新拉取远程映射绑定 ID，确保后续删除触发后端 DELETE
      await dispatch(
        loadProductMappingsAndOptions({
          channelCode: activeChannel.channelCode,
          extUnitCode: filterExtUnitCode,
          unitId: filterUnitId,
          unitType: filterUnitType || 'Property',
          hotelName: filterHotelName,
        })
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      dispatch(
        showToast({
          title: '保存修改失败',
          description: errorMsg,
          type: 'error',
        })
      );
    }
  };

  const handleResetFilters = () => {
    dispatch(setProductSearch(''));
    setFilterStatus('all');
    setCurrentPage(1);
  };

  return (
    <div className="w-full h-full max-w-[1400px] mx-auto flex flex-col p-6 text-[#0b1c30] overflow-hidden min-h-0 gap-3">
      {/* 1. 顶部标头栏 */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">产品采集</h1>
          <span className="text-xs text-[#737686] ml-2 font-mono">
            共 {products.length} 条产品映射
          </span>
          {activeHotel && (
            <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>当前门店已就绪</span>
            </span>
          )}
        </div>

        {/* 顶部主操作组 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isLoading || isHotelFetching || isChannelLoading || isSaving || isCrawling}
            onClick={handleRefreshAll}
            className="h-8.5 px-3 text-xs font-semibold text-[#004ac6] bg-[#eff4ff] hover:bg-[#dce9ff] active:bg-[#cbe0ff] rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer select-none border border-[#dce9ff]"
            title="重新获取最新渠道、门店映射与产品数据"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                isLoading || isHotelFetching || isChannelLoading ? 'animate-spin' : ''
              }`}
            />
            <span>刷新数据</span>
          </button>

          {modifiedCount > 0 && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveAllModified}
              className="h-8.5 px-3 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg shadow-2xs transition-colors inline-flex items-center gap-1.5 cursor-pointer select-none"
              title="一键保存所有未保存的修改"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>保存修改 ({modifiedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCrawlOtaProducts}
            disabled={!canCrawl || isCrawling || isLoading}
            className={`h-8.5 px-3.5 text-xs font-semibold rounded-lg shadow-2xs transition-colors inline-flex items-center gap-1.5 select-none shrink-0 ${
              !canCrawl
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                : 'text-white bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] cursor-pointer'
            }`}
            title={
              !canCrawl
                ? '请先在下方选择已完成渠道映射与门店绑定的酒店'
                : '通过自动化引擎抓取该酒店最新房型与商品'
            }
          >
            {isCrawling ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>正在采集产品...</span>
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

      {/* 2. 渠道与门店前置门禁控制栏 */}
      <div className="bg-white rounded-xl p-3.5 border border-[#dce9ff] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 w-full">
          {/* OTA 渠道选择器 (仅展示已完成映射的渠道) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-[#0b1c30] flex items-center gap-1.5">
                <span>OTA 渠道</span>
                {isChannelLoading && (
                  <RefreshCw className="w-3 h-3 text-[#004ac6] animate-spin" />
                )}
              </label>
              {isChannelLoading ? (
                <span className="text-[11px] text-[#004ac6]">正在同步渠道...</span>
              ) : mappedChannels.length === 0 ? (
                <span className="text-[11px] text-rose-600">暂无已完成映射的渠道</span>
              ) : null}
            </div>
            <SearchableSelect
              value={filterChannel}
              onChange={handleChannelFilterChange}
              options={channelOptions}
              placeholder={
                isChannelLoading
                  ? '正在同步渠道数据...'
                  : mappedChannels.length > 0
                    ? '请选择已映射的 OTA 渠道'
                    : '暂无可用渠道'
              }
              searchPlaceholder="搜索渠道名称、代码..."
              size="sm"
              disabled={isChannelLoading || mappedChannels.length === 0}
              buttonClassName="font-semibold text-[#0b1c30]"
            />
          </div>

          {/* 对应酒店选择器 (仅展示该渠道下已绑定 unitId 的门店) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-[#0b1c30] flex items-center gap-1.5">
                <span>对应酒店 (已绑定门店)</span>
                {isHotelFetching && (
                  <RefreshCw className="w-3 h-3 text-[#004ac6] animate-spin" />
                )}
              </label>
              {isHotelFetching ? (
                <span className="text-[11px] text-[#004ac6]">正在获取门店列表...</span>
              ) : filterChannel && mappedHotels.length === 0 ? (
                <span className="text-[11px] text-amber-700">该渠道暂无已绑定门店</span>
              ) : null}
            </div>
            <SearchableSelect
              value={filterExtUnitCode}
              onChange={handleHotelFilterChange}
              options={hotelOptions}
              placeholder={
                !filterChannel
                  ? '请先选择上方的 OTA 渠道'
                  : isHotelFetching
                    ? '正在加载门店数据...'
                    : mappedHotels.length > 0
                      ? '请选择已绑定的酒店门店...'
                      : '当前渠道暂无已绑定门店'
              }
              searchPlaceholder="输入酒店名称或代码搜索..."
              size="sm"
              disabled={!filterChannel || isHotelFetching || mappedHotels.length === 0}
              buttonClassName="font-semibold text-[#0b1c30]"
            />
          </div>
        </div>
      </div>

      {/* 未完成门禁提示条 */}
      {(!filterChannel || !filterExtUnitCode) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2.5 text-xs text-amber-850 shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            {!filterChannel
              ? '请先选择已经完成渠道映射的 OTA 渠道。未映射渠道无法进行产品采集。'
              : '请选择该渠道下已完成文旅平台绑定的酒店门店，系统将自动读取已有映射与内部字典。'}
          </span>
        </div>
      )}

      {/* 错误提示 */}
      {productError && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2.5 text-xs text-rose-800 shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{productError}</span>
        </div>
      )}

      {/* 3. 数据表格卡片 */}
      <div className="flex-1 min-h-0 bg-white rounded-xl shadow-xs border border-[#dce9ff] flex flex-col overflow-hidden divide-y divide-[#edf2f9]">
        {/* 内嵌搜索与快捷过滤 */}
        <div className="p-3 bg-[#f8faff] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-[#737686] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => dispatch(setProductSearch(e.target.value))}
                placeholder="搜索 OTA产品名称、产品编码、物理房型..."
                className="w-full h-8.5 pl-8.5 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs text-[#0b1c30] placeholder-[#94a3b8] transition-colors outline-hidden"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => dispatch(setProductSearch(''))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                  title="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 状态快捷过滤 */}
            <div className="flex items-center bg-[#edf4ff] p-0.5 rounded-lg text-xs shrink-0 border border-[#dce9ff]">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
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
                onClick={() => setFilterStatus('completed')}
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
                onClick={() => setFilterStatus('pending')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterStatus === 'pending'
                    ? 'bg-white text-amber-800 shadow-2xs font-semibold'
                    : 'text-[#434655] hover:text-[#0b1c30]'
                }`}
              >
                待配置
              </button>
            </div>

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

          <div className="flex items-center gap-2 text-xs text-[#737686] shrink-0 font-mono">
            <span>
              检索到 <strong className="text-[#004ac6] font-bold">{filteredProducts.length}</strong> / {products.length} 条产品
            </span>
          </div>
        </div>

        {/* 批量操作工具条 */}
        <div
          className={`p-2 transition-all duration-200 shrink-0 ${
            selectedKeys.length > 0 ? 'bg-[#eff4ff]' : 'bg-[#fafcff]'
          }`}
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
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

              {selectedKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedKeys([])}
                  className="text-xs text-[#ba1a1a] hover:bg-rose-50 px-2 py-1 rounded bg-white border border-[#ffdad6] transition-colors cursor-pointer"
                >
                  清空选择
                </button>
              )}

              <div className="h-4 w-px bg-[#dce9ff] mx-1" />

              <span className="text-xs text-[#737686] flex items-center gap-1 font-mono">
                已选{' '}
                <strong
                  className={`text-xs ${
                    selectedKeys.length > 0 ? 'text-[#004ac6]' : 'text-[#737686]'
                  }`}
                >
                  {selectedKeys.length}
                </strong>{' '}
                项
              </span>
            </div>

            {/* 右侧批量操作动作 */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={selectedKeys.length === 0 || isSaving}
                onClick={handleBatchSave}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] rounded-md transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
                title="批量保存所选产品映射（允许未填写房型、房价、预订类型）"
              >
                <Save className="w-3.5 h-3.5" />
                <span>批量保存 (允许留空)</span>
              </button>
            </div>
          </div>
        </div>

        {/* 数据表格 */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-separate border-spacing-0 min-w-[1320px] table-fixed">
            <thead className="sticky top-0 z-20 bg-[#f8faff]">
              <tr className="bg-[#f8faff] text-[#434655] text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                {/* 列 1: 复选框 (固定) */}
                <th className="py-2.5 px-4 w-[48px] min-w-[48px] max-w-[48px] text-center sticky top-0 left-0 z-30 bg-[#f8faff] border-b border-[#e5edfa]">
                  <input
                    type="checkbox"
                    checked={isCurrentPageAllSelected}
                    onChange={(e) => handleToggleSelectAllCurrentPage(e.target.checked)}
                    className="w-4 h-4 rounded border-[#dce9ff] text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                  />
                </th>

                {/* 列 2: OTA 产品 (固定在 left-[48px]) */}
                <th className="py-2.5 px-4 w-[260px] min-w-[260px] max-w-[260px] sticky top-0 left-[48px] z-30 bg-[#f8faff] border-b border-[#e5edfa]">
                  OTA 产品
                </th>

                {/* 列 3: OTA 物理房型 (固定在 left-[308px]，带右侧立体投影与分割线) */}
                <th className="py-2.5 px-4 w-[200px] min-w-[200px] max-w-[200px] sticky top-0 left-[308px] z-30 bg-[#f8faff] border-b border-r border-[#e2e8f0] shadow-[4px_0_8px_-3px_rgba(0,0,0,0.08)]">
                  OTA 物理房型
                </th>

                {/* 列 4: 内部房型 */}
                <th className="py-2.5 px-4 w-[210px] min-w-[210px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">
                  内部房型
                </th>

                {/* 列 5: 房价码 */}
                <th className="py-2.5 px-4 w-[190px] min-w-[190px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">
                  房价码
                </th>

                {/* 列 6: 预订类型 */}
                <th className="py-2.5 px-4 w-[170px] min-w-[170px] sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">
                  预订类型
                </th>

                {/* 列 7: 状态 */}
                <th className="py-2.5 px-4 w-[110px] min-w-[110px] text-center whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">
                  状态
                </th>

                {/* 列 8: 操作 (随表格平滑横向滚动) */}
                <th className="py-2.5 px-6 w-[120px] min-w-[120px] text-right whitespace-nowrap sticky top-0 z-20 bg-[#f8faff] border-b border-[#e5edfa]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-xs text-[#0b1c30]">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#737686]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-5 h-5 text-[#004ac6] animate-spin" />
                      <span>正在从文旅平台读取产品映射与字典选项...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <EmptyState
                      title={
                        !filterChannel || !filterExtUnitCode
                          ? '请先选择渠道与已绑定酒店'
                          : '当前酒店暂无产品映射数据'
                      }
                      description={
                        !filterChannel || !filterExtUnitCode
                          ? '在上方选择后将自动拉取平台历史映射，并可一键采集 OTA 产品'
                          : '可点击右上角「采集 OTA 产品」抓取最新房型商品'
                      }
                      actionText={
                        searchKeyword || filterStatus !== 'all' ? '清除过滤条件' : undefined
                      }
                      onAction={
                        searchKeyword || filterStatus !== 'all' ? handleResetFilters : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((p) => {
                  const key = getProductIdentityKey(p);
                  const edits = rowEdits[key] || {};
                  const currentRoomType =
                    edits.roomType !== undefined ? edits.roomType : (p.roomType || '');
                  const currentRateCode =
                    edits.rateCode !== undefined ? edits.rateCode : (p.rateCode || '');
                  const currentPayType =
                    edits.payType !== undefined ? edits.payType : (p.payType || '');
                  const isChecked = selectedKeys.includes(key);
                  const isModified =
                    edits.roomType !== undefined ||
                    edits.rateCode !== undefined ||
                    edits.payType !== undefined;

                  return (
                    <tr
                      key={key}
                      className={`hover:bg-[#f8faff] transition-colors relative group ${
                        isChecked ? 'bg-[#edf4ff]' : 'bg-white'
                      }`}
                    >
                      {/* 列 1: 复选框 (固定在 left-0，纯实色背景防止透字) */}
                      <td
                        className={`py-3 px-4 w-[48px] min-w-[48px] max-w-[48px] text-center sticky left-0 z-20 transition-colors border-b border-[#edf2f9] ${
                          isChecked
                            ? 'bg-[#edf4ff] group-hover:bg-[#e4eeff]'
                            : 'bg-white group-hover:bg-[#f8faff]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(key)}
                          className="w-4 h-4 rounded border-[#dce9ff] text-[#004ac6] focus:ring-[#004ac6] cursor-pointer align-middle"
                        />
                      </td>

                      {/* 列 2: OTA 产品 (固定在 left-[48px]，实色背景) */}
                      <td
                        className={`py-3 px-4 w-[260px] min-w-[260px] max-w-[260px] sticky left-[48px] z-20 transition-colors border-b border-[#edf2f9] ${
                          isChecked
                            ? 'bg-[#edf4ff] group-hover:bg-[#e4eeff]'
                            : 'bg-white group-hover:bg-[#f8faff]'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-1 overflow-hidden">
                          <span
                            className="font-bold text-xs text-[#0b1c30] leading-snug line-clamp-2 break-all"
                            title={p.otaRoomTypeName || p.otaProductName}
                          >
                            {p.otaRoomTypeName || p.otaProductName}
                          </span>
                          <span
                            className="text-[11px] text-[#737686] mt-1 font-mono truncate"
                            title={p.otaRoomTypeId || p.otaProductCode}
                          >
                            OTA 产品编码：{p.otaRoomTypeId || p.otaProductCode}
                          </span>
                        </div>
                      </td>

                      {/* 列 3: OTA 物理房型 (固定在 left-[308px]，右侧带实体边框和立体投影) */}
                      <td
                        className={`py-3 px-4 w-[200px] min-w-[200px] max-w-[200px] sticky left-[308px] z-20 transition-colors border-b border-r border-[#e2e8f0] shadow-[4px_0_8px_-3px_rgba(0,0,0,0.08)] ${
                          isChecked
                            ? 'bg-[#edf4ff] group-hover:bg-[#e4eeff]'
                            : 'bg-white group-hover:bg-[#f8faff]'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-1 overflow-hidden">
                          <span
                            className="font-medium text-xs text-[#0b1c30] leading-snug line-clamp-2 break-all"
                            title={p.otaBasicRoomName || p.otaPhysicalRoomName || '—'}
                          >
                            {p.otaBasicRoomName || p.otaPhysicalRoomName || '—'}
                          </span>
                          {(p.otaBasicRoomId || p.otaPhysicalRoomCode) && (
                            <span
                              className="text-[11px] text-[#737686] mt-1 font-mono truncate"
                              title={p.otaBasicRoomId || p.otaPhysicalRoomCode}
                            >
                              房型编码：{p.otaBasicRoomId || p.otaPhysicalRoomCode}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 列 4: 内部房型 */}
                      <td className="py-3 px-4 w-[210px] min-w-[210px] border-b border-[#edf2f9]">
                        <div className="w-full">
                          <SearchableSelect
                            value={currentRoomType}
                            onChange={(val) => handleRowValueChange(key, 'roomType', val)}
                            options={roomTypeOptions}
                            placeholder="留空 / 未关联"
                            searchPlaceholder="搜索房型..."
                            size="sm"
                          />
                        </div>
                      </td>

                      {/* 列 5: 内部房价码 */}
                      <td className="py-3 px-4 w-[190px] min-w-[190px] border-b border-[#edf2f9]">
                        <div className="w-full">
                          <SearchableSelect
                            value={currentRateCode}
                            onChange={(val) => handleRowValueChange(key, 'rateCode', val)}
                            options={rateCodeOptions}
                            placeholder="留空 / 未关联"
                            searchPlaceholder="搜索房价码..."
                            size="sm"
                          />
                        </div>
                      </td>

                      {/* 列 6: 预订类型 */}
                      <td className="py-3 px-4 w-[170px] min-w-[170px] border-b border-[#edf2f9]">
                        <div className="w-full">
                          <SearchableSelect
                            value={currentPayType}
                            onChange={(val) => handleRowValueChange(key, 'payType', val)}
                            options={reservationTypeOptions}
                            placeholder="留空 / 未关联"
                            searchPlaceholder="搜索预订类型..."
                            size="sm"
                          />
                        </div>
                      </td>

                      {/* 列 7: 状态 */}
                      <td className="py-3 px-4 w-[110px] min-w-[110px] text-center border-b border-[#edf2f9] whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <StatusBadge
                            variant={
                              p.status === 'completed'
                                ? 'success'
                                : p.status === 'pending'
                                  ? 'warning'
                                  : 'neutral'
                            }
                            label={
                              p.status === 'completed'
                                ? '已完成'
                                : p.status === 'pending'
                                  ? '待配置'
                                  : '已停用'
                            }
                          />
                          {p.source === 'ota-collection' && (
                            <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded font-medium">
                              新采集
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 列 8: 操作 (随表格平滑横向滚动，不作右侧遮挡固定) */}
                      <td className="py-3 px-6 w-[120px] min-w-[120px] text-right whitespace-nowrap border-b border-[#edf2f9]">
                        <div className="flex items-center justify-end gap-1.5">
                          {isModified && (
                            <button
                              type="button"
                              onClick={() => handleSaveRow(p)}
                              className="px-2 py-1 text-xs font-semibold text-[#004ac6] bg-[#eff4ff] hover:bg-[#dce9ff] rounded transition-colors cursor-pointer"
                              title="保存此行修改"
                            >
                              保存
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(p)}
                            className="p-1 text-[#737686] hover:text-[#ba1a1a] hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="删除此产品映射"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

        {/* 底部固定分页栏 */}
        <div className="p-3 bg-white flex items-center justify-between shrink-0 border-t border-[#edf2f9]">
          <Pagination
            currentPage={safeCurrentPage}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={(page) => setCurrentPage(page)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>
      </div>
    </div>
  );
};
