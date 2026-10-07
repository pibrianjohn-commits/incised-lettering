// Ctrl+K: a search box for every command and setting. Type a few letters,
// pick from the list with the arrow keys or the mouse, and Enter does it.

export interface Command {
  label: string;
  /** Shown faintly on the right: the stage, or the key that does the same. */
  hint?: string;
  /** Extra words it can be found by. */
  words?: string;
  run(): void;
}

/**
 * How well `query` matches `text`: higher is better, -1 is no match. Every
 * letter typed must appear in order; whole words and word starts count most.
 */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return 1000 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return (/\W/.test(t[at - 1] ?? ' ') ? 800 : 600) - at;
  // Every word of the query found somewhere.
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 500 - t.length;
  // The letters in order, anywhere.
  let i = 0;
  let gaps = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    else if (i > 0) gaps++;
    if (i === q.length) return 200 - gaps;
  }
  return -1;
}

export function rankCommands(query: string, commands: Command[], limit = 12): Command[] {
  if (!query.trim()) return commands.slice(0, limit);
  return commands
    .map((c, i) => ({ c, i, s: Math.max(matchScore(query, c.label), matchScore(query, `${c.label} ${c.words ?? ''} ${c.hint ?? ''}`) - 50) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.c);
}

/** Open the search box over `dialog`, with the commands `list()` gives at the time. */
export function openPalette(dialog: HTMLDialogElement, list: () => Command[]) {
  const input = dialog.querySelector<HTMLInputElement>('#palette-input')!;
  const ul = dialog.querySelector<HTMLUListElement>('#palette-list')!;
  const all = list();
  let shown: Command[] = [];
  let at = 0;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const render = () => {
    shown = rankCommands(input.value, all);
    at = Math.min(at, Math.max(0, shown.length - 1));
    ul.innerHTML = shown.length
      ? shown
          .map(
            (c, i) =>
              `<li role="option" data-i="${i}" class="${i === at ? 'on' : ''}" aria-selected="${i === at}"><span>${esc(c.label)}</span>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</li>`,
          )
          .join('')
      : '<li class="none">Nothing found</li>';
    ul.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    dialog.close();
    c.run();
  };
  input.value = '';
  at = 0;
  render();
  input.oninput = () => {
    at = 0;
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(shown[at]);
    }
  };
  ul.onclick = (e) => {
    const li = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (li) run(shown[Number(li.dataset.i)]);
  };
  ul.onpointermove = (e) => {
    const li = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (li && Number(li.dataset.i) !== at) {
      at = Number(li.dataset.i);
      ul.querySelectorAll('li').forEach((el, i) => el.classList.toggle('on', i === at));
    }
  };
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close(); // a click outside the box
  };
  dialog.showModal();
  input.focus();
}
