/**
 * 证据文本脱敏（设计 7.1/9.8：发送模型与写入通知前统一清除敏感信息）。
 *
 * 覆盖手机号、身份证形态与长数字串；页面观察（dutyPageObserver）与
 * 异常诊断（exceptionDiagnosisWorkflow 的 incident.errorMessage）共用，
 * 禁止各处自行实现第二套脱敏规则。
 */

const PHONE_PATTERN = /1[3-9]\d{9}/g;
const LONG_DIGIT_PATTERN = /\d{7,}/g;
const ID_CARD_PATTERN = /\d{17}[\dXx]/g;

/** 证据脱敏：手机号、身份证形态与长数字串在进入模型与通知前必须掩码 */
export function maskSensitiveText(text: string): string {
  return text
    .replace(ID_CARD_PATTERN, (match) => `${match.slice(0, 4)}************${match.slice(-2)}`)
    .replace(PHONE_PATTERN, (match) => `${match.slice(0, 3)}****${match.slice(7)}`)
    .replace(LONG_DIGIT_PATTERN, (match) => `${match.slice(0, 3)}****${match.slice(-2)}`);
}
