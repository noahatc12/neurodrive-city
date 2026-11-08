/**
 * Camera mode chips for the 3D view (spec M: bottom-right). One chip per camera mode;
 * the active chip is highlighted and `aria-pressed`. The C key cycles modes.
 * @module ui/cameraChips
 */
import type { CameraMode } from '../app/renderer.ts';
import { h } from './dom.ts';

export const CAMERA_MODES: readonly { id: CameraMode; label: string; tip: string }[] = [
  { id: 'chase', label: 'Chase', tip: 'Follow behind the focused car' },
  { id: 'orbit', label: 'Orbit', tip: 'Drag to orbit, wheel to zoom, right-drag to pan' },
  { id: 'top', label: 'Top', tip: 'High top-down camera' },
  { id: 'cinematic', label: 'Cinematic', tip: 'Slow auto-orbit between interesting cars' },
];

export class CameraChips {
  readonly el: HTMLElement;
  private readonly buttons = new Map<CameraMode, HTMLButtonElement>();

  constructor(onSelect: (mode: CameraMode) => void) {
    const chips = CAMERA_MODES.map((m) => {
      const b = h('button', {
        class: 'btn chip',
        type: 'button',
        text: m.label,
        title: `${m.tip} (C cycles)`,
        aria: { pressed: 'false' },
        data: { camera: m.id },
        onclick: () => onSelect(m.id),
      });
      this.buttons.set(m.id, b);
      return b;
    });
    this.el = h(
      'div',
      { class: 'camera-chips glass hidden', role: 'toolbar', aria: { label: 'Camera mode' } },
      ...chips,
    );
  }

  set(mode: CameraMode): void {
    for (const [id, b] of this.buttons) {
      b.classList.toggle('active', id === mode);
      b.setAttribute('aria-pressed', String(id === mode));
    }
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }
}

/** The next mode in the cycle order. */
export function nextCameraMode(mode: CameraMode): CameraMode {
  const i = CAMERA_MODES.findIndex((m) => m.id === mode);
  return (CAMERA_MODES[(i + 1) % CAMERA_MODES.length] as { id: CameraMode }).id;
}
