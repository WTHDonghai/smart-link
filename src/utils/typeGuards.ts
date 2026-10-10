/**
 * 类型守卫：判断值是否为非数组的普通对象（字典形态的 JSON 记录）。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
