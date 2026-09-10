'use client';

/**
 * The console's control vocabulary.
 *
 * Every input on the check-in is a choice from a fixed list, so there is exactly
 * one control here and everything else composes it. That is not tidiness for its
 * own sake: spec §6 wants the check-in answered in seconds, one-handed, and a
 * screen where every control behaves identically is one you can answer without
 * reading it the second time.
 *
 * No native <select> anywhere. A picker wheel hides its options behind a tap and
 * costs two gestures per answer; four buttons cost one and show you the whole
 * choice at rest.
 */

import type { ReactNode } from 'react';

export type Option<T> = { value: T; label: string; hint?: string };

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
          {label}
        </h2>
        {hint && <span className="text-xs text-neutral-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * `min-h-[3rem]` rather than padding alone: 48px is the tap target that stops a
 * thumb selecting the neighbour, and padding on a one-line label doesn't reach
 * it on a small phone.
 */
const BASE =
  'min-h-[3rem] rounded-xl border px-4 text-center transition-colors select-none ' +
  'active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400';

const ON = 'border-transparent bg-neutral-100 text-neutral-900';
const OFF = 'border-neutral-700 bg-neutral-900 text-neutral-200';

export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  columns = 3,
  emphasis = false,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  /** Larger type for the one answer that sets the size of everything else. */
  emphasis?: boolean;
}) {
  const grid = columns === 2 ? 'grid-cols-2' : columns === 4 ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <div className={`grid gap-2 ${grid}`}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`${BASE} ${selected ? ON : OFF} flex flex-col items-center justify-center gap-0.5 py-2`}
          >
            <span className={emphasis ? 'text-2xl font-semibold' : 'text-sm font-medium'}>
              {option.label}
            </span>
            {option.hint && (
              <span
                className={`text-[0.6875rem] leading-tight ${
                  selected ? 'text-neutral-600' : 'text-neutral-500'
                }`}
              >
                {option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Multi-select. Toggling rather than a checkbox list because "avoid" and
 * "equipment" are both answered by tapping the two or three that apply and
 * leaving the rest — a list of checkboxes makes the empty answer look unfinished
 * when it is usually the right one.
 */
export function MultiChoice<T extends string>({
  options,
  values,
  onChange,
}: {
  options: Option<T>[];
  values: T[];
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = values.indexOf(option.value) >= 0;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              onChange(
                selected
                  ? values.filter((held) => held !== option.value)
                  : [...values, option.value],
              )
            }
            className={`${BASE} ${selected ? ON : OFF} px-4 py-2 text-sm font-medium`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="min-h-[3.5rem] w-full rounded-xl bg-neutral-100 px-4 text-lg font-semibold text-neutral-900 transition-opacity disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function QuietButton({
  children,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  const colour =
    tone === 'danger'
      ? 'border-red-900/70 text-red-300'
      : 'border-neutral-700 text-neutral-200';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[3rem] w-full rounded-xl border bg-neutral-900 px-4 text-sm font-medium transition-opacity disabled:opacity-40 ${colour}`}
    >
      {children}
    </button>
  );
}
