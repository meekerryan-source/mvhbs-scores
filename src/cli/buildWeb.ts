// npm run build:web [-- --live] — writes the read-only site to dist/. With --live, weeks that nflverse
// hasn't published yet are filled from ESPN (provisional).
import { loadEngineInput } from '../data/load.js';
import { detectCurrentWeek, fetchLiveWeek } from '../data/espn.js';
import { buildSite } from './site.js';

const { input, config, rulesSource } = await loadEngineInput();
if (process.argv.includes('--live')) {
  const week = (await detectCurrentWeek(input.season)) ?? config.live_week;
  if (week && !input.stats.some(s => s.week === week)) input.live = { [week]: await fetchLiveWeek(input.season, week, input.roster) };
}
console.log(buildSite(input, config, rulesSource));
