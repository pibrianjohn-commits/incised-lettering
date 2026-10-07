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
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
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
