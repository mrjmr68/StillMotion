'use client';

/**
 * After the session.
 *
 * Two fields, both optional, on a screen you reach while out of breath. `rating`
 * is what Build 2's progression will read; the note is for the thing a rating
 * can't hold ("left knee complained on the lunges").
 *
 * Skip is a real answer and is styled like one. A rating extracted under duress
 * is worse than no rating, because the progression logic can't tell the
 * difference between "it was right" and "I tapped the middle one to make this
 * screen go away."
 */

import { useState } from 'react';
import { PrimaryButton, QuietButton, type Option } from './controls';

export type Rating = 'easy' | 'right' | 'hard';

const RATINGS: Option<Rating>[] = [
  { value: 'easy', label: 'Easy', hint: 'had more in me' },
  { value: 'right', label: 'Right', hint: 'well judged' },
  { value: 'hard', label: 'Hard', hint: 'at my limit' },
];

export default function Feedback({
  minutes,
  outcome,
  busy,
  onSave,
  onSkip,
}: {
  minutes: number;
  outcome: string;
  busy: boolean;
  onSave: (rating: Rating | null, note: string) => void;
  onSkip: () => void;
}) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [note, setNote] = useState('');

  return (
    <div className="space-y-8 py-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-neutral-100">
          {outcome === 'completed' ? 'Session complete' : 'Session ended'}
        </h1>
        <p className="text-neutral-400">{minutes} minutes</p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {RATINGS.map((option) => {
          const selected = option.value === rating;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setRating(selected ? null : option.value)}
              className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-2 ${
                selected
                  ? 'border-transparent bg-neutral-100 text-neutral-900'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-200'
              }`}
            >
              <span className="font-medium">{option.label}</span>
              <span
                className={`text-[0.6875rem] leading-tight ${
                  selected ? 'text-neutral-600' : 'text-neutral-500'
                }`}
              >
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        placeholder="Anything worth remembering?"
        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
      />

      <div className="space-y-3">
        <PrimaryButton
          onClick={() => onSave(rating, note.trim())}
          disabled={busy || (rating === null && note.trim() === '')}
        >
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <QuietButton onClick={onSkip} disabled={busy}>
          Skip
        </QuietButton>
      </div>
    </div>
  );
}
