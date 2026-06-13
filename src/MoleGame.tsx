import { useState, useEffect, useRef, useCallback } from 'react';
import { sfx } from './utils/audioSynth';

// ============ 指とキーのマッピング ============
type Finger = 'L-pinky' | 'L-ring' | 'L-middle' | 'L-index' | 'R-index' | 'R-middle' | 'R-ring' | 'R-pinky';

const FINGER_KEYS: Record<Finger, string[]> = {
  'L-pinky': ['q', 'a', 'z'],
  'L-ring': ['w', 's', 'x'],
  'L-middle': ['e', 'd', 'c'],
  'L-index': ['r', 'f', 'v', 't', 'g', 'b'],
  'R-index': ['y', 'h', 'n', 'u', 'j', 'm'],
  'R-middle': ['i', 'k', ','],
  'R-ring': ['o', 'l', '.'],
  'R-pinky': ['p', ';', '/'],
};

const KEY_TO_FINGER: Record<string, Finger> = {};
for (const [finger, keys] of Object.entries(FINGER_KEYS)) {
  for (const k of keys) KEY_TO_FINGER[k] = finger as Finger;
}

const KEYBOARD_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

const HOME_KEYS = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];

const FINGER_LABEL: Record<Finger, string> = {
  'L-pinky': '左小指', 'L-ring': '左薬指', 'L-middle': '左中指', 'L-index': '左人差し指',
  'R-index': '右人差し指', 'R-middle': '右中指', 'R-ring': '右薬指', 'R-pinky': '右小指',
};

// ============ ステージ定義 ============
interface StageDef {
  id: string;
  name: string;
  desc: string;
  keys: string[];
  clearScore: number;
  duration: number;
  spawnDelay: [number, number]; // [min, max] ms
  moleTtl: number;
  useGolden: boolean;
  useBomb: boolean;
  useHelmet: boolean;
  strictMiss: boolean; // ホームポジションモード: 担当外キーで即ミス
  endless: boolean;
  maxMoles: number;
}

const STAGES: StageDef[] = [
  {
    id: 'index', name: '👆 人差し指ステージ', desc: '左右の人差し指だけで叩こう（F・Jから動かす）',
    keys: [...FINGER_KEYS['L-index'], ...FINGER_KEYS['R-index']],
    clearScore: 300, duration: 60, spawnDelay: [900, 1500], moleTtl: 2800,
    useGolden: false, useBomb: false, useHelmet: false, strictMiss: false, endless: false, maxMoles: 1,
  },
  {
    id: 'middle', name: '🖕 中指ステージ', desc: '左右の中指だけで叩こう（D・Kから動かす）',
    keys: [...FINGER_KEYS['L-middle'], ...FINGER_KEYS['R-middle']],
    clearScore: 300, duration: 60, spawnDelay: [900, 1500], moleTtl: 2800,
    useGolden: false, useBomb: false, useHelmet: false, strictMiss: false, endless: false, maxMoles: 1,
  },
  {
    id: 'ring', name: '💍 薬指ステージ', desc: '左右の薬指だけで叩こう（S・Lから動かす）',
    keys: [...FINGER_KEYS['L-ring'], ...FINGER_KEYS['R-ring']],
    clearScore: 250, duration: 60, spawnDelay: [1000, 1600], moleTtl: 3000,
    useGolden: false, useBomb: false, useHelmet: false, strictMiss: false, endless: false, maxMoles: 1,
  },
  {
    id: 'pinky', name: '🤙 小指ステージ', desc: '左右の小指だけで叩こう（A・;から動かす）',
    keys: [...FINGER_KEYS['L-pinky'], ...FINGER_KEYS['R-pinky']],
    clearScore: 250, duration: 60, spawnDelay: [1000, 1700], moleTtl: 3200,
    useGolden: false, useBomb: false, useHelmet: false, strictMiss: false, endless: false, maxMoles: 1,
  },
  {
    id: 'combo-adjacent', name: '🤝 同手・隣接連携', desc: '隣り合う指の切り替え！ゴールデンモグラ出現',
    keys: [...FINGER_KEYS['L-index'], ...FINGER_KEYS['L-middle'], ...FINGER_KEYS['R-index'], ...FINGER_KEYS['R-middle']],
    clearScore: 400, duration: 60, spawnDelay: [800, 1300], moleTtl: 2500,
    useGolden: true, useBomb: false, useHelmet: false, strictMiss: false, endless: false, maxMoles: 1,
  },
  {
    id: 'combo-cross', name: '✖ クロス連携', desc: '全部の指を使え！爆弾に注意',
    keys: KEYBOARD_ROWS.flat(),
    clearScore: 450, duration: 60, spawnDelay: [800, 1300], moleTtl: 2500,
    useGolden: true, useBomb: true, useHelmet: false, strictMiss: false, endless: false, maxMoles: 1,
  },
  {
    id: 'homepos', name: '🏠 ホームポジション維持', desc: '担当外のキーを押すと即ミス！Shiftモグラ出現',
    keys: KEYBOARD_ROWS.flat(),
    clearScore: 500, duration: 60, spawnDelay: [700, 1200], moleTtl: 2300,
    useGolden: true, useBomb: true, useHelmet: true, strictMiss: true, endless: false, maxMoles: 2,
  },
  {
    id: 'endless', name: '♾ 無限モグラたたき', desc: 'どこまで叩ける？レベルが上がるほど高速に！',
    keys: KEYBOARD_ROWS.flat(),
    clearScore: Infinity, duration: Infinity, spawnDelay: [900, 1400], moleTtl: 2500,
    useGolden: true, useBomb: true, useHelmet: true, strictMiss: false, endless: true, maxMoles: 3,
  },
];

// ============ モグラ ============
type MoleType = 'normal' | 'golden' | 'bomb' | 'helmet';

interface Mole {
  id: number;
  key: string;
  type: MoleType;
  bornAt: number;
  ttl: number;
  customImageUrl?: string;
}

// もぐら本体（アップロード画像のイメージ：オレンジの体・黒い目と鼻・白い爪）
function MoleFace({ type }: { type: 'normal' | 'golden' | 'helmet' }) {
  const body = type === 'golden' ? '#f3c44d' : '#d98c3f';
  const belly = type === 'golden' ? '#f9e09a' : '#e8b275';
  return (
    <svg viewBox="0 0 48 46" className="mole-svg">
      {/* 耳 */}
      <circle cx="13" cy="9" r="5.5" fill={body} />
      <circle cx="35" cy="9" r="5.5" fill={body} />
      <circle cx="13" cy="9" r="2.6" fill={belly} />
      <circle cx="35" cy="9" r="2.6" fill={belly} />
      {/* 体 */}
      <ellipse cx="24" cy="27" rx="19" ry="18" fill={body} />
      {/* おなか */}
      <ellipse cx="24" cy="35" rx="11" ry="8.5" fill={belly} />
      {/* 目 */}
      <circle cx="17" cy="21" r="2.7" fill="#221a14" />
      <circle cx="31" cy="21" r="2.7" fill="#221a14" />
      <circle cx="17.9" cy="20.2" r="0.9" fill="#fff" />
      <circle cx="31.9" cy="20.2" r="0.9" fill="#fff" />
      {/* 鼻まわり */}
      <ellipse cx="24" cy="28" rx="5.2" ry="3.8" fill={belly} />
      <ellipse cx="24" cy="26.3" rx="2.4" ry="1.8" fill="#221a14" />
      <path d="M24 28.2 v2.2 M24 30.4 q-2 1.6 -3.6 0.6 M24 30.4 q2 1.6 3.6 0.6" stroke="#221a14" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      {/* 爪 */}
      <g fill="#f5f0e8" stroke="#cfc4b4" strokeWidth="0.5">
        <ellipse cx="11" cy="42" rx="1.7" ry="3.2" />
        <ellipse cx="15" cy="43" rx="1.7" ry="3.2" />
        <ellipse cx="19" cy="43.5" rx="1.7" ry="3.2" />
        <ellipse cx="29" cy="43.5" rx="1.7" ry="3.2" />
        <ellipse cx="33" cy="43" rx="1.7" ry="3.2" />
        <ellipse cx="37" cy="42" rx="1.7" ry="3.2" />
      </g>
      {/* ヘルメット（Shiftもぐら） */}
      {type === 'helmet' && (
        <g>
          <path d="M10 16 a14 12 0 0 1 28 0 v1.5 a1.5 1.5 0 0 1 -1.5 1.5 h-25 a1.5 1.5 0 0 1 -1.5 -1.5 z" fill="#38bdf8" stroke="#1e7fb0" strokeWidth="1.2" />
          <rect x="21" y="4" width="6" height="4" rx="1.5" fill="#fbbf24" stroke="#1e7fb0" strokeWidth="0.8" />
        </g>
      )}
    </svg>
  );
}

function CustomMoleFace({ type, imageUrl }: { type: 'normal' | 'golden' | 'helmet'; imageUrl: string }) {
  const style: React.CSSProperties = type === 'golden' ? {
    filter: 'sepia(0.5) saturate(3) hue-rotate(10deg) drop-shadow(0 0 5px rgba(251,191,36,0.9))'
  } : {};

  return (
    <div className="custom-mole-container">
      <img src={imageUrl} className="mole-custom-img" style={style} alt="custom mole" />
      {type === 'helmet' && (
        <svg viewBox="0 0 48 46" className="mole-helmet-overlay">
          <path d="M10 16 a14 12 0 0 1 28 0 v1.5 a1.5 1.5 0 0 1 -1.5 1.5 h-25 a1.5 1.5 0 0 1 -1.5 -1.5 z" fill="#38bdf8" stroke="#1e7fb0" strokeWidth="1.2" />
          <rect x="21" y="4" width="6" height="4" rx="1.5" fill="#fbbf24" stroke="#1e7fb0" strokeWidth="0.8" />
        </svg>
      )}
    </div>
  );
}

// ============ 永続データ ============
interface MoleScoreRecord {
  userName: string;
  stageId: string;
  gameMode: 'score' | 'timeAttack' | 'atoz';
  score: number;
  time: number;
  accuracy: number;
  endlessLevel: number;
  date: number;
}

interface FingerStat {
  hits: number;
  misses: number;
  totalReactionMs: number;
}

interface MoleProgress {
  cleared: string[];
  highScores: Record<string, number>;
  timeAttackBests?: Record<string, number>;
  timeAttackAccuracies?: Record<string, number>;
  fingerStats: Record<string, FingerStat>;
  endlessBestLevel: number;
}

function loadProgressForUser(user: { id: string; name: string } | null): MoleProgress {
  const key = user ? `moleGameProgress_${user.id}` : 'moleGameProgress';
  const defaults: MoleProgress = { cleared: [], highScores: {}, timeAttackBests: {}, timeAttackAccuracies: {}, fingerStats: {}, endlessBestLevel: 0 };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 古い・破損したデータでもフィールド欠損でクラッシュしないよう補完
      return {
        cleared: Array.isArray(parsed?.cleared) ? parsed.cleared : [],
        highScores: parsed?.highScores && typeof parsed.highScores === 'object' ? parsed.highScores : {},
        timeAttackBests: parsed?.timeAttackBests && typeof parsed.timeAttackBests === 'object' ? parsed.timeAttackBests : {},
        timeAttackAccuracies: parsed?.timeAttackAccuracies && typeof parsed.timeAttackAccuracies === 'object' ? parsed.timeAttackAccuracies : {},
        fingerStats: parsed?.fingerStats && typeof parsed.fingerStats === 'object' ? parsed.fingerStats : {},
        endlessBestLevel: typeof parsed?.endlessBestLevel === 'number' ? parsed.endlessBestLevel : 0,
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveProgressForUser(p: MoleProgress, user: { id: string; name: string } | null) {
  const key = user ? `moleGameProgress_${user.id}` : 'moleGameProgress';
  localStorage.setItem(key, JSON.stringify(p));
}



function fingerFeedback(stat: FingerStat | undefined, finger: Finger): string {
  if (!stat || stat.hits + stat.misses < 5) return 'まだデータ不足。モグラを叩いて鍛えよう！';
  const missRate = Math.round((stat.misses / (stat.hits + stat.misses)) * 100);
  const avgMs = stat.hits > 0 ? Math.round(stat.totalReactionMs / stat.hits) : 0;
  if (missRate > 40) return `誤打率${missRate}%…この指はまだ見習いモグラ。特訓だ！`;
  if (avgMs > 1200) return `反応${avgMs}ms。${FINGER_LABEL[finger]}はおねぼうさん💤`;
  if (avgMs < 600 && missRate < 15) return `反応${avgMs}ms・誤打率${missRate}%。もはやモグラの天敵！🏆`;
  return `反応${avgMs}ms・誤打率${missRate}%。順調に成長中！`;
}

// ============ メインコンポーネント ============
type Phase = 'menu' | 'playing' | 'result' | 'stats';

let moleIdCounter = 0;

interface MoleGameProps {
  currentUser: { id: string; name: string } | null;
  users: { id: string; name: string }[];
}

export default function MoleGame({ currentUser, users }: MoleGameProps) {
  const [phase, setPhase] = useState<Phase>('menu');
  const [progress, setProgress] = useState<MoleProgress>(() => loadProgressForUser(currentUser));

  useEffect(() => {
    setProgress(loadProgressForUser(currentUser));
  }, [currentUser]);
  const [moleScale, setMoleScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('moleGameScale');
      return saved ? parseFloat(saved) : 1.2;
    } catch {
      return 1.2;
    }
  });
  const [stage, setStage] = useState<StageDef | null>(null);
  const [customImagePaths, setCustomImagePaths] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('customMoleImagePaths');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((p): p is string => typeof p === 'string');
        }
      }
    } catch { /* ignore */ }
    return [];
  });
  const [customImageUrls, setCustomImageUrls] = useState<string[]>([]);

  const loadCustomImages = useCallback(async (paths: string[]) => {
    if (!window.electronAPI) {
      // Webブラウザ (Vercel) 環境用: pathsに入っているBase64形式のData URLをそのままURL配列にセット
      const urls = paths.filter(p => typeof p === 'string' && p.startsWith('data:image/'));
      setCustomImageUrls(urls);
      return;
    }
    
    // Electron環境用（ローカルファイルバッファの読み込み）
    try {
      const urls: string[] = [];
      const arrayToLoad = Array.isArray(paths) ? paths : [paths];
      for (const path of arrayToLoad) {
        if (typeof path !== 'string') continue;
        const buf = await window.electronAPI.readFileBuffer(path);
        if (buf) {
          const ext = path.split('.').pop()?.toLowerCase();
          const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const blob = new Blob([buf], { type: mime });
          const url = URL.createObjectURL(blob);
          urls.push(url);
        }
      }
      setCustomImageUrls(urls);
    } catch (err) {
      console.error('Failed to load custom mole images:', err);
    }
  }, []);

  useEffect(() => {
    if (customImagePaths.length > 0) {
      loadCustomImages(customImagePaths);
    } else {
      setCustomImageUrls([]);
    }
  }, [customImagePaths, loadCustomImages]);

  const handleAddCustomImage = async () => {
    if (window.electronAPI) {
      // Electron環境用
      const path = await window.electronAPI.openFileDialog([
        { name: '画像ファイル', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
      ]);
      if (path && !customImagePaths.includes(path)) {
        const updated = [...customImagePaths, path];
        setCustomImagePaths(updated);
        localStorage.setItem('customMoleImagePaths', JSON.stringify(updated));
      }
    } else {
      // Webブラウザ (Vercel) 環境用
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // 容量制限 (ブラウザのlocalStorage上限は約5MBのため、1.5MB以下に制限)
        if (file.size > 1024 * 1024 * 1.5) {
          alert('画像のファイルサイズが大きすぎます。1.5MB以下の画像を選択してください。');
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          if (dataUrl && !customImagePaths.includes(dataUrl)) {
            // 容量を圧迫しないよう、最大5枚までにトリム
            const updated = [...customImagePaths, dataUrl].slice(-5);
            setCustomImagePaths(updated);
            try {
              localStorage.setItem('customMoleImagePaths', JSON.stringify(updated));
            } catch (err) {
              console.error('Failed to save custom image to localStorage:', err);
              alert('ローカルストレージの容量制限を超えました。不要な画像を削除するか、より小さいサイズの画像を選択してください。');
            }
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }
  };

  const handleRemoveCustomImage = (idxToRemove: number) => {
    const updated = customImagePaths.filter((_, i) => i !== idxToRemove);
    setCustomImagePaths(updated);
    localStorage.setItem('customMoleImagePaths', JSON.stringify(updated));
  };

  const handleClearCustomImages = () => {
    setCustomImagePaths([]);
    localStorage.removeItem('customMoleImagePaths');
  };
  const TIME_ATTACK_TARGET = 30;

  const ATOZ_STAGE: StageDef = {
    id: 'atoz',
    name: '🔤 A～Z タイムアタック',
    desc: 'AからZまでのキーを順番にタイピングしよう！キーの位置を覚えるのに最適。',
    keys: KEYBOARD_ROWS.flat(),
    clearScore: 0,
    duration: Infinity,
    spawnDelay: [0, 0],
    moleTtl: Infinity,
    useGolden: false,
    useBomb: false,
    useHelmet: false,
    strictMiss: false,
    endless: false,
    maxMoles: 1,
  };

  const [gameMode, setGameMode] = useState<'score' | 'timeAttack' | 'atoz'>(() => {
    try {
      const saved = localStorage.getItem('moleGameMode');
      return (saved === 'score' || saved === 'timeAttack' || saved === 'atoz') ? saved : 'score';
    } catch {
      return 'score';
    }
  });

  const handleGameModeChange = (mode: 'score' | 'timeAttack' | 'atoz') => {
    setGameMode(mode);
    localStorage.setItem('moleGameMode', mode);
    if (mode === 'atoz') {
      setSelectedRankStage('atoz');
    } else if (selectedRankStage === 'atoz' || (mode === 'timeAttack' && selectedRankStage === 'endless')) {
      setSelectedRankStage(STAGES[0].id);
    }
  };

  const [hitsCount, setHitsCount] = useState(0);
  const [correctKeys, setCorrectKeys] = useState(0);
  const [missedKeys, setMissedKeys] = useState(0);

  const [moles, setMoles] = useState<Mole[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [, setMaxCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [hitEffect, setHitEffect] = useState<{ key: string; type: 'hit' | 'miss' | 'bomb' } | null>(null);
  const [lastResult, setLastResult] = useState<{
    cleared: boolean;
    score: number;
    maxCombo: number;
    level: number;
    timeElapsed?: number;
    accuracy?: number;
    isTimeAttack?: boolean;
  } | null>(null);
  const [selectedRankStage, setSelectedRankStage] = useState<string>(STAGES[0].id);

  const [rankings, setRankings] = useState<any[]>([]);

  const fetchRankings = useCallback(async () => {
    const targetStage = gameMode === 'atoz' ? 'atoz' : selectedRankStage;

    if (window.electronAPI) {
      try {
        const globalKey = 'moleGameGlobalScores';
        let rawScores = localStorage.getItem(globalKey);
        
        // 既存の個人ハイスコアデータからグローバルランキングへの移行（初回のみ）
        if (!rawScores && users && Array.isArray(users)) {
          const initialScores: MoleScoreRecord[] = [];
          for (const u of users) {
            try {
              const userKey = `moleGameProgress_${u.id}`;
              const userRaw = localStorage.getItem(userKey);
              if (userRaw) {
                const parsed = JSON.parse(userRaw);
                // スコアモード
                if (parsed?.highScores && typeof parsed.highScores === 'object') {
                  for (const [stageId, score] of Object.entries(parsed.highScores)) {
                    if (typeof score === 'number' && score > 0) {
                      const isEndless = stageId === 'endless';
                      initialScores.push({
                        userName: u.name,
                        stageId,
                        gameMode: 'score',
                        score,
                        time: Infinity,
                        accuracy: 0,
                        endlessLevel: isEndless ? (parsed.endlessBestLevel || 1) : 0,
                        date: Date.now()
                      });
                    }
                  }
                }
                // タイムアタックモード & A-to-Z
                if (parsed?.timeAttackBests && typeof parsed.timeAttackBests === 'object') {
                  for (const [stageId, time] of Object.entries(parsed.timeAttackBests)) {
                    if (typeof time === 'number' && time < Infinity) {
                      const accuracy = parsed.timeAttackAccuracies?.[stageId] || 0;
                      initialScores.push({
                        userName: u.name,
                        stageId,
                        gameMode: stageId === 'atoz' ? 'atoz' : 'timeAttack',
                        score: 0,
                        time,
                        accuracy,
                        endlessLevel: 0,
                        date: Date.now()
                      });
                    }
                  }
                }
              }
            } catch { /* ignore */ }
          }
          if (initialScores.length > 0) {
            localStorage.setItem(globalKey, JSON.stringify(initialScores));
            rawScores = JSON.stringify(initialScores);
          }
        }

        if (!rawScores) {
          setRankings([]);
          return;
        }
        const scoresList: MoleScoreRecord[] = JSON.parse(rawScores);
        const filtered = scoresList
          .filter(r => r.stageId === targetStage && r.gameMode === gameMode)
          .map(r => ({
            userName: r.userName,
            time: r.time,
            accuracy: r.accuracy,
            isTimeAttack: r.gameMode === 'timeAttack' || r.gameMode === 'atoz',
            score: r.score,
            endlessLevel: r.endlessLevel,
            isEndless: r.stageId === 'endless'
          }))
          .sort((a, b) => {
            if (a.isTimeAttack && b.isTimeAttack) return a.time - b.time;
            if (a.isEndless) return b.endlessLevel - a.endlessLevel || b.score - a.score;
            return b.score - a.score;
          })
          .slice(0, 10);
        setRankings(filtered);
      } catch (err) {
        console.error('Failed to get rankings locally:', err);
        setRankings([]);
      }
    } else {
      // Webブラウザ (Vercel) 環境用
      try {
        const res = await fetch(`/api/mole-ranking?stageId=${targetStage}&gameMode=${gameMode}`);
        if (!res.ok) throw new Error('API failed');
        const data = await res.json();
        setRankings(data);
      } catch (err) {
        console.error('Failed to load online rankings:', err);
        setRankings([]);
      }
    }
  }, [gameMode, selectedRankStage, users]);

  useEffect(() => {
    fetchRankings();
  }, [selectedRankStage, gameMode, fetchRankings]);

  const stageRef = useRef<StageDef | null>(null);
  const molesRef = useRef<Mole[]>([]);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const levelRef = useRef(1);
  const livesRef = useRef(3);
  const phaseRef = useRef<Phase>('menu');
  const spawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(progress);

  const hitsCountRef = useRef(0);
  const correctKeysRef = useRef(0);
  const missedKeysRef = useRef(0);
  const startTimeRef = useRef(0);

  useEffect(() => { molesRef.current = moles; }, [moles]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  const customImageUrlsRef = useRef<string[]>([]);
  useEffect(() => { customImageUrlsRef.current = customImageUrls; }, [customImageUrls]);

  const updateFingerStat = useCallback((key: string, hit: boolean, reactionMs: number) => {
    const finger = KEY_TO_FINGER[key];
    if (!finger) return;
    setProgress(p => {
      const stat = p.fingerStats[finger] || { hits: 0, misses: 0, totalReactionMs: 0 };
      const updated = {
        ...p,
        fingerStats: {
          ...p.fingerStats,
          [finger]: hit
            ? { hits: stat.hits + 1, misses: stat.misses, totalReactionMs: stat.totalReactionMs + reactionMs }
            : { hits: stat.hits, misses: stat.misses + 1, totalReactionMs: stat.totalReactionMs },
        },
      };
      saveProgressForUser(updated, currentUser);
      return updated;
    });
  }, [currentUser]);

  // ============ ゲーム終了 ============
  const endGame = useCallback((reason: 'time' | 'lives' | 'targetReached') => {
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    const st = stageRef.current;
    if (!st) return;

    const finalScore = scoreRef.current;
    const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
    
    // Calculate final accuracy
    const totalKeys = correctKeysRef.current + missedKeysRef.current;
    const finalAccuracy = totalKeys > 0 ? Math.round((correctKeysRef.current / totalKeys) * 100) : 100;

    let cleared = false;
    if (gameMode === 'timeAttack' || gameMode === 'atoz') {
      cleared = reason === 'targetReached';
    } else {
      cleared = !st.endless && finalScore >= st.clearScore;
    }

    setProgress(p => {
      let updated: MoleProgress;
      if (gameMode === 'timeAttack' || gameMode === 'atoz') {
        const bests = p.timeAttackBests || {};
        const accuracies = p.timeAttackAccuracies || {};
        const currentBest = bests[st.id] !== undefined ? bests[st.id] : Infinity;
        
        const isNewRecord = cleared && elapsedSec < currentBest;
        const newBests = isNewRecord ? { ...bests, [st.id]: elapsedSec } : bests;
        const newAccuracies = isNewRecord ? { ...accuracies, [st.id]: finalAccuracy } : accuracies;

        updated = {
          ...p,
          cleared: cleared && !p.cleared.includes(st.id) ? [...p.cleared, st.id] : p.cleared,
          timeAttackBests: newBests,
          timeAttackAccuracies: newAccuracies,
        };
      } else {
        updated = {
          ...p,
          cleared: cleared && !p.cleared.includes(st.id) ? [...p.cleared, st.id] : p.cleared,
          highScores: { ...p.highScores, [st.id]: Math.max(p.highScores[st.id] || 0, finalScore) },
          endlessBestLevel: st.endless ? Math.max(p.endlessBestLevel, levelRef.current) : p.endlessBestLevel,
        };
      }
      saveProgressForUser(updated, currentUser);
      return updated;
    });

    // グローバルスコアランキングへの保存
    // グローバルスコアランキングへの保存
    try {
      const shouldSave = (gameMode === 'timeAttack' || gameMode === 'atoz')
        ? cleared
        : (st.endless ? (levelRef.current > 0 || finalScore > 0) : finalScore > 0);

      if (shouldSave) {
        if (window.electronAPI) {
          // デスクトップ (Electron) / ローカルストレージ環境用
          const globalKey = 'moleGameGlobalScores';
          const rawScores = localStorage.getItem(globalKey);
          const scoresList: MoleScoreRecord[] = rawScores ? JSON.parse(rawScores) : [];
          
          const newRecord: MoleScoreRecord = {
            userName: currentUser ? currentUser.name : 'ゲスト',
            stageId: st.id,
            gameMode: gameMode,
            score: finalScore,
            time: elapsedSec,
            accuracy: finalAccuracy,
            endlessLevel: st.endless ? levelRef.current : 0,
            date: Date.now()
          };
          
          scoresList.push(newRecord);
          if (scoresList.length > 1000) {
            scoresList.shift();
          }
          localStorage.setItem(globalKey, JSON.stringify(scoresList));
          fetchRankings();
        } else {
          // Webブラウザ (Vercel) 環境用
          fetch('/api/mole-ranking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userName: currentUser ? currentUser.name : 'ゲスト',
              stageId: st.id,
              gameMode: gameMode,
              score: finalScore,
              time: elapsedSec,
              accuracy: finalAccuracy,
              endlessLevel: st.endless ? levelRef.current : 0
            })
          })
            .then(res => {
              if (!res.ok) throw new Error('API failed');
              return res.json();
            })
            .then(() => {
              fetchRankings();
            })
            .catch(err => {
              console.error('Failed to save online ranking:', err);
            });
        }
      }
    } catch (err) {
      console.error('Failed to save global score:', err);
    }

    setLastResult({
      cleared,
      score: finalScore,
      maxCombo: maxComboRef.current,
      level: levelRef.current,
      timeElapsed: elapsedSec,
      accuracy: finalAccuracy,
      isTimeAttack: gameMode === 'timeAttack' || gameMode === 'atoz',
    });
    setMoles([]);
    setPhase('result');

    if (st.endless) {
      if (reason === 'lives') {
        sfx.playFail();
      } else {
        sfx.playClear();
      }
    } else {
      if (cleared) {
        sfx.playClear();
      } else {
        sfx.playFail();
      }
    }
  }, [currentUser, gameMode]);

  // ============ モグラ出現 ============
  const spawnMole = useCallback(() => {
    const st = stageRef.current;
    if (!st || phaseRef.current !== 'playing') return;

    const speedFactor = st.endless ? Math.max(0.4, 1 - (levelRef.current - 1) * 0.08) : 1;

    if (molesRef.current.length < st.maxMoles) {
      // 出現タイプ抽選
      let type: MoleType = 'normal';
      const r = Math.random();
      if (st.useBomb && r < 0.12) type = 'bomb';
      else if (st.useGolden && r < 0.22) type = 'golden';
      else if (st.useHelmet && r < 0.32) type = 'helmet';

      // 使用中でないキーを選択
      const usedKeys = new Set(molesRef.current.map(m => m.key));
      const candidates = st.keys.filter(k => !usedKeys.has(k));
      if (candidates.length > 0) {
        const key = candidates[Math.floor(Math.random() * candidates.length)];
        const ttl = type === 'golden' ? 1000 : st.moleTtl * speedFactor;
        const urls = customImageUrlsRef.current;
        const customUrl = urls.length > 0 ? urls[Math.floor(Math.random() * urls.length)] : undefined;
        const mole: Mole = { id: ++moleIdCounter, key, type, bornAt: Date.now(), ttl, customImageUrl: customUrl };
        setMoles(ms => [...ms, mole]);
        sfx.playPop();

        // TTL経過で消滅（爆弾は叩かなければセーフ、通常系は逃すとコンボリセット）
        setTimeout(() => {
          setMoles(ms => {
            const still = ms.find(m => m.id === mole.id);
            if (still && phaseRef.current === 'playing') {
              if (still.type !== 'bomb') {
                comboRef.current = 0;
                setCombo(0);
                updateFingerStat(still.key, false, 0);
                if (stageRef.current?.endless) {
                  livesRef.current -= 1;
                  setLives(livesRef.current);
                  if (livesRef.current <= 0) endGame('lives');
                }
              }
              return ms.filter(m => m.id !== mole.id);
            }
            return ms;
          });
        }, ttl);
      }
    }

    const [min, max] = st.spawnDelay;
    const delay = (min + Math.random() * (max - min)) * speedFactor;
    spawnTimerRef.current = setTimeout(spawnMole, delay);
  }, [endGame, updateFingerStat]);

  const spawnAtoZMole = useCallback((idx: number) => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    if (idx >= letters.length) return;
    const key = letters[idx];
    const mole: Mole = {
      id: ++moleIdCounter,
      key,
      type: 'normal',
      bornAt: Date.now(),
      ttl: Infinity,
    };
    setMoles([mole]);
    sfx.playPop();
  }, []);

  // ============ ゲーム開始 ============
  const startStage = useCallback((st: StageDef) => {
    stageRef.current = st;
    setStage(st);
    setScore(0); scoreRef.current = 0;
    setCombo(0); comboRef.current = 0;
    setMaxCombo(0); maxComboRef.current = 0;
    setLevel(1); levelRef.current = 1;
    setLives(3); livesRef.current = 3;
    setMoles([]); molesRef.current = [];

    // Reset Time Attack values
    setHitsCount(0); hitsCountRef.current = 0;
    setCorrectKeys(0); correctKeysRef.current = 0;
    setMissedKeys(0); missedKeysRef.current = 0;
    startTimeRef.current = Date.now();

    setTimeLeft(st.endless ? 0 : (gameMode === 'score' ? st.duration : 0));
    setPhase('playing');
    phaseRef.current = 'playing';

    // 高精度タイマー
    let elapsedMs = 0;
    tickTimerRef.current = setInterval(() => {
      elapsedMs += 100;
      if (gameMode === 'timeAttack' || gameMode === 'atoz') {
        setTimeLeft(elapsedMs / 1000);
      } else {
        if (st.endless) {
          const elapsedSec = Math.floor(elapsedMs / 1000);
          setTimeLeft(elapsedSec);
          const newLevel = Math.floor(elapsedSec / 15) + 1;
          if (newLevel !== levelRef.current) {
            levelRef.current = newLevel;
            setLevel(newLevel);
          }
        } else {
          const remain = st.duration - Math.floor(elapsedMs / 1000);
          setTimeLeft(remain);
          if (remain <= 0) endGame('time');
        }
      }
    }, 100);

    // 最初のモグラは少し待ってから
    if (gameMode === 'atoz') {
      spawnAtoZMole(0);
    } else {
      spawnTimerRef.current = setTimeout(spawnMole, 800);
    }
  }, [endGame, spawnMole, gameMode, spawnAtoZMole]);

  // ============ キー入力 ============
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (e.key === 'Escape') { endGame('time'); return; }
      if (e.key === 'Shift') return;
      const key = e.key.toLowerCase();
      if (!KEYBOARD_ROWS.flat().includes(key)) return;
      e.preventDefault();

      const st = stageRef.current;
      if (!st) return;

      const mole = molesRef.current.find(m => m.key === key);
      if (mole) {
        if (gameMode === 'atoz') {
          // Hits correct A-to-Z key!
          const reaction = Date.now() - mole.bornAt;
          correctKeysRef.current += 1;
          setCorrectKeys(correctKeysRef.current);
          hitsCountRef.current += 1;
          setHitsCount(hitsCountRef.current);

          setHitEffect({ key, type: 'hit' });
          sfx.playHit();
          updateFingerStat(key, true, reaction);

          if (hitsCountRef.current >= 26) {
            endGame('targetReached');
          } else {
            spawnAtoZMole(hitsCountRef.current);
          }
          return;
        }

        if (mole.type === 'bomb') {
          // 爆弾を叩いてしまった
          scoreRef.current = Math.max(0, scoreRef.current - 30);
          setScore(scoreRef.current);
          comboRef.current = 0;
          setCombo(0);
          
          missedKeysRef.current += 1;
          setMissedKeys(missedKeysRef.current);

          setHitEffect({ key, type: 'bomb' });
          sfx.playBomb();
          if (st.endless) {
            livesRef.current -= 1;
            setLives(livesRef.current);
            if (livesRef.current <= 0) { setMoles(ms => ms.filter(m => m.id !== mole.id)); endGame('lives'); return; }
          }
          setMoles(ms => ms.filter(m => m.id !== mole.id));
        } else if (mole.type === 'helmet' && !e.shiftKey) {
          // ヘルメットはShiftが必要
          comboRef.current = 0;
          setCombo(0);
          
          missedKeysRef.current += 1;
          setMissedKeys(missedKeysRef.current);

          setHitEffect({ key, type: 'miss' });
          sfx.playMiss();
          updateFingerStat(key, false, 0);
        } else {
          // ヒット！
          const reaction = Date.now() - mole.bornAt;
          const base = mole.type === 'golden' ? 50 : mole.type === 'helmet' ? 30 : 10;
          const comboBonus = Math.min(comboRef.current, 20);
          scoreRef.current += base + comboBonus;
          setScore(scoreRef.current);
          comboRef.current += 1;
          setCombo(comboRef.current);
          if (comboRef.current > maxComboRef.current) {
            maxComboRef.current = comboRef.current;
            setMaxCombo(comboRef.current);
          }
          
          correctKeysRef.current += 1;
          setCorrectKeys(correctKeysRef.current);
          hitsCountRef.current += 1;
          setHitsCount(hitsCountRef.current);

          setHitEffect({ key, type: 'hit' });
          sfx.playHit();
          updateFingerStat(key, true, reaction);
          setMoles(ms => ms.filter(m => m.id !== mole.id));

          if (gameMode === 'timeAttack' && hitsCountRef.current >= TIME_ATTACK_TARGET) {
            endGame('targetReached');
          }
        }
      } else {
        // モグラのいないキーを叩いた
        if (gameMode === 'atoz') {
          missedKeysRef.current += 1;
          setMissedKeys(missedKeysRef.current);
          setHitEffect({ key, type: 'miss' });
          sfx.playMiss();
          updateFingerStat(key, false, 0);
        } else if (st.strictMiss || st.keys.includes(key)) {
          comboRef.current = 0;
          setCombo(0);
          
          missedKeysRef.current += 1;
          setMissedKeys(missedKeysRef.current);

          setHitEffect({ key, type: 'miss' });
          sfx.playMiss();
          if (st.strictMiss) {
            scoreRef.current = Math.max(0, scoreRef.current - 10);
            setScore(scoreRef.current);
          }
          updateFingerStat(key, false, 0);
        }
      }
      setTimeout(() => setHitEffect(null), 200);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [endGame, updateFingerStat, gameMode, spawnAtoZMole]);

  // クリーンアップ
  useEffect(() => () => {
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
  }, []);

  const isUnlocked = (idx: number) => idx === 0 || progress.cleared.includes(STAGES[idx - 1].id);

  // 現在光っているモグラの指
  const activeFingers = new Set(moles.filter(m => m.type !== 'bomb').map(m => KEY_TO_FINGER[m.key]));

  // ============ 手ガイド描画 ============
  const renderHand = (side: 'L' | 'R') => {
    const fingers: Finger[] = side === 'L'
      ? ['L-pinky', 'L-ring', 'L-middle', 'L-index']
      : ['R-index', 'R-middle', 'R-ring', 'R-pinky'];
    return (
      <div className={`hand hand-${side.toLowerCase()}`}>
        {fingers.map(f => (
          <div
            key={f}
            className={`finger${activeFingers.has(f) ? ' finger-active' : ''}`}
            title={FINGER_LABEL[f]}
          />
        ))}
        <div className="palm">{side === 'L' ? '左手' : '右手'}</div>
      </div>
    );
  };

  // ============ キーボード描画 ============
  const renderKeyboard = () => (
    <div className="mole-keyboard">
      {KEYBOARD_ROWS.map((row, ri) => (
        <div key={ri} className={`mole-row mole-row-${ri}`}>
          {row.map(key => {
            const mole = moles.find(m => m.key === key);
            const inStage = stage?.keys.includes(key);
            const isHome = HOME_KEYS.includes(key);
            const effect = hitEffect?.key === key ? hitEffect.type : null;
            return (
              <div
                key={key}
                className={[
                  'mole-key',
                  inStage ? 'mole-key-active' : 'mole-key-dim',
                  isHome ? 'mole-key-home' : '',
                  mole ? `mole-up mole-${mole.type}` : '',
                  effect ? `effect-${effect}` : '',
                ].filter(Boolean).join(' ')}
              >
                {mole?.type === 'helmet' && <span className="shift-hint">Shift+</span>}
                <div className="mole-hole"></div>
                {mole && (
                  <div className="mole-pocket">
                    <span className={`mole-char mole-char-${mole.type}`}>
                      {mole.type === 'bomb' ? (
                        <span className="bomb-emoji">💣</span>
                      ) : mole.customImageUrl ? (
                        <CustomMoleFace type={mole.type} imageUrl={mole.customImageUrl} />
                      ) : (
                        <MoleFace type={mole.type} />
                      )}
                    </span>
                  </div>
                )}
                {inStage && (
                  <div className="mole-dirt-container">
                    <div className="mole-dirt-rim" />
                  </div>
                )}
                {/* 文字板（キーキャップ）。もぐらが頭で押し上げる */}
                <div className="key-cap">
                  <span className="mole-key-label">{key.toUpperCase()}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  // ============ メニュー画面 ============
  if (phase === 'menu') {
    return (
      <div className="mole-game">
        <div className="mole-menu-header">
          <h2 className="mole-title">🔨 もぐらで訓練メニュー</h2>
        </div>

        <div className="mole-menu-columns">
          {/* 左カラム：設定とステージ選択 */}
          <div className="mole-menu-left">
            {/* ゲームモード（最上部に配置） */}
            <div className="mole-menu-scale-section" style={{ marginTop: 0 }}>
              <span className="scale-label">ゲームモード:</span>
              <div className="mole-scale-control">
                <button
                  className={`scale-btn${gameMode === 'score' ? ' scale-active' : ''}`}
                  onClick={() => handleGameModeChange('score')}
                >
                  スコアアタック (60秒制限)
                </button>
                <button
                  className={`scale-btn${gameMode === 'timeAttack' ? ' scale-active' : ''}`}
                  onClick={() => handleGameModeChange('timeAttack')}
                >
                  タイムアタック (30打目標)
                </button>
                <button
                  className={`scale-btn${gameMode === 'atoz' ? ' scale-active' : ''}`}
                  onClick={() => handleGameModeChange('atoz')}
                >
                  A～Z タイムアタック
                </button>
              </div>
            </div>

            {/* ステージリスト */}
            <div className="mole-stage-list">
              {gameMode === 'atoz' ? (
                <button
                  className="mole-stage-btn mole-cleared"
                  onClick={() => startStage(ATOZ_STAGE)}
                >
                  <div className="mole-stage-name">
                    🔤 A～Z タイムアタックを開始
                  </div>
                  <div className="mole-stage-meta">
                    目標打鍵: A～Z (26文字)
                    {progress.timeAttackBests?.atoz !== undefined && ` ｜ 自己ベスト: ${progress.timeAttackBests.atoz?.toFixed(2)}秒 (正確率: ${progress.timeAttackAccuracies?.atoz || 0}%)`}
                  </div>
                </button>
              ) : (
                STAGES.map((st, i) => {
                  const isEndlessStage = st.endless;
                  const unlocked = isUnlocked(i);
                  const disabled = !unlocked || (gameMode === 'timeAttack' && isEndlessStage);
                  const high = progress.highScores[st.id];
                  const cleared = progress.cleared.includes(st.id);
                  return (
                    <button
                      key={st.id}
                      className={`mole-stage-btn${disabled ? ' mole-locked' : ''}${cleared ? ' mole-cleared' : ''}`}
                      disabled={disabled}
                      onClick={() => startStage(st)}
                    >
                      <div className="mole-stage-name">
                        {unlocked ? st.name : `🔒 ${st.name}`}
                        {cleared && <span className="clear-mark">✓</span>}
                      </div>
                      <div className="mole-stage-meta">
                        {isEndlessStage
                          ? (gameMode === 'timeAttack' ? 'タイムアタック非対応' : (progress.endlessBestLevel > 0 ? `最高レベル: ${progress.endlessBestLevel}` : 'ライフ3でどこまで続く？'))
                          : (gameMode === 'timeAttack' ? `目標打鍵: ${TIME_ATTACK_TARGET}回` : `クリア: ${st.clearScore}点 / ${st.duration}秒`)}
                        {gameMode === 'timeAttack'
                          ? (progress.timeAttackBests?.[st.id] !== undefined && ` ｜ 自己ベスト: ${progress.timeAttackBests[st.id]?.toFixed(2)}秒 (正確率: ${progress.timeAttackAccuracies?.[st.id] || 0}%)`)
                          : (high !== undefined && ` ｜ ハイスコア: ${high}`)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* 各種オプション設定エリア */}
            <div className="mole-menu-options">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="scale-label">もぐらの画像:</span>
                  <button className="btn btn-secondary btn-small" onClick={handleAddCustomImage}>
                    画像を追加...
                  </button>
                </div>
                {customImagePaths.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto', background: '#0f0f1a', borderRadius: '8px', padding: '8px', border: '1px solid #2a2a4a' }}>
                    {customImagePaths.map((path, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <span className="custom-image-path-label" title={path} style={{ fontSize: '0.82rem', color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                          {path.split(/[\\/]/).pop()}
                        </span>
                        <button className="btn btn-small" style={{ background: '#4a1a1a', color: '#f87171', border: '1px solid #5a2a2a', padding: '2px 6px', fontSize: '0.75rem' }} onClick={() => handleRemoveCustomImage(idx)}>
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: '#6060a0', textAlign: 'center', padding: '6px 0' }}>
                    デフォルト (SVG)
                  </div>
                )}
                {customImagePaths.length > 0 && (
                  <button className="btn btn-small" style={{ alignSelf: 'flex-end', background: '#3a2a4a', color: '#c4b5fd', border: '1px solid #4a3a7a', padding: '4px 10px', fontSize: '0.8rem' }} onClick={handleClearCustomImages}>
                    すべてクリア
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 右カラム：ランキング */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
            <div className="mole-menu-scale-section" style={{ marginTop: 0 }}>
              <span className="scale-label">画面サイズ:</span>
              <div className="mole-scale-control">
                {[1.0, 1.2, 1.4, 1.6].map(s => (
                  <button
                    key={s}
                    className={`scale-btn${moleScale === s ? ' scale-active' : ''}`}
                    onClick={() => {
                      setMoleScale(s);
                      localStorage.setItem('moleGameScale', String(s));
                    }}
                  >
                    {s === 1.0 ? '標準 (100%)' : s === 1.2 ? '大 (120%)' : s === 1.4 ? '特大 (140%)' : '極大 (160%)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mole-menu-right">
              <h3 className="mole-title" style={{ fontSize: '1.2rem', marginBottom: '10px' }}>
                🏆 {gameMode === 'atoz' ? 'A～Z タイムアタックランキング' : gameMode === 'timeAttack' ? 'タイムアタックランキング' : 'スコアランキング'}
              </h3>
              {gameMode !== 'atoz' && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.88rem', color: '#a0a0d0' }}>ステージ:</span>
                  <select
                    value={selectedRankStage}
                    onChange={e => setSelectedRankStage(e.target.value)}
                    style={{ background: '#1a1a30', color: '#c4b5fd', border: '1px solid #3a3a5a', borderRadius: '6px', padding: '4px 8px', fontSize: '0.88rem', outline: 'none', cursor: 'pointer' }}
                  >
                    {STAGES.filter(st => !(gameMode === 'timeAttack' && st.endless)).map(st => (
                      <option key={st.id} value={st.id}>{st.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {rankings.length > 0 ? (
                <table className="ranking-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '20%', padding: '6px' }}>順位</th>
                      <th style={{ width: '45%', padding: '6px' }}>名前</th>
                      <th style={{ width: '35%', padding: '6px' }}>{gameMode === 'timeAttack' || gameMode === 'atoz' ? 'タイム' : 'スコア'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.map((r, i) => (
                      <tr key={i} className={currentUser && r.userName === currentUser.name ? 'ranking-my-row' : ''}>
                        <td style={{ padding: '6px' }}>{i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}</td>
                        <td style={{ padding: '6px' }}>{r.userName}</td>
                        <td style={{ padding: '6px', fontWeight: 'bold', color: '#fbbf24' }}>
                          {r.isTimeAttack
                            ? `${r.time.toFixed(2)}秒 (${r.accuracy}%)`
                            : r.isEndless ? `Lv.${r.endlessLevel} (${r.score}点)` : `${r.score}点`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#6060a0', textAlign: 'center', padding: '24px 0' }}>
                  このステージのランキングデータがまだありません。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ 成績画面 ============
  if (phase === 'stats') {
    const allFingers: Finger[] = ['L-pinky', 'L-ring', 'L-middle', 'L-index', 'R-index', 'R-middle', 'R-ring', 'R-pinky'];
    return (
      <div className="mole-game">
        <div className="mole-stats-screen">
          <h2 className="mole-title">📊 指ごとの成績</h2>
          <div className="finger-stat-grid">
            {allFingers.map(f => {
              const stat = progress.fingerStats[f];
              const total = stat ? stat.hits + stat.misses : 0;
              const missRate = total > 0 ? (stat!.misses / total) : 0;
              const heatClass = total < 5 ? 'heat-none' : missRate > 0.4 ? 'heat-bad' : missRate > 0.2 ? 'heat-mid' : 'heat-good';
              return (
                <div key={f} className={`finger-stat-card ${heatClass}`}>
                  <div className="finger-stat-name">{FINGER_LABEL[f]}</div>
                  <div className="finger-stat-detail">{fingerFeedback(stat, f)}</div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-primary" onClick={() => setPhase('menu')}>← メニューに戻る</button>
        </div>
      </div>
    );
  }

  // ============ リザルト画面 ============
  if (phase === 'result' && lastResult && stage) {
    const isTA = lastResult.isTimeAttack;
    return (
      <div className="mole-game">
        <div className="mole-result">
          <h2 className="mole-title">
            {stage.endless
              ? `⏱ レベル${lastResult.level}まで到達！`
              : lastResult.cleared
                ? (stage.id === 'atoz' ? '🎉 A～Z タイムアタック成功！' : isTA ? '🎉 タイムアタッククリア！' : '🎉 ステージクリア！')
                : '😢 クリアならず…'}
          </h2>
          <div className="stats">
            {isTA ? (
              <>
                <div className="stat">
                  <span className="stat-label">クリアタイム</span>
                  <span className="stat-value" style={{ color: '#fbbf24' }}>{lastResult.timeElapsed?.toFixed(2)}秒</span>
                </div>
                <div className="stat">
                  <span className="stat-label">正確率</span>
                  <span className="stat-value">{lastResult.accuracy}%</span>
                </div>
              </>
            ) : (
              <div className="stat">
                <span className="stat-label">スコア</span>
                <span className="stat-value">{lastResult.score}</span>
              </div>
            )}
            <div className="stat">
              <span className="stat-label">最大コンボ</span>
              <span className="stat-value">{lastResult.maxCombo}</span>
            </div>
            {!stage.endless && !isTA && (
              <div className="stat">
                <span className="stat-label">クリアライン</span>
                <span className="stat-value">{stage.clearScore}</span>
              </div>
            )}
          </div>
          {!stage.endless && !lastResult.cleared && !isTA && (
            <p className="mole-retry-hint">あと{stage.clearScore - lastResult.score}点！ホームポジションに指を置いて再挑戦！</p>
          )}
          <div className="mole-result-btns">
            <button className="btn btn-primary btn-large" onClick={() => startStage(stage)}>もう一度</button>
            <button className="btn btn-secondary" onClick={() => setPhase('menu')}>メニューへ</button>
          </div>
        </div>
      </div>
    );
  }

  // ============ プレイ画面 ============
  return (
    <div className="mole-game">
      <div className="mole-hud">
        <span className="mole-hud-stage">{stage?.name}</span>
        <span>スコア: <strong>{score}</strong></span>
        <span>コンボ: <strong className={combo >= 10 ? 'combo-hot' : ''}>{combo}</strong></span>
        <span>正確率: <strong>{correctKeys + missedKeys > 0 ? Math.round((correctKeys / (correctKeys + missedKeys)) * 100) : 100}%</strong></span>
        {stage?.endless ? (
          <>
            <span>レベル: <strong>{level}</strong></span>
            <span>ライフ: <strong>{'❤'.repeat(Math.max(0, lives))}</strong></span>
            <span>経過: <strong>{timeLeft}秒</strong></span>
          </>
        ) : gameMode === 'timeAttack' ? (
          <>
            <span>目標: <strong>{hitsCount} / {TIME_ATTACK_TARGET} 匹</strong></span>
            <span>タイム: <strong>{timeLeft.toFixed(1)}秒</strong></span>
          </>
        ) : gameMode === 'atoz' ? (
          <>
            <span>目標: <strong>A～Z</strong></span>
            <span>次のキー: <strong style={{ fontSize: '1.4rem', color: '#fbbf24', background: '#2a2a4e', padding: '2px 8px', borderRadius: '4px' }}>
              {'abcdefghijklmnopqrstuvwxyz'.charAt(Math.min(25, hitsCount)).toUpperCase()}
            </strong></span>
            <span>タイム: <strong>{timeLeft.toFixed(1)}秒</strong></span>
          </>
        ) : (
          <span className={timeLeft <= 10 ? 'time-warning' : ''}>残り: <strong>{timeLeft}秒</strong></span>
        )}
        <div className="mole-scale-control">
          <span className="scale-label">サイズ:</span>
          {[1.0, 1.2, 1.4, 1.6].map(s => (
            <button
              key={s}
              className={`scale-btn${moleScale === s ? ' scale-active' : ''}`}
              onClick={() => {
                setMoleScale(s);
                localStorage.setItem('moleGameScale', String(s));
              }}
            >
              {s * 100}%
            </button>
          ))}
        </div>
        <button className="btn btn-secondary mole-quit-btn" onClick={() => endGame('time')}>終了 (Esc)</button>
      </div>
      <div className="mole-play-container" style={{ zoom: moleScale }}>
        {renderKeyboard()}
        <div className="hand-guide">
          {renderHand('L')}
          <div className="hand-guide-hint">
            {activeFingers.size > 0
              ? [...activeFingers].map(f => FINGER_LABEL[f]).join('・') + ' で叩け！'
              : 'ホームポジションで待機…'}
          </div>
          {renderHand('R')}
        </div>
      </div>
    </div>
  );
}
