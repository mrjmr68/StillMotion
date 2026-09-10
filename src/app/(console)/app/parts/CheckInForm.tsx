'use client';

/**
 * The check-in (spec §6).
 *
 * Four questions above the fold — how long, how you feel, what you want, what
 * hurts — and everything else behind "More options". The split is the spec's,
 * and it is load-bearing: the four change daily, the rest change monthly, and
 * putting them on one screen would make the daily answer feel like a form.
 *
 * The collapsed half is sticky. It arrives from `user_preferences` and is
 * written back on Generate, so the second check-in is genuinely four taps.
 */

import { useState } from 'react';
import { DEFAULT_CHECKIN, FOCUSES, type CheckinRequest } from '@/lib/console/checkin';
import {
  DURATION_OPTIONS,
  EMPHASES,
  EMPHASIS_LABELS,
  ENERGY_HINTS,
  ENERGY_LABELS,
  ENERGY_LEVELS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  FLOOR_LABELS,
  FLOOR_TOLERANCES,
  FORMAT_LABELS,
  FORMAT_PREFERENCES,
  REGION_LABELS,
  REGIONS,
} from '@/lib/console/vocab';
import { FOCUS_LABELS } from '@/lib/planner/vocab';
import { Choice, Field, MultiChoice, PrimaryButton, type Option } from './controls';

const ENERGY_OPTIONS: Option<CheckinRequest['energy']>[] = ENERGY_LEVELS.map((level) => ({
  value: level,
  label: ENERGY_LABELS[level],
  hint: ENERGY_HINTS[level],
}));

const FOCUS_OPTIONS: Option<CheckinRequest['focus']>[] = FOCUSES.map((focus) => ({
  value: focus,
  // Sentence case rather than the vocab's lowercase: these are buttons, not
  // prose, and "surprise me" mid-grid reads as a typo.
  label: FOCUS_LABELS[focus].replace(/^./, (first) => first.toUpperCase()),
}));

const REGION_OPTIONS: Option<(typeof REGIONS)[number]>[] = REGIONS.map((region) => ({
  value: region,
  label: REGION_LABELS[region],
}));

const EQUIPMENT_OPTIONS: Option<(typeof EQUIPMENT)[number]>[] = EQUIPMENT.map((piece) => ({
  value: piece,
  label: EQUIPMENT_LABELS[piece],
}));

const EMPHASIS_OPTIONS: Option<CheckinRequest['emphasis']>[] = EMPHASES.map((value) => ({
  value,
  label: EMPHASIS_LABELS[value],
}));

const FORMAT_OPTIONS: Option<CheckinRequest['format_preference']>[] = FORMAT_PREFERENCES.map(
  (value) => ({ value, label: FORMAT_LABELS[value] }),
);

const FLOOR_OPTIONS: Option<CheckinRequest['floor_tolerance']>[] = FLOOR_TOLERANCES.map(
  (value) => ({ value, label: FLOOR_LABELS[value] }),
);

export default function CheckInForm({
  initial,
  onGenerate,
  error,
}: {
  initial: CheckinRequest;
  onGenerate: (checkin: CheckinRequest) => void;
  error: string | null;
}) {
  const [checkin, setCheckin] = useState<CheckinRequest>(initial);
  const [open, setOpen] = useState(false);

  const set = <K extends keyof CheckinRequest>(key: K, value: CheckinRequest[K]) =>
    setCheckin((previous) => ({ ...previous, [key]: value }));

  const stickyChanged =
    checkin.equipment_on_hand.length > 0 ||
    checkin.emphasis !== DEFAULT_CHECKIN.emphasis ||
    checkin.format_preference !== DEFAULT_CHECKIN.format_preference ||
    checkin.floor_tolerance !== DEFAULT_CHECKIN.floor_tolerance;

  return (
    <div className="space-y-8">
      <Field label="How long">
        <Choice
          options={DURATION_OPTIONS}
          value={checkin.duration_min}
          onChange={(value) => set('duration_min', value)}
          columns={4}
          emphasis
        />
      </Field>

      <Field label="Energy">
        <Choice
          options={ENERGY_OPTIONS}
          value={checkin.energy}
          onChange={(value) => set('energy', value)}
          columns={3}
        />
      </Field>

      <Field label="Focus">
        <Choice
          options={FOCUS_OPTIONS}
          value={checkin.focus}
          onChange={(value) => set('focus', value)}
          columns={2}
        />
      </Field>

      <Field
        label="Anything to avoid"
        hint={checkin.avoid_regions.length === 0 ? 'nothing' : undefined}
      >
        <MultiChoice
          options={REGION_OPTIONS}
          values={checkin.avoid_regions}
          onChange={(values) => set('avoid_regions', values)}
        />
      </Field>

      {/*
        A plain button rather than <details>: the summary marker is styled
        differently on every mobile browser, and this one needs a stable hit
        area more than it needs semantics it isn't using.
      */}
      <div className="rounded-xl border border-neutral-800">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          className="flex min-h-[3rem] w-full items-center justify-between px-4 text-sm text-neutral-300"
        >
          <span>More options</span>
          <span className="text-neutral-500">
            {stickyChanged && !open ? 'set · ' : ''}
            {open ? '−' : '+'}
          </span>
        </button>

        {open && (
          <div className="space-y-6 border-t border-neutral-800 p-4">
            <Field label="Equipment on hand" hint="what's actually within reach">
              <MultiChoice
                options={EQUIPMENT_OPTIONS}
                values={checkin.equipment_on_hand}
                onChange={(values) => set('equipment_on_hand', values)}
              />
            </Field>

            <Field label="Emphasis">
              <Choice
                options={EMPHASIS_OPTIONS}
                value={checkin.emphasis}
                onChange={(value) => set('emphasis', value)}
                columns={2}
              />
            </Field>

            <Field label="Format">
              <Choice
                options={FORMAT_OPTIONS}
                value={checkin.format_preference}
                onChange={(value) => set('format_preference', value)}
                columns={2}
              />
            </Field>

            <Field label="Floor">
              <Choice
                options={FLOOR_OPTIONS}
                value={checkin.floor_tolerance}
                onChange={(value) => set('floor_tolerance', value)}
                columns={2}
              />
            </Field>

            <p className="text-xs text-neutral-500">
              These stay set until you change them.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* No pending state: pressing this swaps the whole screen for the
          waiting one in the same commit, so a spinner here would never render. */}
      <PrimaryButton onClick={() => onGenerate(checkin)}>Generate</PrimaryButton>
    </div>
  );
}
