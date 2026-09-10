import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { extractCoreActions } from './pmdSpriteZip';

// A sheet of 3 frames x 8 directions at 4x4px, plus AnimData.xml the way
// PMDCollab writes it — including an action that is only an alias of
// another (Beedrill's Idle is `<CopyOf>Walk</CopyOf>` with no sheet of its
// own), which is what kept several species out of the mirror.
async function buildZip(animData: string, sheets: string[]): Promise<Buffer> {
  const png = await sharp({ create: { width: 12, height: 32, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 255 } } })
    .png()
    .toBuffer();
  const zip = new AdmZip();
  zip.addFile('AnimData.xml', Buffer.from(animData, 'utf-8'));
  for (const sheet of sheets) zip.addFile(sheet, png);
  return zip.toBuffer();
}

const ANIM_DATA = `<?xml version="1.0" ?>
<AnimData>
  <ShadowSize>1</ShadowSize>
  <Anims>
    <Anim><Name>Walk</Name><Index>1</Index><FrameWidth>4</FrameWidth><FrameHeight>4</FrameHeight>
      <Durations><Duration>2</Duration><Duration>4</Duration><Duration>2</Duration></Durations></Anim>
    <Anim><Name>Idle</Name><Index>7</Index><CopyOf>Walk</CopyOf></Anim>
    <Anim><Name>Attack</Name><Index>2</Index><CopyOf>Jab</CopyOf></Anim>
    <Anim><Name>Jab</Name><Index>3</Index><CopyOf>Attack</CopyOf></Anim>
  </Anims>
</AnimData>`;

describe('extractCoreActions', () => {
  it('resolves an aliased action to the sheet it copies and stores it under its own name', async () => {
    const zip = await buildZip(ANIM_DATA, ['Walk-Anim.png', 'Walk-Shadow.png']);
    const extracted = await extractCoreActions(zip);
    expect(extracted).not.toBeNull();
    const { actions, pngsToWrite } = extracted!;
    expect(actions.Walk).toEqual({ frameWidth: 4, frameHeight: 4, directions: 8, durationsMs: [33, 67, 33], hasShadow: true });
    expect(actions.Idle).toEqual(actions.Walk);
    expect(Object.keys(pngsToWrite).sort()).toEqual(['Idle-Anim.png', 'Idle-Shadow.png', 'Walk-Anim.png', 'Walk-Shadow.png']);
    expect(pngsToWrite['Idle-Anim.png']).toBe(pngsToWrite['Walk-Anim.png']);
    // Attack <-> Jab alias each other: a broken chain, skipped rather than looped on.
    expect(actions.Attack).toBeUndefined();
  });

  it('still rejects a zip without the required actions', async () => {
    const walkOnly = ANIM_DATA.replace('<Anim><Name>Idle</Name><Index>7</Index><CopyOf>Walk</CopyOf></Anim>', '');
    expect(await extractCoreActions(await buildZip(walkOnly, ['Walk-Anim.png']))).toBeNull();
    // The alias exists but its target sheet doesn't.
    expect(await extractCoreActions(await buildZip(ANIM_DATA, []))).toBeNull();
  });
});
