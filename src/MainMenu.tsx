import { useEffect, useState } from 'react';

type AppTab = 'mole' | 'kana' | 'typing';

interface Mode {
  key: AppTab;
  num: string;
  icon: string;
  title: string;
  subtitle: string;
  desc: string;
  accent: string;
  glow: string;
}

const MODES: Mode[] = [
  {
    key: 'mole',
    num: '1',
    icon: '🔨',
    title: 'もぐらで訓練',
    subtitle: 'Mole Basher',
    desc: '飛び出すもぐらをタイピングで叩け！反射神経とスピードを鍛える。',
    accent: '#f59e0b',
    glow: '#f59e0b40',
  },
  {
    key: 'kana',
    num: '2',
    icon: '🈶',
    title: 'かな練習',
    subtitle: 'Kana Time Attack',
    desc: 'ひらがなをローマ字で素早く入力。制限時間内に何文字打てるか挑戦！',
    accent: '#34d399',
    glow: '#34d39940',
  },
  {
    key: 'typing',
    num: '3',
    icon: '🎵',
    title: '歌で訓練',
    subtitle: 'Song Typing',
    desc: '好きな曲に合わせて歌詞をタイピング。リズムに乗って指を動かせ。',
    accent: '#a78bfa',
    glow: '#a78bfa40',
  },
];

export default function MainMenu({ onSelect }: { onSelect: (tab: AppTab) => void }) {
  const [hovered, setHovered] = useState<AppTab | null>(null);
  const [pressed, setPressed] = useState<AppTab | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '1') onSelect('mole');
      if (e.key === '2') onSelect('kana');
      if (e.key === '3') onSelect('typing');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onSelect]);

  const handleClick = (key: AppTab) => {
    setPressed(key);
    setTimeout(() => onSelect(key), 120);
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      gap: '40px',
      background: 'radial-gradient(ellipse at 50% 0%, #1e1040 0%, #0f0f1a 60%)',
      minHeight: 0,
    }}>
      {/* title block */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.8rem', fontWeight: 900, letterSpacing: '0.04em', color: '#e9d5ff', lineHeight: 1.1 }}>
          ⌨ ZaTouch
        </div>
        <div style={{ fontSize: '1rem', color: '#6b52a8', marginTop: '6px', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Master the Art of Speed Typing
        </div>
        <div style={{ width: '80px', height: '2px', background: 'linear-gradient(90deg, transparent, #7c3aed, transparent)', margin: '14px auto 0' }} />
      </div>

      {/* mode cards */}
      <div style={{
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
        justifyContent: 'center',
        width: '100%',
        maxWidth: '900px',
      }}>
        {MODES.map(mode => {
          const isHovered = hovered === mode.key;
          const isPressed = pressed === mode.key;
          return (
            <button
              key={mode.key}
              onClick={() => handleClick(mode.key)}
              onMouseEnter={() => setHovered(mode.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                flex: '1 1 240px',
                maxWidth: '280px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '28px 24px',
                background: isHovered
                  ? `linear-gradient(135deg, #1e1e38, #16163a)`
                  : '#16162a',
                border: `1px solid ${isHovered ? mode.accent : '#2a2a4a'}`,
                borderRadius: '18px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'transform 0.15s, border-color 0.15s, box-shadow 0.15s, background 0.15s',
                transform: isPressed ? 'scale(0.96)' : isHovered ? 'translateY(-4px)' : 'none',
                boxShadow: isHovered ? `0 8px 32px ${mode.glow}, 0 0 0 1px ${mode.accent}20` : '0 2px 8px #00000040',
                outline: 'none',
              }}
            >
              {/* number badge */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}>
                <span style={{
                  fontSize: '2.4rem',
                  lineHeight: 1,
                }}>{mode.icon}</span>
                <span style={{
                  fontSize: '1.5rem',
                  fontWeight: 900,
                  color: isHovered ? mode.accent : '#2a2a5a',
                  fontVariantNumeric: 'tabular-nums',
                  transition: 'color 0.15s',
                  border: `2px solid ${isHovered ? mode.accent : '#2a2a5a'}`,
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  transition: 'color 0.15s, border-color 0.15s',
                }}>{mode.num}</span>
              </div>

              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: isHovered ? '#fff' : '#c4b5fd', transition: 'color 0.15s' }}>
                  {mode.title}
                </div>
                <div style={{ fontSize: '0.78rem', color: mode.accent, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '2px', opacity: isHovered ? 1 : 0.6, transition: 'opacity 0.15s' }}>
                  {mode.subtitle}
                </div>
              </div>

              <div style={{ fontSize: '0.85rem', color: '#8080a8', lineHeight: 1.6, marginTop: '4px' }}>
                {mode.desc}
              </div>

              {/* bottom accent bar */}
              <div style={{
                width: isHovered ? '100%' : '32px',
                height: '3px',
                borderRadius: '2px',
                background: mode.accent,
                marginTop: '8px',
                transition: 'width 0.25s ease',
                opacity: isHovered ? 1 : 0.3,
              }} />
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: '0.78rem', color: '#3d3d5a', letterSpacing: '0.1em' }}>
        キーボード 1 / 2 / 3 でも選択できます
      </div>
    </div>
  );
}
