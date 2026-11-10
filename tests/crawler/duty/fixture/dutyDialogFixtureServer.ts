import http from 'node:http';

/**
 * P4 弹窗处置验收基建:本地仿真订单页 fixture 服务器(设计 7.2/7.3/13.3)。
 *
 * 页面结构与 dutyPageObserver 的观察选择器完全对齐:
 * - 弹窗容器: [role="dialog"] / .mtd-modal(可见性依赖 getBoundingClientRect)
 * - 标题: h1-h4 / [role="heading"] / .mtd-modal-title
 * - 按钮: button / [role="button"]
 * - 全屏遮罩 overlay: 弹窗出现时拦截内容区点击,使页面步骤真实失败(点击超时)
 *
 * 场景(scenario 查询参数):
 * - clean      无弹窗(阴性对照)
 * - ad         300ms 后弹「系统公告」广告弹窗,点「我知道了」即消失(可正常处置)
 * - captcha    弹「安全验证」验证码弹窗,无可关闭按钮(越界红线用例,只允许通知)
 * - ad-retry   广告弹窗首次关闭后 500ms 再弹一次(验证「同一弹窗仅处置一次」)
 * - persistent 广告弹窗点「我知道了」不消失(验证关闭后校验失败路径)
 */

export type DutyDialogFixtureScenario = 'clean' | 'ad' | 'captcha' | 'ad-retry' | 'persistent';

export const DUTY_DIALOG_FIXTURE_SCENARIOS: readonly DutyDialogFixtureScenario[] = [
  'clean',
  'ad',
  'captcha',
  'ad-retry',
  'persistent',
];

export interface DutyDialogFixture {
  /** 构造指定场景的仿真订单页地址 */
  urlFor(scenario: DutyDialogFixtureScenario): string;
  /** 关闭服务器并释放端口 */
  close(): Promise<void>;
}

const OVERLAY_DIV = `<div id="overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:98;"></div>`;

function dialogDiv(title: string, body: string, buttonId: string, buttonText: string): string {
  return `
    ${OVERLAY_DIV}
    <div id="dialog" role="dialog" style="display:none; position:fixed; left:40%; top:30%; width:320px; height:170px; background:#fff; border:1px solid #ccc; z-index:99;">
      <h3>${title}</h3>
      <p>${body}</p>
      <button type="button" id="${buttonId}">${buttonText}</button>
    </div>`;
}

function buildOrderPageHtml(scenario: DutyDialogFixtureScenario): string {
  const dialogBehavior = (() => {
    switch (scenario) {
      case 'clean':
        return '';
      case 'captcha':
        return `
          ${dialogDiv('安全验证', '检测到异常操作，请拖动滑块完成验证', 'captcha-submit', '提交验证')}
          <script>
            setTimeout(() => {
              document.getElementById('overlay').style.display = 'block';
              document.getElementById('dialog').style.display = 'block';
            }, 300);
            // 验证码弹窗:提交按钮不关闭弹窗(滑块未完成),严禁被自动化绕过
            document.getElementById('captcha-submit').addEventListener('click', () => {});
          </script>`;
      case 'ad-retry':
        return `
          ${dialogDiv('系统公告', '今日凌晨系统升级，给您带来不便敬请谅解', 'dialog-dismiss', '我知道了')}
          <script>
            let closedCount = 0;
            const showDialog = () => {
              document.getElementById('overlay').style.display = 'block';
              document.getElementById('dialog').style.display = 'block';
            };
            const hideDialog = () => {
              document.getElementById('overlay').style.display = 'none';
              document.getElementById('dialog').style.display = 'none';
            };
            setTimeout(showDialog, 300);
            document.getElementById('dialog-dismiss').addEventListener('click', () => {
              closedCount += 1;
              hideDialog();
              if (closedCount === 1) {
                // 首次关闭后 500ms 再弹一次:验证「同一弹窗仅处置一次,不循环」
                setTimeout(showDialog, 500);
              }
            });
          </script>`;
      case 'persistent':
        return `
          ${dialogDiv('系统公告', '今日凌晨系统升级，给您带来不便敬请谅解', 'dialog-dismiss', '我知道了')}
          <script>
            setTimeout(() => {
              document.getElementById('overlay').style.display = 'block';
              document.getElementById('dialog').style.display = 'block';
            }, 300);
            // 点击关闭后弹窗不消失:验证关闭后的校验失败路径(不得重试/伪造成功)
            document.getElementById('dialog-dismiss').addEventListener('click', () => {});
          </script>`;
      case 'ad':
      default:
        return `
          ${dialogDiv('系统公告', '今日凌晨系统升级，给您带来不便敬请谅解', 'dialog-dismiss', '我知道了')}
          <script>
            setTimeout(() => {
              document.getElementById('overlay').style.display = 'block';
              document.getElementById('dialog').style.display = 'block';
            }, 300);
            document.getElementById('dialog-dismiss').addEventListener('click', () => {
              document.getElementById('dialog').remove();
              document.getElementById('overlay').remove();
            });
          </script>`;
    }
  })();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>仿真订单值守页</title></head>
<body>
  <main>
    <h2>待处理订单</h2>
    <ul>
      <li data-order="ORD-1001">订单 ORD-1001 豪华大床房 待接单</li>
      <li data-order="ORD-1002">订单 ORD-1002 双床房 待接单</li>
    </ul>
  </main>
  ${dialogBehavior}
</body>
</html>`;
}

export function startDutyDialogFixtureServer(): Promise<DutyDialogFixture> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/orders', 'http://127.0.0.1');
    const scenarioRaw = url.searchParams.get('scenario') || 'clean';
    const scenario = (DUTY_DIALOG_FIXTURE_SCENARIOS as readonly string[]).includes(scenarioRaw)
      ? (scenarioRaw as DutyDialogFixtureScenario)
      : 'clean';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildOrderPageHtml(scenario));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        urlFor: (scenario) => `http://127.0.0.1:${port}/orders?scenario=${scenario}`,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
