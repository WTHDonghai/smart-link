import { describe, expect, it } from 'vitest';
import { isRecord } from '@/src/utils/typeGuards';

describe('isRecord (字典形态类型守卫)', () => {
  it('普通对象应判定为 Record（含空对象与 new Object）', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ orderId: '5035036081700000001' })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it('null、undefined 与原始类型应判定为非 Record', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('{"orderId":1}')).toBe(false);
    expect(isRecord(5035036081700000001)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(Symbol('x'))).toBe(false);
  });

  it('数组与函数应判定为非 Record（与字典严格区分）', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ orderId: '1' }])).toBe(false);
    expect(isRecord(() => {})).toBe(false);
  });
});
