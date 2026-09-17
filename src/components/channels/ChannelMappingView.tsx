import React, { useEffect, useMemo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fetchChannelMappingData,
  saveChannelMapping,
  selectCulturalTourismChannel,
  setSelectedChannelForTemplate,
  removeChannel,
  clearChannelError,
} from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import type { OTAChannel } from '../../types';
import { AddChannelDropdown } from './AddChannelDropdown';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../common/StatusBadge';
import { SearchableSelect, type SelectOption } from '../common/SearchableSelect';
import { TableRowActions } from '../common/TableRowActions';
import { ChannelBadge } from '../common/ChannelBadge';
import { normalizeAppError } from '../../utils/errorNormalizer';
import { Settings, RefreshCw, CircleAlert } from 'lucide-react';

export const ChannelMappingView: React.FC = () => {
  const dispatch = useAppDispatch();
  const {
    channels,
    culturalTourismChannels,
    isLoading,
    isSaving,
    savingChannelId,
    error,
  } = useAppSelector((state) => state.channel);

  const normalizedError = error ? normalizeAppError(error, 'NET') : null;

  const channelSelectOptions = useMemo<SelectOption[]>(
    () =>
      culturalTourismChannels.map((opt) => ({
        value: opt.channelId,
        label: `${opt.channelName} (${opt.channelCode})`,
        subtext: `渠道代码: ${opt.channelCode}`,
      })),
    [culturalTourismChannels]
  );

  const getOptionsForChannel = useCallback(
    (ch: OTAChannel): SelectOption[] => {
      if (ch.channelId && !channelSelectOptions.some((opt) => opt.value === ch.channelId)) {
        return [
          {
            value: ch.channelId,
            label: `${ch.channelName || ch.channelCode} (${ch.channelCode || ch.channelId})`,
            subtext: `渠道代码: ${ch.channelCode || ch.channelId}`,
          },
          ...channelSelectOptions,
        ];
      }
      return channelSelectOptions;
    },
    [channelSelectOptions]
  );

  useEffect(() => {
    dispatch(fetchChannelMappingData());
  }, [dispatch]);

  const handleRefresh = useCallback(async () => {
    const result = await dispatch(fetchChannelMappingData());
    if (fetchChannelMappingData.fulfilled.match(result)) {
      dispatch(
        showToast({
          title: '渠道映射已刷新',
          description: `已成功同步文旅渠道与 ${result.payload.mappings.length} 条已配置映射`,
          type: 'success',
        })
      );
    }
  }, [dispatch]);

  const handleSelectPmsChannel = useCallback(
    (channelId: string, pmsChannelId: string) => {
      if (!pmsChannelId) {
        dispatch(
          selectCulturalTourismChannel({
            channelId,
            pmsChannelId: '',
            pmsChannelCode: '',
            pmsChannelName: '',
          })
        );
        return;
      }

      const selectedPms = culturalTourismChannels.find((c) => c.channelId === pmsChannelId);
      if (selectedPms) {
        dispatch(
          selectCulturalTourismChannel({
            channelId,
            pmsChannelId: selectedPms.channelId,
            pmsChannelCode: selectedPms.channelCode,
            pmsChannelName: selectedPms.channelName,
          })
        );
      }
    },
    [dispatch, culturalTourismChannels]
  );

  const handleSave = useCallback(
    async (channel: OTAChannel) => {
      if (!channel.channelId || !channel.channelCode) {
        dispatch(
          showToast({
            title: '请先选择文旅渠道',
            description: `请为「${channel.name}」指定对应的文旅接收渠道后再保存`,
            type: 'info',
          })
        );
        return;
      }

      const result = await dispatch(
        saveChannelMapping({
          channelId: channel.id,
          otaChannelCode: channel.code,
          otaChannelName: channel.name,
          pmsChannelId: channel.channelId,
          channelCode: channel.channelCode,
          pmsChannelName: channel.channelName,
          status: 'A',
        })
      );

      if (saveChannelMapping.fulfilled.match(result)) {
        dispatch(
          showToast({
            title: `已成功保存「${channel.name}」渠道映射`,
            description: `绑定文旅渠道：${channel.channelName || channel.channelCode}`,
            type: 'success',
          })
        );
        dispatch(
          addLog({
            level: 'INFO',
            channelId: channel.id,
            message: `[ChannelMapping] Saved mapping for ${channel.name} (${channel.code}) -> ${channel.channelName || channel.channelCode}`,
          })
        );
      } else if (saveChannelMapping.rejected.match(result)) {
        const rawError = (result.payload as string) || result.error?.message || '保存渠道映射失败';
        const normalized = normalizeAppError(rawError, 'NET');
        dispatch(
          showToast({
            title: `保存「${channel.name}」渠道映射失败`,
            description: normalized.userMessage,
            type: 'error',
          })
        );
        dispatch(
          addLog({
            level: 'ERROR',
            channelId: channel.id,
            message: `[ChannelMapping] Failed to save mapping for ${channel.name} (${channel.code}): ${rawError}`,
            details: rawError,
          })
        );
      }
    },
    [dispatch]
  );

  const handleDelete = useCallback(
    (channel: OTAChannel) => {
      dispatch(removeChannel(channel.id));
      dispatch(
        showToast({
          title: `已删除「${channel.name}」渠道`,
          description: '该渠道映射已从列表中移除',
          type: 'info',
        })
      );
      dispatch(
        addLog({
          level: 'WARN',
          channelId: channel.id,
          message: `[ChannelConfig] Removed channel mapping ${channel.name} (${channel.code})`,
        })
      );
    },
    [dispatch]
  );

  return (
    <div className="flex flex-col gap-5 max-w-[1400px] mx-auto w-full p-6">
      {/* 顶部标题栏与操作按钮 */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4 rounded-full bg-[#004ac6] shrink-0" aria-hidden="true" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            渠道映射
          </h1>
          <span className="text-xs text-[#737686] ml-2">
            共 <span className="font-mono font-medium text-[#0b1c30]">{channels.length}</span> 个渠道
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-8 px-3 rounded-lg border border-[#dce9ff] hover:bg-[#eff4ff] active:bg-[#dce9ff] text-[#004ac6] font-medium text-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 select-none shadow-2xs"
            title="刷新渠道列表与映射状态"
            aria-label="刷新数据"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>刷新数据</span>
          </button>
          <AddChannelDropdown />
        </div>
      </div>

      {/* 错误提示栏 */}
      {normalizedError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center justify-between" role="alert">
          <div className="flex items-center gap-2">
            <CircleAlert className="w-4 h-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{normalizedError.userTitle}: {normalizedError.userMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => dispatch(clearChannelError())}
            className="text-rose-500 hover:text-rose-700 font-medium underline ml-3 shrink-0 cursor-pointer"
            aria-label="关闭错误提示"
          >
            关闭
          </button>
        </div>
      )}

      {/* Main Card Panel: Channel Mapping Table */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] min-h-[380px]">
        <div className="w-full overflow-x-auto min-h-[380px] pb-16">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-20 bg-[#f8faff] text-[#434655] text-xs font-semibold border-b border-[#e5edfa]">
              <tr>
                <th className="py-3 px-6" scope="col">
                  OTA 渠道
                </th>
                <th className="py-3 px-4" scope="col">
                  文旅渠道
                </th>
                <th className="py-3 px-4 whitespace-nowrap w-28" scope="col">
                  映射状态
                </th>
                <th className="py-3 px-4 whitespace-nowrap w-36" scope="col">
                  订单备注模板
                </th>
                <th className="py-3 px-6 text-right whitespace-nowrap w-44" scope="col">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-[#0b1c30] text-sm" id="channel-table-body">
              {channels.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <EmptyState
                      title="暂无配置渠道"
                      description="当前未添加任何 OTA 渠道，请通过右上角「添加渠道」进行添加并配置文旅接收映射"
                    />
                  </td>
                </tr>
              ) : (
                channels.map((ch, index) => {
                  const isPaused = ch.status === 'paused';
                  const isRowSaving = isSaving && savingChannelId === ch.id;
                  const isUnsaved = Boolean(ch.channelId && !ch.isMapped);

                  return (
                    <tr
                      key={ch.id}
                      className={`channel-row hover:bg-[#f8faff] transition-colors ${
                        isPaused ? 'opacity-60 bg-gray-50/50' : ''
                      }`}
                      data-channel-id={ch.id}
                    >
                      {/* OTA 渠道 */}
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-3">
                          <ChannelBadge channel={ch} size="lg" />
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-sm text-[#0b1c30]">
                                {ch.name}
                              </span>
                              {isPaused && (
                                <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                                  已暂停
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-[#737686] font-mono">
                              {ch.code}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 文旅渠道（对应接收系统） */}
                      <td className="py-3.5 px-4">
                        <div className="relative w-full max-w-sm">
                          <SearchableSelect
                            value={ch.channelId || ''}
                            onChange={(val) => handleSelectPmsChannel(ch.id, val)}
                            options={getOptionsForChannel(ch)}
                            placeholder={
                              culturalTourismChannels.length === 0
                                ? isLoading
                                  ? '加载文旅渠道中...'
                                  : '暂无可用文旅渠道'
                                : '-- 请选择文旅渠道 --'
                            }
                            searchPlaceholder="输入关键词搜索文旅渠道..."
                            disabled={isLoading || isRowSaving}
                            placement={index >= channels.length - 1 && channels.length > 1 ? 'top' : 'bottom'}
                            clearable
                          />
                        </div>
                      </td>

                      {/* 映射状态 */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isUnsaved ? (
                          <StatusBadge
                            variant="pending"
                            label="待保存"
                            icon={true}
                            size="xs"
                          />
                        ) : (
                          <StatusBadge
                            variant={ch.isMapped ? 'success' : 'cancelled'}
                            label={ch.isMapped ? '已映射' : '未映射'}
                            icon={ch.isMapped}
                            size="xs"
                          />
                        )}
                      </td>

                      {/* 订单备注模板（保持解耦，本次不接入远程） */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => dispatch(setSelectedChannelForTemplate(ch.id))}
                          className="inline-flex items-center gap-1.5 text-xs text-[#004ac6] hover:text-[#003ea8] font-medium hover:underline cursor-pointer shrink-0 whitespace-nowrap"
                          aria-label={`配置 ${ch.name} 订单备注模板`}
                        >
                          <Settings className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>配置模板</span>
                        </button>
                      </td>

                      {/* 操作 */}
                      <td className="py-3.5 px-6 text-right whitespace-nowrap">
                        <TableRowActions
                          size="md"
                          onSave={() => handleSave(ch)}
                          isSaving={isRowSaving}
                          isUnsaved={isUnsaved}
                          saveDisabled={!ch.channelId}
                          saveAriaLabel={`保存 ${ch.name} 渠道映射`}
                          onDelete={() => handleDelete(ch)}
                          deleteTitle="删除渠道"
                          deleteAriaLabel={`删除 ${ch.name} 渠道`}
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
