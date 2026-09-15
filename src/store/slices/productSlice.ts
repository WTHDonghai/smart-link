import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ProductMapping } from '../../types';

interface ProductState {
  products: ProductMapping[];
  filterChannel: string;
  filterHotel: string;
  searchKeyword: string;
}

const initialState: ProductState = {
  filterChannel: 'meituan',
  filterHotel: '禅驿度假酒店（自贡方特恐龙王国店）',
  searchKeyword: '',
  products: [
    {
      id: 'prod-01',
      hotelId: 'MT-ZG-52019',
      hotelName: '禅驿度假酒店（自贡方特恐龙王国店）',
      otaChannelId: 'meituan',
      otaProductName: '松香家庭房-含双早-入住当天14:00前免费取消-商旅用户专享价',
      otaProductCode: '802445488',
      otaPhysicalRoomName: '松香家庭房',
      otaPhysicalRoomCode: '32877350',
      internalRoomType: '行政大床房（EXK）',
      rateCode: 'RACK155（RACK）',
      bookingType: 'R01',
      status: 'completed',
      priceRule: 'markup_fixed',
      markupValue: 20,
      autoSyncInventory: true
    },
    {
      id: 'prod-02',
      hotelId: 'MT-ZG-52019',
      hotelName: '禅驿度假酒店（自贡方特恐龙王国店）',
      otaChannelId: 'meituan',
      otaProductName: '云隐大床房-含双早-入住当天14:00前免费取消-商旅用户专享价',
      otaProductCode: '802413222',
      otaPhysicalRoomName: '云隐大床房',
      otaPhysicalRoomCode: '32877288',
      internalRoomType: '行政大床房（EXK）',
      rateCode: 'RACK155（RACK）',
      bookingType: 'R01',
      status: 'completed',
      priceRule: 'markup_percent',
      markupValue: 8,
      autoSyncInventory: true
    },
    {
      id: 'prod-03',
      hotelId: 'MT-ZG-52019',
      hotelName: '禅驿度假酒店（自贡方特恐龙王国店）',
      otaChannelId: 'meituan',
      otaProductName: '松香大床房-不含早-入住当天14:00前免费取消',
      otaProductCode: '2532714518',
      otaPhysicalRoomName: '松香大床房',
      otaPhysicalRoomCode: '39967515',
      internalRoomType: '行政大床房（EXK）',
      rateCode: 'RACK155（RACK）',
      bookingType: 'R01',
      status: 'completed',
      priceRule: 'direct',
      markupValue: 0,
      autoSyncInventory: true
    },
    {
      id: 'prod-04',
      hotelId: 'MT-ZG-52019',
      hotelName: '禅驿度假酒店（自贡方特恐龙王国店）',
      otaChannelId: 'meituan',
      otaProductName: '松香家庭房-不含早-入住当天14:00前免费取消',
      otaProductCode: '2532749203',
      otaPhysicalRoomName: '松香家庭房',
      otaPhysicalRoomCode: '32877350',
      internalRoomType: '行政大床房（EXK）',
      rateCode: 'RACK155（RACK）',
      bookingType: 'R01',
      status: 'completed',
      priceRule: 'markup_fixed',
      markupValue: 30,
      autoSyncInventory: true
    },
    {
      id: 'prod-05',
      hotelId: 'MT-ZG-52019',
      hotelName: '禅驿度假酒店（自贡方特恐龙王国店）',
      otaChannelId: 'meituan',
      otaProductName: '松香家庭房-含双早-入住当天14:00前免费取消',
      otaProductCode: '790250659',
      otaPhysicalRoomName: '松香家庭房',
      otaPhysicalRoomCode: '32877350',
      internalRoomType: '行政大床房（EXK）',
      rateCode: 'RACK155（RACK）',
      bookingType: 'R01',
      status: 'completed',
      priceRule: 'markup_percent',
      markupValue: 5,
      autoSyncInventory: true
    }
  ]
};

export const productSlice = createSlice({
  name: 'product',
  initialState,
  reducers: {
    setProductFilterChannel: (state, action: PayloadAction<string>) => {
      state.filterChannel = action.payload;
    },
    setProductFilterHotel: (state, action: PayloadAction<string>) => {
      state.filterHotel = action.payload;
    },
    setProductSearch: (state, action: PayloadAction<string>) => {
      state.searchKeyword = action.payload;
    },
    updateProductMapping: (state, action: PayloadAction<Partial<ProductMapping> & { id: string }>) => {
      const idx = state.products.findIndex(p => p.id === action.payload.id);
      if (idx !== -1) {
        state.products[idx] = { ...state.products[idx], ...action.payload };
      }
    },
    deleteProduct: (state, action: PayloadAction<string>) => {
      state.products = state.products.filter(p => p.id !== action.payload);
    },
    batchDeleteProducts: (state, action: PayloadAction<string[]>) => {
      const set = new Set(action.payload);
      state.products = state.products.filter(p => !set.has(p.id));
    }
  }
});

export const {
  setProductFilterChannel,
  setProductFilterHotel,
  setProductSearch,
  updateProductMapping,
  deleteProduct,
  batchDeleteProducts
} = productSlice.actions;

export default productSlice.reducer;
