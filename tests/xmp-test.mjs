import {XMP} from '@captraw/desktop-core/xmp';
import {Documents} from '@captraw/desktop-core/documents';
import {resolve} from 'node:path';
const documents=new Documents(new XMP(resolve(process.env.CAPTRAW_XMP_BINARY||'build/xmp/captraw-xmp')));
export const readDocument=path=>documents.read(path);
