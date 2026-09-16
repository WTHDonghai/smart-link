import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setSelectedChannelForTemplate,
  updateRemarkTemplate,
} from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { Check, Eye, SlidersHorizontal, TriangleAlert, Lightbulb } from 'lucide-react';
import { Modal } from '../common/Modal';
import { TemplateVariablePicker } from './TemplateVariablePicker';
import { ProtocolFieldManagerModal } from './ProtocolFieldManagerModal';
import {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  DEFAULT_MEITUAN_REMARK_TEMPLATE,
  MEITUAN_RAW_SAMPLE_ORDER,
} from '../../services/protocols/meituanProtocol';
import {
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  DEFAULT_DOUYIN_REMARK_TEMPLATE,
  DOUYIN_RAW_SAMPLE_ORDER,
} from '../../services/protocols/douyinProtocol';
import type { CleanOrderContext } from '../../types/template';
import {
  renderTemplate,
  validateTemplate,
} from '../../utils/template/templateEngine';
import {
  insertAtCursor,
  detectUnknownVariables,
} from '../../utils/template/templateEditor';
import { normalizeOrderPayload } from '../../utils/template/protocolNormalizer';

export const RemarkTemplateModal: React.FC = () => {
  const dispatch = useAppDispatch();
  const selectedChannelId = useAppSelector((state) => state.channel.selectedChannelForTemplate);
  const channels = useAppSelector((state) => state.channel.channels);

  const currentChannel = channels.find((c) => c.id === selectedChannelId);

  const [templateText, setTemplateText] = useState('');
  const [isFieldManagerOpen, setIsFieldManagerOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTextareaFocusedRef = useRef(false);

  const isMeituan = currentChannel?.id === 'meituan';
  const isDouyin = currentChannel?.id === 'douyin';

  const defaultTemplate = useMemo(() => {
    if (isDouyin) return DEFAULT_DOUYIN_REMARK_TEMPLATE;
    return DEFAULT_MEITUAN_REMARK_TEMPLATE;
  }, [isDouyin]);

  useEffect(() => {
    if (currentChannel) {
      setTemplateText(currentChannel.remarkTemplate || defaultTemplate);
      isTextareaFocusedRef.current = false;
    }
  }, [currentChannel, defaultTemplate]);

  // 获取当前渠道的协议 Schema (优先取渠道已保存的，否则按渠道类型匹配默认预设)
  const schema = useMemo(() => {
    if (currentChannel?.protocolSchema) {
      return currentChannel.protocolSchema;
    }
    if (isDouyin) {
      return DEFAULT_DOUYIN_PROTOCOL_SCHEMA;
    }
    return DEFAULT_MEITUAN_PROTOCOL_SCHEMA;
  }, [currentChannel, isDouyin]);

  // 将生产采集的真实报文按当前 Schema 清洗为标准化上下文 (Fail-Fast 保留错误上下文)
  const { cleanContext, normalizationError } = useMemo<{
    cleanContext: CleanOrderContext;
    normalizationError: string | null;
  }>(() => {
    if (!currentChannel) {
      return { cleanContext: {}, normalizationError: null };
    }

    try {
      if (isMeituan) {
        const ctx = normalizeOrderPayload(MEITUAN_RAW_SAMPLE_ORDER, schema);
        return { cleanContext: ctx, normalizationError: null };
      }
      if (isDouyin) {
        const ctx = normalizeOrderPayload(DOUYIN_RAW_SAMPLE_ORDER, schema);
        return { cleanContext: ctx, normalizationError: null };
      }

      // 针对尚未接入专属 Schema 的其他渠道，提供标准通用模拟上下文
      if (!currentChannel.protocolSchema) {
        return {
          cleanContext: {
            'OTA订单号': `${currentChannel.code}-20260914-8849`,
            '入住人': '张小泉',
            '联系电话': '139****5820',
            '房型名称': '豪华商务海景大床房',
            '间夜数': '2间夜',
            '房间数': '1间',
            '底价': '780.00',
            '实付金额': '860.00',
            '入住离店日期': '2026-09-16至2026-09-18',
            '渠道来源': currentChannel.name,
          },
          normalizationError: null,
        };
      }

      const ctx = normalizeOrderPayload(MEITUAN_RAW_SAMPLE_ORDER, schema);
      return { cleanContext: ctx, normalizationError: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { cleanContext: {}, normalizationError: msg };
    }
  }, [schema, isMeituan, isDouyin, currentChannel]);

  // 实时语法验证
  const validation = useMemo(() => {
    return validateTemplate(templateText);
  }, [templateText]);

  // 检测模板中未在当前 Schema 或上下文中定义的变量 (用于友好防错提示，不阻断保存)
  const unknownVariables = useMemo(() => {
    return detectUnknownVariables(templateText, schema.fields, cleanContext);
  }, [templateText, schema.fields, cleanContext]);

  // 实时高保真渲染预览 (带条件求值与真实数据)
  const renderedPreview = useMemo(() => {
    if (normalizationError) {
      return `⚠️ 协议解析契约报警：${normalizationError}\n请点击上方「管理协议字段」检查并更正字段取值路径。`;
    }
    if (!validation.valid) {
      return '⚠️ 模板语法存在错误，请根据上方提示修正后预览...';
    }
    try {
      return renderTemplate(templateText, cleanContext);
    } catch (err) {
      return `渲染失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [templateText, cleanContext, validation, normalizationError]);

  if (!selectedChannelId || !currentChannel) return null;

  const handleInsert = (textToInsert: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      const { newText } = insertAtCursor(templateText, textToInsert);
      setTemplateText(newText);
      return;
    }

    // 判断文本框是否有焦点或曾获得焦点
    const hasFocus = isTextareaFocusedRef.current || document.activeElement === textarea;
    const start = hasFocus ? textarea.selectionStart : undefined;
    const end = hasFocus ? textarea.selectionEnd : undefined;

    const { newText, nextCursorPos } = insertAtCursor(textarea.value, textToInsert, start, end);
    setTemplateText(newText);
    isTextareaFocusedRef.current = true;

    // 恢复文本框焦点并将光标精准移动到插入内容末尾
    const scheduleFocus = (cb: () => void) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(cb);
      } else {
        setTimeout(cb, 0);
      }
    };
    scheduleFocus(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursorPos, nextCursorPos);
      }
    });
  };

  const handleSave = () => {
    if (normalizationError) {
      dispatch(
        showToast({
          title: '协议配置异常，无法保存',
          description: normalizationError,
          type: 'error',
        })
      );
      return;
    }

    if (!validation.valid) {
      dispatch(
        showToast({
          title: '无法保存模板',
          description: validation.error || '模板语法校验未通过',
          type: 'error',
        })
      );
      return;
    }

    dispatch(
      updateRemarkTemplate({
        channelId: currentChannel.id,
        template: templateText,
      })
    );
    dispatch(
      showToast({
        title: `已更新「${currentChannel.name}」备注模板`,
        description: '后续来自该渠道的订单将自动经过条件表达式引擎计算并注入文旅系统',
        type: 'success',
      })
    );
    dispatch(setSelectedChannelForTemplate(null));
  };

  const handleClose = () => {
    dispatch(setSelectedChannelForTemplate(null));
  };

  const activeFieldsCount = schema.fields.filter((f) => f.enabled).length;

  const footerContent = (
    <div className="w-full flex items-center justify-between">
      <button
        type="button"
        onClick={() => setTemplateText(defaultTemplate)}
        className="text-xs text-[#737686] hover:text-[#004ac6] underline cursor-pointer"
      >
        恢复默认模板
      </button>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={handleClose}
          className="px-4 py-2 text-xs font-semibold text-[#434655] hover:bg-[#eff4ff] rounded-lg transition-colors cursor-pointer"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!validation.valid || Boolean(normalizationError)}
          className="px-5 py-2 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] rounded-lg shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-3.5 h-3.5" />
          <span>保存模板</span>
        </button>
      </div>
    </div>
  );

  const headerExtraContent = (
    <button
      type="button"
      onClick={() => setIsFieldManagerOpen(true)}
      className="h-8 px-3 rounded-lg bg-white hover:bg-[#eff4ff] text-[#004ac6] border border-[#dce9ff] text-xs font-medium transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0"
      title="配置字段白名单裁剪与原始路径映射"
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
      <span>管理协议字段 ({activeFieldsCount}/{schema.fields.length})</span>
    </button>
  );

  return (
    <>
      <Modal
        isOpen={Boolean(selectedChannelId && currentChannel)}
        onClose={handleClose}
        title={`配置订单备注模板 - ${currentChannel.name} (${currentChannel.code})`}
        icon={
          <div
            className={`w-6 h-6 rounded-md ${currentChannel.bgColor} ${currentChannel.textColor} flex items-center justify-center font-bold text-xs`}
          >
            {currentChannel.short}
          </div>
        }
        maxWidth="3xl"
        headerExtra={headerExtraContent}
        footer={footerContent}
      >
        <div className="space-y-4">

          {/* 协议漂移/契约报警提示 (Fail-Fast，绝不静默吞掉) */}
          {normalizationError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <TriangleAlert className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <span className="font-semibold">协议解析契约报警 (Fail-Fast)：</span>
                <span>{normalizationError}</span>
              </div>
            </div>
          )}

          {/* 极简模式分类参数变量选择器 */}
          <TemplateVariablePicker
            fields={schema.fields}
            onInsertTag={handleInsert}
          />

          {/* 模板文本编辑区 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-[#0b1c30] block">
                备注模板文本与条件表达式
              </label>
              <span className="text-[11px] text-[#737686]">
                支持 {'{变量名}'}、{'{{ 变量 | 过滤器 }}'} 及 {'{{#if 条件}}...{{/if}}'}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              rows={4}
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              onFocus={() => {
                isTextareaFocusedRef.current = true;
              }}
              className={`w-full p-3 rounded-xl border font-mono text-xs text-[#0b1c30] outline-none resize-y transition-all bg-white leading-relaxed ${
                validation.valid
                  ? 'border-[#dce9ff] focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/20'
                  : 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
              }`}
              placeholder="请输入模板文本，例如：【搬单】单号:{主单号} | 房型:{房型名称}..."
            />

            {/* 语法错误提示 (Fail-Fast) */}
            {!validation.valid && (
              <div className="mt-1.5 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <TriangleAlert className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <div>
                  <span className="font-semibold">模板语法错误：</span>
                  <span>{validation.error}</span>
                </div>
              </div>
            )}

            {/* 未定义变量防错提示 (友好辅助，不阻断保存) */}
            {validation.valid && unknownVariables.length > 0 && (
              <div className="mt-1.5 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <Lightbulb className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <span className="font-semibold">💡 提示：</span>
                  <span>
                    模板中包含可能未定义的变量「{unknownVariables.join('」、「')}」，请核对是否拼写有误。
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 实时效果渲染沙箱 (Live Sandbox) */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
            <div className="flex items-center justify-between mb-1.5 text-xs font-semibold text-emerald-900">
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                    实时效果预览
                </span>
              </div>
              {isMeituan && !normalizationError && (
                <span className="text-[11px] text-emerald-700 font-normal">
                  已自动匹配：底价 ¥{String(cleanContext['结算底价'] || cleanContext.floorPrice || '')} | 延迟退房 | 酒店开票
                </span>
              )}
              {isDouyin && !normalizationError && (
                <span className="text-[11px] text-emerald-700 font-normal">
                  已自动匹配：实付 ¥{String(cleanContext['实付金额'] || cleanContext.payAmount || '')} | 自助早餐 | 乐园门票
                </span>
              )}
            </div>
            <div className="p-3 bg-white rounded-lg border border-emerald-100 text-xs text-[#0b1c30] font-mono leading-relaxed whitespace-pre-wrap break-all shadow-2xs">
              {renderedPreview || '<空模板>'}
            </div>
          </div>
        </div>
      </Modal>

      {/* 协议字段裁剪与映射管理抽屉/弹窗 */}
      <ProtocolFieldManagerModal
        isOpen={isFieldManagerOpen}
        onClose={() => setIsFieldManagerOpen(false)}
        channelId={currentChannel.id}
        channelName={currentChannel.name}
        schema={schema}
      />
    </>
  );
};
