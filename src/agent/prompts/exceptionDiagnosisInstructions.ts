/**
 * 异常诊断模型提示词（版本化，设计 9.3）。
 *
 * 输出契约（模型必须返回的 JSON 结构）：
 * { "category": "login_required|risk_verification|page_blocked|protocol_parse_error|pms_rejection|network_timeout|business_field_missing|unknown",
 *   "severity": "high|medium|low", "confidence": "high|medium|low",
 *   "summary": "≤120字可读分析", "manualAction": "人工下一步", "facts": ["已观察事实，≤10条"] }
 */

import type { ExceptionIncident } from '@/src/types/agent';
import type { ModelChatMessage } from '@/src/agent/agentModelClient';

export const EXCEPTION_DIAGNOSIS_PROMPT_VERSION = 'exception-diagnosis-v1';

const SYSTEM_INSTRUCTIONS = `你是 OTA 订单搬运系统的异常诊断助手。值守任务失败后，你将收到任务失败信息与页面现场观察（可能缺失），需要产出结构化诊断结论供值班人员处置。

必须遵守的规则：
1. category 必须从给定枚举中选取；证据不足时选 unknown，不得猜测具体原因。
2. facts 只能引用输入中真实存在的证据（错误信息、页面观察、按钮文本）；禁止编造页面内容或接口响应。
3. summary 面向值班人员：先说发生了什么事实，再说你的判断；不超过 120 字。
4. manualAction 必须是明确、可执行的下一步（如"在该电脑完成登录验证后核对订单状态"）；不确定时写"请人工核对订单状态与渠道后台"。
5. 页面出现验证码、风控、重新登录类内容时 category 取 risk_verification 或 login_required，manualAction 指引人工完成验证；绝不建议绕过验证。
6. 必须只返回一个 JSON 对象，不含解释文字或代码块标记。

输出 JSON 结构：
{"category":"page_blocked","severity":"high","confidence":"medium","summary":"页面被公告弹窗遮挡，订单详情未能打开","manualAction":"请人工关闭公告后重试该订单","facts":["错误信息：定位订单卡片超时","页面观察：存在标题为「系统公告」的弹窗"]}`;

export function buildExceptionDiagnosisMessages(incident: ExceptionIncident): ModelChatMessage[] {
  const observation = incident.observation
    ? {
        pageUrl: incident.observation.pageUrl,
        visibleTextExcerpt: incident.observation.visibleTextExcerpt,
        dialogs: incident.observation.dialogs.map((dialog) => ({
          title: dialog.title,
          bodyText: dialog.bodyText,
          buttons: dialog.buttons,
        })),
        note: incident.observation.note ?? null,
      }
    : null;

  const userPayload = {
    incident: {
      taskId: incident.taskId,
      channelCode: incident.channelCode,
      orderNo: incident.orderNo,
      taskType: incident.msgType,
      failurePhase: incident.failurePhase,
      errorCode: incident.errorCode,
      errorMessage: incident.errorMessage,
      retryable: incident.retryable,
      sideEffectState: incident.sideEffectState,
      occurredAt: incident.occurredAt,
    },
    pageObservation: observation,
  };

  return [
    { role: 'system', content: SYSTEM_INSTRUCTIONS },
    {
      role: 'user',
      content: `请诊断以下值守任务异常并返回规定结构的 JSON。\n${JSON.stringify(userPayload, null, 0)}`,
    },
  ];
}
