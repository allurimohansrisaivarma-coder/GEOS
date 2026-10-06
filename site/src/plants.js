// The plants a user can switch between. A plant may have a scripted shift (`scenario`, with events such as a dust
// front or a gas release) and/or real weather (`live`, an Open-Meteo location from live/openmeteo.js).

export const PLANTS = [
  { id: 'jaisalmer', name: 'Jaisalmer Solar Park', kind: 'Solar farm', place: 'Rajasthan, India', icon: 'solar', scenario: 'thar', live: 'jaisalmer', crew: 'solar' },
  { id: 'platformb', name: 'Platform B', kind: 'Offshore platform', place: 'Mumbai High, India', icon: 'rig', scenario: 'offshore', live: 'mumbaihigh', crew: 'offshore' },
  { id: 'shaybah', name: 'Shaybah Oilfield', kind: 'Oil field', place: 'Rub al Khali, Saudi Arabia', icon: 'rig', live: 'shaybah', crew: 'field' },
  { id: 'deathvalley', name: 'Death Valley Solar', kind: 'Solar farm', place: 'California, USA', icon: 'solar', live: 'deathvalley', crew: 'solar' },
];

// Job titles for the simulated crew when real weather drives a site (the scripted desert crew already has solar roles).
export const CREW_ROLES = {
  solar: null,
  offshore: ['Roustabout (new hire)', 'Electrician (acclimatised)', 'Deck supervisor', 'Pipe crew (new hire)', 'HSE officer (acclimatised)'],
  field: ['Rigger (new hire)', 'Electrician (acclimatised)', 'Site supervisor', 'Pipe crew (new hire)', 'Surveyor (acclimatised)'],
};

export const plantById = (id) => PLANTS.find((p) => p.id === id) || PLANTS[0];
export const hasShift = (p) => !!p.scenario;

/** Old deep links used ?scenario=thar|offshore|live; map them onto plants. */
export function legacyScenario(id) {
  if (id === 'thar') return { plant: 'jaisalmer', src: 'sim' };
  if (id === 'offshore') return { plant: 'platformb', src: 'sim' };
  if (id === 'live') return { plant: 'jaisalmer', src: 'live' };
  return null;
}
