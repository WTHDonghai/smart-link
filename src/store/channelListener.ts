import { createListenerMiddleware } from '@reduxjs/toolkit';
import {
  updateChannelFieldMapping,
  toggleChannelField,
  updateRemarkTemplate,
  saveRemarkTemplateAsync,
  fetchRemarkTemplateAsync,
  resetChannelProtocol,
  updateChannelProtocolSchema,
  saveProtocolSchemaToStorage,
  saveRemarkTemplateToStorage,
  removeProtocolSchemaFromStorage,
  removeRemarkTemplateFromStorage,
  type ChannelState,
} from './slices/channelSlice';

/**
 * 渠道模块专属 Redux Listener 中间件
 * 负责在 100% 纯函数 Reducer 执行完毕后，统一监听相关 Action 将最新 state 安全持久化至 localStorage 或执行清理。
 * 杜绝在 Reducer 内部引发 I/O 副作用或非确定性操作。
 */
export const channelListenerMiddleware = createListenerMiddleware();

// 1. 监听协议 Schema 字段与规则变更，安全同步至 LocalStorage
channelListenerMiddleware.startListening({
  actionCreator: updateChannelFieldMapping,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as { channel: ChannelState };
    const channelId = action.payload.channelId;
    const channel = state.channel?.channels.find((c) => c.id === channelId);
    if (channel?.protocolSchema) {
      saveProtocolSchemaToStorage(channelId, channel.protocolSchema);
    }
  },
});

channelListenerMiddleware.startListening({
  actionCreator: toggleChannelField,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as { channel: ChannelState };
    const channelId = action.payload.channelId;
    const channel = state.channel?.channels.find((c) => c.id === channelId);
    if (channel?.protocolSchema) {
      saveProtocolSchemaToStorage(channelId, channel.protocolSchema);
    }
  },
});

channelListenerMiddleware.startListening({
  actionCreator: updateChannelProtocolSchema,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as { channel: ChannelState };
    const channelId = action.payload.channelId;
    const channel = state.channel?.channels.find((c) => c.id === channelId);
    const schemaToSave = channel?.protocolSchema || action.payload.schema;
    if (schemaToSave) {
      saveProtocolSchemaToStorage(channelId, schemaToSave);
    }
  },
});

// 2. 监听备注模板更新（本地与异步远程），安全同步至 LocalStorage
channelListenerMiddleware.startListening({
  actionCreator: updateRemarkTemplate,
  effect: (action, listenerApi) => {
    const state = listenerApi.getState() as { channel: ChannelState };
    const channelId = action.payload.channelId;
    const channel = state.channel?.channels.find((c) => c.id === channelId);
    if (channel && typeof channel.remarkTemplate === 'string') {
      saveRemarkTemplateToStorage(channelId, channel.remarkTemplate);
    }
  },
});

channelListenerMiddleware.startListening({
  actionCreator: saveRemarkTemplateAsync.fulfilled,
  effect: (action) => {
    const channelId = action.payload.channelId;
    if (typeof action.payload.template === 'string') {
      saveRemarkTemplateToStorage(channelId, action.payload.template);
    }
  },
});

channelListenerMiddleware.startListening({
  actionCreator: fetchRemarkTemplateAsync.fulfilled,
  effect: (action) => {
    const channelId = action.payload.channelId;
    if (typeof action.payload.remarkTemplate === 'string') {
      saveRemarkTemplateToStorage(channelId, action.payload.remarkTemplate);
    }
  },
});

// 3. 监听协议与模板重置，安全清除 LocalStorage 缓存
channelListenerMiddleware.startListening({
  actionCreator: resetChannelProtocol,
  effect: (action) => {
    const channelId = action.payload.channelId;
    removeProtocolSchemaFromStorage(channelId);
    removeRemarkTemplateFromStorage(channelId);
  },
});
