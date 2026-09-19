import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import appReducer from './slices/appSlice';
import channelReducer from './slices/channelSlice';
import hotelReducer from './slices/hotelSlice';
import productReducer from './slices/productSlice';
import orderGuardianReducer from './slices/orderGuardianSlice';
import systemLogReducer from './slices/systemLogSlice';
import authReducer from './slices/authSlice';
import { channelListenerMiddleware } from './channelListener';
import { logPersistenceMiddleware } from './logPersistenceMiddleware';

export const rootReducer = {
  app: appReducer,
  channel: channelReducer,
  hotel: hotelReducer,
  product: productReducer,
  orderGuardian: orderGuardianReducer,
  systemLog: systemLogReducer,
  auth: authReducer,
};

export const createAppStore = () =>
  configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(
        logPersistenceMiddleware,
        channelListenerMiddleware.middleware
      ),
  });

export const store = createAppStore();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
