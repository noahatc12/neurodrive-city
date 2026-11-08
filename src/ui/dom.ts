/**
 * Tiny DOM builder used by all UI components (no framework).
 *
 * ```ts
 * h('button', { class: 'btn', aria: { label: 'Undo' }, onclick: undo }, icon('undo'))
 * ```
 * @module ui/dom
 */

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  role?: string;
  tabIndex?: number;
  style?: Partial<Record<string, string>>;
  aria?: Record<string, string>;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
  onkeydown?: (e: KeyboardEvent) => void;
}

/** Creates an element with props and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.title) el.title = props.title;
  if (props.type) el.setAttribute('type', props.type);
  if (props.role) el.setAttribute('role', props.role);
  if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
  if (props.style)
    for (const [k, v] of Object.entries(props.style))
      if (v !== undefined) el.style.setProperty(k, v);
  if (props.aria) for (const [k, v] of Object.entries(props.aria)) el.setAttribute(`aria-${k}`, v);
  if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  const target: HTMLElement = el;
  if (props.onclick) target.addEventListener('click', props.onclick);
  if (props.oninput) target.addEventListener('input', props.oninput);
  if (props.onchange) target.addEventListener('change', props.onchange);
  if (props.onkeydown) target.addEventListener('keydown', props.onkeydown);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Parses trusted, static SVG markup into an element. */
export function svg(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild;
  if (!(el instanceof SVGElement)) throw new Error('invalid svg markup');
  return el;
}

/** Formats a number with fixed decimals and tabular alignment-friendly output. */
export function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
