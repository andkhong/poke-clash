import { describe, expect, it } from 'vitest';
import { containsBlockedLanguage, containsBlockedLanguageInName, foldForFilter } from './chatFilter';
import { listAllSpecies } from '../data/loader';

describe('foldForFilter', () => {
  it('folds case, accents, fullwidth forms and homoglyphs to plain lowercase', () => {
    expect(foldForFilter('ＦＵＣＫ')).toBe('fuck');
    expect(foldForFilter('fúck')).toBe('fuck');
    expect(foldForFilter('Ѕhit')).toBe('shit');
  });
});

describe('containsBlockedLanguage', () => {
  it('catches plain swearing and slurs', () => {
    for (const text of ['fuck you', 'what a bitch', 'this is shit', 'you are a nigger', 'faggot', 'stfu'])
      expect(containsBlockedLanguage(text)).toBe(true);
  });

  it('catches the spelling tricks people actually use', () => {
    const dodges = [
      'F U C K',
      'fuuuuck',
      'f.u.c.k',
      'sh!t',
      'f*ck',
      'b1tch',
      'a$$hole',
      'n1gger',
      'nlgger',
      'niqqer',
      'n i g g e r',
      'ＦＵＣＫ',
      'fúck',
      'sand nigger',
    ];
    for (const text of dodges) expect(containsBlockedLanguage(text)).toBe(true);
  });

  it('catches a slur buried inside a longer run of characters', () => {
    // The anywhere-matched list exists for exactly this; a word-boundary
    // filter alone would pass it straight through.
    expect(containsBlockedLanguage('xxniggerxx')).toBe(true);
    expect(containsBlockedLanguage('haha_faggot_lol')).toBe(true);
  });

  it('leaves innocent words that merely contain a bad substring alone', () => {
    const clean = [
      'gg wp',
      'class act',
      'assassin build',
      'bass drop',
      'Scunthorpe United',
      'raccoon',
      'cocoon',
      'grasshopper',
      'Pakistan',
      'Japan is nice',
      'spice it up',
      'shiitake mushrooms',
      'cocktail hour',
      'Dickinson',
      'analysis',
      'Niger',
      'let him cook',
      '🔥🔥',
    ];
    for (const text of clean) expect(containsBlockedLanguage(text)).toBe(false);
  });

  it('never blocks a Pokémon species name', () => {
    // Species names are both chat content and the seated sender's label, so
    // a false positive here would be visible on every line they send.
    for (const species of listAllSpecies()) expect(containsBlockedLanguage(species.name)).toBe(false);
  });
});

describe('containsBlockedLanguageInName', () => {
  it('blocks a swear word at the edge of a name segment, where there is no space to make a boundary', () => {
    for (const name of ['Fuck482', 'Sh1tMunchr', 'bigcock', 'xXn1ggerXx']) expect(containsBlockedLanguageInName(name)).toBe(true);
  });

  it('passes every generated-style species name, including the ones with a bad substring', () => {
    for (const species of listAllSpecies()) {
      expect(containsBlockedLanguageInName(species.name)).toBe(false);
      // spectatorIdentity.ts shapes names as Species + a 3-digit number.
      expect(containsBlockedLanguageInName(`${species.name}482`)).toBe(false);
    }
    // The four that make the edge rule delicate: Nosepass, Froslass, Cascoon
    // (suffixes) and Cofagrigus (an infix).
    for (const name of ['Nosepass', 'Froslass', 'Cascoon', 'Cofagrigus']) expect(containsBlockedLanguageInName(name)).toBe(false);
  });
});
