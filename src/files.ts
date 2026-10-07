// Saving and opening files on the laptop. Where the browser allows it (Chrome
// and Edge, and the installed app), Save asks where once and then writes
// straight back to the same file; elsewhere each save goes to the Downloads
// folder.

export interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

interface Pickers {
  showSaveFilePicker?(o: unknown): Promise<FileHandle>;
  showOpenFilePicker?(o: unknown): Promise<FileHandle[]>;
}

export interface FileKind {
  description: string;
  type: string;
  extension: string;
}

const pickers = () => window as unknown as Pickers;
const cancelled = (e: unknown) => (e as DOMException)?.name === 'AbortError';

/** Download text as a file (to the Downloads folder). */
export function download(text: string | Blob, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save text. With a handle, it goes back into that file; without one, the
 * carver chooses where. The text can be given as a function, worked out only
 * once the place is chosen. Returns the file's name and handle, or null if
 * the carver cancelled.
 */
export async function saveFile(
  text: string | (() => Promise<string>),
  o: FileKind & { suggestedName: string; handle: FileHandle | null },
): Promise<{ name: string; handle: FileHandle | null } | null> {
  const p = pickers();
  const body = () => (typeof text === 'string' ? Promise.resolve(text) : text());
  if (p.showSaveFilePicker) {
    try {
      let handle = o.handle;
      if (handle?.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') handle = null;
      handle ??= await p.showSaveFilePicker({
        suggestedName: o.suggestedName,
        types: [{ description: o.description, accept: { [o.type]: [o.extension] } }],
      });
      const out = await handle.createWritable();
      await out.write(await body());
      await out.close();
      return { name: handle.name, handle };
    } catch (e) {
      if (cancelled(e)) return null;
      // Anything else (no permission, a locked file): fall back to a download.
    }
  }
  download(await body(), o.suggestedName, o.type);
  return { name: o.suggestedName, handle: null };
}

/** Let the carver choose a file to open. Null if they cancelled. */
export async function chooseFile(fallback: HTMLInputElement, kind: FileKind): Promise<{ file: File; handle: FileHandle | null } | null> {
  const p = pickers();
  if (p.showOpenFilePicker) {
    try {
      const [handle] = await p.showOpenFilePicker({
        multiple: false,
        types: [{ description: kind.description, accept: { 'application/json': [kind.extension, '.json'] } }],
      });
      return { file: await handle.getFile(), handle };
    } catch (e) {
      if (cancelled(e)) return null;
    }
  }
  return new Promise((resolve) => {
    fallback.onchange = () => {
      const file = fallback.files?.[0];
      fallback.value = '';
      resolve(file ? { file, handle: null } : null);
    };
    fallback.oncancel = () => resolve(null);
    fallback.click();
  });
}

/** A picture (Blob) as text that can go inside a project file, and back. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}
