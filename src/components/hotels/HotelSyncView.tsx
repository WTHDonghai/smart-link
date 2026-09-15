import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { setIsScraping, setFilterChannel, setSearchKeyword, updateHotelMapping, addDiscoveredHotel } from '../../store/slices/hotelSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { Search, RefreshCw, ChevronDown, Save } from 'lucide-react';
import { HotelMapping } from '../../types';

const PMS_HOTEL_OPTIONS = [
  { id: 'PMS-HZ-001', name: '华住全季-杭州湖滨店' },
  { id: 'PMS-SY-099', name: '复星旅文-亚特兰蒂斯(海棠湾)' },
  { id: 'PMS-BJ-012', name: '国贸商务酒店-北京总店' },
  { id: 'PMS-CD-034', name: '花间堂-成都宽窄店' },
  { id: 'PMS-SH-102', name: '万豪瑞吉-上海静安' },
  { id: 'PMS-HZ-028', name: '桔子水晶-杭州武林总店' },
  { id: 'PMS-SZ-045', name: '洲际酒店-深圳湾店' },
  { id: 'PMS-GZ-066', name: '四季酒店-广州塔店' },
];

export const HotelSyncView: React.FC = () => {
  const dispatch = useAppDispatch();
  const hotels = useAppSelector((state) => state.hotel.hotels);
  const isScraping = useAppSelector((state) => state.hotel.isScraping);
  const filterChannel = useAppSelector((state) => state.hotel.filterChannel);
  const searchKeyword = useAppSelector((state) => state.hotel.searchKeyword);
  const channels = useAppSelector((state) => state.channel.channels);

  const [selectedPmsMap, setSelectedPmsMap] = useState<Record<string, string>>({});

  const filteredHotels = hotels.filter((h) => {
    const matchesChannel = filterChannel === 'all' || h.otaChannelId === filterChannel;
    const matchesKeyword = !searchKeyword || 
      h.otaHotelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      h.pmsHotelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      h.city.toLowerCase().includes(searchKeyword.toLowerCase());
    return matchesChannel && matchesKeyword;
  });

  const getHotelOptions = (currentPmsId: string, currentPmsName: string) => {
    if (PMS_HOTEL_OPTIONS.some(opt => opt.id === currentPmsId)) {
      return PMS_HOTEL_OPTIONS;
    }
    return [{ id: currentPmsId, name: currentPmsName }, ...PMS_HOTEL_OPTIONS];
  };

  const handlePmsChange = (hotelId: string, pmsId: string) => {
    setSelectedPmsMap(prev => ({ ...prev, [hotelId]: pmsId }));
  };

  const handleSaveRow = (hotel: HotelMapping) => {
    const pmsId = selectedPmsMap[hotel.id] ?? hotel.pmsHotelId;
    const options = getHotelOptions(hotel.pmsHotelId, hotel.pmsHotelName);
    const matched = options.find(o => o.id === pmsId);
    const pmsName = matched ? matched.name : hotel.pmsHotelName;

    dispatch(updateHotelMapping({
      id: hotel.id,
      pmsHotelId: pmsId,
      pmsHotelName: pmsName
    }));

    dispatch(showToast({
      title: `已保存「${hotel.otaHotelName}」映射`,
      description: `对应中台酒店：${pmsName} (${pmsId})`,
      type: 'success'
    }));

    dispatch(addLog({
      level: 'INFO',
      channelId: hotel.otaChannelId,
      message: `[HotelSync] Saved mapping for ${hotel.otaHotelName} (${hotel.otaHotelId}) -> ${pmsName} (${pmsId})`
    }));
  };

  const handleStartPlaywrightCrawl = () => {
    if (isScraping) return;
    dispatch(setIsScraping(true));
    dispatch(showToast({
      title: 'Playwright 启动 OTA 酒店深度采集',
      description: '分配 Chromium 独立上下文，并发读取已连接商户后台所有已上线酒店数据...',
      type: 'info'
    }));

    dispatch(addLog({
      level: 'PLAYWRIGHT',
      message: '[Playwright:Crawler] Initiated headless Chromium cluster for hotel inventory fetch.'
    }));

    setTimeout(() => {
      // Simulate discovering a new hotel
      const newHotel: HotelMapping = {
        id: `hm-${Date.now()}`,
        otaChannelId: 'meituan',
        otaHotelName: '桔子水晶酒店(杭州西湖武林广场店)',
        otaHotelId: 'MT-HZ-99014',
        pmsHotelName: '桔子水晶-杭州武林总店',
        pmsHotelId: 'PMS-HZ-028',
        city: '杭州',
        starRating: '四星/中高端',
        status: 'mapped',
        lastScraped: '刚刚 (Playwright)',
        roomCount: 16
      };
      dispatch(addDiscoveredHotel(newHotel));
      dispatch(setIsScraping(false));
      dispatch(showToast({
        title: 'OTA 酒店数据自动采集完成',
        description: '成功拉取最新酒店信息，自动完成 PMS 库字典比对',
        type: 'success'
      }));
      dispatch(addLog({
        level: 'SUCCESS',
        message: '[Playwright:Crawler] Extracted 1 new property "桔子水晶酒店(杭州西湖武林广场店)" and verified pricing matrix.'
      }));
    }, 2200);
  };

  return (
    <div className="flex flex-col gap-5 max-w-[1400px] mx-auto w-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            酒店采集和映射
          </h1>
          <span className="text-xs text-[#737686] ml-2">
            共 {hotels.length} 家酒店
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartPlaywrightCrawl}
            disabled={isScraping}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white font-medium text-xs shadow-2xs transition-all cursor-pointer ${
              isScraping
                ? 'bg-[#2170e4] cursor-wait opacity-80'
                : 'bg-[#004ac6] hover:bg-[#2563eb]'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? 'animate-spin' : ''}`} />
            <span>{isScraping ? '采集同步中...' : '同步 OTA 酒店'}</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686]" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => dispatch(setSearchKeyword(e.target.value))}
              placeholder="搜索酒店名称或城市..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#dce9ff] rounded-lg text-xs text-[#0b1c30] placeholder-[#737686] outline-none focus:border-[#004ac6]"
            />
          </div>

          <div className="flex items-center">
            <select
              value={filterChannel}
              onChange={(e) => dispatch(setFilterChannel(e.target.value))}
              className="py-1.5 px-2.5 bg-white border border-[#dce9ff] rounded-lg text-xs text-[#0b1c30] outline-none focus:border-[#004ac6]"
            >
              <option value="all">所有渠道</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-[#737686]">
          共显示 {filteredHotels.length} 家酒店
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#f8faff] text-[#434655] text-xs font-semibold border-b border-[#e5edfa]">
                <th className="py-3 px-6">OTA 渠道与酒店</th>
                <th className="py-3 px-4 w-36 whitespace-nowrap">OTA ID</th>
                <th className="py-3 px-4 min-w-[240px]">中台对应酒店</th>
                <th className="py-3 px-6 text-right whitespace-nowrap w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-sm text-[#0b1c30]">
              {filteredHotels.map((h) => {
                const ch = channels.find(c => c.id === h.otaChannelId);
                const currentPmsId = selectedPmsMap[h.id] ?? h.pmsHotelId;
                const options = getHotelOptions(h.pmsHotelId, h.pmsHotelName);

                return (
                  <tr key={h.id} className="hover:bg-[#f8faff] transition-colors">
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-md ${ch?.bgColor || 'bg-blue-100'} ${ch?.textColor || 'text-blue-700'} flex items-center justify-center font-bold text-xs shrink-0`}>
                          {ch?.short || 'OTA'}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-[#0b1c30]">{h.otaHotelName}</span>
                          <span className="text-[11px] text-[#737686]">{h.starRating}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs text-[#737686] whitespace-nowrap">
                      {h.otaHotelId}
                    </td>

                    {/* 中台对应酒店 - 下拉框 */}
                    <td className="py-3.5 px-4">
                      <div className="relative w-full max-w-xs">
                        <select
                          value={currentPmsId}
                          onChange={(e) => handlePmsChange(h.id, e.target.value)}
                          className="w-full h-8.5 pl-3 pr-8 rounded-lg bg-white text-[#0b1c30] text-xs shadow-2xs focus:ring-1 focus:ring-[#004ac6] focus:outline-hidden appearance-none cursor-pointer border border-[#dce9ff] hover:border-[#004ac6]/60 transition-colors font-medium truncate"
                        >
                          {options.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name} ({opt.id})
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-[#737686]">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </td>

                    {/* 操作列提供保存按钮，去掉状态显示 */}
                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => handleSaveRow(h)}
                          className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-[#004ac6] hover:bg-[#003ea8] rounded-md shadow-2xs transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                          title="保存酒店映射"
                        >
                          <Save className="w-3.5 h-3.5 shrink-0" />
                          <span>保存</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
