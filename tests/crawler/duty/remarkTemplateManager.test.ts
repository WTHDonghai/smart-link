import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RemarkTemplateManager,
  remarkTemplateManager,
  REMARK_TEMPLATE_TTL_MS,
  getCachedChannelRemarkTemplate,
  updateRemarkTemplateCache,
  invalidateRemarkTemplateCache,
  clearRemarkTemplateCache,
} from '../../../src/crawler/duty/remarkTemplateManager';
import * as channelApi from '../../../src/services/channelApi';
import { SYSTEM_TIMING } from '../../../src/config/timing';

describe('remarkTemplateManager (渠道备注模板管理器)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    remarkTemplateManager.clearCache();
  });

  describe('基础拉取与 10 分钟 TTL 内存缓存机制', () => {
    it('首次拉取调用远端 API，并在有效期内直接命中内存缓存（零网络请求）', async () => {
      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockResolvedValue({
        id: 'tmpl-meituan',
        channelCode: 'MEITUAN',
        remarkTemplate: '美团真实模板: {{住客}} / {{联系电话}}',
      } as unknown as never);

      // 1. 首次获取：触发网络请求
      const template1 = await remarkTemplateManager.getTemplate('MEITUAN');
      expect(template1).toBe('美团真实模板: {{住客}} / {{联系电话}}');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith('MEITUAN');

      // 2. 第二次获取：直接命中缓存，不发起二次网络请求
      const template2 = await remarkTemplateManager.getTemplate('meituan'); // 大小写自愈归一化
      expect(template2).toBe('美团真实模板: {{住客}} / {{联系电话}}');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(remarkTemplateManager.hasCache('MEITUAN')).toBe(true);
    });

    it('当 channelCode 为空或纯空格时，直接返回 null 且不触发网络请求', async () => {
      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate');

      const res1 = await remarkTemplateManager.getTemplate('');
      const res2 = await remarkTemplateManager.getTemplate('   ');

      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('当远端返回 null 或无 remarkTemplate 字段时，如实缓存 null', async () => {
      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockResolvedValue({
        id: 'tmpl-empty',
        channelCode: 'DOUYIN',
        remarkTemplate: null,
      } as unknown as never);

      const res1 = await remarkTemplateManager.getTemplate('DOUYIN');
      expect(res1).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 再次读取命中已缓存的 null
      const res2 = await remarkTemplateManager.getTemplate('DOUYIN');
      expect(res2).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('当远端接口异常时抛出错误，且不污染缓存', async () => {
      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate')
        .mockRejectedValueOnce(new Error('Gateway Timeout 504'))
        .mockResolvedValueOnce({
          id: 'tmpl-ok',
          channelCode: 'CTRIP',
          remarkTemplate: '携程模板',
        } as unknown as never);

      await expect(remarkTemplateManager.getTemplate('CTRIP')).rejects.toThrow('Gateway Timeout 504');
      expect(remarkTemplateManager.hasCache('CTRIP')).toBe(false);

      // 重试时成功拉取
      const retryRes = await remarkTemplateManager.getTemplate('CTRIP');
      expect(retryRes).toBe('携程模板');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('主动写入、精准失效与清空缓存', () => {
    it('updateCache 可主动写入或更新模板，后续读取直接命中且支持 null 覆盖', async () => {
      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate');

      // 1. 主动写入最新模板
      remarkTemplateManager.updateCache('MEITUAN', '主动推送的美团最新模板');
      expect(remarkTemplateManager.hasCache('MEITUAN')).toBe(true);

      const res = await remarkTemplateManager.getTemplate('MEITUAN');
      expect(res).toBe('主动推送的美团最新模板');
      expect(fetchSpy).not.toHaveBeenCalled();

      // 2. 主动置空模板 (null)
      remarkTemplateManager.updateCache('MEITUAN', null);
      const resNull = await remarkTemplateManager.getTemplate('MEITUAN');
      expect(resNull).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('updateCache 传入空渠道代码时安全忽略', () => {
      expect(() => remarkTemplateManager.updateCache('', '模板')).not.toThrow();
      expect(remarkTemplateManager.hasCache('')).toBe(false);
    });

    it('invalidateCache 可针对特定渠道执行精准失效，不影响其他渠道缓存', async () => {
      remarkTemplateManager.updateCache('MEITUAN', '美团模板');
      remarkTemplateManager.updateCache('CTRIP', '携程模板');

      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockResolvedValue({
        id: 'tmpl-new',
        channelCode: 'MEITUAN',
        remarkTemplate: '重新拉取的美团模板',
      } as unknown as never);

      // 精准失效美团
      remarkTemplateManager.invalidateCache('MEITUAN');
      expect(remarkTemplateManager.hasCache('MEITUAN')).toBe(false);
      expect(remarkTemplateManager.hasCache('CTRIP')).toBe(true);

      // 携程直接命中缓存
      const ctrip = await remarkTemplateManager.getTemplate('CTRIP');
      expect(ctrip).toBe('携程模板');
      expect(fetchSpy).not.toHaveBeenCalled();

      // 美团重新发起请求
      const meituan = await remarkTemplateManager.getTemplate('MEITUAN');
      expect(meituan).toBe('重新拉取的美团模板');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('clearCache 清空所有渠道缓存', async () => {
      remarkTemplateManager.updateCache('MEITUAN', '美团模板');
      remarkTemplateManager.updateCache('CTRIP', '携程模板');

      remarkTemplateManager.clearCache();
      expect(remarkTemplateManager.hasCache('MEITUAN')).toBe(false);
      expect(remarkTemplateManager.hasCache('CTRIP')).toBe(false);
    });
  });

  describe('高并发 Singleflight 并发请求合并去重', () => {
    it('同一时刻发起多个相同渠道请求时，仅发起一次底层网络 I/O 并广播结果', async () => {
      let resolveRemote!: (value: { otaChannelCode: string; remarkTemplate: string }) => void;
      const deferredPromise = new Promise<{ otaChannelCode: string; remarkTemplate: string }>((resolve) => {
        resolveRemote = resolve;
      });

      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate')
        .mockReturnValue(deferredPromise as unknown as never);

      // 并发发起 3 个请求
      const p1 = remarkTemplateManager.getTemplate('FLIGGY');
      const p2 = remarkTemplateManager.getTemplate('FLIGGY');
      const p3 = remarkTemplateManager.getTemplate('FLIGGY');

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      resolveRemote({ otaChannelCode: 'FLIGGY', remarkTemplate: '飞猪并发模板' });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toBe('飞猪并发模板');
      expect(r2).toBe('飞猪并发模板');
      expect(r3).toBe('飞猪并发模板');
    });
  });

  describe('函数式快捷入口向后兼容性验证', () => {
    it('导出的快捷函数与单例管理器状态严格联动', async () => {
      expect(REMARK_TEMPLATE_TTL_MS).toBe(10 * 60 * 1000);
      expect(REMARK_TEMPLATE_TTL_MS).toBe(SYSTEM_TIMING.TEMPLATE_CACHE_TTL);

      // updateRemarkTemplateCache -> getCachedChannelRemarkTemplate
      updateRemarkTemplateCache('DOUYIN', '抖音快捷模板');
      expect(await getCachedChannelRemarkTemplate('DOUYIN')).toBe('抖音快捷模板');

      // invalidateRemarkTemplateCache
      invalidateRemarkTemplateCache('DOUYIN');
      expect(remarkTemplateManager.hasCache('DOUYIN')).toBe(false);

      // clearRemarkTemplateCache
      updateRemarkTemplateCache('DOUYIN', '重新设置');
      clearRemarkTemplateCache();
      expect(remarkTemplateManager.hasCache('DOUYIN')).toBe(false);
    });
  });

  describe('自定义 TTL 与实例隔离', () => {
    it('支持实例化独立的 RemarkTemplateManager 并定制 TTL', async () => {
      const customManager = new RemarkTemplateManager(1000);
      const fetchSpy = vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockResolvedValue({
        id: 'tmpl-1',
        channelCode: 'CUSTOM',
        remarkTemplate: '自定义模板',
      } as unknown as never);

      const res = await customManager.getTemplate('CUSTOM');
      expect(res).toBe('自定义模板');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
