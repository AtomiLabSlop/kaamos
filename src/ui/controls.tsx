import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActionButton as S2ActionButton,
  Button as S2Button,
  ButtonGroup as S2ButtonGroup,
  Content as S2Content,
  Dialog as S2Dialog,
  Disclosure as S2Disclosure,
  DisclosureHeader as S2DisclosureHeader,
  DisclosurePanel as S2DisclosurePanel,
  DisclosureTitle as S2DisclosureTitle,
  DialogContainer as S2DialogContainer,
  Heading as S2Heading,
  NumberField as S2NumberField,
  Picker as S2Picker,
  PickerItem as S2PickerItem,
  Slider as S2Slider,
  Switch as S2Switch,
  Text as S2Text,
  TextField as S2TextField,
  ToggleButton as S2ToggleButton,
  ToggleButtonGroup as S2ToggleButtonGroup,
} from '@react-spectrum/s2';
import { createPortal } from 'react-dom';
import { Icon, spectrumIcon, type IconName } from './Icon';
import { clamp } from '../lib/util';

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
            className="pointer-events-none fixed bottom-3 left-3 z-100 w-[248px] whitespace-pre-line rounded-lg border border-amber bg-raised px-3 py-2.5 text-ctl leading-snug text-ink shadow-xl"
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
   Buttons (Spectrum 2, 2.00.0-dev.4)

   Same props as in 1.01.x, so every caller moved at once. Mapping:
   primary = Spectrum's accent Button; default and ghost = ActionButton
   (ghost is quiet), the toolbar-and-panel button of Spectrum's pro tools;
   danger = negative outline Button. A button given `active` is a
   ToggleButton (emphasized: amber when on). Kaamos's own icons are wrapped
   with Spectrum's createIcon so they sit in the icon slot.
 * ------------------------------------------------------------------ */

type ButtonTone = 'default' | 'primary' | 'danger' | 'ghost';

function ButtonContent({ icon, children }: { icon?: IconName; children?: ReactNode }) {
  const Glyph = icon ? spectrumIcon(icon) : null;
  return (
    <>
      {Glyph && <Glyph />}
      {children !== undefined && children !== null && children !== false && <S2Text>{children}</S2Text>}
    </>
  );
}

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
  const content = <ButtonContent icon={icon}>{children}</ButtonContent>;
  let button: ReactNode;
  if (active !== undefined) {
    button = (
      <S2ToggleButton
        size="S"
        isEmphasized
        isQuiet={tone === 'ghost'}
        isSelected={active}
        onChange={() => onClick?.()}
        isDisabled={disabled}
        aria-label={label}
        UNSAFE_className={`kaamos-emph ${className}`}
      >
        {content}
      </S2ToggleButton>
    );
  } else if (tone === 'primary' || tone === 'danger') {
    button = (
      <S2Button
        size="S"
        variant={tone === 'primary' ? 'accent' : 'negative'}
        fillStyle={tone === 'primary' ? 'fill' : 'outline'}
        type={type}
        onPress={() => onClick?.()}
        isDisabled={disabled}
        aria-label={label}
        UNSAFE_className={tone === 'primary' ? `kaamos-accent-fill ${className}` : className}
      >
        {content}
      </S2Button>
    );
  } else {
    button = (
      <S2ActionButton
        size="S"
        isQuiet={tone === 'ghost'}
        type={type}
        onPress={() => onClick?.()}
        isDisabled={disabled}
        aria-label={label}
        UNSAFE_className={className}
      >
        {content}
      </S2ActionButton>
    );
  }
  return <Tip text={tip}>{button}</Tip>;
}

export function IconButton({
  icon,
  tip,
  onClick,
  disabled,
  active,
  tone = 'ghost',
  size = 26,
  label,
}: {
  icon: IconName;
  tip?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: ButtonTone;
  size?: number;
  /** Kept for callers; Spectrum sizes the icon from the button size. */
  iconSize?: number;
  label?: string;
}) {
  const Glyph = spectrumIcon(icon);
  const s2size = size <= 22 ? 'XS' : size >= 30 ? 'M' : 'S';
  const name = label ?? tip ?? icon;
  const quiet = tone === 'ghost';
  return (
    <Tip text={tip}>
      {active !== undefined ? (
        <S2ToggleButton
          size={s2size}
          isQuiet={quiet}
          isEmphasized
          isSelected={active}
          onChange={() => onClick?.()}
          isDisabled={disabled}
          aria-label={name}
          UNSAFE_className="kaamos-emph"
        >
          <Glyph />
        </S2ToggleButton>
      ) : (
        <S2ActionButton
          size={s2size}
          isQuiet={quiet}
          onPress={() => onClick?.()}
          isDisabled={disabled}
          aria-label={name}
        >
          <Glyph />
        </S2ActionButton>
      )}
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
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
      <h2 className="text-title font-semibold text-ink">{children}</h2>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}

/**
 * Which sections the user has opened, by title. Kept for the whole visit and in
 * this browser's localStorage, so a section opened once stays open when the
 * selection, the tab or the page changes. Sections the caller opens and closes
 * itself (the `open` prop) are not remembered here.
 */
const SECTION_MEMORY_KEY = 'kaamos.openSections';
const openSections: Set<string> = (() => {
  try {
    const raw = localStorage.getItem(SECTION_MEMORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set<string>();
  }
})();
function rememberSection(title: string, open: boolean) {
  if (open) openSections.add(title);
  else openSections.delete(title);
  try {
    localStorage.setItem(SECTION_MEMORY_KEY, JSON.stringify([...openSections]));
  } catch {
    // Storage blocked (private window): the memory lasts for this visit only.
  }
}

export function Section({
  title,
  children,
  defaultOpen = false,
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
  // Spectrum Disclosure (quiet, compact). Its content is only mounted while
  // open, as before, so a closed section costs nothing.
  const [innerOpen, setInnerOpen] = useState(() => openSections.has(title) || defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) return onOpenChange(next);
    rememberSection(title, next);
    setInnerOpen(next);
  };
  return (
    <S2Disclosure
      size="S"
      density="regular"
      isQuiet
      isExpanded={open}
      onExpandedChange={setOpen}
      UNSAFE_className="kaamos-section"
    >
      <S2DisclosureHeader>
        <S2DisclosureTitle>{title}</S2DisclosureTitle>
        {hint && (
          <Tip text={hint}>
            <span className="grid size-6 shrink-0 place-items-center text-ink-faint">
              <Icon name="info" size={13} />
            </span>
          </Tip>
        )}
        {actions && <span className="flex shrink-0 items-center gap-0.5 pr-1">{actions}</span>}
      </S2DisclosureHeader>
      <S2DisclosurePanel>
        {open && <div className="px-2.5 pt-0.5 pb-3">{children}</div>}
      </S2DisclosurePanel>
    </S2Disclosure>
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

/** A single-line text field filling its row (names of materials, lights, parts). */
export function TextInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <S2TextField
      aria-label={label}
      size="S"
      value={value}
      onChange={onChange}
      isDisabled={disabled}
      UNSAFE_style={{ flex: 1, minWidth: 0 }}
    />
  );
}

/**
 * A row of quick values for a number (sample counts). The one equal to the
 * current value shows as chosen; none does when the value is set elsewhere.
 */
export function PresetButtons({
  values,
  value,
  onChange,
  label,
}: {
  values: number[];
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <S2ToggleButtonGroup
      aria-label={label}
      size="XS"
      density="compact"
      isJustified
      isEmphasized
      selectionMode="single"
      selectedKeys={values.includes(value) ? [String(value)] : []}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next !== undefined) onChange(Number(next));
      }}
      UNSAFE_className="mb-2.5"
      UNSAFE_style={{ width: '100%' }}
    >
      {values.map((v) => (
        <S2ToggleButton key={v} id={String(v)} UNSAFE_className="kaamos-emph">
          <S2Text>{String(v)}</S2Text>
        </S2ToggleButton>
      ))}
    </S2ToggleButtonGroup>
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
  label,
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
  /** Accessible name, when the field has no visible label of its own. */
  label?: string;
}) {
  // Spectrum NumberField: commits on Enter or blur, arrow keys step by `step`.
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <S2NumberField
        aria-label={label ?? (suffix ? `Value in ${suffix}` : 'Value')}
        size="S"
        hideStepper
        isDisabled={disabled}
        value={value}
        minValue={Number.isFinite(min) ? min : undefined}
        maxValue={Number.isFinite(max) ? max : undefined}
        step={step}
        formatOptions={{ maximumFractionDigits: decimals, useGrouping: false }}
        onChange={(next) => Number.isFinite(next) && onChange(clamp(next, min, max))}
        UNSAFE_style={{ width: Math.max(width, 56) + 10 }}
      />
      {suffix && <span className="text-label text-ink-faint">{suffix}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ *
   Slider (Spectrum 2)

   Spectrum's Slider for the track, with Kaamos's label row above it: the
   label (with its hover help) on the left and an editable Spectrum
   NumberField on the right, so the value stays readable and editable.
   Spectrum's own read-only value output is hidden (.kaamos-slider output in
   index.css). Holding Shift fines the step to a quarter while dragging, and
   double-clicking the track returns the default. onChange fires on every
   move, as before, so the imperative material path stays live while dragging.
 * ------------------------------------------------------------------ */

let shiftHeld = false;
const shiftListeners = new Set<() => void>();
function setShift(next: boolean) {
  if (next === shiftHeld) return;
  shiftHeld = next;
  shiftListeners.forEach((l) => l());
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => setShift(e.shiftKey));
  window.addEventListener('keyup', (e) => setShift(e.shiftKey));
  window.addEventListener('blur', () => setShift(false));
}
function useShiftHeld() {
  return useSyncExternalStore(
    (l) => {
      shiftListeners.add(l);
      return () => shiftListeners.delete(l);
    },
    () => shiftHeld,
  );
}

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
  const fine = useShiftHeld();
  const tidy = (v: number) => clamp(Number(v.toFixed(6)), min, max);

  return (
    <div className="kaamos-slider mb-2.5 last:mb-0">
      <div className="flex items-center justify-between gap-2">
        <Tip text={tip}>
          <span className={`truncate text-label ${disabled ? 'text-ink-faint' : 'text-ink-dim'}`}>{label}</span>
        </Tip>
        <span className="inline-flex shrink-0 items-center gap-1">
          <S2NumberField
            aria-label={label}
            size="S"
            hideStepper
            isDisabled={disabled}
            value={value}
            minValue={min}
            maxValue={max}
            step={step}
            formatOptions={{ maximumFractionDigits: decimals, useGrouping: false }}
            onChange={(next) => Number.isFinite(next) && onChange(tidy(next))}
            UNSAFE_style={{ width: 64 }}
          />
          {suffix && <span className="text-label text-ink-faint">{suffix}</span>}
        </span>
      </div>
      <div onDoubleClick={() => !disabled && defaultValue !== undefined && onChange(defaultValue)}>
        <S2Slider
          aria-label={label}
          size="S"
          isEmphasized
          isDisabled={disabled}
          value={clamp(value, min, max)}
          minValue={min}
          maxValue={max}
          step={fine ? step / 4 : step}
          onChange={(next) => onChange(tidy(next))}
          UNSAFE_style={{ width: '100%' }}
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
      <S2TextField
        aria-label="Hex colour"
        size="S"
        value={draft ?? value}
        isDisabled={disabled}
        spellCheck="false"
        onChange={setDraft}
        onBlur={(event) => commit((event.target as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit((event.target as HTMLInputElement).value);
          if (event.key === 'Escape') setDraft(null);
        }}
        UNSAFE_style={{ width: 92 }}
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
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  flex?: boolean;
  /** Accessible name (the Field's label); without it, the chosen option. */
  label?: string;
}) {
  return (
    <S2Picker
      aria-label={label ?? options.find((o) => o.value === value)?.label ?? 'Choose'}
      size="S"
      isDisabled={disabled}
      value={value}
      onChange={(key) => key !== null && onChange(String(key) as T)}
      UNSAFE_style={flex ? { flex: 1, minWidth: 0 } : undefined}
    >
      {options.map((option) => (
        <S2PickerItem key={option.value} id={option.value} textValue={option.label}>
          {option.label}
        </S2PickerItem>
      ))}
    </S2Picker>
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
    <S2Switch
      size="S"
      isEmphasized
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
      aria-label={label}
    />
  );
}

/**
 * Exclusive choice of two to four options. A Spectrum ToggleButtonGroup rather
 * than SegmentedControl: its buttons can each carry Kaamos's hover help.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; tip?: string }[];
}) {
  // Long label sets (Gradient / Colour / Environment) drop to Spectrum's XS
  // size so every label stays whole in the 336 px panel.
  const long = options.reduce((n, o) => n + o.label.length, 0) > 20;
  return (
    <S2ToggleButtonGroup
      aria-label={options.map((o) => o.label).join(' or ')}
      size={long ? 'XS' : 'S'}
      density="compact"
      isJustified={!long}
      isEmphasized
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next !== undefined && next !== value) onChange(String(next) as T);
      }}
      UNSAFE_style={{ flex: 1, minWidth: 0 }}
    >
      {options.map((option) => (
        <Tip key={option.value} text={option.tip}>
          <S2ToggleButton id={option.value} UNSAFE_className="kaamos-emph">
            <S2Text>{option.label}</S2Text>
          </S2ToggleButton>
        </Tip>
      ))}
    </S2ToggleButtonGroup>
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
          <S2NumberField
            aria-label={labels[index]}
            size="S"
            hideStepper
            isDisabled={disabled}
            value={component}
            step={step}
            formatOptions={{ maximumFractionDigits: decimals, useGrouping: false }}
            onChange={(next) => {
              if (!Number.isFinite(next)) return;
              const updated = [...value] as [number, number, number];
              updated[index] = next;
              onChange(updated);
            }}
            UNSAFE_style={{ width: '100%', minWidth: 0 }}
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
  // Spectrum Dialog: Esc calls onClose and focus is trapped inside. Spectrum
  // hides a dialog's ButtonGroup when it is dismissible (close button + click
  // outside), so only a dialog without footer buttons is made dismissible.
  return (
    <S2DialogContainer onDismiss={onClose}>
      <S2Dialog isDismissible={!footer} size={wide ? 'M' : 'S'}>
        <S2Heading slot="title">{title}</S2Heading>
        <S2Content>
          <div className="text-ctl leading-relaxed text-ink-dim">{children}</div>
        </S2Content>
        {footer && <S2ButtonGroup>{footer}</S2ButtonGroup>}
      </S2Dialog>
    </S2DialogContainer>
  );
}
