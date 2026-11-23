/**
 * What changed, for the About dialog. Newest first, in plain words a user
 * would care about; internal refactors stay out. Add an entry with every
 * release that changes something a user can see or rely on.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.01.1',
    date: '23 Nov 2026',
    changes: [
      'Long path traced renders carry on after the graphics chip resets, instead of failing.',
      'The camera and the focus stay where they were when the view is rebuilt.',
      'A shorter About, with this list.',
    ],
  },
  {
    version: '2.00.25',
    date: '1 Nov 2026',
    changes: [
      'Bump maps show in path traced renders.',
      'A comma works as a decimal point in number fields.',
    ],
  },
  {
    version: '2.00.21',
    date: '28 Oct 2026',
    changes: ['3MF import.'],
  },
  {
    version: '2.00.16',
    date: '27 Oct 2026',
    changes: [
      'Depth of field focuses on a flat plane in path traced views too.',
      'A pause button for the path traced preview, and a camera position panel.',
    ],
  },
  {
    version: '2.00.0',
    date: '26 Oct 2026',
    changes: ['A new interface built on Adobe Spectrum 2.'],
  },
];
