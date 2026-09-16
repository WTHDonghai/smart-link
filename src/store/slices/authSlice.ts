import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import {
  PlatformAuthTokens,
  PlatformDeviceCodeInfo,
  PlatformTokenState,
  PlatformAuthStatus,
  AppError,
} from '../../types';
import {
  platformAuthService,
  getPlatformBaseUrl,
  inspectTokenState,
  loadTokensFromStorage,
  clearTokensFromStorage,
  saveTokensToStorage,
} from '../../services/platformAuth';
import { normalizeAppError } from '../../utils/errorNormalizer';

export interface AuthState {
  status: PlatformAuthStatus;
  platformBaseUrl: string;
  tenantId: string;
  tokens: PlatformAuthTokens | null;
  tokenState: PlatformTokenState | null;
  deviceCodeInfo: PlatformDeviceCodeInfo | null;
  isAuthorizing: boolean;
  isRefreshing: boolean;
  failureReason: string | null;
  failureError: AppError | null;
}

const initialTokens = loadTokensFromStorage();
const initialTokenState = initialTokens ? inspectTokenState(initialTokens) : null;
const initialStatus: PlatformAuthStatus =
  initialTokenState && initialTokenState.usable ? 'authorized' : 'login-required';

function resolveInitialBaseUrl(): string {
  try {
    return getPlatformBaseUrl();
  } catch {
    return '';
  }
}

const initialState: AuthState = {
  status: initialStatus,
  platformBaseUrl: resolveInitialBaseUrl(),
  tenantId: initialTokens?.tenantId || '',
  tokens: initialTokens,
  tokenState: initialTokenState,
  deviceCodeInfo: null,
  isAuthorizing: false,
  isRefreshing: false,
  failureReason: null,
  failureError: null,
};

// 异步 Thunk：发起设备授权码并启动轮询
export const startDeviceLogin = createAsyncThunk<
  PlatformAuthTokens,
  { baseUrl?: string; signal?: AbortSignal },
  { rejectValue: string }
>('auth/startDeviceLogin', async ({ baseUrl, signal }, { dispatch, rejectWithValue }) => {
  try {
    const targetUrl = baseUrl || getPlatformBaseUrl();
    const codeInfo = await platformAuthService.requestDeviceCode(targetUrl);
    dispatch(setDeviceCodeInfo(codeInfo));

    // 自动在外部浏览器弹出文旅平台授权页
    if (typeof window !== 'undefined' && codeInfo.verificationUri) {
      try {
        window.open(codeInfo.verificationUri, '_blank', 'noopener,noreferrer');
      } catch {
        // 浏览器弹窗拦截备用方案由 UI 界面提供手动点击按钮
      }
    }

    const tokens = await platformAuthService.pollDeviceToken(targetUrl, codeInfo.deviceCode, {
      expiresIn: codeInfo.expiresIn,
      interval: codeInfo.interval,
      signal,
    });

    return tokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectWithValue(message);
  }
});

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setPlatformBaseUrl: (state, action: PayloadAction<string>) => {
      state.platformBaseUrl = action.payload;
      if (state.tokens) {
        state.tokens.platformBaseUrl = action.payload;
        saveTokensToStorage(state.tokens);
      }
    },
    setDeviceCodeInfo: (state, action: PayloadAction<PlatformDeviceCodeInfo | null>) => {
      state.deviceCodeInfo = action.payload;
      if (action.payload) {
        state.status = 'authorizing';
        state.isAuthorizing = true;
        state.failureReason = null;
        state.failureError = null;
      }
    },
    cancelDeviceLogin: (state) => {
      state.isAuthorizing = false;
      state.deviceCodeInfo = null;
      state.status = state.tokens && state.tokenState?.usable ? 'authorized' : 'login-required';
    },
    updateTokenState: (state) => {
      if (state.tokens) {
        state.tokenState = inspectTokenState(state.tokens);
        if (!state.tokenState.usable) {
          state.status = 'login-required';
        }
      } else {
        state.tokenState = null;
        state.status = 'login-required';
      }
    },
    loginSucceeded: (state, action: PayloadAction<PlatformAuthTokens>) => {
      state.tokens = action.payload;
      state.tokenState = inspectTokenState(action.payload);
      state.tenantId = action.payload.tenantId || state.tenantId;
      state.platformBaseUrl = action.payload.platformBaseUrl || state.platformBaseUrl;
      state.status = 'authorized';
      state.isAuthorizing = false;
      state.deviceCodeInfo = null;
      state.failureReason = null;
      state.failureError = null;
      saveTokensToStorage(action.payload);
    },
    tokenRefreshed: (state, action: PayloadAction<PlatformAuthTokens>) => {
      state.tokens = action.payload;
      state.tokenState = inspectTokenState(action.payload);
      state.isRefreshing = false;
      state.status = 'authorized';
      state.failureReason = null;
      state.failureError = null;
      saveTokensToStorage(action.payload);
    },
    authFailed: (state, action: PayloadAction<string>) => {
      state.status = 'login-required';
      state.isAuthorizing = false;
      state.isRefreshing = false;
      state.deviceCodeInfo = null;
      state.failureReason = action.payload;
      state.failureError = normalizeAppError(action.payload, 'AUTH');
    },
    logout: (state) => {
      state.tokens = null;
      state.tokenState = null;
      state.tenantId = '';
      state.status = 'login-required';
      state.isAuthorizing = false;
      state.isRefreshing = false;
      state.deviceCodeInfo = null;
      state.failureReason = null;
      state.failureError = null;
      clearTokensFromStorage();
      platformAuthService.stopRefreshScheduler();
    },
  },
  extraReducers: (builder) => {
    builder
      // startDeviceLogin
      .addCase(startDeviceLogin.pending, (state) => {
        state.isAuthorizing = true;
        state.failureReason = null;
        state.failureError = null;
      })
      .addCase(startDeviceLogin.fulfilled, (state, action) => {
        state.tokens = action.payload;
        state.tokenState = inspectTokenState(action.payload);
        state.tenantId = action.payload.tenantId || state.tenantId;
        state.platformBaseUrl = action.payload.platformBaseUrl || state.platformBaseUrl;
        state.status = 'authorized';
        state.isAuthorizing = false;
        state.deviceCodeInfo = null;
        state.failureReason = null;
        state.failureError = null;
        saveTokensToStorage(action.payload);
      })
      .addCase(startDeviceLogin.rejected, (state, action) => {
        const errorPayload = action.payload || '平台授权申请失败';
        state.isAuthorizing = false;
        state.status = 'login-required';
        state.deviceCodeInfo = null;
        state.failureReason = errorPayload;
        state.failureError = normalizeAppError(errorPayload, 'AUTH');
      });
  },
});

export const {
  setPlatformBaseUrl,
  setDeviceCodeInfo,
  cancelDeviceLogin,
  updateTokenState,
  loginSucceeded,
  tokenRefreshed,
  authFailed,
  logout,
} = authSlice.actions;

export default authSlice.reducer;
