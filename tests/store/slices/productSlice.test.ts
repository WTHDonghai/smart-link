import { describe, it, expect } from 'vitest';
import productReducer, {
  setProductFilterChannel,
  setProductFilterHotel,
  setProductSearch,
  updateProductMapping,
  deleteProduct,
  batchDeleteProducts,
} from '../../../src/store/slices/productSlice';

describe('productSlice', () => {
  it('initializes with default filters and 5 predefined products', () => {
    const state = productReducer(undefined, { type: '@@INIT' });

    expect(state.filterChannel).toBe('meituan');
    expect(state.filterHotel).toBe('禅驿度假酒店（自贡方特恐龙王国店）');
    expect(state.searchKeyword).toBe('');
    expect(state.products.length).toBe(5);

    const firstProduct = state.products[0];
    expect(firstProduct.id).toBe('prod-01');
    expect(firstProduct.hotelId).toBe('MT-ZG-52019');
    expect(firstProduct.otaChannelId).toBe('meituan');
    expect(firstProduct.otaProductCode).toBe('802445488');
    expect(firstProduct.internalRoomType).toBe('行政大床房（EXK）');
    expect(firstProduct.rateCode).toBe('RACK155（RACK）');
    expect(firstProduct.bookingType).toBe('R01');
    expect(firstProduct.status).toBe('completed');
    expect(firstProduct.priceRule).toBe('markup_fixed');
    expect(firstProduct.markupValue).toBe(20);
    expect(firstProduct.autoSyncInventory).toBe(true);
  });

  describe('filter and search actions', () => {
    it('updates filterChannel with setProductFilterChannel', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, setProductFilterChannel('douyin'));

      expect(nextState.filterChannel).toBe('douyin');
      expect(nextState.filterHotel).toBe(initialState.filterHotel);
    });

    it('updates filterHotel with setProductFilterHotel', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, setProductFilterHotel('三亚亚特兰蒂斯度假酒店'));

      expect(nextState.filterHotel).toBe('三亚亚特兰蒂斯度假酒店');
      expect(nextState.filterChannel).toBe(initialState.filterChannel);
    });

    it('updates searchKeyword with setProductSearch', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, setProductSearch('家庭房'));

      expect(nextState.searchKeyword).toBe('家庭房');
    });
  });

  describe('updateProductMapping', () => {
    it('updates specified product room type, rate code, status and other fields', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(
        initialState,
        updateProductMapping({
          id: 'prod-01',
          internalRoomType: '高级大床房（SUP）',
          rateCode: 'PROMO100（PRM）',
          bookingType: 'R02',
          status: 'active',
          priceRule: 'markup_percent',
          markupValue: 15,
        })
      );

      const updated = nextState.products.find((p) => p.id === 'prod-01');
      expect(updated).toBeDefined();
      expect(updated?.internalRoomType).toBe('高级大床房（SUP）');
      expect(updated?.rateCode).toBe('PROMO100（PRM）');
      expect(updated?.bookingType).toBe('R02');
      expect(updated?.status).toBe('active');
      expect(updated?.priceRule).toBe('markup_percent');
      expect(updated?.markupValue).toBe(15);
      // Ensure unchanged fields remain intact
      expect(updated?.otaProductCode).toBe('802445488');
      expect(updated?.autoSyncInventory).toBe(true);

      // Other products remain unchanged
      const untouched = nextState.products.find((p) => p.id === 'prod-02');
      expect(untouched?.internalRoomType).toBe('行政大床房（EXK）');
    });

    it('ignores update when product ID is not found', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(
        initialState,
        updateProductMapping({
          id: 'non-existent-product',
          internalRoomType: '豪华套房',
        })
      );

      expect(nextState.products).toEqual(initialState.products);
    });
  });

  describe('deleteProduct', () => {
    it('removes single product by id from products list', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      expect(initialState.products.length).toBe(5);

      const nextState = productReducer(initialState, deleteProduct('prod-03'));

      expect(nextState.products.length).toBe(4);
      expect(nextState.products.find((p) => p.id === 'prod-03')).toBeUndefined();
      expect(nextState.products.map((p) => p.id)).toEqual(['prod-01', 'prod-02', 'prod-04', 'prod-05']);
    });

    it('handles deletion of non-existent product gracefully without modifying array', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, deleteProduct('prod-999'));

      expect(nextState.products.length).toBe(5);
      expect(nextState.products).toEqual(initialState.products);
    });
  });

  describe('batchDeleteProducts', () => {
    it('removes multiple products matching provided ids', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      expect(initialState.products.length).toBe(5);

      const nextState = productReducer(initialState, batchDeleteProducts(['prod-01', 'prod-04']));

      expect(nextState.products.length).toBe(3);
      expect(nextState.products.find((p) => p.id === 'prod-01')).toBeUndefined();
      expect(nextState.products.find((p) => p.id === 'prod-04')).toBeUndefined();
      expect(nextState.products.map((p) => p.id)).toEqual(['prod-02', 'prod-03', 'prod-05']);
    });

    it('handles empty id array without removing any products', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, batchDeleteProducts([]));

      expect(nextState.products.length).toBe(5);
      expect(nextState.products).toEqual(initialState.products);
    });

    it('handles batch deletion with mix of existing and non-existing ids', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, batchDeleteProducts(['prod-02', 'prod-non-existent']));

      expect(nextState.products.length).toBe(4);
      expect(nextState.products.find((p) => p.id === 'prod-02')).toBeUndefined();
      expect(nextState.products.map((p) => p.id)).toEqual(['prod-01', 'prod-03', 'prod-04', 'prod-05']);
    });
  });
});
