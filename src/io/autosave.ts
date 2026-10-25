import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { frameAll } from '../scene/viewportApi';
import { registry } from '../scene/registry';
import {
  loadProjectFile,
  serializeProject,
  type ProjectAsset,
  type ProjectFile,
} from './projectFile';

/**
 * Automatic backup of the working copy, kept in this browser (IndexedDB).
 *
 * It exists for the accidents: a closed tab, a refresh, a crash. It is not a
 * saved file and does not replace one. The project's settings are written as a
 * small record each time; the source files (models, environment, images) are big
 * and never change, so each is written once and only removed when nothing uses
 * it. On the next start the app offers to restore the backup, and nothing is
 * written until that question is answered, so a fresh empty page cannot
 * overwrite the backup it is about to offer.
 */

const DB_NAME = 'kaamos-autosave';
const STORE = 'kv';
const STATE_KEY = 'state';
const DELAY_MS = 5000;

interface AutosaveRecord {
  savedAt: number;
  name: string;
  models: number;
  file: ProjectFile;
  assets: string[];
}

const assetId = (asset: Pick<ProjectAsset, 'kind' | 'key'>) => `asset:${asset.kind}:${asset.key}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const read = <T>(key: string) => run<T | undefined>('readonly', (store) => store.get(key));
const write = (key: string, value: unknown) => run('readwrite', (store) => store.put(value, key));
const remove = (key: string) => run('readwrite', (store) => store.delete(key));
const allKeys = () => run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());

let armed = false;
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failed = false;
/** Assets known to be in the database already, so they are not written twice. */
const stored = new Set<string>();

async function saveNow() {
  if (!armed || failed) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const state = useProject.getState();
    if (state.modelOrder.length === 0) {
      // Nothing worth keeping; drop an old backup so it is not offered later.
      await clearAutosave();
      return;
    }
    const { file, assets } = serializeProject(false);
    const wanted = new Set<string>();
    for (const asset of assets) {
      const id = assetId(asset);
      wanted.add(id);
      if (!stored.has(id)) {
        await write(id, asset.bytes);
        stored.add(id);
      }
    }
    const record: AutosaveRecord = {
      savedAt: Date.now(),
      name: state.name,
      models: state.modelOrder.length,
      file,
      assets: [...wanted],
    };
    await write(STATE_KEY, record);
    for (const key of await allKeys()) {
      if (typeof key === 'string' && key.startsWith('asset:') && !wanted.has(key)) {
        await remove(key);
        stored.delete(key);
      }
    }
    useUI.getState().markAutosaved();
  } catch (error) {
    // Private browsing or a full disk. Say so once; the app carries on.
    failed = true;
    console.warn('Autosave stopped', error);
    useUI
      .getState()
      .toast('warn', 'Autosave is not available', 'This browser would not keep a backup. Save the project to a file.');
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule() {
  if (!armed || failed) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void saveNow();
  }, DELAY_MS);
}

/**
 * Puts back into memory the source file of any model whose copy has gone from
 * the registry, from the automatic backup. Returns the names that could not be
 * recovered, each with the reason, so a save can say why instead of guessing.
 */
export async function rescueModelFiles(): Promise<string[]> {
  const problems: string[] = [];
  const state = useProject.getState();
  for (const id of state.modelOrder) {
    const model = state.models[id];
    if (!model || model.source !== 'file') continue;
    const have = registry.getFile(model.fileKey);
    if (have && have.bytes.byteLength > 0) continue;
    const why = have ? 'its copy in memory is empty' : 'its copy in memory is gone';
    try {
      const bytes = await read<ArrayBuffer>(assetId({ kind: 'model', key: model.id }));
      if (bytes && bytes.byteLength > 0 && model.fileKey && model.fileName && model.format) {
        registry.putFile(model.fileKey, { bytes, name: model.fileName, format: model.format });
        continue;
      }
      problems.push(`${model.name} (${why}, and the backup has no copy)`);
    } catch {
      problems.push(`${model.name} (${why}, and the backup could not be read)`);
    }
  }
  return problems;
}

export async function clearAutosave() {
  try {
    for (const key of await allKeys()) await remove(String(key));
    stored.clear();
  } catch {
    /* nothing to clear */
  }
}

async function restoreAutosave(record: AutosaveRecord) {
  const ui = useUI.getState();
  ui.setBusy('Restoring the backup…');
  registry.hold();
  try {
    const assets = new Map<string, ArrayBuffer>();
    for (const id of record.assets) {
      const bytes = await read<ArrayBuffer>(id);
      if (bytes) {
        assets.set(id.split(':').slice(2).join(':'), bytes);
        stored.add(id);
      }
    }
    const report = await loadProjectFile(record.file, assets);
    ui.selectNode(null);
    ui.selectLight(null);
    requestAnimationFrame(() => {
      const framing = frameAll();
      if (framing) useProject.getState().updateCamera({ orthoZoom: framing.orthoZoom }, 'frame');
    });
    ui.toast(
      report.warnings.length > 0 ? 'warn' : 'success',
      `Restored ${report.name}`,
      report.warnings.length > 0
        ? report.warnings.join(' ')
        : 'From the automatic backup. Save the project to a file to keep it.',
    );
    useUI.setState({ unsaved: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ui.toast('error', 'Could not restore the backup', detail);
  } finally {
    registry.release();
    ui.setBusy(null);
  }
}

const formatWhen = (ms: number) =>
  new Date(ms).toLocaleString('fi-FI', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const CONTENT_KEYS = [
  'nodes',
  'models',
  'modelOrder',
  'materials',
  'materialOrder',
  'lights',
  'environment',
  'camera',
  'viewpoints',
  'render',
  'name',
] as const;

/** Starts the backup. Call once, when the app mounts. Returns a function that stops it. */
export function startAutosave() {
  const unsubscribe = useProject.subscribe((state, previous) => {
    if (CONTENT_KEYS.every((key) => state[key] === previous[key])) return;
    useUI.getState().markUnsaved();
    schedule();
  });

  const flush = () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      timer = null;
      void saveNow();
    }
  };
  document.addEventListener('visibilitychange', flush);

  const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
    if (useUI.getState().unsaved && useProject.getState().modelOrder.length > 0) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', warnBeforeLeaving);

  let stopped = false;
  void (async () => {
    let record: AutosaveRecord | undefined;
    try {
      record = await read<AutosaveRecord>(STATE_KEY);
    } catch {
      failed = true;
      return;
    }
    if (stopped) return;
    if (!record || record.models === 0 || useProject.getState().modelOrder.length > 0) {
      armed = true;
      return;
    }
    const found = record;
    useUI.getState().confirm({
      title: 'Restore the previous session?',
      body:
        `Kaamos kept an automatic backup of "${found.name}" from ${formatWhen(found.savedAt)}, ` +
        'which was not saved to a file. Restore it? Cancel throws the backup away.',
      confirmLabel: 'Restore',
      onConfirm: () => {
        armed = true;
        void restoreAutosave(found);
      },
      onCancel: () => {
        armed = true;
        void clearAutosave();
      },
    });
  })();

  return () => {
    stopped = true;
    unsubscribe();
    document.removeEventListener('visibilitychange', flush);
    window.removeEventListener('beforeunload', warnBeforeLeaving);
    if (timer) clearTimeout(timer);
  };
}
