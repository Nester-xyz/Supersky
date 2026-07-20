import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CheckIcon, ChevronDownIcon } from './icons';
import { cx } from './ui';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** `input` = a form-field box (settings); `pill` = a compact ghost button (toolbar). */
  variant?: 'input' | 'pill';
  /** Leading icon, used by the pill variant (e.g. a globe). */
  icon?: ReactNode;
  ariaLabel: string;
  title?: string;
  /** Where the menu opens; `auto` flips up when there isn't room below. */
  placement?: 'auto' | 'top' | 'bottom';
  /** Which trigger edge the menu aligns to. */
  align?: 'start' | 'end';
  triggerClassName?: string;
  menuClassName?: string;
}

/**
 * A custom, keyboard-accessible dropdown that replaces the native <select>, so
 * the menu matches the app's surfaces/typography instead of the OS's chrome.
 * Follows the listbox pattern: the open list holds focus and aria-activedescendant
 * tracks the highlighted option.
 */
export function Select({
  value,
  options,
  onChange,
  variant = 'input',
  icon,
  ariaLabel,
  title,
  placement = 'auto',
  align = 'start',
  triggerClassName,
  menuClassName,
}: SelectProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState<'top' | 'bottom'>('bottom');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? value;
  const [active, setActive] = useState(selectedIndex);

  // On open: highlight the current value and choose a placement before paint.
  useLayoutEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    if (placement !== 'auto') {
      setDrop(placement);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setDrop(below < 264 && rect.top > below ? 'top' : 'bottom');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move focus into the list so the keyboard drives it.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Keep the highlighted option in view as it changes.
  useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // Dismiss on an outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function commit(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(active);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  const trigger =
    variant === 'pill' ? (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          'inline-flex h-8 cursor-pointer items-center gap-0.5 rounded-lg pr-1.5 pl-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink',
          open && 'bg-surface-2 text-ink',
          triggerClassName,
        )}
      >
        {icon}
        <span className="max-w-[80px] truncate text-xs font-medium">{selectedLabel}</span>
        <ChevronDownIcon size={14} strokeWidth={2} className="shrink-0 text-ink-faint" />
      </button>
    ) : (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          'input flex cursor-pointer items-center justify-between gap-2 pr-2.5 text-left',
          open && 'border-line-strong',
          triggerClassName,
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDownIcon
          size={16}
          strokeWidth={2}
          className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')}
        />
      </button>
    );

  return (
    <div className="relative inline-flex" ref={rootRef}>
      {trigger}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${uid}-opt-${active}`}
          onKeyDown={onListKeyDown}
          className={cx(
            'menu-pop absolute z-50 max-h-64 overflow-y-auto outline-none',
            drop === 'top'
              ? 'bottom-full mb-2 animate-slide-up'
              : 'top-full mt-2 animate-slide-down',
            align === 'end' ? 'right-0' : 'left-0',
            menuClassName ?? 'w-52',
          )}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === active;
            return (
              <div
                key={option.value || '__unspecified'}
                id={`${uid}-opt-${index}`}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(index)}
                className={cx('menu-item justify-between', highlighted && 'bg-surface-2')}
              >
                <span
                  className={cx('truncate', selected ? 'font-medium text-ink' : 'text-ink-muted')}
                >
                  {option.label}
                </span>
                {selected && <CheckIcon size={15} className="shrink-0 text-accent" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
