import { toRomaji, isKana } from 'wanakana';

export interface KanaChunk {
  original: string;
  romaji: string;
}

// テキストがローマ字主体かどうかを判定
// 半角英字が全文字の50%以上ならローマ字行とみなす
export function isRomajiText(text: string): boolean {
  if (!text) return false;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  return latin / text.length >= 0.5;
}

// ローマ字テキストをそのままチャンクに変換（1文字=1チャンク、記号・括弧は除外）
function romajiTextToChunks(text: string): KanaChunk[] {
  const chunks: KanaChunk[] = [];
  // 括弧と中身を丸ごとスキップ
  const stripped = text.replace(/[（(][^）)]*[）)]/g, '').replace(/[・。、！？!?,]/g, '');
  for (const char of stripped) {
    if (/[a-zA-Z]/.test(char)) {
      chunks.push({ original: char, romaji: char.toLowerCase() });
    } else if (/[0-9]/.test(char)) {
      chunks.push({ original: char, romaji: char });
    }
    // スペースは入力対象に含めない
  }
  return chunks;
}

// かなテキストをローマ字チャンクに変換
function kanaTextToChunks(text: string): KanaChunk[] {
  const chunks: KanaChunk[] = [];
  for (const char of text) {
    if (char === 'ー') {
      chunks.push({ original: char, romaji: '-' });
    } else if (isKana(char)) {
      chunks.push({ original: char, romaji: toRomaji(char).toLowerCase() });
    } else if (/[a-zA-Z0-9]/.test(char)) {
      chunks.push({ original: char, romaji: char.toLowerCase() });
    }
    // スペースは入力対象に含めない
  }
  return chunks;
}

// forceRomaji: true=ローマ字モード強制, false=かなモード強制, undefined=自動判定
export function textToChunks(text: string, forceRomaji?: boolean): KanaChunk[] {
  const useRomaji = forceRomaji !== undefined ? forceRomaji : isRomajiText(text);
  return useRomaji ? romajiTextToChunks(text) : kanaTextToChunks(text);
}

export function chunksToRomaji(chunks: KanaChunk[]): string {
  return chunks.map(c => c.romaji).join('');
}

export function kanaToRomaji(kana: string): string {
  return toRomaji(kana).toLowerCase();
}
