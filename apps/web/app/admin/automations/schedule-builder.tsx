'use client';

import { useMemo, useState } from 'react';

/**
 * Friendly schedule picker that writes a standard cron expression underneath.
 * Presets cover the common cases; Advanced exposes the raw cron for everything
 * else. Editing an existing automation reverse-parses its cron back into a
 * preset when possible.
 */

type Mode = 'daily' | 'weekdays' | 'weekly' | 'every_hours' | 'advanced';

const DAYS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
];

interface Parsed {
  mode: Mode;
  time: string; // HH:MM
  day: string; // 0-6 (weekly)
  everyHours: number;
}

function two(n: number | string): string {
  return String(n).padStart(2, '0');
}

/** Try to express an existing cron as one of our presets. */
export function parseCron(cron: string): Parsed {
  const fallback: Parsed = { mode: 'advanced', time: '09:00', day: '1', everyHours: 4 };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [min, hour, dom, mon, dow] = parts;
  if (!/^\d{1,2}$/.test(min)) return fallback;
  if (dom !== '*' || mon !== '*') return fallback;

  if (/^\d{1,2}$/.test(hour)) {
    const time = `${two(hour)}:${two(min)}`;
    if (dow === '*') return { ...fallback, mode: 'daily', time };
    if (dow === '1-5') return { ...fallback, mode: 'weekdays', time };
    if (/^[0-6]$/.test(dow)) return { ...fallback, mode: 'weekly', time, day: dow };
  }
  const every = hour.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (every && dow === '*') {
    return { ...fallback, mode: 'every_hours', time: `${two(every[1])}:${two(min)}`, everyHours: Number(every[2]) };
  }
  return fallback;
}

function buildCron(p: Parsed, advanced: string): string {
  const [h, m] = p.time.split(':').map((x) => parseInt(x, 10) || 0);
  switch (p.mode) {
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekdays':
      return `${m} ${h} * * 1-5`;
    case 'weekly':
      return `${m} ${h} * * ${p.day}`;
    case 'every_hours':
      return `${m} ${h}/${Math.max(1, p.everyHours)} * * *`;
    case 'advanced':
      return advanced;
  }
}

function summarize(p: Parsed, cron: string): string {
  const nice = (t: string) => {
    const [h, m] = t.split(':').map((x) => parseInt(x, 10) || 0);
    const ampm = h < 12 ? 'am' : 'pm';
    const hr = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hr}${ampm}` : `${hr}:${two(m)}${ampm}`;
  };
  switch (p.mode) {
    case 'daily':
      return `Every day at ${nice(p.time)}`;
    case 'weekdays':
      return `Monday–Friday at ${nice(p.time)}`;
    case 'weekly':
      return `Every ${DAYS.find((d) => d.value === p.day)?.label} at ${nice(p.time)}`;
    case 'every_hours':
      return `Every ${p.everyHours} hour${p.everyHours === 1 ? '' : 's'}, starting at ${nice(p.time)} each day`;
    case 'advanced':
      return `Cron: ${cron}`;
  }
}

export function ScheduleBuilder({
  initialCron,
  timezone,
  onCronChange,
  onTimezoneChange,
}: {
  initialCron: string;
  timezone: string;
  onCronChange: (cron: string) => void;
  onTimezoneChange: (tz: string) => void;
}) {
  const [parsed, setParsed] = useState<Parsed>(() => parseCron(initialCron));
  const [advanced, setAdvanced] = useState(initialCron || '0 9 * * *');

  const cron = useMemo(() => buildCron(parsed, advanced), [parsed, advanced]);

  function update(patch: Partial<Parsed>) {
    const next = { ...parsed, ...patch };
    setParsed(next);
    onCronChange(buildCron(next, advanced));
  }

  const sel: React.CSSProperties = { fontSize: '0.88rem' };

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        className="field"
        style={sel}
        value={parsed.mode}
        onChange={(e) => update({ mode: e.target.value as Mode })}
      >
        <option value="daily">Daily at…</option>
        <option value="weekdays">Weekdays (Mon–Fri) at…</option>
        <option value="weekly">Weekly on…</option>
        <option value="every_hours">Every X hours…</option>
        <option value="advanced">Advanced (cron)</option>
      </select>

      {parsed.mode === 'weekly' && (
        <select className="field" style={sel} value={parsed.day} onChange={(e) => update({ day: e.target.value })}>
          {DAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}

      {parsed.mode === 'every_hours' && (
        <>
          <span style={{ fontSize: '0.86rem' }}>every</span>
          <input
            className="field mono"
            style={{ width: 60 }}
            type="number"
            min={1}
            max={23}
            value={parsed.everyHours}
            onChange={(e) => update({ everyHours: Math.max(1, Math.min(23, Number(e.target.value) || 1)) })}
          />
          <span style={{ fontSize: '0.86rem' }}>hours, starting at</span>
        </>
      )}

      {parsed.mode !== 'advanced' && (
        <input
          className="field mono"
          style={{ width: 105 }}
          type="time"
          value={parsed.time}
          onChange={(e) => update({ time: e.target.value || '09:00' })}
        />
      )}

      {parsed.mode === 'advanced' && (
        <input
          className="field mono"
          style={{ width: 150 }}
          placeholder="0 9 * * 1-5"
          value={advanced}
          onChange={(e) => {
            setAdvanced(e.target.value);
            onCronChange(e.target.value);
          }}
          title="Standard 5-field cron expression"
        />
      )}

      <input
        className="field"
        style={{ width: 180, fontSize: '0.85rem' }}
        placeholder="Timezone (server default)"
        value={timezone}
        onChange={(e) => onTimezoneChange(e.target.value)}
        title="IANA timezone, e.g. Australia/Sydney"
      />

      <span
        style={{
          fontSize: '0.82rem',
          color: 'var(--color-text-muted)',
          background: '#f6f2e7',
          borderRadius: 6,
          padding: '0.25rem 0.6rem',
        }}
      >
        {summarize(parsed, cron)}
        {parsed.mode !== 'advanced' && <span style={{ opacity: 0.6 }}> · {cron}</span>}
      </span>
    </div>
  );
}
