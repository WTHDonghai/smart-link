import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../../src/store';
import { SystemLogsView } from '../../../src/components/logs/SystemLogsView';
import { 
  addLogs, 
  setFilterModule, 
  setFilterSearch,
  setFilterDateRange,
  setFilterTaskStage,
  resetLogFilters,
} from '../../../src/store/slices/systemLogSlice';
import type { SystemLogEntry } from '../../../src/types';

describe('SystemLogsView 系统运行日志与任务调度视图', () => {
  it('正确渲染模块过滤筛选组与日志级别选项', () => {
    const store = createAppStore();
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(html).toContain('系统日志');
    expect(html).toContain('业务模块:');
    expect(html).toContain('全部');
    expect(html).toContain('任务调度');
    expect(html).toContain('订单值守');
    expect(html).toContain('门店采集');
    expect(html).toContain('系统内核');

    expect(html).toContain('日志级别:');
    expect(html).toContain('全部级别');
    expect(html).toContain('PLAYWRIGHT');
    expect(html).toContain('INFO');
    expect(html).toContain('WARN');
    expect(html).toContain('ERROR');
    expect(html).toContain('SUCCESS');
  });

  it('清晰呈现任务流转阶段 (claim / execute / result)、msgType 与执行结果 result', () => {
    const store = createAppStore();

    const mockLogs: SystemLogEntry[] = [
      {
        id: 'test-log-claim',
        timestamp: '14:20:01',
        createdAt: 1000,
        level: 'INFO',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_CLAIM',
        taskActionStage: 'claim',
        msgType: 'OTA_IMPORT_ORDER',
        taskId: 'task-9981',
        taskStatus: 'PROCESSING',
        message: '[任务认领 claim] 任务类型: OTA_IMPORT_ORDER (ID: task-9981)',
        details: '所属渠道: MEITUAN',
      },
      {
        id: 'test-log-exec',
        timestamp: '14:20:02',
        createdAt: 2000,
        level: 'PLAYWRIGHT',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_EXECUTE_START',
        taskActionStage: 'execute',
        msgType: 'OTA_IMPORT_ORDER',
        taskId: 'task-9981',
        taskStatus: 'PROCESSING',
        message: '[任务执行 execute] 正在执行 OTA_IMPORT_ORDER (ID: task-9981)',
      },
      {
        id: 'test-log-result',
        timestamp: '14:20:03',
        createdAt: 3000,
        level: 'SUCCESS',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_EXECUTE_SUCCESS',
        taskActionStage: 'result',
        msgType: 'OTA_IMPORT_ORDER',
        taskId: 'task-9981',
        taskStatus: 'SUCCEEDED',
        taskResult: { success: true, pmsOrderNo: 'PMS-8888' },
        message: '[任务结果 result] 任务 OTA_IMPORT_ORDER 执行成功 (ID: task-9981)',
      },
    ];

    store.dispatch(addLogs(mockLogs));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 1. 验证 claim 阶段标签
    expect(html).toContain('认领 claim');

    // 2. 验证 execute 阶段标签
    expect(html).toContain('执行 execute');

    // 3. 验证 result 阶段标签与成功徽标
    expect(html).toContain('结果 result');
    expect(html).toContain('成功');

    // 4. 验证任务类型 msgType 与 taskId
    expect(html).toContain('msgType: OTA_IMPORT_ORDER');
    expect(html).toContain('taskId: task-9981');

    // 5. 验证执行结果结构体输出
    expect(html).toContain('result:');
    expect(html).toContain('PMS-8888');
  });

  it('支持按业务模块过滤任务调度日志与门店日志', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-duty-1',
          timestamp: '14:30:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          message: '值守任务调度日志',
        },
        {
          id: 'log-hotel-1',
          timestamp: '14:30:01',
          createdAt: 2000,
          level: 'INFO',
          module: 'HOTEL',
          message: '酒店门店采集日志',
        },
      ])
    );

    // 默认全部模块展示两条
    const allHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(allHtml).toContain('值守任务调度日志');
    expect(allHtml).toContain('酒店门店采集日志');

    // 切换至 DUTY_TASK 模块
    store.dispatch(setFilterModule('DUTY_TASK'));
    const dutyHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(dutyHtml).toContain('值守任务调度日志');
    expect(dutyHtml).not.toContain('酒店门店采集日志');
  });

  it('默认收起接口参数与返回，需要时可通过按钮展开查看', () => {
    const store = createAppStore();

    const apiLog: SystemLogEntry = {
      id: 'api-log-01',
      timestamp: '15:10:00',
      createdAt: 5000,
      level: 'INFO',
      module: 'API',
      event: 'API_REQUEST_SUCCESS',
      message: '[接口调用] [POST] /toolkit/toolbox/task-claims (200) - 28ms',
      apiUrl: '/toolkit/toolbox/task-claims',
      apiMethod: 'POST',
      httpStatus: 200,
      durationMs: 28,
      apiParams: {
        stationId: 'station-shanghai-01',
        appId: 'smart-link',
        direction: 'FORWARD',
      },
      apiResponse: {
        id: 'task-7788',
        msgType: 'OTA_COLLECT_ORDER',
        leaseToken: 'lease-xyz-99',
      },
    };

    store.dispatch(addLogs([apiLog]));

    // 1. 默认渲染：参数与返回默认收起，保持终端高信息密度
    const defaultHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 验证核心摘要条呈现
    expect(defaultHtml).toContain('POST');
    expect(defaultHtml).toContain('/toolkit/toolbox/task-claims');
    expect(defaultHtml).toContain('HTTP 200');
    expect(defaultHtml).toContain('28ms');
    expect(defaultHtml).toContain('展开传参与返回');
    expect(defaultHtml).toContain('展开全部参数');

    // 验证默认不展示冗长入参/返回面板
    expect(defaultHtml).not.toContain('📤 请求入参 (Params / Body)');
    expect(defaultHtml).not.toContain('📥 接口返回 (Response Data)');

    // 2. 展开渲染：展示详细的请求入参面板与接口返回面板
    const expandedHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView defaultExpandApiPayloads={true} />
      </Provider>
    );

    expect(expandedHtml).toContain('收起传参与返回');
    expect(expandedHtml).toContain('收起全部参数');
    expect(expandedHtml).toContain('📤 请求入参 (Params / Body)');
    expect(expandedHtml).toContain('station-shanghai-01');
    expect(expandedHtml).toContain('FORWARD');
    expect(expandedHtml).toContain('复制入参');

    expect(expandedHtml).toContain('📥 接口返回 (Response Data)');
    expect(expandedHtml).toContain('task-7788');
    expect(expandedHtml).toContain('OTA_COLLECT_ORDER');
    expect(expandedHtml).toContain('lease-xyz-99');
    expect(expandedHtml).toContain('复制返回');
  });

  it('支持按「接口请求」模块过滤以及通过参数内容搜索日志', () => {
    const store = createAppStore();

    const logs: SystemLogEntry[] = [
      {
        id: 'log-normal',
        timestamp: '15:20:00',
        createdAt: 6000,
        level: 'INFO',
        module: 'ORDER',
        message: '普通订单状态更新',
      },
      {
        id: 'log-api',
        timestamp: '15:20:01',
        createdAt: 6001,
        level: 'INFO',
        module: 'API',
        event: 'API_REQUEST_SUCCESS',
        message: '[接口调用] [PUT] /toolkit/toolbox/tasks/task-999/result (200) - 15ms',
        apiUrl: '/toolkit/toolbox/tasks/task-999/result',
        apiMethod: 'PUT',
        httpStatus: 200,
        apiParams: {
          taskId: 'task-999',
          status: 'SUCCEEDED',
        },
        apiResponse: {
          success: true,
        },
      },
    ];

    store.dispatch(addLogs(logs));

    // 1. 验证切换至 API (接口请求) 模块
    store.dispatch(setFilterModule('API'));
    const apiFilterHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(apiFilterHtml).toContain('/toolkit/toolbox/tasks/task-999/result');
    expect(apiFilterHtml).toContain('task-999');
    expect(apiFilterHtml).not.toContain('普通订单状态更新');

    // 2. 重置模块并使用搜索栏搜索请求入参中的特定值
    store.dispatch(setFilterModule('ALL'));
    store.dispatch(setFilterSearch('task-999'));
    const searchHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(searchHtml).toContain('/toolkit/toolbox/tasks/task-999/result');
    expect(searchHtml).not.toContain('普通订单状态更新');
  });

  it('终端与内容容器采用全屏自适应撑满布局，彻底消除固定 600px 高度上限与宽度受限', () => {
    const store = createAppStore();
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 验证根容器为 flex-1 h-full min-h-0
    expect(html).toContain('flex-1 flex flex-col h-full overflow-hidden w-full');
    // 验证不存在 max-h-[600px] 导致的大片空白
    expect(html).not.toContain('max-h-[600px]');
    // 验证不存在限制宽度的 max-w-[1400px]
    expect(html).not.toContain('max-w-[1400px]');
  });

  it('正确渲染日期过滤、订单号过滤、Task 操作标签选项', () => {
    const store = createAppStore();
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 验证 Task 操作筛选标签组
    expect(html).toContain('Task 操作:');
    expect(html).toContain('认领 claim');
    expect(html).toContain('入单提交 order-import-submit');
    expect(html).toContain('结果 result');
    expect(html).toContain('执行 execute');
    expect(html).toContain('下游派发');

    // 验证合二为一的统一专业日志搜索框 (支持自由文本、单号与专业查询语句)
    expect(html).toContain('搜索日志关键词，或查询语句');

    // 验证日期过滤与快捷预设
    expect(html).toContain('日期:');
    expect(html).toContain('今天');
    expect(html).toContain('近3天');
    expect(html).toContain('近7天');
  });

  it('支持按日期区间 (filterStartDate & filterEndDate) 过滤视图中的日志', () => {
    const store = createAppStore();

    const d1 = new Date('2026-09-10T12:00:00.000Z').getTime();
    const d2 = new Date('2026-09-15T12:00:00.000Z').getTime();
    const d3 = new Date('2026-09-20T12:00:00.000Z').getTime();

    store.dispatch(
      addLogs([
        {
          id: 'log-date-1',
          timestamp: '2026-09-10 12:00:00',
          createdAt: d1,
          level: 'INFO',
          module: 'DUTY_TASK',
          message: '历史归档日志-20260910',
        },
        {
          id: 'log-date-2',
          timestamp: '2026-09-15 12:00:00',
          createdAt: d2,
          level: 'INFO',
          module: 'DUTY_TASK',
          message: '命中日期日志-20260915',
        },
        {
          id: 'log-date-3',
          timestamp: '2026-09-20 12:00:00',
          createdAt: d3,
          level: 'INFO',
          module: 'DUTY_TASK',
          message: '未来日志-20260920',
        },
      ])
    );

    // 默认展示全部日志
    const allHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(allHtml).toContain('历史归档日志-20260910');
    expect(allHtml).toContain('命中日期日志-20260915');
    expect(allHtml).toContain('未来日志-20260920');

    // 过滤 2026-09-14 至 2026-09-16 区间
    store.dispatch(setFilterDateRange({ startDate: '2026-09-14', endDate: '2026-09-16' }));
    const filteredHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(filteredHtml).toContain('命中日期日志-20260915');
    expect(filteredHtml).not.toContain('历史归档日志-20260910');
    expect(filteredHtml).not.toContain('未来日志-20260920');
  });

  it('支持通过统一搜索查询按订单号过滤并呈现订单号专属徽章', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-order-1',
          timestamp: '15:00:01',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          orderNo: 'MT-889900',
          message: '美团订单 889900 处理中',
        },
        {
          id: 'log-order-2',
          timestamp: '15:00:02',
          createdAt: 2000,
          level: 'INFO',
          module: 'DUTY_TASK',
          orderNo: 'DY-112233',
          message: '抖音订单 112233 处理中',
        },
      ])
    );

    // 通过统一搜索框过滤订单号 889900
    store.dispatch(setFilterSearch('order:MT-889900'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 命中 MT-889900 且呈现订单号徽章
    expect(html).toContain('美团订单 889900 处理中');
    expect(html).toContain('订单号: MT-889900');
    // 排除 DY-112233
    expect(html).not.toContain('抖音订单 112233 处理中');
  });

  it('支持按 Task 链路阶段 (filterTaskStage) 细粒度过滤: claim, order-import-submit, result 等', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-stage-claim',
          timestamp: '15:10:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'claim',
          message: '认领待处理任务-CLAIM-LOG',
        },
        {
          id: 'log-stage-import',
          timestamp: '15:10:01',
          createdAt: 2000,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'order-import-submit',
          message: '向中台提交入单-IMPORT-LOG',
        },
        {
          id: 'log-stage-result',
          timestamp: '15:10:02',
          createdAt: 3000,
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          taskActionStage: 'result',
          message: '上报执行结果-RESULT-LOG',
        },
      ])
    );

    // 1. 筛选 order-import-submit 阶段
    store.dispatch(setFilterTaskStage('order-import-submit'));
    const importHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(importHtml).toContain('向中台提交入单-IMPORT-LOG');
    expect(importHtml).toContain('入单提交 order-import-submit');
    expect(importHtml).not.toContain('认领待处理任务-CLAIM-LOG');
    expect(importHtml).not.toContain('上报执行结果-RESULT-LOG');

    // 2. 切换至 claim 阶段
    store.dispatch(setFilterTaskStage('claim'));
    const claimHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(claimHtml).toContain('认领待处理任务-CLAIM-LOG');
    expect(claimHtml).toContain('认领 claim');
    expect(claimHtml).not.toContain('向中台提交入单-IMPORT-LOG');
    expect(claimHtml).not.toContain('上报执行结果-RESULT-LOG');

    // 3. 切换至 result 阶段
    store.dispatch(setFilterTaskStage('result'));
    const resultHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(resultHtml).toContain('上报执行结果-RESULT-LOG');
    expect(resultHtml).toContain('结果 result');
    expect(resultHtml).not.toContain('向中台提交入单-IMPORT-LOG');
    expect(resultHtml).not.toContain('认领待处理任务-CLAIM-LOG');
  });

  it('激活任何筛选条件时展示「重置」按钮，重置后恢复全量日志展示', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-reset-test',
          timestamp: '15:20:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          message: '用于测试重置按钮的日志',
        },
      ])
    );

    // 初始状态没有筛选，不应有重置按钮
    const initialHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(initialHtml).not.toContain('重置所有筛选条件');

    // 激活订单号搜索条件
    store.dispatch(setFilterSearch('order:FILTER_TEST'));
    const filteredHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(filteredHtml).toContain('重置所有筛选条件');

    // 重置后
    store.dispatch(resetLogFilters());
    const resetHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(resetHtml).not.toContain('重置所有筛选条件');
    expect(resetHtml).toContain('用于测试重置按钮的日志');
  });

  it('能够智能识别并过滤仅包含 apiUrl 或 event 的接口请求与任务日志', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-claim-api',
          timestamp: '16:00:01',
          createdAt: 1000,
          level: 'INFO',
          module: 'API',
          apiUrl: '/toolkit/toolbox/task-claims',
          message: '[接口调用] [POST] /toolkit/toolbox/task-claims (200) - 28ms',
        },
        {
          id: 'log-import-api',
          timestamp: '16:00:02',
          createdAt: 2000,
          level: 'INFO',
          module: 'API',
          apiUrl: '/toolkit/orders/import',
          message: '[接口调用] [POST] /toolkit/orders/import (200) - 35ms',
        },
        {
          id: 'log-result-api',
          timestamp: '16:00:03',
          createdAt: 3000,
          level: 'INFO',
          module: 'API',
          apiUrl: '/toolkit/toolbox/tasks/task-99/result',
          message: '[接口调用] [PUT] /toolkit/toolbox/tasks/task-99/result (200) - 15ms',
        },
      ])
    );

    // 1. 过滤 claim 阶段：智能匹配到 /toolkit/toolbox/task-claims 接口调用
    store.dispatch(setFilterTaskStage('claim'));
    const claimHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(claimHtml).toContain('/toolkit/toolbox/task-claims');
    expect(claimHtml).not.toContain('/toolkit/orders/import');
    expect(claimHtml).not.toContain('/toolkit/toolbox/tasks/task-99/result');

    // 2. 过滤 order-import-submit 阶段：智能匹配到 /toolkit/orders/import 接口调用
    store.dispatch(setFilterTaskStage('order-import-submit'));
    const importHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(importHtml).toContain('/toolkit/orders/import');
    expect(importHtml).not.toContain('/toolkit/toolbox/task-claims');

    // 3. 过滤 result 阶段：智能匹配到 /result 接口调用
    store.dispatch(setFilterTaskStage('result'));
    const resultHtml = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(resultHtml).toContain('/toolkit/toolbox/tasks/task-99/result');
    expect(resultHtml).not.toContain('/toolkit/toolbox/task-claims');
  });

  it('任务阶段标签在日志条目中渲染为交互式可点击按钮', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-chip-test',
          timestamp: '16:10:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'claim',
          orderNo: 'MT-12345',
          message: '认领任务测试',
        },
      ])
    );

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 验证阶段标签为带 title 的 button
    expect(html).toContain('title="点击按「认领 claim」筛选日志"');
    expect(html).toContain('认领 claim');
    expect(html).toContain('title="点击仅看此订单号的全链路日志"');
    expect(html).toContain('订单号: MT-12345');
  });

  it('订单号搜索条件激活时渲染订单号徽章的激活态', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-active-order-chip',
          timestamp: '16:15:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'claim',
          orderNo: 'MT-12345',
          message: '订单号激活态测试',
        },
      ])
    );
    store.dispatch(setFilterSearch('order:MT-12345'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(html).toContain('订单号: MT-12345');
    expect(html).toContain('title="点击取消单号筛选"');
    expect(html).toContain('bg-amber-600');
  });

  it('行内 msgType 与 taskId 升级为交互式快捷筛选按钮', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-chip-meta-test',
          timestamp: '16:20:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'order-import-submit',
          msgType: 'OTA_IMPORT_ORDER',
          taskId: 'task-import-888',
          message: '入单提交测试',
        },
      ])
    );

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 验证 msgType 与 taskId 均渲染为交互式 button
    expect(html).toContain('title="点击按「OTA_IMPORT_ORDER」快捷搜索"');
    expect(html).toContain('msgType: OTA_IMPORT_ORDER');
    expect(html).toContain('title="点击按「task-import-888」快捷搜索"');
    expect(html).toContain('taskId: task-import-888');
  });

  it('当筛选无匹配日志时，空状态区域展示「清空所有筛选条件」快捷按钮', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-empty-test',
          timestamp: '16:30:00',
          createdAt: 1000,
          level: 'INFO',
          module: 'DUTY_TASK',
          message: '正常日志记录',
        },
      ])
    );

    // 施加未命中的筛选条件
    store.dispatch(setFilterSearch('NON_EXISTENT_KEYWORD_XYZ'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(html).toContain('暂无匹配的系统运行日志');
    expect(html).toContain('清空所有筛选条件');
  });

  it('搜索语句语法不完整时提示按字面文本匹配', () => {
    const store = createAppStore();
    store.dispatch(setFilterSearch('module:"AUTH'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    expect(html).toContain('查询语法不完整，已按字面文本匹配');
  });

  it('支持在统合搜索框中使用高级日志查询语句（如 order:xxx, stage:xxx, level:xxx）精准过滤', () => {
    const store = createAppStore();

    store.dispatch(
      addLogs([
        {
          id: 'log-query-1',
          timestamp: '16:40:01',
          createdAt: 1001,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'claim',
          orderNo: 'MT-111222',
          message: '认领任务成功',
        },
        {
          id: 'log-query-2',
          timestamp: '16:40:02',
          createdAt: 1002,
          level: 'ERROR',
          module: 'DUTY_TASK',
          taskActionStage: 'result',
          orderNo: 'MT-333444',
          message: '执行任务失败超时',
        },
        {
          id: 'log-query-3',
          timestamp: '16:40:03',
          createdAt: 1003,
          level: 'INFO',
          module: 'ORDER',
          orderNo: 'MT-555666',
          message: '订单同步完成',
        },
      ])
    );

    // 1. 通过 order: 查询单号
    store.dispatch(setFilterSearch('order:MT-111222'));
    let html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(html).toContain('认领任务成功');
    expect(html).not.toContain('执行任务失败超时');
    expect(html).not.toContain('订单同步完成');

    // 2. 通过 stage: 结合 level: 查询
    store.dispatch(setFilterSearch('stage:result level:error'));
    html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(html).toContain('执行任务失败超时');
    expect(html).not.toContain('认领任务成功');
    expect(html).not.toContain('订单同步完成');

    // 3. 自由组合 OR 查询
    store.dispatch(setFilterSearch('order:MT-111222 OR order:MT-333444'));
    html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );
    expect(html).toContain('认领任务成功');
    expect(html).toContain('执行任务失败超时');
    expect(html).not.toContain('订单同步完成');
  });
});
