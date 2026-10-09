/** Saves text as a file through the browser's (or the desktop shell's) normal download. */
export function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers start the save after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
