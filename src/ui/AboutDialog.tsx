import { useMemo } from 'react';
import { useUI } from '../store/ui';
import { APP_VERSION } from '../lib/version';
import { systemInfoLine } from '../lib/systemInfo';
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

/** What an early user should know before relying on Kaamos. Keep it short and true. */
const LIMITATIONS: string[] = [
  'Desktop browsers only. Built and tested mostly in Chrome and Safari on a Mac; Windows, Linux and Firefox have had less testing.',
  'Path traced renders lean on the graphics chip. On weak or integrated graphics a large scene or a large output can lose the graphics context; use fewer samples or a smaller size.',
  'Models over about a million triangles make the view slow, and a large import pauses the page while it is read.',
  'Subsurface scattering (wax, skin, jade, marble, milk) is new, shows only in path traced views, and needs closed meshes.',
  'Glass seen through glass, and light cast by glowing materials, show only in path traced views.',
  'Textures that come with an imported file are kept, but the material editor cannot show or edit them; giving the part a library material replaces them.',
  'Your work is saved as a project file on your own computer. The automatic backup lives only in this browser.',
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
      wide
      footer={
        <>
          {FEEDBACK_URL && (
            <Button tone="primary" onClick={sendFeedback} tip="Opens the feedback form in a new tab">
              Send feedback
            </Button>
          )}
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p>
          Kaamos is a product rendering studio that runs in your browser: import a model,
          give it materials, light it and render an image.{' '}
          <span className="text-ink">
            Your models never leave this computer; nothing is uploaded.
          </span>{' '}
          Kaamos is open source (AGPL-3.0):{' '}
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
          <h3 className="mb-1 text-label text-ink-faint">Early version — known limitations</h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {LIMITATIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
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
      </div>
    </Modal>
  );
}
