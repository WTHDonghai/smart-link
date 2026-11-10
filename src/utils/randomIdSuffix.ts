/**
 * 随机 ID 片段：以 Date.now/base36 组合生成业务标识（runId、snapshotId、incidentId 等）
 * 的公共随机后缀，禁止各处自行实现第二套同形生成逻辑。
 */

export function randomIdSuffix(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length);
}
