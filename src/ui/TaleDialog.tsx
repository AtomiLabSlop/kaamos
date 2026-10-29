import { useEffect } from 'react';
import { useUI } from '../store/ui';
import { POPOVER_WIDTH } from './controls';
import '@fontsource/pinyon-script/latin-400.css';
import backgroundUrl from '../assets/kaamos-tale-bg.jpg';

/** Width / height of the background picture. */
const PICTURE_ASPECT = 2242 / 2806;

const STORY = [
  'It was a dark October. Not exactly stormy, but dark, and the real polar night hadn’t even started yet. One designer, one cup of coffee and one AI decided to build something nobody had asked for: a render studio that runs in the browser.',
  'The world did not applaud. Spam filters removed the first posts. Some said no machine could ever make anything good. Others suspected the models were being stolen. Many judged, few believed.',
  'But Kaamos did not give up. It had Finnish sisu, a bag of salmiakki and a very specific shade of amber (#FAAF57, and absolutely nothing blue). It rose like a proper Finnish rye bread: slowly, dense, and in spite of everyone’s doubts.',
  'Now it runs on your own graphics card, and your models never leave your computer. Free, open source and slightly stubborn. Just as the north intended.',
];

const QUOTES = [
  'You built it?',
  'Get that slop out of here.',
  'you clearly haven\'t considered your customer acquisition pipeline and market positioning',
  'Can we please get a rule against vibe coded slop apps',
  'Why do all AI generated apps have the same look',
  'Kaamos and atomilab are both really shit names',
  'useless for any Rhino power user.',
  'someone make it stoooop',
  'the f*cking ai responses dude',
];

/** A thin amber line, like the ones on the bottle label. */
function Rule({ style }: { style?: React.CSSProperties }) {
  return <div style={{ width: '22cqw', height: 1, flexShrink: 0, background: 'var(--color-amber)', opacity: 0.8, ...style }} />;
}

/**
 * The story a click on the logo opens: a misty background with the text over
 * it in Kaamos amber, as wide as the About window with the same rounded
 * corners. Sizes are in container units, so the text scales with the window and
 * always fits the picture. A press anywhere, or Esc, closes it.
 */
export function TaleDialog() {
  const open = useUI((state) => state.taleOpen);
  const setOpen = useUI((state) => state.setTaleOpen);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The Tale of Kaamos"
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/45 p-4"
    >
      <div
        className="relative overflow-hidden rounded-2xl bg-[#1c1d1f] text-amber"
        // The About width, or less when the window is too short to show the whole picture.
        style={{
          width: `min(${POPOVER_WIDTH}px, calc((100vh - 32px) * ${PICTURE_ASPECT}), calc(100vw - 32px))`,
          aspectRatio: `${PICTURE_ASPECT}`,
          containerType: 'inline-size',
        }}
      >
        <img src={backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute inset-0 flex flex-col items-center text-center"
          style={{ padding: '9cqw 9cqw 7cqw' }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "'Pinyon Script', cursive",
              fontWeight: 400,
              fontSize: '9.5cqw',
              lineHeight: 1,
            }}
          >
            The Tale of Kaamos
          </h2>
          <Rule style={{ margin: '4.5cqw 0 5cqw' }} />
          <div style={{ fontSize: '2.2cqw', lineHeight: 1.6 }}>
            {STORY.map((paragraph) => (
              <p key={paragraph.slice(0, 12)} style={{ margin: '0 0 2.2cqw' }}>
                {paragraph}
              </p>
            ))}
          </div>
          <div className="mt-auto flex w-full flex-col items-center">
            <Rule style={{ margin: '0 0 3.5cqw' }} />
            <p aria-label="1 star out of 5" style={{ margin: '0 0 2cqw', fontSize: '2.8cqw', letterSpacing: '0.3em', paddingLeft: '0.3em' }}>
              ★☆☆☆☆
            </p>
            <div style={{ fontSize: '1.9cqw', lineHeight: 1.5, letterSpacing: '0.02em' }}>
              {QUOTES.map((quote) => (
                <p key={quote} style={{ margin: '0 0 0.6cqw' }}>
                  “{quote}”
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
