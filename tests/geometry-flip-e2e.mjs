// Fresh flip-capable native core and current production UI must be built by
// the coordinating process first. This only runs the hidden real App workflow.
process.env.CAPTRAW_MASK_REFERENCE_FLIPS='1';
await import('./mask-reference-e2e.mjs');
