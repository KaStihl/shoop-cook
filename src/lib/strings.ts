// String and number helpers without Node dependencies, shared by the server and the browser bundle.
export const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

export const slug = (s: string): string => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const today = (): string => new Date().toISOString().slice(0, 10);
