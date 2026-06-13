#!/usr/bin/env python3
"""
音楽ファイルをWhisperで文字起こしし、歌詞行とマッチングしてLRC形式で出力する。

使用方法:
  python whisper_timing.py <音楽ファイル> <歌詞ファイル> [モデル名]

モデル: tiny / base / small / medium / large (精度と速度のトレードオフ)
出力: JSON形式でstdoutに書き出す
"""

import sys
import json
import unicodedata
import re

def normalize(text):
    """比較用にテキストを正規化"""
    text = unicodedata.normalize('NFKC', text)
    text = re.sub(r'[\s　。、！？!?,. ]+', '', text)
    return text.lower()

def similarity(a, b):
    """2文字列の類似度（共通文字数ベース）"""
    a, b = normalize(a), normalize(b)
    if not a or not b:
        return 0.0
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    matches = sum(1 for c in shorter if c in longer)
    return matches / len(longer)

def match_lyrics_to_segments(lyrics_lines, segments):
    """
    Whisperセグメントを歌詞行に対応させる。
    各歌詞行に最も近いセグメントの開始時刻を割り当てる。
    """
    results = []
    seg_idx = 0

    for lyric in lyrics_lines:
        best_score = -1
        best_time = None
        search_start = max(0, seg_idx - 1)

        for i in range(search_start, len(segments)):
            seg = segments[i]
            score = similarity(lyric, seg['text'])
            if score > best_score:
                best_score = score
                best_time = seg['start']
                if score > 0.6:
                    seg_idx = i + 1
                    break

        results.append({
            'text': lyric,
            'time': best_time,
            'confidence': round(best_score, 3)
        })

    return results

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'error': '引数が不足しています: <音楽ファイル> <歌詞ファイル>'}))
        sys.exit(1)

    audio_path = sys.argv[1]
    lyrics_path = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else 'small'

    # 歌詞読み込み
    with open(lyrics_path, 'r', encoding='utf-8') as f:
        lyrics_lines = [l.strip() for l in f.readlines() if l.strip()]

    # Whisper実行
    try:
        import whisper
    except ImportError:
        print(json.dumps({'error': 'whisperがインストールされていません。\npip install openai-whisper を実行してください。'}))
        sys.exit(1)

    # 進捗をstderrに出力（stderrはElectron側でログ表示）
    print(f'[whisper] モデル "{model_name}" を読み込み中...', file=sys.stderr)
    model = whisper.load_model(model_name)

    print(f'[whisper] 文字起こし中...', file=sys.stderr)
    result = model.transcribe(audio_path, language='ja', verbose=False)

    segments = [{'start': s['start'], 'text': s['text'].strip()} for s in result['segments']]
    print(f'[whisper] {len(segments)}セグメント検出', file=sys.stderr)

    # 歌詞とマッチング
    matched = match_lyrics_to_segments(lyrics_lines, segments)

    print(json.dumps({'ok': True, 'lines': matched}, ensure_ascii=False))

if __name__ == '__main__':
    main()
