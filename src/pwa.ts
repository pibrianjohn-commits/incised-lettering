// The installed app: the offline worker, and the "Install app" button.
//
// Chrome and Edge offer to install the site as an app that opens in its own
// window, with its own icon, and works without the internet (the offline
// worker keeps a copy of every file; see pwa/sw.js).

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function startApp(ui: {
  /** Install is possible now (show the button), or no longer (hide it). */
  installable(install: (() => Promise<void>) | null): void;
}) {
  // Only the published build has the offline worker; the development server doesn't.
  // Its own file is always checked with the server, never the browser's store of files.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {
        /* no offline copy this time; the app still works online */
      });
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // offer it from our own button instead
    const prompt = e as InstallPrompt;
    ui.installable(async () => {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') ui.installable(null);
    });
  });
  window.addEventListener('appinstalled', () => ui.installable(null));
}

/**
 * Refresh the app: let the offline worker look for a newer version, then open
 * the page again. When online the page always comes fresh from the server
 * (pwa/sw.js), so this brings the newest version; offline, the saved copy,
 * whose files all belong together.
 */
export async function refreshApp() {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  await Promise.race([reg?.update().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  location.reload();
}

/** One of the app's own files could not be had, either way. */
export class AppFileError extends Error {
  constructor(
    readonly url: string,
    /** What happened each time, in a line each. */
    readonly tries: string[],
  ) {
    super(`${url} could not be loaded`);
  }
}

/**
 * One of the app's own files: as usual (the offline copy, the browser's store
 * of files or the server), and if that fails, fresh from the server.
 */
export async function fetchAppFile(url: string): Promise<Response> {
  const tries: string[] = [];
  for (const [cache, how] of [
    ['default', 'As usual'],
    ['reload', 'Fresh from the server'],
  ] as const) {
    try {
      const res = await fetch(url, { cache });
      if (res.ok) return res;
      tries.push(`${how}: the server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    } catch (err) {
      tries.push(`${how}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new AppFileError(url, tries);
}

/** The offline copies this browser holds, for a problem's Details. */
export async function savedCopies(): Promise<string> {
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith('incised-lettering-'));
    const using = navigator.serviceWorker?.controller ? 'in use' : 'not in use';
    return `${using}; copies saved: ${names.map((n) => n.replace('incised-lettering-', '')).join(', ') || 'none'}`;
  } catch {
    return 'not available in this window';
  }
}

/** True when running as the installed app, in its own window. */
export function runningAsApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

/** When the installed app is opened by double-clicking a project file, hand the file over. */
export function onFileLaunch(open: (file: File, handle: unknown) => void) {
  const lq = (window as unknown as { launchQueue?: { setConsumer(f: (p: LaunchParams) => void): void } }).launchQueue;
  lq?.setConsumer(async (params) => {
    const handle = params.files[0];
    if (handle) open(await handle.getFile(), handle);
  });
}
