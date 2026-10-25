import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { clamp, fmt } from '../lib/util';

/* ------------------------------------------------------------------ *
   Tooltip
 * ------------------------------------------------------------------ */

const TooltipCtx = createContext<{
  show(text: string): void;
  hide(): void;
} | null>(null);

/**
 * Hover help for every control. It always appears in the same place, the lower
 * left corner over the Materials window, instead of beside the control: the
 * eye does not have to chase it, and it never covers what is being pointed at.
 */
export function TooltipLayer({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);

  const show = useCallback((next: string) => setText(next), []);
  const hide = useCallback(() => setText(null), []);

  return (
    <TooltipCtx.Provider value={{ show, hide }}>
      {children}
      {text &&
        createPortal(
          <div
            role="tooltip"
            data-testid="tooltip"
            className="pointer-events-none fixed bottom-3 left-3 z-100 w-[222px] whitespace-pre-line rounded-sm border border-amber bg-raised px-2.5 py-2 text-ctl leading-snug text-ink shadow-xl"
          >
            {text}
          </div>,
          document.body,
        )}
    </TooltipCtx.Provider>
  );
}

const TIP_DELAY = 420;

/** Wraps a control so hovering it explains what it does. */
export function Tip({ text, children }: { text?: string; children: ReactNode }) {
  const ctx = useContext(TooltipCtx);
  const timer = useRef<number>(0);

  if (!text || !ctx) return <>{children}</>;

  const open = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => ctx.show(text), TIP_DELAY);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    ctx.hide();
  };

  return (
    <span
      className="contents"
      onPointerEnter={open}
      onPointerLeave={close}
      onPointerDown={close}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
   Buttons
 * ------------------------------------------------------------------ */

type ButtonTone = 'default' | 'primary' | 'danger' | 'ghost';

const TONE: Record<ButtonTone, string> = {
  default:
    'bg-raised text-ink border border-line hover:bg-hover hover:border-line-strong',
  primary:
    'bg-amber text-shell border border-amber font-medium hover:brightness-110',
  danger:
    'bg-raised text-danger border border-line hover:border-danger hover:bg-hover',
  ghost: 'text-ink-dim hover:text-ink hover:bg-hover border border-transparent',
};

export function Button({
  children,
  icon,
  tone = 'default',
  tip,
  onClick,
  disabled,
  active,
  className = '',
  type = 'button',
  label,
}: {
  children?: ReactNode;
  icon?: IconName;
  tone?: ButtonTone;
  tip?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  /** Overrides the accessible name when the visible text is ambiguous. */
  label?: string;
}) {
  return (
    <Tip text={tip}>
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`inline-flex h-[26px] items-center gap-1.5 rounded-sm px-2 text-ctl whitespace-nowrap transition-colors disabled:opacity-35 ${
          active ? 'bg-amber-wash! border-amber-dim! text-amber!' : ''
        } ${TONE[tone]} ${className}`}
      >
        {icon && <Icon name={icon} />}
        {children}
      </button>
    </Tip>
  );
}

export function IconButton({
  icon,
  tip,
  onClick,
  disabled,
  active,
  tone = 'ghost',
  size = 26,
  iconSize,
  label,
}: {
  icon: IconName;
  tip?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: ButtonTone;
  size?: number;
  /** Drawn size of the icon itself; the default suits the 26 px button. */
  iconSize?: number;
  label?: string;
}) {
  return (
    <Tip text={tip}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label ?? tip ?? icon}
        aria-pressed={active}
        style={{ width: size, height: size }}
        className={`inline-grid place-items-center rounded-sm transition-colors disabled:opacity-30 ${
          active ? 'bg-amber/25! text-amber! ring-1 ring-amber ring-inset' : ''
        } ${TONE[tone]}`}
      >
        <Icon name={icon} size={iconSize} />
      </button>
    </Tip>
  );
}

/* ------------------------------------------------------------------ *
   Layout
 * ------------------------------------------------------------------ */

export function PanelTitle({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-2.5">
      <h2 className="text-title font-medium text-ink">{children}</h2>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  actions,
  hint,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Set both to let the caller open and close the section (e.g. to open it for the user). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  actions?: ReactNode;
  hint?: string;
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: (value: boolean) => boolean) =>
    onOpenChange ? onOpenChange(next(open)) : setInnerOpen(next);
  return (
    <section className="border-b border-line">
      <div className="flex h-7 items-center gap-1 pr-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 flex-1 items-center gap-1 pl-1.5 text-left text-label text-ink-dim hover:text-ink"
          aria-expanded={open}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          {title}
        </button>
        {hint && (
          <Tip text={hint}>
            <span className="grid size-4 place-items-center text-ink-faint">
              <Icon name="info" size={12} />
            </span>
          </Tip>
        )}
        {actions}
      </div>
      {open && <div className="px-2.5 pt-0.5 pb-3">{children}</div>}
    </section>
  );
}

export function Field({
  label,
  children,
  tip,
}: {
  label: string;
  children: ReactNode;
  tip?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 last:mb-0">
      <Tip text={tip}>
        <span className="w-[86px] shrink-0 truncate text-label text-ink-dim">
          {label}
        </span>
      </Tip>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 text-label leading-snug text-ink-faint">{children}</p>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 py-3 text-label leading-relaxed text-ink-faint">{children}</p>
  );
}

/* ------------------------------------------------------------------ *
   Numeric input
 * ------------------------------------------------------------------ */

export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 0.01,
  decimals = 2,
  width = 54,
  suffix,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  width?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? fmt(value, decimals);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    setDraft(null);
    if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        style={{ width }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          } else if (event.key === 'Escape') {
            setDraft(null);
            (event.target as HTMLInputElement).blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const scale = event.shiftKey ? 10 : 1;
            setDraft(null);
            onChange(clamp(value + direction * step * scale, min, max));
          }
        }}
        /* shrink-0: the width is set in pixels, and without this flex squeezes
           the field in a narrow panel until "1600" is clipped to "16" — which
           reads as wrong data rather than as a layout problem. */
        className="h-[22px] shrink-0 rounded-sm border border-line bg-well px-1.5 text-right text-ctl text-ink tabular-nums disabled:opacity-40"
      />
      {suffix && <span className="text-label text-ink-faint">{suffix}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ *
   Slider

   A thin track under the label row, with the value always readable and always
   editable. Dragging anywhere on the track works, shift fines the step down,
   and double-clicking returns the control to its default.
 * ------------------------------------------------------------------ */

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  decimals = 2,
  defaultValue,
  disabled,
  tip,
  suffix,
  note,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  defaultValue?: number;
  disabled?: boolean;
  tip?: string;
  suffix?: string;
  note?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const id = useId();

  const fraction = clamp((value - min) / (max - min || 1), 0, 1);

  const quantize = (raw: number, fine: boolean) => {
    const effective = fine ? step / 4 : step;
    const snapped = Math.round(raw / effective) * effective;
    // Keep float noise out of the displayed value.
    return clamp(Number(snapped.toFixed(6)), min, max);
  };

  const fromPointer = (clientX: number, fine: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    onChange(quantize(min + ratio * (max - min), fine));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    fromPointer(event.clientX, event.shiftKey);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    fromPointer(event.clientX, event.shiftKey);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const scale = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onChange(quantize(value + step * scale, false));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onChange(quantize(value - step * scale, false));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
    }
  };

  return (
    <div className={`mb-2.5 last:mb-0 ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <Tip text={tip}>
          <label htmlFor={id} className="truncate text-label text-ink-dim">
            {label}
          </label>
        </Tip>
        <NumberInput
          value={value}
          onChange={(next) => onChange(clamp(next, min, max))}
          min={min}
          max={max}
          step={step}
          decimals={decimals}
          disabled={disabled}
          suffix={suffix}
        />
      </div>

      <div
        ref={trackRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={Number(value.toFixed(decimals))}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        className={`relative mt-1.5 h-3 touch-none ${disabled ? '' : 'cursor-ew-resize'}`}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-well ring-1 ring-line ring-inset" />
        <div
          className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-amber"
          style={{ width: `${fraction * 100}%` }}
        />
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-shell bg-ink"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
      {note && <Hint>{note}</Hint>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Colour
 * ------------------------------------------------------------------ */

const HEX = /^#?([0-9a-f]{1,3}|[0-9a-f]{6})$/i;

/**
 * Typed hex to a full #rrggbb, the short ways too: one digit is a grey
 * ("0" = #000000), two digits are a grey pair ("f1" = #f1f1f1), three are the
 * CSS shorthand ("abc" = #aabbcc). Null when it is not a colour.
 */
export function expandHex(raw: string): string | null {
  const match = HEX.exec(raw.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  if (digits.length === 6) return `#${digits}`;
  if (digits.length === 1) return `#${digits.repeat(6)}`;
  if (digits.length === 2) return `#${digits.repeat(3)}`;
  return `#${[...digits].map((d) => d + d).join('')}`;
}

export function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    setDraft(null);
    const hex = expandHex(raw);
    if (hex) onChange(hex);
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="grid size-[22px] shrink-0 place-items-center rounded-sm border border-line bg-well"
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Colour"
          className="size-[16px] rounded-[1px]"
        />
      </span>
      <input
        type="text"
        value={draft ?? value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
          if (event.key === 'Escape') setDraft(null);
        }}
        className="h-[22px] w-[74px] rounded-sm border border-line bg-well px-1.5 text-ctl text-ink tabular-nums disabled:opacity-40"
      />
    </span>
  );
}

/* ------------------------------------------------------------------ *
   Select, toggle, segmented
 * ------------------------------------------------------------------ */

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  flex = true,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  flex?: boolean;
}) {
  return (
    <span className={`relative inline-flex items-center ${flex ? 'flex-1' : ''}`}>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-[22px] w-full rounded-sm border border-line bg-well pr-5 pl-1.5 text-ctl text-ink disabled:opacity-40"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1 text-ink-faint">
        <Icon name="chevronDown" size={12} />
      </span>
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[16px] w-[28px] shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
        checked ? 'border-amber-dim bg-amber' : 'border-line bg-well'
      }`}
    >
      <span
        className={`absolute top-[1px] size-[12px] rounded-full transition-all ${
          checked ? 'left-[13px] bg-shell' : 'left-[1px] bg-ink-faint'
        }`}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; tip?: string }[];
}) {
  return (
    <div
      role="radiogroup"
      className="flex flex-1 gap-px rounded-sm border border-line bg-well p-px"
    >
      {options.map((option) => (
        <Tip key={option.value} text={option.tip}>
          <button
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={`h-[20px] flex-1 rounded-[2px] px-1 text-label whitespace-nowrap transition-colors ${
              value === option.value
                ? 'bg-raised text-amber'
                : 'text-ink-dim hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        </Tip>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Vector
 * ------------------------------------------------------------------ */

export function Vector3Field({
  value,
  onChange,
  step = 0.01,
  decimals = 3,
  disabled,
  labels = ['X', 'Y', 'Z'],
}: {
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  step?: number;
  decimals?: number;
  disabled?: boolean;
  labels?: [string, string, string] | string[];
}) {
  return (
    <div className="flex flex-1 gap-1">
      {value.map((component, index) => (
        <span key={index} className="flex min-w-0 flex-1 items-center gap-1">
          <span className="text-label text-ink-faint">{labels[index]}</span>
          <input
            type="text"
            inputMode="decimal"
            value={fmt(component, decimals)}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value);
              if (!Number.isFinite(parsed)) return;
              const next = [...value] as [number, number, number];
              next[index] = parsed;
              onChange(next);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              const direction = event.key === 'ArrowUp' ? 1 : -1;
              const next = [...value] as [number, number, number];
              next[index] = component + direction * step * (event.shiftKey ? 10 : 1);
              onChange(next);
            }}
            className="h-[22px] w-full min-w-0 rounded-sm border border-line bg-well px-1 text-right text-ctl text-ink tabular-nums disabled:opacity-40"
          />
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Modal
 * ------------------------------------------------------------------ */

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** A wider panel for reading text rather than answering a question. */
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    panel.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-90 grid place-items-center bg-black/55 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-[480px]' : 'max-w-[380px]'} rounded-md border border-line-strong bg-panel shadow-2xl`}
      >
        <div className="flex h-9 items-center justify-between border-b border-line px-3">
          <h2 className="text-title font-medium">{title}</h2>
          <IconButton icon="close" onClick={onClose} tip="Close" size={22} />
        </div>
        <div className="px-3 py-3 text-ctl leading-relaxed text-ink-dim">{children}</div>
        {footer && (
          <div className="flex justify-end gap-1.5 border-t border-line px-3 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
