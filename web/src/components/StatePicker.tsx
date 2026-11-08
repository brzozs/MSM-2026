import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import './StatePicker.css';

interface StatePickerProps {
  states: readonly { code: string; name: string }[];
  selectedStateCode: string | null;
  onSelectState: (stateCode: string | null) => void;
  selectorButtonRef: RefObject<HTMLButtonElement | null>;
}

export default function StatePicker({ states, selectedStateCode, onSelectState, selectorButtonRef }: StatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ query: '', lastTypedAt: 0 });
  const listboxId = useId();
  const options = [{ code: null, name: 'All states' }, ...states];
  const selectedOptionIndex = Math.max(0, options.findIndex((option) => option.code === selectedStateCode));
  const selectedStateName = states.find((state) => state.code === selectedStateCode)?.name ?? 'Choose a state';

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setIsOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const listbox = listboxRef.current;
      const activeOption = listbox?.children[activeOptionIndex] as HTMLElement | undefined;
      if (!listbox || !activeOption) return;
      const optionBottom = activeOption.offsetTop + activeOption.offsetHeight;
      if (activeOption.offsetTop < listbox.scrollTop) listbox.scrollTop = activeOption.offsetTop;
      else if (optionBottom > listbox.scrollTop + listbox.clientHeight) listbox.scrollTop = optionBottom - listbox.clientHeight;
    }
  }, [isOpen, activeOptionIndex]);

  function openPicker(optionIndex = selectedOptionIndex) {
    setActiveOptionIndex(optionIndex);
    setIsOpen(true);
    typeaheadRef.current = { query: '', lastTypedAt: 0 };
  }

  function selectOption(optionIndex: number) {
    setIsOpen(false);
    onSelectState(options[optionIndex].code);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openPicker();
      else setActiveOptionIndex((currentIndex) => (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      openPicker(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) selectOption(activeOptionIndex);
      else openPicker();
    } else if (event.key === 'Escape') {
      if (isOpen) event.preventDefault();
      setIsOpen(false);
    } else if (event.key === 'Tab') {
      setIsOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const typedAt = Date.now();
      const previousQuery = typedAt - typeaheadRef.current.lastTypedAt < 700 ? typeaheadRef.current.query : '';
      const typedCharacter = event.key.toLocaleLowerCase();
      const query = previousQuery === typedCharacter ? typedCharacter : previousQuery + typedCharacter;
      typeaheadRef.current = { query, lastTypedAt: typedAt };
      const currentOptionIndex = isOpen ? activeOptionIndex : selectedOptionIndex;
      const searchStartIndex = currentOptionIndex - (query.length > 1 ? 1 : 0);
      if (!isOpen) setActiveOptionIndex(selectedOptionIndex);

      for (let offset = 1; offset <= options.length; offset += 1) {
        const optionIndex = (searchStartIndex + offset) % options.length;
        if (options[optionIndex].name.toLocaleLowerCase().startsWith(query)) {
          setActiveOptionIndex(optionIndex);
          break;
        }
      }
      setIsOpen(true);
    }
  }

  return <div className="state-picker" ref={pickerRef} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
  }}>
    <button
      id="state-selector"
      className="state-picker-trigger"
      ref={selectorButtonRef}
      type="button"
      role="combobox"
      aria-label="Choose a state"
      aria-describedby={`${listboxId}-value`}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      aria-controls={listboxId}
      aria-activedescendant={isOpen ? `${listboxId}-option-${activeOptionIndex}` : undefined}
      onClick={() => isOpen ? setIsOpen(false) : openPicker()}
      onKeyDown={handleKeyDown}
    >
      <Search size={15} aria-hidden="true" />
      <span id={`${listboxId}-value`}>{selectedStateName}</span>
      <ChevronDown size={13} className="state-picker-chevron" aria-hidden="true" />
    </button>
    {isOpen && <div className="state-picker-listbox" id={listboxId} ref={listboxRef} role="listbox" aria-label="States">
      {options.map((option, optionIndex) => <div
        className="state-picker-option"
        id={`${listboxId}-option-${optionIndex}`}
        key={option.code ?? 'all-states'}
        role="option"
        aria-selected={optionIndex === selectedOptionIndex}
        data-active={optionIndex === activeOptionIndex}
        onPointerMove={() => setActiveOptionIndex(optionIndex)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectOption(optionIndex)}
      >
        <span>{option.name}</span>
        {optionIndex === selectedOptionIndex && <Check size={13} aria-hidden="true" />}
      </div>)}
    </div>}
  </div>;
}
