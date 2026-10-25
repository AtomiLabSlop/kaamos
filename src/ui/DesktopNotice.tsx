import { useState } from 'react';
import { Button } from './controls';

/**
 * Kaamos is built for a mouse, a large screen and a desktop GPU: the
 * path tracer and big imports do not fit a phone's memory or its touch
 * controls. A phone, or any touch-first device, gets this notice first; it can
 * be dismissed for the visit, since a tablet with a mouse may do fine.
 */
function looksLikeMobile() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const phoneUa = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
  return phoneUa || (coarse && noHover) || window.innerWidth < 700;
}

export function DesktopNotice() {
  const [show, setShow] = useState(looksLikeMobile);
  if (!show) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="desktop-notice-title"
      className="fixed inset-0 z-200 grid place-items-center bg-shell p-6"
    >
      <div className="flex max-w-[360px] flex-col gap-3 text-ctl leading-snug text-ink">
        <h1 id="desktop-notice-title" className="text-[15px] font-medium">
          Kaamos needs a desktop browser
        </h1>
        <p className="text-ink-dim">
          Kaamos does not support phones or tablets. It needs a mouse, a large screen and a
          computer's graphics card, so on a mobile device it will be hard to use and large models
          or renders are likely to fail.
        </p>
        <p className="text-ink-dim">
          Open this page on a computer with a recent Chrome, Edge, Firefox or Safari.
        </p>
        <div>
          <Button onClick={() => setShow(false)}>Continue anyway</Button>
        </div>
      </div>
    </div>
  );
}
