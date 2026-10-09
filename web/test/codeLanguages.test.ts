import { describe, it, expect } from 'vitest';
import {
  CODE_LANGUAGES, fileNameFor, indentString, isIndentChoice, languageById, languageForFileName, PLAIN_TEXT,
} from '@/lib/codeLanguages';

describe('code languages', () => {
  it('has a unique id and extension list for each language', () => {
    const ids = CODE_LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of CODE_LANGUAGES) {
      expect(l.extensions.length).toBeGreaterThan(0);
      expect(typeof l.load).toBe('function');
    }
    expect(CODE_LANGUAGES.length).toBeGreaterThanOrEqual(25);
  });

  it('falls back to plain text for an unknown or missing language', () => {
    expect(languageById('python').label).toBe('Python');
    expect(languageById('klingon').id).toBe(PLAIN_TEXT);
    expect(languageById(undefined).id).toBe(PLAIN_TEXT);
  });

  it('guesses the language from a file name', () => {
    expect(languageForFileName('app.py')).toBe('python');
    expect(languageForFileName('Main.JAVA')).toBe('java');
    expect(languageForFileName('index.tsx')).toBe('tsx');
    expect(languageForFileName('Dockerfile')).toBe('dockerfile');
    expect(languageForFileName('notes')).toBe(PLAIN_TEXT);
    expect(languageForFileName('.gitignore')).toBe(PLAIN_TEXT);
    expect(languageForFileName('weird.zzz')).toBe(PLAIN_TEXT);
    expect(languageForFileName('util.h')).toBe('c');
  });

  it('names a download from the title and language, keeping an extension that is already right', () => {
    expect(fileNameFor('Customer fields', 'json')).toBe('Customer fields.json');
    expect(fileNameFor('script.py', 'python')).toBe('script.py');
    expect(fileNameFor('script.py', 'javascript')).toBe('script.py.js');
    expect(fileNameFor('a/b:c*d?', 'sql')).toBe('a-b-c-d-.sql');
    expect(fileNameFor('   ', 'go')).toBe('untitled.go');
    expect(fileNameFor('Dockerfile', 'dockerfile')).toBe('Dockerfile');
    expect(fileNameFor('.env', 'shell')).toBe('env.sh');
    expect(fileNameFor('x', 'nope')).toBe('x.txt');
  });

  it('knows its indent choices', () => {
    expect(indentString('2')).toBe('  ');
    expect(indentString('4')).toBe('    ');
    expect(indentString('tab')).toBe('\t');
    expect(isIndentChoice('4')).toBe(true);
    expect(isIndentChoice('8')).toBe(false);
  });
});
