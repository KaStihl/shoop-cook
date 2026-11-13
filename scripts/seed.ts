import { seedProducts } from '@/lib/seed';

const inserted = seedProducts();
console.log(inserted ? `Seed: vložených ${inserted} ukážkových produktov.` : 'Seed preskočený: databáza už obsahuje produkty.');
