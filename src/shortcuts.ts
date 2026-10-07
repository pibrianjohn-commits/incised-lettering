// Every keyboard shortcut and mouse action, for the ? list.

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Stages and views',
    items: [
      ['1 – 5', 'Write, Space, Panel, Machine, 3D'],
      ['Shift + 1 – 4', 'View: Design, Spacing, Setting-out, Proof'],
      ['I', 'Show or hide the inspection panel'],
      ['Z', 'Zoom to the whole panel'],
      ['Shift + Z', 'True size'],
      ['Esc', 'Close a box, clear the selection, or leave the 3D view'],
    ],
  },
  {
    group: 'Finding things',
    items: [
      ['Ctrl + K', 'Find any command or setting'],
      ['?', 'This list'],
      ['Click the problems badge', 'Every problem, each with buttons that put it right'],
    ],
  },
  {
    group: 'Files',
    items: [
      ['Ctrl + S', 'Save the project'],
      ['Ctrl + Shift + S', 'Save the project as a new file'],
      ['Ctrl + O', 'Open a project'],
      ['Ctrl + P', 'Bench sheet, to print'],
    ],
  },
  {
    group: 'Changes',
    items: [
      ['Ctrl + Z', 'Undo'],
      ['Ctrl + Shift + Z or Ctrl + Y', 'Redo'],
    ],
  },
  {
    group: 'Fitting',
    items: [
      ['F', 'Fit the lettering to the panel (as big as fits)'],
      ['Shift + F', 'Fit the panel to the lettering'],
    ],
  },
  {
    group: 'Lines',
    items: [
      ['Click a line', 'Select it: its tools appear beside it'],
      ['← ↑ → ↓', 'Nudge the selected line 0.1 mm'],
      ['Shift + arrows', 'Nudge it 1 mm'],
      ['Alt while dragging', 'Move a line freely, without snapping'],
      ['S', 'Turn snapping on or off'],
      ['[ / ]', 'Close or spread the selected line’s letters 0.1 mm (Shift: 1 mm)'],
      ['Drag an end of the selected line', 'Spread or close its letters; the other end, or the centre, stays put'],
      ['Click a blank line', 'Its height: ↑ / ↓ change it 0.5 mm (Shift: 5 mm), Delete removes it'],
    ],
  },
  {
    group: 'Spacing',
    items: [
      ['Click a gap', 'Its spacing controls appear beside it'],
      ['Alt + ← / →', 'Close or open the gap 0.1 mm'],
      ['Alt + Shift + ← / →', 'Close or open it 1 mm'],
      ['Tab / Shift + Tab', 'Next or previous gap'],
    ],
  },
  {
    group: 'Mouse',
    items: [
      ['Drag', 'Move the view'],
      ['Scroll', 'Zoom in or out at the pointer'],
      ['Drag from a ruler', 'Make a guide; drag it back to remove it'],
      ['M, then drag', 'Measure between two points'],
      ['Drag sideways on a setting’s name', 'Change its value (Shift for ten steps at a time)'],
    ],
  },
];
