import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isValidUrl, cn } from '@/lib/utils';

interface LinkFormProps {
  linkName: string;
  linkUrl: string;
  urlError: string;
  onNameChange: (name: string) => void;
  onUrlChange: (url: string) => void;
  onUrlError: (error: string) => void;
  nameFieldId: string;
  urlFieldId: string;
}

const LinkForm: React.FC<LinkFormProps> = ({
  linkName,
  linkUrl,
  urlError,
  onNameChange,
  onUrlChange,
  onUrlError,
  nameFieldId,
  urlFieldId,
}) => {
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUrlChange(e.target.value);
    if (urlError) {
      onUrlError('');
    }
  };

  const handleUrlBlur = () => {
    if (linkUrl.trim() && !isValidUrl(linkUrl)) {
      onUrlError('Please enter a valid URL (e.g., https://example.com)');
    }
  };

  return (
    <div className='space-y-4 py-4'>
      <div className='space-y-2'>
        <Label htmlFor={nameFieldId}>Link Name (Optional)</Label>
        <Input
          id={nameFieldId}
          value={linkName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder='e.g., Company Website'
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor={urlFieldId}>Link URL</Label>
        <Input
          id={urlFieldId}
          type='url'
          value={linkUrl}
          onChange={handleUrlChange}
          onBlur={handleUrlBlur}
          placeholder='https://example.com'
          className={cn(
            urlError && 'border-red-500 focus-visible:ring-red-500'
          )}
        />
        {urlError && <p className='text-sm text-red-500 pt-1'>{urlError}</p>}
      </div>
    </div>
  );
};

export default LinkForm;
