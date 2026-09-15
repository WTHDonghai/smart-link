import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, X } from 'lucide-react';

export interface SelectOption {
  label: string;
  value: string;
  subtext?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: (string | SelectOption)[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  buttonClassName?: string;
  dropdownClassName?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  clearable?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '请选择',
  searchPlaceholder = '输入关键词搜索...',
  className = '',
  buttonClassName = '',
  dropdownClassName = '',
  disabled = false,
  size = 'sm',
  clearable = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Normalize options
  const normalizedOptions: SelectOption[] = options.map((opt) => {
    if (typeof opt === 'string') {
      return { label: opt, value: opt };
    }
    return opt;
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  // Filter options
  const filteredOptions = normalizedOptions.filter((opt) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      opt.label.toLowerCase().includes(query) ||
      opt.value.toLowerCase().includes(query) ||
      (opt.subtext && opt.subtext.toLowerCase().includes(query))
    );
  });

  // Handle outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchQuery('');
  };

  const heightClass = size === 'sm' ? 'h-8.5 text-xs' : 'h-10 text-xs';

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-left w-full ${isOpen ? 'z-40' : 'z-10'} ${className}`}
    >
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full ${heightClass} pl-3 ${clearable && value ? 'pr-12' : 'pr-8'} rounded-lg bg-white text-[#0b1c30] shadow-2xs border border-[#dce9ff] hover:border-[#004ac6]/60 focus:outline-hidden focus:ring-1 focus:ring-[#004ac6] flex items-center justify-between transition-colors font-medium truncate cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed ${buttonClassName}`}
      >
        <span className="truncate block">
          {selectedOption ? selectedOption.label : <span className="text-[#a0aec0]">{placeholder}</span>}
        </span>
      </button>

      {/* Control Actions & Icons (positioned outside button to avoid invalid HTML nesting) */}
      <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1 pointer-events-none">
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label="清空选择"
            onClick={handleClear}
            className="pointer-events-auto text-[#a0aec0] hover:text-[#525f7f] cursor-pointer p-0.5 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#737686] transition-transform duration-200 ${
            isOpen ? 'transform rotate-180 text-[#004ac6]' : ''
          }`}
        />
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-full min-w-[200px] max-w-[340px] bg-white rounded-lg shadow-lg border border-[#dce9ff] z-50 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100 ${dropdownClassName}`}
        >
          {/* Search Header */}
          <div className="p-2 border-b border-[#edf3fc] bg-[#fafafa]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#737686] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-7.5 pl-7 pr-7 text-xs bg-white rounded-md border border-[#dce9ff] focus:border-[#004ac6] focus:outline-hidden text-[#0b1c30] placeholder-[#a0aec0]"
                onClick={(e) => e.stopPropagation()}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#a0aec0] hover:text-[#525f7f] p-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto py-1 divide-y divide-gray-50">
            {filteredOptions.length === 0 ? (
              <div className="py-4 px-3 text-center text-xs text-[#737686]">
                未找到匹配结果
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#edf4ff] text-[#004ac6] font-semibold'
                        : 'text-[#0b1c30] hover:bg-[#f6f9fc]'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="truncate">{option.label}</span>
                      {option.subtext && (
                        <span className="text-[10px] text-[#737686] truncate mt-0.5">
                          {option.subtext}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#004ac6] shrink-0 ml-1" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
