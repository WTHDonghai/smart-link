import { AppError, ErrorDomain } from '../types/error';
import { ERROR_DICTIONARY } from './errorDictionary';

interface ErrorLikeObject {
  message?: string;
  statusCode?: number;
  status?: number;
  error?: string;
  error_description?: string;
  msg?: string;
  code?: string;
}

function extractRawMessage(error: unknown): string {
  if (!error) return '未知错误';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (typeof error === 'object') {
    const errObj = error as ErrorLikeObject;
    if (typeof errObj.message === 'string') return errObj.message;
    if (typeof errObj.error_description === 'string') return errObj.error_description;
    if (typeof errObj.msg === 'string') return errObj.msg;
    if (typeof errObj.error === 'string') return errObj.error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function extractStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const obj = error as ErrorLikeObject;
  if (typeof obj.statusCode === 'number') return obj.statusCode;
  if (typeof obj.status === 'number') return obj.status;
  return undefined;
}

/**
 * 智能错误归一化解析器 (Error Normalizer)
 * 将各类异构的原始异常、HTTP 状态码、网关超时堆栈清洗转换为标准的 AppError 对象
 */
export function normalizeAppError(
  error: unknown,
  fallbackDomain: ErrorDomain = 'SYS'
): AppError {
  const rawMessage = extractRawMessage(error);
  const statusCode = extractStatusCode(error);
  const lowerMsg = rawMessage.toLowerCase();
  const timestamp = new Date().toISOString();

  // 1. 认证域特征匹配
  if (
    lowerMsg.includes('用户取消') ||
    ((lowerMsg.includes('aborted') || lowerMsg.includes('abort')) &&
      (fallbackDomain === 'AUTH' || lowerMsg.includes('授权') || lowerMsg.includes('login')))
  ) {
    return {
      ...ERROR_DICTIONARY.AUTH_USER_CANCELLED,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  if (lowerMsg.includes('授权超时') || lowerMsg.includes('device_code_expired')) {
    return {
      ...ERROR_DICTIONARY.AUTH_DEVICE_EXPIRED,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  // 网络超时特征（精准识别网关转发超时，例如 connection timed out after 30000 ms: /10.233.109.82:8090）
  if (
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('etimedout') ||
    statusCode === 504 ||
    statusCode === 408
  ) {
    if (fallbackDomain === 'AUTH' || lowerMsg.includes('oauth') || lowerMsg.includes('token') || lowerMsg.includes('授权')) {
      return {
        ...ERROR_DICTIONARY.AUTH_NET_TIMEOUT,
        rawMessage,
        statusCode: statusCode ?? 504,
        timestamp,
      };
    }
    return {
      ...ERROR_DICTIONARY.NET_REQUEST_TIMEOUT,
      rawMessage,
      statusCode: statusCode ?? 504,
      timestamp,
    };
  }

  // 网关或服务不可用 (502 / 503)
  if (
    statusCode === 502 ||
    statusCode === 503 ||
    lowerMsg.includes('502 bad gateway') ||
    lowerMsg.includes('503 service temporarily unavailable') ||
    lowerMsg.includes('connection refused')
  ) {
    if (fallbackDomain === 'AUTH' || lowerMsg.includes('oauth') || lowerMsg.includes('token')) {
      return {
        ...ERROR_DICTIONARY.AUTH_NET_UNAVAILABLE,
        rawMessage,
        statusCode: statusCode ?? 502,
        timestamp,
      };
    }
    return {
      ...ERROR_DICTIONARY.NET_REQUEST_TIMEOUT,
      rawMessage,
      statusCode: statusCode ?? 502,
      timestamp,
    };
  }

  // 凭据失效特征 (401 / invalid_grant / invalid_token / token 刷新失败)
  if (
    (statusCode === 401 && (fallbackDomain === 'AUTH' || lowerMsg.includes('token') || lowerMsg.includes('oauth') || lowerMsg.includes('auth'))) ||
    lowerMsg.includes('invalid_grant') ||
    lowerMsg.includes('invalid_token') ||
    lowerMsg.includes('unauthorized_client') ||
    lowerMsg.includes('token 已过期') ||
    lowerMsg.includes('未找到 refresh_token')
  ) {
    return {
      ...ERROR_DICTIONARY.AUTH_CRED_INVALID,
      rawMessage,
      statusCode: statusCode ?? 401,
      timestamp,
    };
  }

  // 2. 订单流转域特征匹配
  if (
    lowerMsg.includes('预订类型不存在') ||
    lowerMsg.includes('房型未') ||
    lowerMsg.includes('unmapped_room')
  ) {
    return {
      ...ERROR_DICTIONARY.ORDER_MAP_ROOM_NOT_FOUND,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  if (lowerMsg.includes('酒店未') || lowerMsg.includes('unmapped_hotel')) {
    return {
      ...ERROR_DICTIONARY.ORDER_MAP_HOTEL_NOT_FOUND,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  if (lowerMsg.includes('价格') && (lowerMsg.includes('异常') || lowerMsg.includes('倒挂'))) {
    return {
      ...ERROR_DICTIONARY.ORDER_VALID_PRICE_MISMATCH,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  if (lowerMsg.includes('pms') && (lowerMsg.includes('失败') || lowerMsg.includes('拒绝'))) {
    return {
      ...ERROR_DICTIONARY.ORDER_PMS_PUSH_FAILED,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  // 3. 自动化会话域特征匹配
  if (lowerMsg.includes('cookie') || lowerMsg.includes('会话失效') || lowerMsg.includes('登录态失效')) {
    return {
      ...ERROR_DICTIONARY.CRAWLER_SESS_EXPIRED,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  if (lowerMsg.includes('captcha') || lowerMsg.includes('验证码') || lowerMsg.includes('滑块')) {
    return {
      ...ERROR_DICTIONARY.CRAWLER_CAPTCHA_BLOCKED,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  // 4. 系统与网络域特征匹配
  if (
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('net::err_internet_disconnected')
  ) {
    return {
      ...ERROR_DICTIONARY.NET_OFFLINE,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  if (lowerMsg.includes('未配置平台接口基础地址') || lowerMsg.includes('vite_platform_base_url')) {
    return {
      ...ERROR_DICTIONARY.SYS_CONFIG_MISSING,
      rawMessage,
      statusCode,
      timestamp,
    };
  }

  // 5. 兜底
  return {
    ...ERROR_DICTIONARY.SYS_UNKNOWN_ERROR,
    rawMessage,
    statusCode,
    timestamp,
  };
}
