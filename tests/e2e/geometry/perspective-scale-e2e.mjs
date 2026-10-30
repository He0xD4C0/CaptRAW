import assert from 'node:assert/strict';
import {CRS,property,text,decodeAdjustments} from '@captraw/desktop-core/xmp';
assert.equal(decodeAdjustments([property(CRS,'PerspectiveScale',text(110))]).adjustments.perspective?.scale,1.1,'new desktop-core build required');
process.env.CAPTRAW_PERSPECTIVE_SCALE_XMP='1';
await import('./perspective-manual-e2e.mjs');
