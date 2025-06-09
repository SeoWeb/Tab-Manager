import React from 'react';
import { Input } from '@/components/ui/input';
import { SearchIcon } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

interface SearchBarProps {
  onSearch: (query: string) => void;
}

const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  ({ onSearch }, ref) => {
    const searchQuery = useAppStore((state) => state.searchQuery);
    const setSearchQuery = useAppStore((state) => state.setSearchQuery);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);
      onSearch(query);
    };

    return (
      <div className='flex-1 max-w-md px-4'>
        <div className='relative'>
          <SearchIcon className='absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400' />
          <Input
            ref={ref}
            type='search'
            placeholder='Search projects, collections, and links...'
            className='pl-10 w-full'
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>
      </div>
    );
  }
);

SearchBar.displayName = 'SearchBar';

export default SearchBar;
