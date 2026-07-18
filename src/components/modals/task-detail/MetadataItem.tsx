import type { ReactNode } from 'react';

export const MetadataItem = ({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: ReactNode;
}) => (
  <div className='flex items-start gap-3'>
    <Icon className='h-5 w-5 text-muted-foreground mt-1' />
    <div>
      <div className='text-sm font-medium text-muted-foreground'>{label}</div>
      <div className='text-sm font-semibold'>{children}</div>
    </div>
  </div>
);
