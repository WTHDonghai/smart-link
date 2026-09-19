import type { HostBridgeApi } from '../types';

export type ApplicationLaunchResult = 'blocked' | 'started';

export async function mountApplication(
  root: HTMLElement,
  host?: HostBridgeApi
): Promise<ApplicationLaunchResult> {
  if (!host) {
    root.innerHTML = `
      <div style="
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f8f9ff;
        color: #0b1c30;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <main style="max-width: 480px; padding: 32px; text-align: center;">
          <h1 style="font-size: 20px; margin: 0 0 12px;">请使用 Smart-Link 桌面端</h1>
          <p style="font-size: 14px; line-height: 1.6; color: #737686; margin: 0;">
            本控制台仅支持桌面端运行，请启动本地桌面应用。
          </p>
        </main>
      </div>
    `;
    return 'blocked';
  }

  const { startApp } = await import('./AppBootstrap');
  startApp(root);
  return 'started';
}
