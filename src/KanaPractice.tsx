import { useState, useEffect, useRef, useCallback } from 'react';
import { toRomaji } from 'wanakana';

const KANA_GROUPS: { label: string; kana: string[] }[] = [
  { label: 'あ行', kana: ['あ', 'い', 'う', 'え', 'お'] },
  { label: 'か行', kana: ['か', 'き', 'く', 'け', 'こ'] },
  { label: 'さ行', kana: ['さ', 'し', 'す', 'せ', 'そ'] },
  { label: 'た行', kana: ['た', 'ち', 'つ', 'て', 'と'] },
  { label: 'な行', kana: ['な', 'に', 'ぬ', 'ね', 'の'] },
  { label: 'は行', kana: ['は', 'ひ', 'ふ', 'へ', 'ほ'] },
  { label: 'ま行', kana: ['ま', 'み', 'む', 'め', 'も'] },
  { label: 'や行', kana: ['や', 'ゆ', 'よ'] },
  { label: 'ら行', kana: ['ら', 'り', 'る', 'れ', 'ろ'] },
  { label: 'わ行', kana: ['わ', 'を', 'ん'] },
  { label: 'が行', kana: ['が', 'ぎ', 'ぐ', 'げ', 'ご'] },
  { label: 'ざ行', kana: ['ざ', 'じ', 'ず', 'ぜ', 'ぞ'] },
  { label: 'だ行', kana: ['だ', 'ぢ', 'づ', 'で', 'ど'] },
  { label: 'ば行', kana: ['ば', 'び', 'ぶ', 'べ', 'ぼ'] },
  { label: 'ぱ行', kana: ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'] },
  {
    label: '拗音', kana: [
      'きゃ', 'きゅ', 'きょ', 'しゃ', 'しゅ', 'しょ',
      'ちゃ', 'ちゅ', 'ちょ', 'にゃ', 'にゅ', 'にょ',
      'ひゃ', 'ひゅ', 'ひょ', 'みゃ', 'みゅ', 'みょ',
      'りゃ', 'りゅ', 'りょ', 'ぎゃ', 'ぎゅ', 'ぎょ',
      'じゃ', 'じゅ', 'じょ', 'びゃ', 'びゅ', 'びょ',
      'ぴゃ', 'ぴゅ', 'ぴょ',
    ],
  },
];

const ROMAJI_ALTS: Record<string, string[]> = {
  'し': ['shi', 'si'],
  'ち': ['chi', 'ti'],
  'つ': ['tsu', 'tu'],
  'ふ': ['fu', 'hu'],
  'じ': ['ji', 'zi'],
  'ぢ': ['di', 'ji'],
  'づ': ['du', 'zu'],
  'しゃ': ['sha', 'sya'],
  'しゅ': ['shu', 'syu'],
  'しょ': ['sho', 'syo'],
  'ちゃ': ['cha', 'tya', 'cya'],
  'ちゅ': ['chu', 'tyu', 'cyu'],
  'ちょ': ['cho', 'tyo', 'cyo'],
  'じゃ': ['ja', 'jya', 'zya'],
  'じゅ': ['ju', 'jyu', 'zyu'],
  'じょ': ['jo', 'jyo', 'zyo'],
};

function getAccepted(kana: string): string[] {
  return ROMAJI_ALTS[kana] ?? [toRomaji(kana).toLowerCase()];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- ranking ----

interface RankEntry {
  correct: number;
  miss: number;
  accuracy: number;
  date: string;
  userName: string;
}

interface UserEntry {
  id: string;
  name: string;
}

function rankKey(timeLimit: number, groupKey: string) {
  return `kanaRanking_${timeLimit}_${groupKey}`;
}

function loadRanking(timeLimit: number, groupKey: string): RankEntry[] {
  try {
    return JSON.parse(localStorage.getItem(rankKey(timeLimit, groupKey)) ?? '[]');
  } catch { return []; }
}

function addToRanking(timeLimit: number, groupKey: string, entry: RankEntry): { entries: RankEntry[]; rank: number } {
  const existing = loadRanking(timeLimit, groupKey);
  const updated = [...existing, entry]
    .sort((a, b) => b.correct - a.correct || b.accuracy - a.accuracy)
    .slice(0, 10);
  localStorage.setItem(rankKey(timeLimit, groupKey), JSON.stringify(updated));
  const rank = updated.findIndex(e => e.date === entry.date) + 1;
  return { entries: updated, rank };
}

// ---- component ----

const TIME_OPTIONS = [30, 60, 90] as const;
type TimeLimit = typeof TIME_OPTIONS[number];
type Phase = 'select' | 'playing' | 'result';

export default function KanaPractice({ currentUser }: { currentUser: UserEntry | null }) {
  const [phase, setPhase] = useState<Phase>('select');
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [timeLimit, setTimeLimit] = useState<TimeLimit>(60);

  // playing state
  const [queue, setQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [target, setTarget] = useState('');
  const [timeLeft, setTimeLeft] = useState(60);
  const [score, setScore] = useState({ correct: 0, miss: 0 });
  const [flash, setFlash] = useState<'correct' | 'miss' | null>(null);

  // result state
  const [ranking, setRanking] = useState<RankEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scoreRef = useRef({ correct: 0, miss: 0 });
  const queueRef = useRef<string[]>([]);
  const queueIndexRef = useRef(0);
  const typedRef = useRef('');
  const targetRef = useRef('');

  const groupKey = [...selectedGroups].sort().join('-');
  const totalKana = [...selectedGroups].reduce((acc, i) => acc + KANA_GROUPS[i].kana.length, 0);

  const triggerFlash = (type: 'correct' | 'miss') => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(type);
    flashTimer.current = setTimeout(() => setFlash(null), 220);
  };

  const finishGame = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const s = scoreRef.current;
    const accuracy = s.correct + s.miss === 0
      ? 100
      : Math.round((s.correct / (s.correct + s.miss)) * 100);
    const entry: RankEntry = { correct: s.correct, miss: s.miss, accuracy, date: new Date().toISOString(), userName: currentUser?.name ?? '??' };
    const { entries, rank } = addToRanking(timeLimit, groupKey, entry);
    setRanking(entries);
    setMyRank(rank);
    setPhase('result');
  }, [timeLimit, groupKey]);

  const startGame = useCallback(() => {
    const kanaList = KANA_GROUPS.filter((_, i) => selectedGroups.has(i)).flatMap(g => g.kana);
    if (kanaList.length === 0) return;
    const shuffled = shuffle(kanaList);
    const initialTarget = getAccepted(shuffled[0])[0];

    setQueue(shuffled);
    setQueueIndex(0);
    setTyped('');
    setTarget(initialTarget);
    setTimeLeft(timeLimit);
    setScore({ correct: 0, miss: 0 });
    setFlash(null);

    queueRef.current = shuffled;
    queueIndexRef.current = 0;
    typedRef.current = '';
    targetRef.current = initialTarget;
    scoreRef.current = { correct: 0, miss: 0 };

    setPhase('playing');
  }, [selectedGroups, timeLimit]);

  // countdown timer
  useEffect(() => {
    if (phase !== 'playing') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          finishGame();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, finishGame]);

  // keydown handler
  useEffect(() => {
    if (phase !== 'playing') return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { finishGame(); return; }
      const char = e.key.toLowerCase();
      if (!/^[a-z\-]$/.test(char)) return;

      const newTyped = typedRef.current + char;
      const currentKana = queueRef.current[queueIndexRef.current];
      const alts = getAccepted(currentKana);
      const matches = alts.filter(r => r.startsWith(newTyped));

      if (matches.length === 0) {
        scoreRef.current = { ...scoreRef.current, miss: scoreRef.current.miss + 1 };
        setScore({ ...scoreRef.current });
        triggerFlash('miss');
        return;
      }

      const newTarget = matches[0];
      targetRef.current = newTarget;
      typedRef.current = newTyped;
      setTyped(newTyped);
      setTarget(newTarget);

      if (matches.some(r => r === newTyped)) {
        scoreRef.current = { ...scoreRef.current, correct: scoreRef.current.correct + 1 };
        setScore({ ...scoreRef.current });
        triggerFlash('correct');

        // advance to next kana (cycle queue if exhausted)
        let nextIdx = queueIndexRef.current + 1;
        let nextQueue = queueRef.current;
        if (nextIdx >= nextQueue.length) {
          nextQueue = shuffle(nextQueue);
          nextIdx = 0;
          queueRef.current = nextQueue;
          setQueue([...nextQueue]);
        }
        queueIndexRef.current = nextIdx;
        const nextKana = nextQueue[nextIdx];
        const nextTarget = getAccepted(nextKana)[0];
        targetRef.current = nextTarget;
        typedRef.current = '';
        setQueueIndex(nextIdx);
        setTyped('');
        setTarget(nextTarget);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [phase, finishGame]);

  const toggleGroup = (i: number) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  // ---- select screen ----
  if (phase === 'select') {
    const savedRanking = loadRanking(timeLimit, groupKey);
    return (
      <main className="main">
        <div style={{ maxWidth: '760px', margin: '0 auto', padding: '20px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ fontSize: '1.6rem', color: '#c4b5fd', textAlign: 'center', margin: 0 }}>🈶 かなタイムアタック</h2>

          <div style={{ background: '#16162a', border: '1px solid #2a2a4a', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* time limit */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#a0a0c0', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>制限時間:</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {TIME_OPTIONS.map(t => (
                  <button
                    key={t}
                    onClick={() => setTimeLimit(t)}
                    style={{
                      padding: '6px 18px',
                      borderRadius: '8px',
                      border: timeLimit === t ? '2px solid #a78bfa' : '1px solid #2a2a4a',
                      background: timeLimit === t ? '#3b1f6e' : '#1c1c3a',
                      color: timeLimit === t ? '#e9d5ff' : '#a0a0c0',
                      cursor: 'pointer',
                      fontWeight: timeLimit === t ? 'bold' : 'normal',
                      fontSize: '0.9rem',
                    }}
                  >{t}秒</button>
                ))}
              </div>
            </div>

            {/* group select */}
            <div>
              <p style={{ color: '#a0a0c0', margin: '0 0 10px 0', fontSize: '0.88rem' }}>練習する行（複数選択可）</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: '7px' }}>
                {KANA_GROUPS.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => toggleGroup(i)}
                    style={{
                      padding: '8px 6px',
                      borderRadius: '8px',
                      border: selectedGroups.has(i) ? '2px solid #a78bfa' : '1px solid #2a2a4a',
                      background: selectedGroups.has(i) ? '#3b1f6e' : '#1c1c3a',
                      color: selectedGroups.has(i) ? '#e9d5ff' : '#a0a0c0',
                      cursor: 'pointer',
                      fontSize: '0.88rem',
                      fontWeight: selectedGroups.has(i) ? 'bold' : 'normal',
                      textAlign: 'center',
                    }}
                  >
                    <div>{g.label}</div>
                    <div style={{ fontSize: '0.74rem', color: selectedGroups.has(i) ? '#c4b5fd' : '#505070', marginTop: '2px' }}>
                      {g.kana.slice(0, 3).join(' ')}{g.kana.length > 3 ? '…' : ''}
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button onClick={() => setSelectedGroups(new Set(KANA_GROUPS.map((_, i) => i)))}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #2a2a4a', background: '#1c1c3a', color: '#a0a0c0', cursor: 'pointer', fontSize: '0.82rem' }}>全選択</button>
                <button onClick={() => setSelectedGroups(new Set())}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #2a2a4a', background: '#1c1c3a', color: '#a0a0c0', cursor: 'pointer', fontSize: '0.82rem' }}>全解除</button>
              </div>
            </div>

            <button
              onClick={startGame}
              disabled={selectedGroups.size === 0}
              className="btn btn-primary btn-large"
              style={{ width: '100%' }}
            >
              ▶ スタート（{timeLimit}秒 / {totalKana}文字プール）
            </button>
          </div>

          {/* ranking preview */}
          {savedRanking.length > 0 && (
            <div style={{ background: '#16162a', border: '1px solid #2a2a4a', borderRadius: '16px', padding: '20px' }}>
              <h3 style={{ color: '#c4b5fd', margin: '0 0 12px 0', fontSize: '1rem' }}>🏆 ランキング（{timeLimit}秒）</h3>
              <RankingTable entries={savedRanking} myRank={null} />
            </div>
          )}
        </div>
      </main>
    );
  }

  // ---- result screen ----
  if (phase === 'result') {
    const accuracy = score.correct + score.miss === 0
      ? 100
      : Math.round((score.correct / (score.correct + score.miss)) * 100);
    return (
      <main className="main">
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="result-screen" style={{ margin: 0 }}>
            <h2>タイム終了！</h2>
            <div className="stats">
              <div className="stat"><span className="stat-label">正打数</span><span className="stat-value">{score.correct}</span></div>
              <div className="stat"><span className="stat-label">ミス</span><span className="stat-value miss">{score.miss}</span></div>
              <div className="stat"><span className="stat-label">正確率</span><span className="stat-value">{accuracy}%</span></div>
            </div>
            {myRank !== null && (
              <div className={`rank-badge${myRank === 1 ? ' rank-1' : myRank <= 3 ? ' rank-top3' : ''}`}>
                {myRank === 1 ? '🏆 1位！' : myRank <= 3 ? `🥈 ${myRank}位` : `${myRank}位`}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' }}>
              <button onClick={startGame} className="btn btn-primary btn-large">もう一度</button>
              <button onClick={() => setPhase('select')} className="btn btn-secondary btn-large">設定に戻る</button>
            </div>
          </div>

          {ranking.length > 0 && (
            <div style={{ background: '#16162a', border: '1px solid #2a2a4a', borderRadius: '16px', padding: '20px' }}>
              <h3 style={{ color: '#c4b5fd', margin: '0 0 12px 0', fontSize: '1rem' }}>🏆 ランキング（{timeLimit}秒）</h3>
              <RankingTable entries={ranking} myRank={myRank} />
            </div>
          )}
        </div>
      </main>
    );
  }

  // ---- playing screen ----
  const kanaColor = flash === 'correct' ? '#4ade80' : flash === 'miss' ? '#f87171' : '#e9d5ff';
  const kanaGlow = flash === 'correct'
    ? '0 0 40px #4ade80, 0 0 80px #4ade8060'
    : flash === 'miss'
      ? '0 0 40px #f87171, 0 0 80px #f8717160'
      : 'none';

  const timerPct = (timeLeft / timeLimit) * 100;
  const timerColor = timeLeft <= 10 ? '#f87171' : timeLeft <= 20 ? '#fbbf24' : '#a78bfa';

  return (
    <main className="main" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0' }}>
      {/* timer bar */}
      <div style={{ width: '100%', maxWidth: '500px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>正打: {score.correct} / ミス: {score.miss}</span>
          <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: timerColor, fontVariantNumeric: 'tabular-nums' }}>
            {timeLeft}s
          </span>
        </div>
        <div style={{ height: '8px', background: '#1c1c3a', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${timerPct}%`,
            background: timerColor,
            borderRadius: '4px',
            transition: 'width 0.9s linear, background 0.3s',
          }} />
        </div>
      </div>

      {/* kana display */}
      <div style={{
        fontSize: 'clamp(5rem, 20vw, 9rem)',
        lineHeight: 1,
        color: kanaColor,
        textShadow: kanaGlow,
        transition: 'color 0.1s, text-shadow 0.1s',
        marginBottom: '28px',
        fontWeight: 'bold',
        userSelect: 'none',
      }}>
        {queue[queueIndex] ?? ''}
      </div>

      {/* romaji input display */}
      <div className="romaji-display" style={{ fontSize: '2.2rem', letterSpacing: '0.12em' }}>
        <span className="typed">{target.slice(0, typed.length)}</span>
        <span className="cursor">{target[typed.length] ?? ''}</span>
        <span className="remaining">{target.slice(typed.length + 1)}</span>
      </div>

      <div style={{ marginTop: '32px', fontSize: '0.82rem', color: '#4b5563' }}>
        Esc キーで終了
      </div>
    </main>
  );
}

// ---- sub-component ----

function RankingTable({ entries, myRank }: { entries: RankEntry[]; myRank: number | null }) {
  const medals = ['🏆', '🥈', '🥉'];
  return (
    <table className="ranking-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>順位</th>
          <th>名前</th>
          <th>正打数</th>
          <th>ミス</th>
          <th>正確率</th>
          <th>日付</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} className={i + 1 === myRank ? 'ranking-my-row' : ''}>
            <td>{medals[i] ?? `${i + 1}`}</td>
            <td>{e.userName}</td>
            <td><strong>{e.correct}</strong></td>
            <td>{e.miss}</td>
            <td>{e.accuracy}%</td>
            <td>{new Date(e.date).toLocaleDateString('ja-JP')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
