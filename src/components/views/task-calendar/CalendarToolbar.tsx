'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarViewMode } from './types';

interface CalendarToolbarProps {
  viewMode: CalendarViewMode;
  /** Human label for the visible range, e.g. "March 2026". */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
}

const buttonClass = cn(
  'inline-flex h-8 items-center justify-center rounded-md border border-border',
  'bg-transparent px-2 text-sm font-medium text-foreground transition-colors',
  'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
);

/**
 * Toolbar with the same affordances as the pre-rework calendar
 * toolbar: previous / today / next navigation and a Month / Week view
 * switch.
 */
export function CalendarToolbar({
  viewMode,
  label,
  onPrev,
  onNext,
  onToday,
  onViewModeChange,
}: CalendarToolbarProps) {
  return (
    <div
      data-testid='calendar-toolbar'
      className='mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2'
    >
      <div className='flex items-center gap-1'>
        <button
          type='button'
          aria-label='Previous'
          data-testid='calendar-prev'
          className={buttonClass}
          onClick={onPrev}
        >
          <ChevronLeft className='h-4 w-4' />
        </button>
        <button
          type='button'
          data-testid='calendar-today'
          className={buttonClass}
          onClick={onToday}
        >
          Today
        </button>
        <button
          type='button'
          aria-label='Next'
          data-testid='calendar-next'
          className={buttonClass}
          onClick={onNext}
        >
          <ChevronRight className='h-4 w-4' />
        </button>
      </div>
      <div
        data-testid='calendar-label'
        aria-live='polite'
        className='text-sm font-semibold text-foreground'
      >
        {label}
      </div>
      <div
        role='group'
        aria-label='Calendar view mode'
        className='flex items-center gap-1'
      >
        <button
          type='button'
          data-testid='calendar-view-month'
          aria-pressed={viewMode === 'month'}
          className={cn(buttonClass, viewMode === 'month' && 'bg-muted')}
          onClick={() => onViewModeChange('month')}
        >
          Month
        </button>
        <button
          type='button'
          data-testid='calendar-view-week'
          aria-pressed={viewMode === 'week'}
          className={cn(buttonClass, viewMode === 'week' && 'bg-muted')}
          onClick={() => onViewModeChange('week')}
        >
          Week
        </button>
      </div>
    </div>
  );
}
