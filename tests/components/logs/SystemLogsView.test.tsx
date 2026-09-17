import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../../src/store';
import { SystemLogsView } from '../../../src/components/logs/SystemLogsView';
import { 
  addLogs, 
  setFilterModule, 
  setFilterSearch 
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

  it('清晰呈现任务流转阶段 (CLAIM / EXECUTE / RESULT)、msgType 与执行结果 result', () => {
    const store = createAppStore();

    const mockLogs: SystemLogEntry[] = [
      {
        id: 'test-log-claim',
        timestamp: '14:20:01',
        createdAt: 1000,
        level: 'INFO',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_CLAIM',
        taskActionStage: 'CLAIM',
        msgType: 'OTA_IMPORT_ORDER',
        taskId: 'task-9981',
        taskStatus: 'PROCESSING',
        message: '[任务认领 CLAIM] 任务类型: OTA_IMPORT_ORDER (ID: task-9981)',
        details: '所属渠道: MEITUAN',
      },
      {
        id: 'test-log-exec',
        timestamp: '14:20:02',
        createdAt: 2000,
        level: 'PLAYWRIGHT',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_EXECUTE_START',
        taskActionStage: 'EXECUTE',
        msgType: 'OTA_IMPORT_ORDER',
        taskId: 'task-9981',
        taskStatus: 'PROCESSING',
        message: '[任务执行 EXECUTE] 正在执行 OTA_IMPORT_ORDER (ID: task-9981)',
      },
      {
        id: 'test-log-result',
        timestamp: '14:20:03',
        createdAt: 3000,
        level: 'SUCCESS',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_EXECUTE_SUCCESS',
        taskActionStage: 'RESULT',
        msgType: 'OTA_IMPORT_ORDER',
        taskId: 'task-9981',
        taskStatus: 'SUCCEEDED',
        taskResult: { success: true, pmsOrderNo: 'PMS-8888' },
        message: '[任务结果 RESULT] 任务 OTA_IMPORT_ORDER 执行成功 (ID: task-9981)',
      },
    ];

    store.dispatch(addLogs(mockLogs));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <SystemLogsView />
      </Provider>
    );

    // 1. 验证 CLAIM 阶段标签
    expect(html).toContain('认领 CLAIM');

    // 2. 验证 EXECUTE 阶段标签
    expect(html).toContain('执行 EXECUTE');

    // 3. 验证 RESULT 阶段标签与成功徽标
    expect(html).toContain('结果 RESULT');
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
});
