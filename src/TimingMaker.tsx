import { useState, useRef, useEffect, useCallback } from 'react';

interface TimedLine {
  time: number | null;
  text: string;
  skip: boolean;
}

type MakerState = 'idle' | 'recording' | 'paused' | 'done';
type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large';

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const ms = Math.floor((sec % 1) * 100).toString().padStart(2, '0');
  return `${m}:${s}.${ms}`;
}

function formatDisplay(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// "1:23" "1:23.45" "83" "83.5" などをパースして秒数を返す。無効なら null
function parseTimeInput(input: string): number | null {
  const s = input.trim();
  // mm:ss または mm:ss.xx
  const colonMatch = s.match(/^(\d+):(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (colonMatch) {
    const sec = parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]) + (colonMatch[3] ? parseInt(colonMatch[3].padEnd(2, '0')) / 100 : 0);
    return isFinite(sec) ? sec : null;
  }
  // 秒数のみ
  const numMatch = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (numMatch) {
    const sec = parseFloat(s);
    return isFinite(sec) ? sec : null;
  }
  return null;
}

export default function TimingMaker() {
  const [lines, setLines] = useState<TimedLine[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [rawAudioPath, setRawAudioPath] = useState<string | null>(null);
  const [state, setState] = useState<MakerState>('idle');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [lyricsFileName, setLyricsFileName] = useState('');
  const [whisperRunning, setWhisperRunning] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState('');
  const [whisperLog, setWhisperLog] = useState<string[]>([]);
  const [whisperModel, setWhisperModel] = useState<WhisperModel>('small');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [jumpInput, setJumpInput] = useState('');
  const [jumpError, setJumpError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentIdxRef = useRef(0);
  const linesRef = useRef<TimedLine[]>([]);
  const stateRef = useRef<MakerState>('idle');
  const animRef = useRef(0);

  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 再生時間を毎フレーム更新
  const tickTime = useCallback(() => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    animRef.current = requestAnimationFrame(tickTime);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(tickTime);
    return () => cancelAnimationFrame(animRef.current);
  }, [tickTime]);

  const loadLyrics = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.openFileDialog([
        { name: 'テキストファイル', extensions: ['txt', 'lrc'] },
      ]);
      if (!path) return;
      const content = await window.electronAPI.readFile(path);
      if (!content) return;
      const parsed: TimedLine[] = content.split('\n')
        .map(l => l.trim()).filter(l => l.length > 0)
        .map(l => {
          const m = l.match(/^\[[\d:\.]+\](.*)/);
          return { time: null, text: m ? m[1].trim() : l, skip: false };
        }).filter(l => l.text.length > 0);
      setLines(parsed);
      linesRef.current = parsed;
      setLyricsFileName(path.split(/[\\/]/).pop() || '');
      setState('idle');
      setCurrentIdx(0);
    } else {
      // Webブラウザ (Vercel) 環境用
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.accept = '.txt,.lrc';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          if (content) {
            const parsed: TimedLine[] = content.split('\n')
              .map(l => l.trim()).filter(l => l.length > 0)
              .map(l => {
                const m = l.match(/^\[[\d:\.]+\](.*)/);
                return { time: null, text: m ? m[1].trim() : l, skip: false };
              }).filter(l => l.text.length > 0);
            setLines(parsed);
            linesRef.current = parsed;
            setLyricsFileName(file.name);
            setState('idle');
            setCurrentIdx(0);
          }
        };
        reader.readAsText(file);
      };
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    }
  };

  const loadAudio = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.openFileDialog([
        { name: '音楽ファイル', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] },
      ]);
      if (!path) return;
      const buf = await window.electronAPI.readFileBuffer(path);
      if (!buf || !audioRef.current) return;
      audioRef.current.src = URL.createObjectURL(new Blob([buf]));
      setAudioPath(path);
      setRawAudioPath(path);
    } else {
      // Webブラウザ (Vercel) 環境用
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.accept = 'audio/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file || !audioRef.current) return;
        const url = URL.createObjectURL(file);
        audioRef.current.src = url;
        setAudioPath(file.name);
        setRawAudioPath(file.name);
      };
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    }
  };

  const handleAudioLoaded = () => {
    if (audioRef.current) setDuration(audioRef.current.duration || 0);
  };

  const changeRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  useEffect(() => {
    if (!window.electronAPI) return; // ブラウザ直接表示時（Electron外）
    window.electronAPI.onWhisperProgress((msg: string) => {
      setWhisperLog(prev => [...prev.slice(-20), msg]);
      setWhisperStatus(msg);
    });
    return () => window.electronAPI.offWhisperProgress();
  }, []);

  // スキップしない行のインデックス一覧
  const activeIndices = lines.map((l, i) => ({ l, i })).filter(x => !x.l.skip).map(x => x.i);

  const startRecording = () => {
    if (!audioRef.current || activeIndices.length === 0) return;
    const reset = lines.map(l => ({ ...l, time: null }));
    setLines(reset);
    linesRef.current = reset;
    const first = activeIndices[0];
    currentIdxRef.current = first;
    setCurrentIdx(first);
    audioRef.current.currentTime = 0;
    audioRef.current.play();
    setState('recording');
  };

  const pauseRecording = () => {
    audioRef.current?.pause();
    setState('paused');
  };

  const resumeRecording = () => {
    audioRef.current?.play();
    setState('recording');
  };

  const stopRecording = async () => {
    audioRef.current?.pause();
    // 途中保存の確認
    const stampedLines = linesRef.current.filter(l => !l.skip && l.time !== null);
    if (stampedLines.length > 0) {
      const save = window.confirm(`${stampedLines.length}行のタイムスタンプがあります。\n保存してから中止しますか？`);
      if (save) await saveLrcFromLines(linesRef.current);
    }
    if (audioRef.current) audioRef.current.currentTime = 0;
    const reset = lines.map(l => ({ ...l, time: null }));
    setLines(reset);
    linesRef.current = reset;
    setCurrentIdx(activeIndices[0] ?? 0);
    currentIdxRef.current = activeIndices[0] ?? 0;
    setState('idle');
  };

  const jumpToTime = (sec: number) => {
    if (!audioRef.current || duration === 0) return;
    const clamped = Math.max(0, Math.min(sec, duration));
    audioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
    const ls = linesRef.current;
    let newIdx = activeIndices[0] ?? 0;
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].time !== null && ls[i].time! <= clamped) newIdx = i + 1;
    }
    const nextActive = activeIndices.find(i => i >= newIdx) ?? activeIndices[activeIndices.length - 1] ?? 0;
    setCurrentIdx(nextActive);
    currentIdxRef.current = nextActive;
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sec = parseTimeInput(jumpInput);
    if (sec === null) { setJumpError(true); setTimeout(() => setJumpError(false), 800); return; }
    jumpToTime(sec);
    setJumpInput('');
  };

  // シークバークリックで任意時間へジャンプ
  const seekBarRef = useRef<HTMLDivElement>(null);
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    jumpToTime(ratio * duration);
  };

  const advanceToNextActive = (fromIdx: number) => {
    const next = activeIndices.find(i => i > fromIdx);
    if (next === undefined) {
      setState('done');
      audioRef.current?.pause();
    } else {
      currentIdxRef.current = next;
      setCurrentIdx(next);
    }
  };

  const handleStamp = useCallback(() => {
    if (!audioRef.current) return;
    const s = stateRef.current;
    if (s !== 'recording') return;
    const idx = currentIdxRef.current;
    const ls = [...linesRef.current];
    if (idx >= ls.length || ls[idx].skip) return;
    ls[idx] = { ...ls[idx], time: audioRef.current.currentTime };
    linesRef.current = ls;
    setLines([...ls]);
    advanceToNextActive(idx);
  }, [activeIndices]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (stateRef.current !== 'recording') return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStamp(); }
  }, [handleStamp]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const undoLast = () => {
    const idx = currentIdxRef.current;
    const prevActive = [...activeIndices].reverse().find(i => i < idx);
    if (prevActive === undefined) return;
    const ls = [...linesRef.current];
    ls[prevActive] = { ...ls[prevActive], time: null };
    linesRef.current = ls;
    setLines([...ls]);
    currentIdxRef.current = prevActive;
    setCurrentIdx(prevActive);
  };

  const runWhisper = async () => {
    if (!rawAudioPath || lines.length === 0) return;
    setWhisperRunning(true);
    setWhisperLog([]);
    setWhisperStatus('Pythonを起動中...');
    const activeLines = lines.filter(l => !l.skip).map(l => l.text);
    const tmpPath = await window.electronAPI.writeTempFile({ content: activeLines.join('\n') });
    const result = await window.electronAPI.runWhisper({ audioPath: rawAudioPath, lyricsPath: tmpPath, model: whisperModel });
    setWhisperRunning(false);
    if (result.cancelled) { setWhisperStatus(''); return; }
    if (result.error) { setWhisperStatus('エラー: ' + result.error); return; }
    const matched: { text: string; time: number }[] = result.lines || [];
    let matchIdx = 0;
    const updated = lines.map(l => {
      if (l.skip) return l;
      const m = matched[matchIdx++];
      return m ? { ...l, time: m.time } : l;
    });
    setLines(updated);
    linesRef.current = updated;
    setState('done');
    setWhisperStatus(`完了！ ${matched.length}行のタイミングを検出しました`);
  };

  const toggleSkip = (i: number) => {
    if (state !== 'idle') return;
    const ls = [...lines];
    ls[i] = { ...ls[i], skip: !ls[i].skip };
    setLines(ls);
    linesRef.current = ls;
  };

  const saveLrcFromLines = async (ls: TimedLine[]) => {
    const content = ls
      .filter(l => !l.skip && l.time !== null)
      .map(l => `[${formatTime(l.time!)}]${l.text}`)
      .join('\n');
    const baseName = lyricsFileName.replace(/\.[^.]+$/, '') || 'output';
    if (window.electronAPI) {
      await window.electronAPI.saveFile({ defaultName: `${baseName}.lrc`, content });
    } else {
      // Webブラウザ (Vercel) 環境用 - ファイルダウンロード
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.lrc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const saveLrc = () => saveLrcFromLines(lines);

  const stamped = lines.filter(l => !l.skip && l.time !== null).length;
  const totalActive = activeIndices.length;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isPlaying = state === 'recording';
  const inSession = state === 'recording' || state === 'paused';

  return (
    <div className="maker-container">
      <audio ref={audioRef} onLoadedMetadata={handleAudioLoaded} />

      <div className="maker-header">
        <div className="maker-controls">
          <button onClick={loadLyrics} className="btn btn-secondary">
            📄 歌詞読込{lines.length > 0 && <span className="loaded"> ✓ {lines.length}行</span>}
          </button>
          <button onClick={loadAudio} className="btn btn-secondary">
            🎵 音楽読込{audioPath && <span className="loaded"> ✓</span>}
          </button>
        </div>
        <div className="maker-hint">
          {!whisperRunning && state === 'idle' && lines.length > 0 && '除外したい行（タイトル・歌手名など）の ✕ をクリック後、自動またはEnter方式でスタート'}
          {!whisperRunning && state === 'idle' && lines.length === 0 && '歌詞と音楽を読み込んでスタートしてください'}
          {!whisperRunning && state === 'recording' && <span className="recording-hint">🔴 録音中 — 各行の頭で <kbd>Enter</kbd> または <kbd>Space</kbd></span>}
          {!whisperRunning && state === 'paused' && <span style={{color:'#fbbf24'}}>⏸ 一時停止中</span>}
          {!whisperRunning && state === 'done' && !whisperStatus.startsWith('エラー') && '✅ 完了！LRCファイルを保存してください'}
          {!whisperRunning && whisperStatus.startsWith('エラー') && <span style={{color:'#f87171'}}>{whisperStatus}</span>}
        </div>
      </div>

      {/* 再生コントロールバー */}
      <div className="playback-bar">
        <div className="playback-time">
          <span className="time-current">{formatDisplay(currentTime)}</span>
          <span className="time-sep"> / </span>
          <span className="time-total">{duration > 0 ? formatDisplay(duration) : '--:--'}</span>
        </div>
        <div className="playback-seek">
          <div
            className="seek-track"
            ref={seekBarRef}
            onClick={handleSeek}
            style={{ cursor: duration > 0 ? 'pointer' : 'default' }}
            title="クリックで任意の位置へジャンプ"
          >
            <div className="seek-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="playback-controls">
          {!inSession ? (
            <button
              className="ctrl-btn ctrl-play"
              onClick={startRecording}
              disabled={totalActive === 0 || !audioPath}
              title="スタート（Enter/Spaceでタイムスタンプ）"
            >▶</button>
          ) : (
            <>
              {isPlaying ? (
                <button className="ctrl-btn ctrl-pause" onClick={pauseRecording} title="一時停止">⏸</button>
              ) : (
                <button className="ctrl-btn ctrl-play" onClick={resumeRecording} title="再開">▶</button>
              )}
            </>
          )}
          <button
            className="ctrl-btn ctrl-stop"
            onClick={stopRecording}
            disabled={!inSession}
            title="中止してリセット"
          >⏹</button>
          {inSession && (
            <button className="ctrl-btn ctrl-undo" onClick={undoLast} title="1行戻す">↩</button>
          )}
        </div>
        <form className="jump-form" onSubmit={handleJumpSubmit} title="時間を入力してジャンプ（例: 1:23 / 83）">
          <input
            className={`jump-input${jumpError ? ' jump-input-error' : ''}`}
            value={jumpInput}
            onChange={e => { setJumpInput(e.target.value); setJumpError(false); }}
            placeholder="1:23"
            disabled={duration === 0}
          />
          <button type="submit" className="jump-btn" disabled={duration === 0}>→</button>
        </form>
        <div className="speed-control">
          {[0.5, 0.75, 1.0, 1.25, 1.5].map(r => (
            <button
              key={r}
              className={`speed-btn${playbackRate === r ? ' speed-active' : ''}`}
              onClick={() => changeRate(r)}
            >{r === 1.0 ? '標準' : `×${r}`}</button>
          ))}
        </div>
        <div className="playback-stamp-hint">
          {state === 'recording' && <span>各行の頭で <kbd>Enter</kbd></span>}
          {state === 'paused' && <span style={{color:'#fbbf24'}}>{stamped} / {totalActive} 行完了</span>}
        </div>
      </div>

      {whisperRunning && (
        <div className="whisper-panel">
          <div className="whisper-panel-top">
            <div className="whisper-bar"><div className="whisper-bar-fill" /></div>
            <button
              className="btn-whisper-cancel"
              onClick={async () => {
                await window.electronAPI.cancelWhisper();
                setWhisperRunning(false);
                setWhisperStatus('');
                setWhisperLog([]);
              }}
              title="Whisperを中止"
            >✕ 中止</button>
          </div>
          <div className="whisper-log">
            {whisperLog.map((msg, i) => (
              <div key={i} className={`whisper-log-line${i === whisperLog.length - 1 ? ' whisper-log-latest' : ''}`}>{msg}</div>
            ))}
          </div>
        </div>
      )}

      <div className="maker-main">
        <div className="lines-panel">
          {lines.length === 0 && (
            <p style={{ color: '#555', textAlign: 'center', marginTop: 40 }}>歌詞ファイルを読み込んでください</p>
          )}
          {lines.map((line, i) => (
            <div key={i} className={[
              'maker-line',
              i === currentIdx && inSession ? 'maker-line-current' : '',
              line.time !== null ? 'maker-line-done' : '',
              line.skip ? 'maker-line-skip' : '',
            ].join(' ')}>
              {state === 'idle' && (
                <button className={`skip-btn${line.skip ? ' skip-btn-active' : ''}`} onClick={() => toggleSkip(i)} title={line.skip ? '除外中（クリックで戻す）' : 'クリックで除外'}>✕</button>
              )}
              <span className="maker-time">
                {line.skip
                  ? <span style={{ color: '#444' }}>[ 除外 ]</span>
                  : line.time !== null
                    ? `[${formatTime(line.time)}]`
                    : <span style={{ color: '#555' }}>[--.--]</span>}
              </span>
              <span className="maker-text">{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="maker-footer">
        <div className="maker-progress">
          {inSession && `${stamped} / ${totalActive} 行`}
          {state === 'idle' && lines.length > 0 && `${totalActive} 行がタイミング設定対象`}
          {state === 'done' && `${stamped} / ${totalActive} 行完了`}
        </div>
        <div className="maker-actions">
          {(state === 'idle' || state === 'done') && !whisperRunning && (
            <>
              {window.electronAPI ? (
                <>
                  <select value={whisperModel} onChange={e => setWhisperModel(e.target.value as WhisperModel)} className="model-select">
                    <option value="tiny">tiny（最速）</option>
                    <option value="base">base</option>
                    <option value="small">small（推奨）</option>
                    <option value="medium">medium</option>
                    <option value="large">large（最高精度）</option>
                  </select>
                  <button onClick={runWhisper} className="btn btn-whisper" disabled={totalActive === 0 || !rawAudioPath}>🤖 自動</button>
                </>
              ) : (
                <span style={{ fontSize: '0.85rem', color: '#8080b0', marginRight: '10px' }}>
                  ※自動タイミング設定（Whisper）はデスクトップ版でのみ利用可能です。
                </span>
              )}
              {state === 'done' && (
                <button onClick={startRecording} className="btn btn-secondary">🔄 手動やり直し</button>
              )}
            </>
          )}
          {state === 'done' && !whisperRunning && (
            <button onClick={saveLrc} className="btn btn-save">💾 LRCを保存</button>
          )}
        </div>
      </div>
    </div>
  );
}
