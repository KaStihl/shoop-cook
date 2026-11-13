import cron from 'node-cron';
import { runRefresh } from '@/lib/refresh';
import { STORES } from '@/lib/types';

// Usage: npm run refresh [-- --store=lidl] [-- --cron]   (--cron keeps running and refreshes daily at 06:00)
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--store='))?.split('=')[1];
const stores = STORES.filter((s) => !only || s === only);
const run = () => runRefresh(stores, (line) => console.log(line));

if (args.includes('--cron')) {
  cron.schedule('0 6 * * *', () => void run());
  console.log('Plánovač beží: aktualizácia každý deň o 06:00.');
}
void run();
