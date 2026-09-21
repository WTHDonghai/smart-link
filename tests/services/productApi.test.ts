import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchProductMappings,
  fetchRoomTypes,
  fetchRatePlans,
  fetchReservationTypes,
  saveProductMappingsBatch,
  deleteProductMapping,
  normalizeRemoteProductMapping,
  PRODUCT_ENDPOINTS,
} from '../../src/services/productApi';
import * as platformApiModule from '../../src/services/platformApi';

describe('productApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeRemoteProductMapping', () => {
    it('normalizes raw remote mapping into standard ProductMapping', () => {
      const raw = {
        id: 'pm-101',
        channelCode: 'MT01',
        extUnitCode: 'POI-888',
        unitId: '1001',
        unitType: 'Property',
        otaRoomTypeId: 'ROOM-1',
        otaRoomTypeName: '豪华大床房',
        otaBasicRoomId: 'BASIC-1',
        otaBasicRoomName: '大床房',
        otaRateCodeId: 'RP-1',
        otaPayType: 'PP',
        roomType: 'EXK',
        rateCode: 'RACK',
        payType: 'R01',
        status: 'A',
      };

      const result = normalizeRemoteProductMapping(raw);

      expect(result.id).toBe('pm-101');
      expect(result.channelCode).toBe('MT01');
      expect(result.extUnitCode).toBe('POI-888');
      expect(result.unitId).toBe('1001');
      expect(result.otaRoomTypeId).toBe('ROOM-1');
      expect(result.otaRoomTypeName).toBe('豪华大床房');
      expect(result.otaBasicRoomId).toBe('BASIC-1');
      expect(result.otaBasicRoomName).toBe('大床房');
      expect(result.roomType).toBe('EXK');
      expect(result.rateCode).toBe('RACK');
      expect(result.payType).toBe('R01');
      expect(result.status).toBe('completed');
      expect(result.source).toBe('remote-platform');
    });

    it('handles empty internal room and rate code as pending status', () => {
      const raw = {
        otaRoomTypeId: 'ROOM-2',
        otaRoomTypeName: '标准双床房',
      };

      const result = normalizeRemoteProductMapping(raw, {
        channelCode: 'MT01',
        extUnitCode: 'POI-888',
        unitId: '1001',
      });

      expect(result.channelCode).toBe('MT01');
      expect(result.roomType).toBe('');
      expect(result.rateCode).toBe('');
      expect(result.payType).toBe('');
      expect(result.status).toBe('pending');
    });
  });

  describe('fetchProductMappings', () => {
    it('fails fast when channelCode is missing', async () => {
      await expect(
        fetchProductMappings({ channelCode: '', unitId: '1001' })
      ).rejects.toThrow('查询产品映射必须提供有效渠道编码 channelCode');
    });

    it('requests channel-product endpoint with query parameters and returns normalized mappings', async () => {
      const mockRawResponse = {
        code: 0,
        data: [
          {
            id: '1',
            channelCode: 'MT01',
            extUnitCode: 'HOTEL-1',
            unitId: '1001',
            otaRoomTypeId: 'G-1',
            otaRoomTypeName: '单人房',
            roomType: 'STD',
          },
        ],
      };

      const requestSpy = vi
        .spyOn(platformApiModule, 'requestPlatformApi')
        .mockResolvedValue(mockRawResponse);

      const mappings = await fetchProductMappings({
        channelCode: 'MT01',
        unitId: '1001',
        extUnitCode: 'HOTEL-1',
      });

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [calledPath, calledOptions] = requestSpy.mock.calls[0];
      expect(calledPath).toContain(PRODUCT_ENDPOINTS.CHANNEL_PRODUCT);
      expect(calledPath).toContain('channelCode=MT01');
      expect(calledPath).toContain('unitId=1001');
      expect(calledPath).toContain('extUnitCode=HOTEL-1');
      expect(calledOptions?.method).toBe('GET');

      expect(mappings).toHaveLength(1);
      expect(mappings[0].otaRoomTypeId).toBe('G-1');
      expect(mappings[0].roomType).toBe('STD');
    });
  });

  describe('fetchRoomTypes', () => {
    it('fails fast when unitId is missing', async () => {
      await expect(fetchRoomTypes({ unitId: '' })).rejects.toThrow(
        '加载内部房型字典必须提供酒店 unitId'
      );
    });

    it('fetches room types via query params and App-Property-Id header and returns unique room type options', async () => {
      const mockRawResponse = {
        code: 0,
        data: [
          { id: '1', roomType: 'EXK', roomTypeName: '行政大床房' },
          { id: '2', roomType: 'DBL', roomTypeName: '经典大床房' },
          { id: '3', roomType: 'EXK', roomTypeName: '重复行政大床房' }, // 重复项应去重
        ],
      };

      const requestSpy = vi
        .spyOn(platformApiModule, 'requestPlatformApi')
        .mockResolvedValue(mockRawResponse);

      const options = await fetchRoomTypes({ unitId: '9988', unitType: 'Property' });

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [calledPath, calledOptions] = requestSpy.mock.calls[0];
      expect(calledPath).toContain(PRODUCT_ENDPOINTS.ROOM_TYPES);
      expect(calledPath).toContain('unitId=9988');
      expect(calledPath).toContain('unitType=Property');
      expect(calledOptions?.method).toBe('GET');
      expect(calledOptions?.headers).toEqual({ 'App-Property-Id': '9988' });

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({
        id: '1',
        code: 'EXK',
        name: '行政大床房',
        displayLabel: '行政大床房（EXK）',
      });
      expect(options[1].code).toBe('DBL');
    });

    it('extracts room types from nested { data: { roomTypes: [...] } } and filters inactive items', async () => {
      const mockRawResponse = {
        code: 0,
        data: {
          roomTypes: [
            { id: '1', roomType: 'SUP', roomTypeName: '高级双床房', status: 'A' },
            { id: '2', roomType: 'DIS', roomTypeName: '停用房型', status: 'I' },
          ],
        },
      };

      vi.spyOn(platformApiModule, 'requestPlatformApi').mockResolvedValue(mockRawResponse);

      const options = await fetchRoomTypes({ unitId: '8888' });
      expect(options).toHaveLength(1);
      expect(options[0].code).toBe('SUP');
    });

    it('propagates error when requestPlatformApi fails', async () => {
      vi.spyOn(platformApiModule, 'requestPlatformApi').mockRejectedValue(
        new Error('Network failure')
      );
      await expect(fetchRoomTypes({ unitId: '8888' })).rejects.toThrow('Network failure');
    });
  });

  describe('fetchRatePlans', () => {
    it('fetches rate plans via query params and App-Property-Id header and returns normalized rate code options', async () => {
      const mockRawResponse = {
        code: 0,
        data: [
          { id: '10', rateCode: 'RACK', rateName: '门市价' },
          { id: '11', rateCode: 'BAR', rateName: '最优价' },
        ],
      };

      const requestSpy = vi
        .spyOn(platformApiModule, 'requestPlatformApi')
        .mockResolvedValue(mockRawResponse);

      const options = await fetchRatePlans({ unitId: '5566' });

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [calledPath, calledOptions] = requestSpy.mock.calls[0];
      expect(calledPath).toContain(PRODUCT_ENDPOINTS.RATE_PLANS);
      expect(calledPath).toContain('unitId=5566');
      expect(calledOptions?.method).toBe('GET');
      expect(calledOptions?.headers).toEqual({ 'App-Property-Id': '5566' });

      expect(options).toHaveLength(2);
      expect(options[0].rateCode).toBe('RACK');
      expect(options[0].displayLabel).toBe('门市价（RACK）');
    });

    it('extracts rate plans from nested { data: { ratePlans: [...] } } structure', async () => {
      const mockRawResponse = {
        code: 0,
        data: {
          ratePlans: [
            { id: '20', ratePlanCode: 'CORP', ratePlanName: '协议价' },
            { id: '21', ratePlanCode: 'EXP', ratePlanName: '过期价', state: 'DISABLED' },
          ],
        },
      };

      vi.spyOn(platformApiModule, 'requestPlatformApi').mockResolvedValue(mockRawResponse);

      const options = await fetchRatePlans({ unitId: '5566' });
      expect(options).toHaveLength(1);
      expect(options[0].rateCode).toBe('CORP');
    });

    it('propagates error when requestPlatformApi fails', async () => {
      vi.spyOn(platformApiModule, 'requestPlatformApi').mockRejectedValue(
        new Error('Rate plans unavailable')
      );
      await expect(fetchRatePlans({ unitId: '5566' })).rejects.toThrow('Rate plans unavailable');
    });
  });

  describe('fetchReservationTypes', () => {
    it('requests configuration entity RES_TYPES via query params and App-Property-Id header', async () => {
      const mockRawResponse = {
        code: 0,
        data: [
          { id: '1', code: 'R01', name: '散客预订' },
          { id: '2', code: 'CORP', name: '协议预订' },
        ],
      };

      const requestSpy = vi
        .spyOn(platformApiModule, 'requestPlatformApi')
        .mockResolvedValue(mockRawResponse);

      const options = await fetchReservationTypes({ unitId: '7788' });

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [calledPath, calledOptions] = requestSpy.mock.calls[0];
      expect(calledPath).toContain(PRODUCT_ENDPOINTS.RESERVATION_TYPES);
      expect(calledPath).toContain('showAll=false');
      expect(calledPath).toContain('unitId=7788');
      expect(calledOptions?.method).toBe('GET');
      expect(calledOptions?.headers).toEqual({ 'App-Property-Id': '7788' });

      expect(options).toHaveLength(2);
      expect(options[0].code).toBe('R01');
      expect(options[0].displayLabel).toBe('散客预订（R01）');
    });

    it('extracts reservation types from { data: { entities: [...] } }', async () => {
      const mockRawResponse = {
        code: 0,
        data: {
          entities: [
            { code: 'PRE', entityName: '预付类型' },
          ],
        },
      };

      vi.spyOn(platformApiModule, 'requestPlatformApi').mockResolvedValue(mockRawResponse);

      const options = await fetchReservationTypes({ unitId: '7788' });
      expect(options).toHaveLength(1);
      expect(options[0].code).toBe('PRE');
      expect(options[0].label).toBe('预付类型');
      expect(options[0].displayLabel).toBe('预付类型（PRE）');
    });

    it('propagates error when requestPlatformApi fails', async () => {
      vi.spyOn(platformApiModule, 'requestPlatformApi').mockRejectedValue(
        new Error('Entities fetch timeout')
      );
      await expect(fetchReservationTypes({ unitId: '7788' })).rejects.toThrow(
        'Entities fetch timeout'
      );
    });
  });

  describe('saveProductMappingsBatch', () => {
    it('allows empty roomType, rateCode and payType and sends empty strings in payload', async () => {
      const requestSpy = vi
        .spyOn(platformApiModule, 'requestPlatformApi')
        .mockResolvedValue({ code: 0, msg: 'ok' });

      const result = await saveProductMappingsBatch([
        {
          channelCode: 'MT01',
          extUnitCode: 'POI-1',
          unitId: '1001',
          unitType: 'Property',
          otaRoomTypeId: 'GOODS-99',
          otaRoomTypeName: '阳光大床房',
          otaPayType: 'PP',
          roomType: '', // 未填写内部房型
          rateCode: '', // 未填写内部房价
          payType: '',  // 未填写内部预订类型
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [calledPath, calledOptions] = requestSpy.mock.calls[0];
      expect(calledPath).toBe(PRODUCT_ENDPOINTS.CHANNEL_PRODUCT_BATCH);
      expect(calledOptions?.method).toBe('POST');

      const sentBody = JSON.parse(String(calledOptions?.body));
      expect(sentBody).toHaveLength(1);
      expect(sentBody[0]).toMatchObject({
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '1001',
        unitType: 'Property',
        otaRoomTypeId: 'GOODS-99',
        otaRoomTypeName: '阳光大床房',
        otaPayType: 'PP',
        roomType: '',
        rateCode: '',
        payType: '',
      });
    });

    it('fails fast when required OTA product identity is missing', async () => {
      await expect(
        saveProductMappingsBatch([
          {
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: '', // 缺少商品ID
            otaRoomTypeName: '测试商品',
            otaPayType: 'PP',
            roomType: '',
            rateCode: '',
            payType: '',
          },
        ])
      ).rejects.toThrow('产品映射缺少 OTA 产品编码 otaRoomTypeId');
    });
  });

  describe('deleteProductMapping', () => {
    it('fails fast when mappingId is empty', async () => {
      await expect(deleteProductMapping('')).rejects.toThrow('缺少要删除的产品映射记录 ID');
    });

    it('issues DELETE request to channel-product/:id', async () => {
      const requestSpy = vi
        .spyOn(platformApiModule, 'requestPlatformApi')
        .mockResolvedValue({ code: 0 });

      const result = await deleteProductMapping('pm-555');

      expect(result.success).toBe(true);
      expect(requestSpy).toHaveBeenCalledWith(
        `${PRODUCT_ENDPOINTS.CHANNEL_PRODUCT}/pm-555`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
