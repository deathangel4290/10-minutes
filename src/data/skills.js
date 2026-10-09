// Active skills: found as loot (elites, the Colossus, treasure chests) and
// used with the Skill button. One slot; a better or different skill can be
// swapped in from the bag. Each one rewards moving into the fight.
//
// Cooldown skills recharge over time. Thunderstride is different: its charges
// refill only as you travel, so standing still leaves it empty.

export const SKILLS = {
  bloodrush: {
    id: 'bloodrush',
    name: 'Blood Rush',
    icon: 'drop',
    color: '#e0384a',
    cooldown: 9,
    desc: 'Dash-strike through foes for 160% damage and 3 bleeds. Each hit cuts 0.5s off the cooldown.',
  },
  thunderstride: {
    id: 'thunderstride',
    name: 'Thunderstride',
    icon: 'bolt',
    color: '#8fd3ff',
    charges: 3,
    chargeDistance: 130, // pixels travelled per charge
    desc: 'Blink ahead, leaving a lightning line that shocks anything crossing it. Charges refill as you travel.',
  },
  riftanchor: {
    id: 'riftanchor',
    name: 'Rift Anchor',
    icon: 'spiral',
    color: '#b68cff',
    cooldown: 13,
    anchorTime: 6,
    desc: 'Drop an anchor. Use again within 6s to rip back to it, blasting both places for 220% damage.',
  },
  wildfire: {
    id: 'wildfire',
    name: 'Wildfire Sprint',
    icon: 'flame',
    color: '#ff9a3c',
    cooldown: 14,
    duration: 4,
    desc: 'Run 40% faster for 4s, leaving fire that ignites foes. Kills while sprinting cut the cooldown.',
  },
};

export const SKILL_IDS = Object.keys(SKILLS);

// Rarer copies hit harder.
export const SKILL_POWER = { common: 1, uncommon: 1.12, rare: 1.25, epic: 1.4, legendary: 1.6 };
