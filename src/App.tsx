import { useState, useEffect, useRef, useCallback } from 'react';
import type { LrcLine } from './utils/lrcParser';
import { parseLrc } from './utils/lrcParser';
import type { KanaChunk } from './utils/romajiConverter';
import { textToChunks, chunksToRomaji, isRomajiText } from './utils/romajiConverter';
import TimingMaker from './TimingMaker';
import MoleGame from './MoleGame';
import './App.css';

declare global {
  interface Window {
    electronAPI: {
      openFileDialog: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>;
      readFile: (path: string) => Promise<string | null>;
      readFileBuffer: (path: string) => Promise<ArrayBuffer | null>;
      saveFile: (opts: { defaultName: string; content: string }) => Promise<boolean>;
      getHistory: () => Promise<SongHistory[]>;
      addHistory: (entry: Omit<SongHistory, 'id' | 'addedAt' | 'usedAt'>) => Promise<void>;
      removeHistory: (id: string) => Promise<void>;
      checkFiles: (paths: Record<string, string | null>) => Promise<Record<string, boolean>>;
      getRanking: (lrcPath: string, userId: string) => Promise<RankingEntry[]>;
      getAllRanking: (lrcPath: string) => Promise<(RankingEntry & { userName: string })[]>;
      addRanking: (lrcPath: string, userId: string, entry: Omit<RankingEntry, 'date'>) => Promise<RankingEntry[]>;
      getUsers: () => Promise<UserEntry[]>;
      addUser: (name: string) => Promise<{ user?: UserEntry; error?: string }>;
      removeUser: (id: string) => Promise<void>;
      runWhisper: (opts: { audioPath: string; lyricsPath: string; model: string }) => Promise<{ error?: string; cancelled?: boolean; lines?: { text: string; time: number }[] }>;
      onWhisperProgress: (cb: (msg: string) => void) => void;
      offWhisperProgress: () => void;
      cancelWhisper: () => Promise<void>;
      writeTempFile: (opts: { content: string }) => Promise<string>;
    };
  }
}

interface RankingEntry {
  accuracy: number;
  correct: number;
  miss: number;
  speed: number;
  date: string;
}

interface UserEntry {
  id: string;
  name: string;
}

interface SongHistory {
  id: string;
  name: string;
  lrcPath: string;
  romajiLrcPath: string | null;
  audioPath: string;
  addedAt: string;
  usedAt: string;
}

type AppTab = 'typing' | 'mole';

interface LineState {
  lrcLine: LrcLine;
  chunks: KanaChunk[];
  romaji: string;
}

type GameState = 'idle' | 'playing' | 'paused' | 'finished';

export default function App() {
  const [tab, setTab] = useState<AppTab>('mole');
  const [romajiMode, setRomajiMode] = useState(false);
  const [parsedLrc, setParsedLrc] = useState<ReturnType<typeof parseLrc>>([]);
  const [parsedRomajiLrc, setParsedRomajiLrc] = useState<ReturnType<typeof parseLrc> | null>(null);
  const [lrcPath, setLrcPath] = useState<string | null>(null);
  const [romajiLrcPath, setRomajiLrcPath] = useState<string | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [typed, setTyped] = useState('');
  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState({ correct: 0, miss: 0 });
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [history, setHistory] = useState<SongHistory[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [_ranking, setRanking] = useState<RankingEntry[]>([]);
  const [allRanking, setAllRanking] = useState<(RankingEntry & { userName: string })[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [currentUser, setCurrentUser] = useState<UserEntry | null>(null);
  const [showUserSelect, setShowUserSelect] = useState(true);
  const [newUserName, setNewUserName] = useState('');
  const [userError, setUserError] = useState<string | null>(null);
  const gameStartTimeRef = useRef<number>(0);
  const [missFlash, setMissFlash] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const currentIndexRef = useRef(-1);
  const typedRef = useRef('');
  const scoreRef = useRef({ correct: 0, miss: 0 });
  const linesRef = useRef<LineState[]>([]);
  const gameStateRef = useRef<GameState>('idle');

  // Keep refs in sync
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { typedRef.current = typed; }, [typed]);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { scoreRef.current = score; }, [score]);

  // 起動時に履歴・ユーザーを読み込む
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getHistory().then(setHistory);
      window.electronAPI.getUsers().then(setUsers);
    } else {
      // Webブラウザ (Vercel) 環境用
      try {
        const rawUsers = localStorage.getItem('typingAppUsers');
        const parsedUsers = rawUsers ? JSON.parse(rawUsers) : [];
        setUsers(parsedUsers);

        const savedUser = localStorage.getItem('typingAppCurrentUser');
        if (savedUser) {
          const parsedCurrentUser = JSON.parse(savedUser);
          if (parsedUsers.some((u: any) => u.id === parsedCurrentUser.id)) {
            setCurrentUser(parsedCurrentUser);
            setShowUserSelect(false);
          }
        }
      } catch (err) {
        console.error('Failed to load users from localStorage:', err);
      }
    }
  }, []);

  // lrcPath変更時にランキング読み込み
  useEffect(() => {
    if (lrcPath && currentUser) {
      if (window.electronAPI) {
        window.electronAPI.getRanking(lrcPath, currentUser.id).then(setRanking);
        window.electronAPI.getAllRanking(lrcPath).then(setAllRanking);
      } else {
        // Webブラウザ (Vercel) 環境用
        const encodedPath = encodeURIComponent(lrcPath);
        fetch(`/api/song-ranking?lrcPath=${encodedPath}`)
          .then(res => {
            if (!res.ok) throw new Error('API failed');
            return res.json();
          })
          .then(data => {
            setAllRanking(data);
          })
          .catch(err => {
            console.error('Failed to load online rankings:', err);
            setAllRanking([]);
          });
      }
    } else {
      setRanking([]);
      setAllRanking([]);
    }
  }, [lrcPath, currentUser]);

  const handleSelectUser = (user: UserEntry) => {
    setCurrentUser(user);
    setShowUserSelect(false);
    setUserError(null);
    if (!window.electronAPI) {
      localStorage.setItem('typingAppCurrentUser', JSON.stringify(user));
    }
  };

  const handleAddUser = async () => {
    const name = newUserName.trim();
    if (!name) return;

    if (window.electronAPI) {
      const res = await window.electronAPI.addUser(name);
      if (res.error) { setUserError(res.error); return; }
      const updated = await window.electronAPI.getUsers();
      setUsers(updated);
      setNewUserName('');
      setUserError(null);
      if (res.user) handleSelectUser(res.user);
    } else {
      // Webブラウザ (Vercel) 環境用
      if (users.some(u => u.name === name)) {
        setUserError('既に存在する名前です');
        return;
      }
      const newUser = {
        id: 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name
      };
      const updatedUsers = [...users, newUser];
      setUsers(updatedUsers);
      localStorage.setItem('typingAppUsers', JSON.stringify(updatedUsers));
      
      setNewUserName('');
      setUserError(null);
      handleSelectUser(newUser);
    }
  };

  const handleRemoveUser = async (id: string) => {
    if (window.electronAPI) {
      await window.electronAPI.removeUser(id);
      setUsers(await window.electronAPI.getUsers());
      if (currentUser?.id === id) { setCurrentUser(null); setShowUserSelect(true); }
    } else {
      // Webブラウザ (Vercel) 環境用
      const updatedUsers = users.filter(u => u.id !== id);
      setUsers(updatedUsers);
      localStorage.setItem('typingAppUsers', JSON.stringify(updatedUsers));
      
      if (currentUser?.id === id) {
        setCurrentUser(null);
        localStorage.removeItem('typingAppCurrentUser');
        setShowUserSelect(true);
      }
    }
  };

  const addToHistory = async (lrcP: string, romajiP: string | null, audioP: string) => {
    if (!window.electronAPI) return; // Webブラウザ環境では履歴追加をスキップ
    const name = lrcP.split(/[\\/]/).pop()?.replace(/\.lrc$/i, '') ?? lrcP;
    await window.electronAPI.addHistory({ name, lrcPath: lrcP, romajiLrcPath: romajiP, audioPath: audioP });
    setHistory(await window.electronAPI.getHistory());
  };

  const removeFromHistory = async (id: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.removeHistory(id);
    setHistory(await window.electronAPI.getHistory());
  };

  const loadFromHistory = async (entry: SongHistory) => {
    setHistoryError(null);
    const check = await window.electronAPI.checkFiles({
      lrc: entry.lrcPath,
      romaji: entry.romajiLrcPath,
      audio: entry.audioPath,
    });
    const missing = [];
    if (!check.lrc) missing.push('LRCファイル');
    if (!check.romaji) missing.push('ローマ字LRCファイル');
    if (!check.audio) missing.push('音楽ファイル');
    if (missing.length > 0) {
      setHistoryError(`ファイルが見つかりません: ${missing.join('、')}`);
      return;
    }
    // LRC読み込み
    const lrcContent = await window.electronAPI.readFile(entry.lrcPath);
    if (!lrcContent) return;
    const parsed = parseLrc(lrcContent);
    let romajiParsed: ReturnType<typeof parseLrc> | null = null;
    if (entry.romajiLrcPath) {
      const rc = await window.electronAPI.readFile(entry.romajiLrcPath);
      if (rc) romajiParsed = parseLrc(rc);
    }
    const sample = parsed.slice(0, 5).map(l => l.text).join(' ');
    const detectedRomaji = romajiParsed ? false : isRomajiText(sample);
    setRomajiMode(detectedRomaji);
    setParsedRomajiLrc(romajiParsed);
    setRomajiLrcPath(entry.romajiLrcPath);
    const ls = buildLines(parsed, detectedRomaji, romajiParsed);
    setLines(ls);
    linesRef.current = ls;
    setParsedLrc(parsed);
    setLrcPath(entry.lrcPath);
    // 音楽読み込み
    const buf = await window.electronAPI.readFileBuffer(entry.audioPath);
    if (buf && audioRef.current) {
      audioRef.current.src = URL.createObjectURL(new Blob([buf]));
      setAudioPath(entry.audioPath);
    }
    setCurrentIndex(-1);
    setTyped('');
    setGameState('idle');
  };

  const changeRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const loadLrc = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.openFileDialog([{ name: 'LRCファイル', extensions: ['lrc'] }]);
      if (!path) return;
      const content = await window.electronAPI.readFile(path);
      if (!content) return;
      const parsed = parseLrc(content);
      // 最初の数行を見てローマ字LRCかどうか自動検出
      const sample = parsed.slice(0, 5).map(l => l.text).join(' ');
      const detectedRomaji = isRomajiText(sample);
      setRomajiMode(detectedRomaji);
      const ls = buildLines(parsed, detectedRomaji, parsedRomajiLrc);
      setLines(ls);
      linesRef.current = ls;
      setParsedLrc(parsed);
      setLrcPath(path);
      setCurrentIndex(-1);
      setTyped('');
      setGameState('idle');
    } else {
      // Webブラウザ (Vercel) 環境用
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.accept = '.lrc';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          if (content) {
            const parsed = parseLrc(content);
            const sample = parsed.slice(0, 5).map(l => l.text).join(' ');
            const detectedRomaji = isRomajiText(sample);
            setRomajiMode(detectedRomaji);
            const ls = buildLines(parsed, detectedRomaji, parsedRomajiLrc);
            setLines(ls);
            linesRef.current = ls;
            setParsedLrc(parsed);
            setLrcPath(file.name);
            setCurrentIndex(-1);
            setTyped('');
            setGameState('idle');
          }
        };
        reader.readAsText(file);
      };
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    }
  };

  const toggleRomajiMode = (next: boolean) => {
    setRomajiMode(next);
    if (parsedLrc.length > 0) {
      const ls = buildLines(parsedLrc, next, parsedRomajiLrc);
      setLines(ls);
      linesRef.current = ls;
    }
    setGameState('idle');
    setCurrentIndex(-1);
    setTyped('');
  };

  const buildLines = (
    parsed: ReturnType<typeof parseLrc>,
    romaji: boolean,
    romajiLines?: ReturnType<typeof parseLrc> | null,
  ) =>
    parsed.map((line, i) => {
      // ローマ字LRCが読み込まれていれば、対応する行のテキストをローマ字として使用
      const romajiText = romajiLines?.[i]?.text ?? null;
      const chunks = romajiText
        ? textToChunks(romajiText, true)
        : textToChunks(line.text, romaji);
      return { lrcLine: line, chunks, romaji: chunksToRomaji(chunks) };
    });

  const loadRomajiLrc = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.openFileDialog([
        { name: 'ローマ字LRCファイル', extensions: ['lrc', 'txt'] },
      ]);
      if (!path) return;
      const content = await window.electronAPI.readFile(path);
      if (!content) return;
      const parsed = parseLrc(content);
      setParsedRomajiLrc(parsed);
      setRomajiLrcPath(path);
      // 既にメインLRCが読み込まれていれば再構築
      if (parsedLrc.length > 0) {
        const ls = buildLines(parsedLrc, romajiMode, parsed);
        setLines(ls);
        linesRef.current = ls;
        setGameState('idle');
        setCurrentIndex(-1);
        setTyped('');
      }
    } else {
      // Webブラウザ (Vercel) 環境用
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.accept = '.lrc,.txt';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          if (content) {
            const parsed = parseLrc(content);
            setParsedRomajiLrc(parsed);
            setRomajiLrcPath(file.name);
            if (parsedLrc.length > 0) {
              const ls = buildLines(parsedLrc, romajiMode, parsed);
              setLines(ls);
              linesRef.current = ls;
              setGameState('idle');
              setCurrentIndex(-1);
              setTyped('');
            }
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
      const blob = new Blob([buf]);
      const url = URL.createObjectURL(blob);
      audioRef.current.src = url;
      setAudioPath(path);
      // LRCも読み込み済みなら履歴に追加
      if (lrcPath) await addToHistory(lrcPath, romajiLrcPath, path);
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
      };
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    }
  };

  // Sync lyrics using requestAnimationFrame
  const syncLoop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || gameStateRef.current !== 'playing') return;
    const t = audio.currentTime;
    const ls = linesRef.current;
    let idx = -1;
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].lrcLine.time <= t) idx = i;
      else break;
    }
    if (idx !== currentIndexRef.current) {
      currentIndexRef.current = idx;
      setCurrentIndex(idx);
      typedRef.current = '';
      setTyped('');
    }
    animFrameRef.current = requestAnimationFrame(syncLoop);
  }, []);

  const startGame = () => {
    if (!audioRef.current || lines.length === 0) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play();
    setGameState('playing');
    gameStateRef.current = 'playing';
    setScore({ correct: 0, miss: 0 });
    setMyRank(null);
    setCurrentIndex(-1);
    currentIndexRef.current = -1;
    setTyped('');
    typedRef.current = '';
    gameStartTimeRef.current = Date.now();
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(syncLoop);
    appRef.current?.focus();
  };

  const togglePause = useCallback(() => {
    if (!audioRef.current) return;
    if (gameStateRef.current === 'playing') {
      audioRef.current.pause();
      setGameState('paused');
      gameStateRef.current = 'paused';
      cancelAnimationFrame(animFrameRef.current);
    } else if (gameStateRef.current === 'paused') {
      audioRef.current.play();
      setGameState('playing');
      gameStateRef.current = 'playing';
      animFrameRef.current = requestAnimationFrame(syncLoop);
      appRef.current?.focus();
    }
  }, [syncLoop]);

  const stopGame = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setGameState('idle');
    gameStateRef.current = 'idle';
    cancelAnimationFrame(animFrameRef.current);
    setCurrentIndex(-1);
    currentIndexRef.current = -1;
    setTyped('');
    typedRef.current = '';
  }, []);

  const handleAudioEnd = useCallback(async () => {
    setGameState('finished');
    gameStateRef.current = 'finished';
    cancelAnimationFrame(animFrameRef.current);
    if (!lrcPath || !currentUser) return;
    const s = scoreRef.current;
    const acc = s.correct + s.miss > 0 ? Math.round((s.correct / (s.correct + s.miss)) * 100) : 100;
    const entry = { accuracy: acc, correct: s.correct, miss: s.miss, speed: playbackRate };

    if (window.electronAPI) {
      const updated = await window.electronAPI.addRanking(lrcPath, currentUser.id, entry);
      setRanking(updated);
      const allUpdated = await window.electronAPI.getAllRanking(lrcPath);
      setAllRanking(allUpdated);
      const rank = allUpdated.findIndex(r => r.accuracy === acc && r.correct === s.correct && r.miss === s.miss && r.speed === playbackRate && r.userName === currentUser.name);
      setMyRank(rank >= 0 ? rank + 1 : null);
    } else {
      // Webブラウザ (Vercel) 環境用
      try {
        const res = await fetch('/api/song-ranking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: currentUser.name,
            lrcPath,
            accuracy: acc,
            correct: s.correct,
            miss: s.miss,
            speed: playbackRate
          })
        });
        if (!res.ok) throw new Error('API failed');
        const allUpdated = await res.json();
        setAllRanking(allUpdated);
        const rank = allUpdated.findIndex((r: any) => r.accuracy === acc && r.correct === s.correct && r.miss === s.miss && r.speed === playbackRate && r.userName === currentUser.name);
        setMyRank(rank >= 0 ? rank + 1 : null);
      } catch (err) {
        console.error('Failed to save online ranking:', err);
      }
    }
  }, [lrcPath, playbackRate, currentUser]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (gameStateRef.current !== 'playing') return;
    const idx = currentIndexRef.current;
    if (idx < 0 || idx >= linesRef.current.length) return;
    const target = linesRef.current[idx].romaji;
    if (!target) return;

    if (e.key === 'Escape') { togglePause(); return; }
    if (e.key.length !== 1) return;

    const key = e.key.toLowerCase();
    const next = typedRef.current + key;

    if (target.startsWith(next)) {
      typedRef.current = next;
      setTyped(next);
      setScore(s => ({ ...s, correct: s.correct + 1 }));
    } else {
      setScore(s => ({ ...s, miss: s.miss + 1 }));
      setMissFlash(true);
      setTimeout(() => setMissFlash(false), 150);
    }
  }, [togglePause]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const currentLine = currentIndex >= 0 && currentIndex < lines.length ? lines[currentIndex] : null;
  const target = currentLine?.romaji ?? '';
  const accuracy = score.correct + score.miss > 0
    ? Math.round((score.correct / (score.correct + score.miss)) * 100)
    : 100;
  const prevLine = currentIndex > 0 ? lines[currentIndex - 1] : null;
  const nextLine = currentIndex < lines.length - 1 ? lines[currentIndex + 1] : null;

  return (
    <div className="app" tabIndex={0} ref={appRef}>
      <audio ref={audioRef} onEnded={handleAudioEnd} />

      {(showUserSelect || !currentUser) && (
        <div className="user-select-overlay">
          <div className="user-select-modal">
            <h2 className="user-select-title">プレイヤーを選択</h2>
            {users.length > 0 && (
              <ul className="user-list">
                {users.map(u => (
                  <li key={u.id} className="user-item">
                    <button className="user-select-btn" onClick={() => handleSelectUser(u)}>
                      {u.name}
                    </button>
                    <button className="user-remove-btn" onClick={() => handleRemoveUser(u.id)} title="削除">✕</button>
                  </li>
                ))}
              </ul>
            )}
            {users.length === 0 && (
              <p className="user-empty">ユーザーがいません。新しく追加してください。</p>
            )}
            <div className="user-add-row">
              <input
                className="user-name-input"
                placeholder="新しい名前を入力..."
                value={newUserName}
                onChange={e => { setNewUserName(e.target.value); setUserError(null); }}
                onKeyDown={e => e.key === 'Enter' && handleAddUser()}
                maxLength={20}
              />
              <button className="btn btn-primary user-add-btn" onClick={handleAddUser}>追加</button>
            </div>
            {userError && <div className="user-error">{userError}</div>}
            {currentUser && (
              <button
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: '8px' }}
                onClick={() => {
                  setShowUserSelect(false);
                  setUserError(null);
                }}
              >
                キャンセル
              </button>
            )}
          </div>
        </div>
      )}

      <header className="header">
        <h1>⌨ 座タッチ〜速打ち職人への道</h1>
        <div className="tab-bar">
          {currentUser && (
            <button className="user-badge" onClick={() => setShowUserSelect(true)} title="プレイヤー変更">
              👤 {currentUser.name}
            </button>
          )}
          <button
            className={`tab-btn${tab === 'mole' ? ' tab-active' : ''}`}
            onClick={() => setTab('mole')}
          >🔨 もぐらで訓練</button>
          <button
            className={`tab-btn${tab === 'typing' ? ' tab-active' : ''}`}
            onClick={() => setTab('typing')}
          >🎵 歌で訓練</button>
        </div>
      </header>

      {tab === 'mole' && <MoleGame currentUser={currentUser} users={users} />}

      {tab === 'typing' && <main className="main">
        {gameState === 'idle' && (
          <div className="typing-menu-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '1100px', margin: '0 auto', padding: '10px' }}>
            <h2 style={{ fontSize: '1.6rem', color: '#c4b5fd', textAlign: 'center', marginBottom: '4px' }}>🎵 歌でタイピング訓練</h2>
            
            <div className="typing-menu-cols" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', width: '100%', alignItems: 'start' }}>
              {/* 左カラム: プレイ準備・開始 */}
              <div style={{ background: '#16162a', border: '1px solid #2a2a4a', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '1.2rem', color: '#c4b5fd', borderBottom: '1px solid #2a2a4a', paddingBottom: '10px', margin: 0 }}>
                  🎮 訓練を開始する
                </h3>
                
                {/* ファイル読込ステータスと読込ボタン */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={loadLrc} className="btn btn-secondary" style={{ flex: 1, minWidth: '100px' }}>
                      📝 LRC読込{lrcPath && <span className="loaded"> ✓</span>}
                    </button>
                    <button onClick={loadRomajiLrc} className="btn btn-secondary" style={{ flex: 1, minWidth: '100px' }} title="ローマ字テキストのLRCを読み込む（入力用）">
                      🔤 ローマ字読込{romajiLrcPath && <span className="loaded"> ✓</span>}
                    </button>
                    <button onClick={loadAudio} className="btn btn-secondary" style={{ flex: 1, minWidth: '100px' }}>
                      🎵 音楽読込{audioPath && <span className="loaded"> ✓</span>}
                    </button>
                  </div>
                  
                  {/* ステータス表示 */}
                  <div style={{ background: '#0f0f1a', borderRadius: '8px', padding: '12px', fontSize: '0.88rem', color: '#a0a0c0', lineHeight: 1.6 }}>
                    {lines.length > 0 ? (
                      <p className="ready" style={{ color: '#4ade80', fontWeight: 'bold', margin: 0 }}>✓ {lines.length}行の歌詞を読み込みました</p>
                    ) : (
                      <p style={{ margin: 0 }}>⚠️ LRC（歌詞）ファイルを読み込んでください</p>
                    )}
                    {audioPath ? (
                      <p style={{ color: '#4ade80', fontWeight: 'bold', margin: '4px 0 0 0' }}>✓ 音楽ファイルを読み込みました</p>
                    ) : (
                      <p style={{ margin: '4px 0 0 0' }}>⚠️ 音楽ファイルを読み込んでください</p>
                    )}
                  </div>
                </div>

                {/* 入力モード設定 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1c1c3a', padding: '10px 16px', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.9rem', color: '#a0a0d0', fontWeight: 'bold' }}>入力モード:</span>
                  <div className="mode-toggle" style={{ margin: 0 }}>
                    <button
                      className={`mode-btn${!romajiMode ? ' mode-active' : ''}`}
                      onClick={() => toggleRomajiMode(false)}
                    >あ かな</button>
                    <button
                      className={`mode-btn${romajiMode ? ' mode-active' : ''}`}
                      onClick={() => toggleRomajiMode(true)}
                    >a ローマ字</button>
                  </div>
                </div>

                {/* エラー表示 */}
                {historyError && (
                  <div className="history-error" style={{ margin: 0 }}>⚠ {historyError}</div>
                )}

                {/* スタートボタン */}
                <button
                  onClick={startGame}
                  className="btn btn-primary btn-large"
                  disabled={lines.length === 0 || !audioPath}
                  style={{ width: '100%', padding: '12px' }}
                >
                  ▶ スタート
                </button>

                {/* 履歴リスト */}
                {history.length > 0 && (
                  <div className="history-section" style={{ marginTop: '10px' }}>
                    <h3 className="history-title" style={{ fontSize: '0.9rem', color: '#8080b0', marginBottom: '8px' }}>最近練習した曲</h3>
                    <ul className="history-list" style={{ maxHeight: '180px' }}>
                      {history.map(entry => (
                        <li key={entry.id} className="history-item">
                          <button
                            className="history-load-btn"
                            onClick={() => loadFromHistory(entry)}
                            title={entry.lrcPath}
                          >
                            <span className="history-name">{entry.name}</span>
                            <span className="history-date">{new Date(entry.usedAt).toLocaleDateString('ja-JP')}</span>
                          </button>
                          <button
                            className="history-remove-btn"
                            onClick={() => removeFromHistory(entry.id)}
                            title="履歴から削除"
                          >✕</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 右カラム: LRC作成 */}
              <div style={{ background: '#16162a', border: '1px solid #2a2a4a', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h3 style={{ fontSize: '1.2rem', color: '#c4b5fd', borderBottom: '1px solid #2a2a4a', paddingBottom: '10px', margin: 0 }}>
                  🕐 LRC（歌詞タイムスタンプ）作成
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#8080b0', margin: 0 }}>
                  手持ちのテキスト歌詞にタイムスタンプを付与し、タイピング用のLRCファイルを作成します。
                </p>
                <TimingMaker />
              </div>
            </div>
          </div>
        )}

        {(gameState === 'playing' || gameState === 'paused') && (
          <div className="game-area">
            <div className="lyrics-display">
              {prevLine && <div className="line line-prev">{prevLine.lrcLine.text}</div>}
              <div className={`line line-current${missFlash ? ' miss-flash' : ''}${!target ? ' line-display-only' : ''}`}>
                <div className="original-text">{currentLine?.lrcLine.text ?? '♪'}</div>
                {target ? (
                  <>
                    <div className="romaji-display">
                      <span className="typed">{target.slice(0, typed.length)}</span>
                      <span className="cursor">{target[typed.length] ?? ''}</span>
                      <span className="remaining">{target.slice(typed.length + 1)}</span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${(typed.length / target.length) * 100}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="display-only-label">♪</div>
                )}
              </div>
              {nextLine && <div className="line line-next">{nextLine.lrcLine.text}</div>}
            </div>
            {gameState === 'paused' && (
              <div className="pause-overlay">⏸ 一時停止中 — Escキーで再開</div>
            )}
          </div>
        )}

        {gameState === 'finished' && (
          <div className="result-screen">
            <h2>完了！</h2>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">正確率</span>
                <span className="stat-value">{accuracy}%</span>
              </div>
              <div className="stat">
                <span className="stat-label">正打数</span>
                <span className="stat-value">{score.correct}</span>
              </div>
              <div className="stat">
                <span className="stat-label">ミス</span>
                <span className="stat-value miss">{score.miss}</span>
              </div>
            </div>
            {myRank !== null && (
              <div className={`rank-badge${myRank === 1 ? ' rank-1' : myRank <= 3 ? ' rank-top3' : ''}`}>
                {myRank === 1 ? '🏆 1位！' : myRank <= 3 ? `🥈 ${myRank}位` : `${myRank}位`}
              </div>
            )}
            {allRanking.length > 0 && (
              <div className="ranking-section">
                <h3 className="ranking-title">ランキング（この曲・全プレイヤー）</h3>
                <table className="ranking-table">
                  <thead>
                    <tr>
                      <th>順位</th>
                      <th>名前</th>
                      <th>正確率</th>
                      <th>正打数</th>
                      <th>ミス</th>
                      <th>速度</th>
                      <th>日付</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRanking.map((r, i) => (
                      <tr key={i} className={i + 1 === myRank ? 'ranking-my-row' : ''}>
                        <td>{i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}</td>
                        <td>{r.userName}</td>
                        <td>{r.accuracy}%</td>
                        <td>{r.correct}</td>
                        <td>{r.miss}</td>
                        <td>×{r.speed}</td>
                        <td>{new Date(r.date).toLocaleDateString('ja-JP')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={startGame} className="btn btn-primary btn-large">
              もう一度
            </button>
          </div>
        )}
      </main>}

      {tab === 'typing' && <footer className="footer">
        <div className="score-bar">
          <span>正確率: <strong>{accuracy}%</strong></span>
          <span>正打: <strong>{score.correct}</strong></span>
          <span>ミス: <strong className="miss-count">{score.miss}</strong></span>
        </div>
        <div className="speed-control">
          <span className="speed-label">速度</span>
          {[0.5, 0.75, 1.0, 1.25, 1.5].map(r => (
            <button
              key={r}
              className={`speed-btn${playbackRate === r ? ' speed-active' : ''}`}
              onClick={() => changeRate(r)}
            >{r === 1.0 ? '標準' : `×${r}`}</button>
          ))}
        </div>
        {(gameState === 'playing' || gameState === 'paused') && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={togglePause} className="btn btn-small">
              {gameState === 'playing' ? '⏸ 一時停止' : '▶ 再開'}
            </button>
            {gameState === 'paused' && (
              <button onClick={startGame} className="btn btn-small">
                ⏮ 最初に戻る
              </button>
            )}
            <button onClick={stopGame} className="btn btn-small" style={{ background: '#4a1a1a', color: '#f87171', border: '1px solid #5a2a2a' }}>
              ⏹ 中止して戻る
            </button>
          </div>
        )}
      </footer>}
    </div>
  );
}
