export interface SaveFileResult {
  ok: boolean;
  location?: string;
  error?: string;
}

/**
 * Saves a text/CSV file cleanly across web and Electron desktop builds
 * without using window.open or window.alert.
 */
export async function saveTextFileCrossPlatform(
  content: string,
  fileName: string,
  mimeType: string = 'text/plain;charset=utf-8'
): Promise<SaveFileResult> {
  try {
    const cleanName = (fileName || 'export.txt').replace(/[\\/:*?"<>|]+/g, '_');
    const isCsv = mimeType.toLowerCase().includes('csv') || cleanName.toLowerCase().endsWith('.csv');
    const payload = isCsv && !content.startsWith('\uFEFF') ? `\uFEFF${content}` : content;

    const blob = new Blob([payload], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = cleanName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);

    return { ok: true, location: cleanName };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Unable to download file on this device.',
    };
  }
}
