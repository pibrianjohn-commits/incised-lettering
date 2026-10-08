// Which version of the app this is (vite.config.ts): the number of the last
// pull request merged, and when it was published. It is shown in the status
// bar and the ? list, so every screenshot says which version was running and
// an out-of-date copy is plain to see. The page and the 3D worker each carry
// it, so a problem's Details can show that the two belong together.

declare const __APP_VERSION__: string;
declare const __APP_PUBLISHED__: string;

/** The version's number, e.g. "22". */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'in development';

/** When it was published, UK time, e.g. "8 Oct 2026, 21:40" (empty if not known). */
export const APP_PUBLISHED: string = typeof __APP_PUBLISHED__ === 'string' ? __APP_PUBLISHED__ : '';

/** "Version 22, published 8 Oct 2026, 21:40". */
export const VERSION_TEXT = `Version ${APP_VERSION}${APP_PUBLISHED ? `, published ${APP_PUBLISHED}` : ''}`;
