/**
 * The languages the code editor knows: a name to show, the file extensions it owns (for guessing from a file name
 * and for naming a download), and how to load its highlighting. Each language is loaded the first time it is used,
 * so the editor's first load carries none of them.
 *
 * Everything but `load` is plain data and pure, so it is tested without the editor.
 */
import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';

export interface CodeLanguage {
  id: string;
  label: string;
  /** The first is the one a download gets. */
  extensions: readonly string[];
  /** Whole file names that mean this language (Dockerfile has no extension). */
  fileNames?: readonly string[];
  load: () => Promise<Extension>;
}

const stream = async (parser: Promise<Record<string, unknown>>, key: string): Promise<Extension> => {
  const mod = await parser;
  return StreamLanguage.define(mod[key] as Parameters<typeof StreamLanguage.define>[0]);
};

export const PLAIN_TEXT = 'plaintext';

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: PLAIN_TEXT, label: 'Plain text', extensions: ['txt', 'text', 'log'], load: async () => [] },
  { id: 'javascript', label: 'JavaScript', extensions: ['js', 'mjs', 'cjs'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
  { id: 'typescript', label: 'TypeScript', extensions: ['ts', 'mts', 'cts'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) },
  { id: 'jsx', label: 'JSX', extensions: ['jsx'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })) },
  { id: 'tsx', label: 'TSX', extensions: ['tsx'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })) },
  // Deluge (Zoho) is not a CodeMirror language; it reads close enough to JavaScript for colours and indentation.
  { id: 'deluge', label: 'Deluge (Zoho)', extensions: ['dg', 'deluge'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
  { id: 'json', label: 'JSON', extensions: ['json', 'jsonc', 'geojson'], load: () => import('@codemirror/lang-json').then((m) => m.json()) },
  { id: 'html', label: 'HTML', extensions: ['html', 'htm'], load: () => import('@codemirror/lang-html').then((m) => m.html()) },
  { id: 'css', label: 'CSS', extensions: ['css'], load: () => import('@codemirror/lang-css').then((m) => m.css()) },
  { id: 'scss', label: 'SCSS / Sass', extensions: ['scss', 'sass'], load: () => import('@codemirror/lang-sass').then((m) => m.sass({ indented: false })) },
  { id: 'python', label: 'Python', extensions: ['py', 'pyw'], load: () => import('@codemirror/lang-python').then((m) => m.python()) },
  { id: 'java', label: 'Java', extensions: ['java'], load: () => import('@codemirror/lang-java').then((m) => m.java()) },
  { id: 'kotlin', label: 'Kotlin', extensions: ['kt', 'kts'], load: () => stream(import('@codemirror/legacy-modes/mode/clike'), 'kotlin') },
  { id: 'c', label: 'C', extensions: ['c', 'h'], load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
  { id: 'cpp', label: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
  { id: 'csharp', label: 'C#', extensions: ['cs'], load: () => stream(import('@codemirror/legacy-modes/mode/clike'), 'csharp') },
  { id: 'go', label: 'Go', extensions: ['go'], load: () => import('@codemirror/lang-go').then((m) => m.go()) },
  { id: 'rust', label: 'Rust', extensions: ['rs'], load: () => import('@codemirror/lang-rust').then((m) => m.rust()) },
  { id: 'php', label: 'PHP', extensions: ['php'], load: () => import('@codemirror/lang-php').then((m) => m.php()) },
  { id: 'ruby', label: 'Ruby', extensions: ['rb', 'rake', 'gemspec'], load: () => stream(import('@codemirror/legacy-modes/mode/ruby'), 'ruby') },
  { id: 'swift', label: 'Swift', extensions: ['swift'], load: () => stream(import('@codemirror/legacy-modes/mode/swift'), 'swift') },
  { id: 'sql', label: 'SQL', extensions: ['sql'], load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
  { id: 'shell', label: 'Shell', extensions: ['sh', 'bash', 'zsh'], load: () => stream(import('@codemirror/legacy-modes/mode/shell'), 'shell') },
  { id: 'powershell', label: 'PowerShell', extensions: ['ps1', 'psm1'], load: () => stream(import('@codemirror/legacy-modes/mode/powershell'), 'powerShell') },
  { id: 'yaml', label: 'YAML', extensions: ['yml', 'yaml'], load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()) },
  { id: 'toml', label: 'TOML', extensions: ['toml'], load: () => stream(import('@codemirror/legacy-modes/mode/toml'), 'toml') },
  { id: 'xml', label: 'XML', extensions: ['xml', 'svg', 'xsd', 'plist'], load: () => import('@codemirror/lang-xml').then((m) => m.xml()) },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'], load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
  { id: 'dockerfile', label: 'Dockerfile', extensions: ['dockerfile'], fileNames: ['Dockerfile'], load: () => stream(import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile') },
];

const BY_ID = new Map(CODE_LANGUAGES.map((l) => [l.id, l]));

/** The language with this id; plain text when it is missing or unknown (a note from a newer version). */
export function languageById(id: string | undefined): CodeLanguage {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(PLAIN_TEXT)!;
}

/** The language a file name suggests (`app.py` → python, `Dockerfile` → dockerfile); plain text when unknown. */
export function languageForFileName(name: string): string {
  const trimmed = name.trim();
  const whole = CODE_LANGUAGES.find((l) => l.fileNames?.some((f) => f.toLowerCase() === trimmed.toLowerCase()));
  if (whole) return whole.id;
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 && !(dot === 0 && trimmed.length > 1)) return PLAIN_TEXT;
  const ext = trimmed.slice(dot + 1).toLowerCase();
  // Several languages share an extension (C/C++ headers); the first listed wins.
  return CODE_LANGUAGES.find((l) => l.id !== PLAIN_TEXT && l.extensions.includes(ext))?.id ?? PLAIN_TEXT;
}

// Characters a file name cannot hold on Windows or macOS, and control characters.
const ILLEGAL = new RegExp('[\\\\/:*?"<>|' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g');

/** The file name for a download: the title made safe, with the language's extension unless it already has one. */
export function fileNameFor(title: string, languageId: string): string {
  const language = languageById(languageId);
  const base = title.replace(ILLEGAL, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'untitled';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext && language.extensions.includes(ext)) return base;
  if (language.fileNames?.some((f) => f.toLowerCase() === base.toLowerCase())) return base;
  return `${base}.${language.extensions[0]}`;
}

export type IndentChoice = '2' | '4' | 'tab';
export const INDENT_CHOICES: ReadonlyArray<{ id: IndentChoice; label: string }> = [
  { id: '2', label: 'Spaces: 2' },
  { id: '4', label: 'Spaces: 4' },
  { id: 'tab', label: 'Tabs' },
];

export function isIndentChoice(value: unknown): value is IndentChoice {
  return value === '2' || value === '4' || value === 'tab';
}

/** What one level of indentation is made of. */
export function indentString(choice: IndentChoice): string {
  return choice === 'tab' ? '\t' : ' '.repeat(Number(choice));
}
