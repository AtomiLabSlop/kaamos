import { useMemo } from 'react';
import { useUI } from '../store/ui';
import { APP_VERSION } from '../lib/version';
import { systemInfoLine } from '../lib/systemInfo';
import { CHANGELOG } from '../lib/changelog';
import { Button, Modal } from './controls';

/**
 * Where the feedback button goes. Empty means no button is shown (a button
 * without a destination would be a dead control). `{system}` anywhere in the
 * address is replaced with the URL-encoded system line, so a form can have that
 * field filled in for the user: a Google Forms "pre-filled link"
 * (…/viewform?usp=pp_url&entry.123456={system}) or a Tally hidden field
 * (…?system={system}). README "Feedback and known limitations".
 */
export const FEEDBACK_URL = 'https://tally.so/r/0VQWxA?system={system}';

/** The public source (AGPL-3.0 asks that users of the hosted app can reach it). */
export const SOURCE_URL = 'https://github.com/AtomiLabSlop/kaamos';

/** Buy Me a Coffee page for supporting the project. Empty hides the section. */
export const SUPPORT_URL = 'https://www.buymeacoffee.com/atomilabslop';

/** Where things can go wrong. Keep it short and true. */
const LIMITATIONS: string[] = [
  'Desktop browsers only, tested mostly in Chrome and Safari on a Mac.',
  'Path tracing leans on the graphics chip. A large scene, a large output or a long render can make it reset; a render then carries on from where it was.',
  'Models over about a million triangles slow the view, and a large import pauses the page.',
  'Subsurface scattering, glass seen through glass and light from glowing materials show only in path traced views.',
  'Textures that come with an imported file are kept but cannot be edited.',
  'Projects are saved as files on your computer; the automatic backup lives only in this browser.',
];

/** Ideas, not promises. */
const MAYBE_LATER: string[] = [
  'Editing the textures that come with an imported file.',
  'Turntable animations.',
  'Faster path tracing on WebGPU.',
  'A smoother view for very large models.',
];

export function AboutDialog() {
  const open = useUI((state) => state.aboutOpen);
  const setOpen = useUI((state) => state.setAboutOpen);
  const system = useMemo(() => (open ? systemInfoLine() : ''), [open]);
  if (!open) return null;

  const close = () => setOpen(false);
  const sendFeedback = () => {
    const url = FEEDBACK_URL.split('{system}').join(encodeURIComponent(system));
    window.open(url, '_blank', 'noopener');
  };

  return (
    <Modal
      title={`About Kaamos ${APP_VERSION}`}
      onClose={close}
      size="L"
      closeOnOutsideClick
      dismissible={false}
    >
      <div className="flex flex-col gap-3">
        <p>
          Product renders in your browser: import a model, give it materials and light, render a
          high-resolution image.{' '}
          <span className="text-ink">Your models stay on this computer; nothing is uploaded.</span>{' '}
          Open source (AGPL-3.0):{' '}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener"
            className="text-amber underline underline-offset-2 hover:brightness-110"
          >
            source code on GitHub
          </a>
          .
        </p>

        <section>
          <h3 className="mb-1 text-label text-ink-faint">Known limitations</h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {LIMITATIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 text-label text-ink-faint">Maybe later</h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {MAYBE_LATER.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-1 text-label text-ink-faint">What’s new</h3>
          <div className="flex flex-col gap-2">
            {CHANGELOG.map((entry) => (
              <div key={entry.version}>
                <p className="text-ink">
                  {entry.version}
                  <span className="text-ink-faint"> · {entry.date}</span>
                </p>
                <ul className="flex list-disc flex-col gap-0.5 pl-4">
                  {entry.changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {FEEDBACK_URL && (
          <section>
            <h3 className="mb-1 text-label text-ink-faint">Feedback</h3>
            <p>
              What worked, what did not, what you would need to use it for real work. This
              line goes with the form, as most problems depend on the browser and graphics:
            </p>
            <p className="mt-1 rounded-sm bg-well px-1.5 py-1 font-mono text-label text-ink select-all">
              {system}
            </p>
          </section>
        )}

        <div className="mt-2 mb-4 flex gap-2">
          {FEEDBACK_URL && (
            <Button tone="primary" onClick={sendFeedback} tip="Opens the feedback form in a new tab">
              Send feedback
            </Button>
          )}
          <Button onClick={close}>Close</Button>
        </div>

        {SUPPORT_URL && (
          <section>
            <h3 className="mb-1 text-label text-ink-faint">Support me</h3>
            <p>
              If you find my open-source projects useful, you can support the time and care
              that goes into maintaining and improving them by buying me a coffee. It’s entirely
              optional, but always appreciated :)
            </p>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener"
              className="mt-2 inline-block hover:brightness-110"
            >
              <img
                src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
                alt="Buy Me a Coffee"
                width={200}
                height={56}
                referrerPolicy="no-referrer"
                className="block h-auto"
              />
            </a>
          </section>
        )}
      </div>
    </Modal>
  );
}
