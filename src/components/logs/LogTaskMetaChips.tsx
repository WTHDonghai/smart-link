import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store';
import { setFilterSearch, setFilterTaskStage } from '../../store/slices/systemLogSlice';
import { resolveTaskActionStage, TASK_STAGES } from '../../utils/taskStage';
import type { TaskStageItem } from '../../utils/taskStage';
import type { SystemLogEntry, TaskActionStage } from '../../types';

interface StageChipConfig {
  cancelName: string;
  activeClass: string;
  getInactiveClass: (log: SystemLogEntry) => string;
}

const SUCCESS_TONE =
  'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/40 hover:text-emerald-200';
const FAILURE_TONE =
  'bg-rose-500/25 text-rose-300 border border-rose-500/40 hover:bg-rose-500/40 hover:text-rose-200';

const STAGE_CHIP_CONFIG: Record<TaskActionStage, StageChipConfig> = {
  claim: {
    cancelName: '认领',
    activeClass: 'bg-purple-600 text-white border border-purple-400 shadow-2xs',
    getInactiveClass: () =>
      'bg-purple-500/25 text-purple-300 border border-purple-500/40 hover:bg-purple-500/40 hover:text-purple-200',
  },
  'order-import-submit': {
    cancelName: '入单提交',
    activeClass: 'bg-indigo-600 text-white border border-indigo-400 shadow-2xs',
    getInactiveClass: () =>
      'bg-indigo-500/25 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/40 hover:text-indigo-200',
  },
  execute: {
    cancelName: '执行',
    activeClass: 'bg-blue-600 text-white border border-blue-400 shadow-2xs',
    getInactiveClass: () =>
      'bg-blue-500/25 text-blue-300 border border-blue-500/40 hover:bg-blue-500/40 hover:text-blue-200',
  },
  result: {
    cancelName: '结果',
    activeClass: 'bg-emerald-600 text-white border border-emerald-400 shadow-2xs',
    getInactiveClass: (log) => (log.taskStatus === 'SUCCEEDED' ? SUCCESS_TONE : FAILURE_TONE),
  },
  'downstream-create': {
    cancelName: '下游派发',
    activeClass: 'bg-cyan-600 text-white border border-cyan-400 shadow-2xs',
    getInactiveClass: () =>
      'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/40 hover:text-cyan-200',
  },
  report: {
    cancelName: '上报',
    activeClass: 'bg-amber-600 text-white border border-amber-400 shadow-2xs',
    getInactiveClass: () =>
      'bg-amber-500/25 text-amber-300 border border-amber-500/40 hover:bg-amber-500/40 hover:text-amber-200',
  },
};

export interface LogTaskMetaChipsProps {
  log: SystemLogEntry;
}

export const LogTaskMetaChips: React.FC<LogTaskMetaChipsProps> = ({ log }) => {
  const dispatch = useAppDispatch();
  const filterTaskStage = useAppSelector((state) => state.systemLog.filterTaskStage);
  const filterSearch = useAppSelector((state) => state.systemLog.filterSearch);

  const normStage = resolveTaskActionStage(log);
  const currentOrderNo = log.orderNo;
  const currentMsgType = log.msgType;
  const currentTaskId = log.taskId;

  if (!normStage && !currentMsgType && !currentTaskId && !log.taskStatus && !currentOrderNo) {
    return null;
  }

  const orderQuery = currentOrderNo ? `order:${currentOrderNo}` : '';
  const isOrderActive = !!currentOrderNo && filterSearch.includes(orderQuery);
  const stageChipItems = TASK_STAGES.filter(
    (item): item is TaskStageItem & { key: TaskActionStage } =>
      item.key !== 'ALL' && item.key === normStage
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 my-1 font-mono text-[11px]">
      {stageChipItems.map((item) => {
        const chip = STAGE_CHIP_CONFIG[item.key];
        const isActive = filterTaskStage === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => dispatch(setFilterTaskStage(isActive ? 'ALL' : item.key))}
            className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold cursor-pointer transition-colors ${
              isActive ? chip.activeClass : chip.getInactiveClass(log)
            }`}
            title={
              isActive
                ? `点击取消「${chip.cancelName}」筛选`
                : `点击按「${item.label}」筛选日志`
            }
          >
            {item.label}
          </button>
        );
      })}

      {currentOrderNo && (
        <button
          type="button"
          onClick={() => {
            if (isOrderActive) {
              dispatch(setFilterSearch(filterSearch.replace(orderQuery, '').trim()));
            } else {
              dispatch(setFilterSearch(orderQuery));
            }
          }}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
            isOrderActive
              ? 'bg-amber-600 text-white border border-amber-400 font-bold shadow-2xs'
              : 'bg-amber-950/60 text-amber-300 border border-amber-600/40 hover:bg-amber-900/60 hover:text-amber-200'
          }`}
          title={isOrderActive ? '点击取消单号筛选' : '点击仅看此订单号的全链路日志'}
        >
          <span>订单号: {currentOrderNo}</span>
        </button>
      )}

      {currentMsgType && (
        <button
          type="button"
          onClick={() =>
            dispatch(setFilterSearch(filterSearch === currentMsgType ? '' : currentMsgType))
          }
          className={`inline-flex items-center px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
            filterSearch === currentMsgType
              ? 'bg-cyan-600 text-white border border-cyan-400 font-bold shadow-2xs'
              : 'bg-cyan-950/60 text-cyan-300 border border-cyan-600/40 hover:bg-cyan-900/60 hover:text-cyan-200'
          }`}
          title={
            filterSearch === currentMsgType
              ? '点击取消任务类型筛选'
              : `点击按「${currentMsgType}」快捷搜索`
          }
        >
          msgType: {currentMsgType}
        </button>
      )}

      {currentTaskId && (
        <button
          type="button"
          onClick={() =>
            dispatch(setFilterSearch(filterSearch === currentTaskId ? '' : currentTaskId))
          }
          className={`inline-flex items-center px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
            filterSearch === currentTaskId
              ? 'bg-slate-700 text-white border border-slate-400 font-bold shadow-2xs'
              : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
          }`}
          title={
            filterSearch === currentTaskId
              ? '点击取消任务 ID 筛选'
              : `点击按「${currentTaskId}」快捷搜索`
          }
        >
          taskId: {currentTaskId}
        </button>
      )}

      {log.taskStatus && (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold ${
            log.taskStatus === 'SUCCEEDED'
              ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-600/40'
              : log.taskStatus === 'FAILED'
              ? 'text-rose-400 bg-rose-950/50 border border-rose-600/40'
              : 'text-amber-400 bg-amber-950/50 border border-amber-600/40'
          }`}
        >
          {log.taskStatus === 'SUCCEEDED' ? (
            <>
              <CheckCircle2 className="w-3 h-3" />
              <span>成功</span>
            </>
          ) : log.taskStatus === 'FAILED' ? (
            <>
              <XCircle className="w-3 h-3" />
              <span>失败</span>
            </>
          ) : (
            <span>{log.taskStatus}</span>
          )}
        </span>
      )}
    </div>
  );
};
