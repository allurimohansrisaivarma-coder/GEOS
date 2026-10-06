// The plants a user can switch between: one of each kind of site, each with its own crew, hazards and sensors.
// `scenario` is a scripted shift (with events such as a dust surge, a gas release or a blizzard front);
// `live` is an Open-Meteo location (see live/openmeteo.js) for running the same crew on today's real weather.
// `crew` picks the people and routines (see sim/scenarios.js).

export const PLANTS = [
  { id: 'jaisalmer', name: 'Jaisalmer Solar Park', kind: 'Desert solar farm', place: 'Rajasthan, India', icon: 'solar', scenario: 'thar', live: 'jaisalmer', crew: 'solar' },
  { id: 'platformb', name: 'Platform B', kind: 'Offshore platform', place: 'Mumbai High, India', icon: 'rig', scenario: 'offshore', live: 'mumbaihigh', crew: 'offshore' },
  { id: 'witbank', name: 'Witbank Coal Mine', kind: 'Underground coal mine', place: 'Mpumalanga, South Africa', icon: 'mine', scenario: 'mine', crew: 'mine' },
  { id: 'norilsk', name: 'Norilsk Arctic Plant', kind: 'Arctic plant', place: 'Krasnoyarsk Krai, Russia', icon: 'snow', scenario: 'arctic', live: 'norilsk', crew: 'arctic', cold: true },
];

export const plantById = (id) => PLANTS.find((p) => p.id === id) || PLANTS[0];
export const hasShift = (p) => !!p.scenario;
export const hasLive = (p) => !!p.live;

/** Old deep links used ?scenario=thar|offshore|live; map them onto plants. */
export function legacyScenario(id) {
  if (id === 'thar') return { plant: 'jaisalmer', src: 'sim' };
  if (id === 'offshore') return { plant: 'platformb', src: 'sim' };
  if (id === 'mine') return { plant: 'witbank', src: 'sim' };
  if (id === 'arctic') return { plant: 'norilsk', src: 'sim' };
  if (id === 'live') return { plant: 'jaisalmer', src: 'live' };
  return null;
}
