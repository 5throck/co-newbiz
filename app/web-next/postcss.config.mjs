// Tailwind CSS v4 wiring (ADR-0069's named stack, previously deferred —
// see docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md §6
// Phase 3's "deviation" note, now closed).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
