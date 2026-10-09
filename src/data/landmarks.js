// Hand-made set pieces stamped into each region's procedural map, so every
// run has a few memorable places worth walking to. Each one is a small ASCII
// template that can be mirrored and rotated.
//
// Legend
//   ' ' untouched (the generator fills it in, which keeps edges organic)
//   '.' open ground    ':' dirt    's' flagstone
//   '#' wall           'P' pillar  'T' tree    '~' the region's pool (ice / lava)
//   '?' broken wall: wall or flagstone (50/50)
//   'C' chest          'F' brazier (a light you can smash for loot)
//   'K' campfire (keeps you warm in the tundra)
//   'B' bones          'G' grave
// `guard`: an elite pack waits here and wakes when you come close.

export const LANDMARKS = {
  forest: [
    {
      id: 'stones',
      name: 'Standing Stones',
      chest: 'rare',
      guard: true,
      rows: [
        '    P . P    ',
        '  P ..... P  ',
        ' . .:::::. . ',
        'P .:sssss:. P',
        ' ..:sFCFs:.. ',
        'P .:sssss:. P',
        ' . .:::::. . ',
        '  P ..... P  ',
        '    P . P    ',
      ],
    },
    {
      id: 'chapel',
      name: 'Ruined Chapel',
      chest: 'epic',
      guard: false,
      rows: [
        '  G   G   G  ',
        ' ###?###?### ',
        ' #sssFCFsss# ',
        ' #sPsssssPs# ',
        ' #sssssssss? ',
        ' ?sPsssssPs# ',
        ' #sssssssss# ',
        ' ####sss#### ',
        '   ::sss::   ',
        '     :::     ',
      ],
    },
  ],
  snow: [
    {
      id: 'icemere',
      name: 'Icebound Shrine',
      chest: 'epic',
      guard: true,
      rows: [
        '   ~~~~~~~   ',
        ' ~~~~~~~~~~~ ',
        '~~~~~sss~~~~~',
        '~~~~sFCFs~~~~',
        '~~~~sssss~~~~',
        '~~~~~sss~~~~~',
        ' ~~~~~:~~~~~ ',
        '   ~~~:~~~   ',
        '      :      ',
      ],
    },
    {
      id: 'palisade',
      name: 'Abandoned Camp',
      chest: 'rare',
      guard: false,
      rows: [
        '  ?#?   ?#?  ',
        ' #:::::::::# ',
        '?:::F:::F:::?',
        '#:::::K:::::#',
        '?::::::::C::?',
        ' #:::::::::# ',
        '  ?#?:::?#?  ',
        '     :::     ',
      ],
    },
  ],
  volcano: [
    {
      id: 'bridge',
      name: 'Obsidian Bridge',
      chest: 'epic',
      guard: true,
      rows: [
        '~~~~~~~~~~~~~',
        '~~~~sssss~~~~',
        '~~~sFsCsFs~~~',
        '~~~sssssss~~~',
        '~~~~sssss~~~~',
        '~~~~~~s~~~~~~',
        '~~~~~~s~~~~~~',
        '~~~~~~s~~~~~~',
        '     :::     ',
      ],
    },
    {
      id: 'forge',
      name: 'Ashen Forge',
      chest: 'rare',
      guard: false,
      rows: [
        ' #####?##### ',
        ' #sssssssss# ',
        ' #sF~~~~~Fs# ',
        ' #sss~~~sss# ',
        ' #ssssCssss# ',
        ' #sssssssss# ',
        ' ####sss#### ',
        '    :sss:    ',
      ],
    },
  ],
  // Crypt set pieces fill the inside of a room.
  crypt: [
    {
      id: 'ossuary',
      name: 'Ossuary',
      chest: 'rare',
      guard: false,
      rows: [
        'BPsBsPB',
        'sssssss',
        'PsFCFsP',
        'sssssss',
        'BPsBsPB',
      ],
    },
    {
      id: 'sarcophagi',
      name: 'Hall of Sarcophagi',
      chest: 'epic',
      guard: true,
      rows: [
        'PsssssP',
        's#sss#s',
        'ssFCFss',
        's#sss#s',
        'PsssssP',
      ],
    },
  ],
};

/** Mirror and/or rotate a template (rows of equal length). */
export function orient(rows, { flipX = false, flipY = false, transpose = false } = {}) {
  let out = rows.map((r) => r.split(''));
  if (transpose) out = out[0].map((_, x) => out.map((row) => row[x]));
  if (flipX) out = out.map((r) => r.reverse());
  if (flipY) out = out.reverse();
  return out.map((r) => r.join(''));
}
