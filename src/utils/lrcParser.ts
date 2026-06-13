export interface LrcLine {
  time: number; // seconds
  text: string;
}

export function parseLrc(content: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const raw of content.split('\n')) {
    const match = raw.trim().match(lineRegex);
    if (!match) continue;
    const min = parseInt(match[1]);
    const sec = parseInt(match[2]);
    const ms = match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3]);
    const time = min * 60 + sec + ms / 1000;
    const text = match[4].trim();
    if (text) lines.push({ time, text });
  }

  return lines.sort((a, b) => a.time - b.time);
}
