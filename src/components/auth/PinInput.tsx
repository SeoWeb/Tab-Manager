'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PinInputProps {
  /** Number of digits (defaults to 8 for the login code). */
  length?: number;
  /** Controlled value (the concatenated digits). */
  value: string;
  /** Called with the new concatenated value on every change. */
  onChange: (value: string) => void;
  /** Called once the input is completely filled. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * Eight (or `length`) single-digit boxes for one-time codes. Supports typing,
 * Backspace, ArrowLeft/Right navigation, and pasting the whole code at once.
 * The value is the concatenated digits so parents can treat it as a plain
 * string (and submit it directly to `POST /auth/verify`).
 */
export function PinInput({
  length = 8,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  className,
  'aria-label': ariaLabel = 'Verification code',
}: PinInputProps) {
  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(() => {
    const padded = value.padEnd(length, ' ').slice(0, length).split('');
    return Array.from({ length }, (_, i) => padded[i] ?? ' ').map((c) =>
      c === ' ' ? '' : c
    );
  }, [value, length]);

  React.useEffect(() => {
    if (autoFocus) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus]);

  const focusIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    inputsRef.current[clamped]?.focus();
    inputsRef.current[clamped]?.select();
  };

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    const nextValue = next.join('').replace(/\s/g, '');
    onChange(nextValue);
    if (nextValue.length === length && !nextValue.includes('')) {
      onComplete?.(nextValue);
    }
  };

  const handleChange = (index: number, raw: string) => {
    const onlyDigits = raw.replace(/\D/g, '');
    if (onlyDigits.length === 0) {
      setDigit(index, '');
      return;
    }
    if (onlyDigits.length === 1) {
      setDigit(index, onlyDigits);
      if (index < length - 1) focusIndex(index + 1);
      return;
    }
    // Multiple digits (e.g. autofill / fast typing): spread across boxes.
    const chars = onlyDigits.slice(0, length - index).split('');
    const next = digits.slice();
    chars.forEach((char, offset) => {
      next[index + offset] = char;
    });
    const nextValue = next.join('').replace(/\s/g, '');
    onChange(nextValue);
    const lastFilled = Math.min(index + chars.length, length - 1);
    focusIndex(lastFilled);
    if (nextValue.length === length && !nextValue.includes('')) {
      onComplete?.(nextValue);
    }
  };

  const handleKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Backspace') {
      if (digits[index]) {
        setDigit(index, '');
      } else if (index > 0) {
        setDigit(index - 1, '');
        focusIndex(index - 1);
      }
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      focusIndex(index - 1);
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      focusIndex(index + 1);
      event.preventDefault();
    }
  };

  const handlePaste = (
    index: number,
    event: React.ClipboardEvent<HTMLInputElement>
  ) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    event.preventDefault();
    const next = digits.slice();
    const start = index;
    pasted
      .slice(0, length - start)
      .split('')
      .forEach((char, offset) => {
        next[start + offset] = char;
      });
    const nextValue = next.join('').replace(/\s/g, '');
    onChange(nextValue);
    const lastFilled = Math.min(start + pasted.length, length - 1);
    focusIndex(lastFilled);
    if (nextValue.length === length && !nextValue.includes('')) {
      onComplete?.(nextValue);
    }
  };

  return (
    <div
      className={cn('flex items-center justify-between gap-1.5', className)}
      role='group'
      aria-label={ariaLabel}
    >
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputsRef.current[index] = el;
          }}
          type='text'
          inputMode='numeric'
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          value={digits[index] ?? ''}
          aria-label={`Digit ${index + 1}`}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            'h-12 w-full min-w-0 rounded-md border border-input bg-background text-center text-lg font-semibold text-foreground ring-offset-background',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
      ))}
    </div>
  );
}

export default PinInput;
