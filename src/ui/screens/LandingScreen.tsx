import type { CSSProperties } from 'react';

// Reuses the in-battle Pokéball sprite (see pokeballAsset.ts) as the title-screen
// mark — same URL-import trick Phaser's loader uses, since this project has no
// image module typings for a plain `import x from './x.png'`.
const pokeballUrl = new URL('../../render/sprites/assets/pokeball.png', import.meta.url).href;

export function LandingScreen() {
  return (
    <div style={containerStyle}>
      <div style={heroStyle}>
        <img src={pokeballUrl} alt="" aria-hidden="true" style={pokeballStyle} />
        <h1 style={titleStyle}>POKÉPIXEL ARENA</h1>
        <p style={taglineStyle}>Choose how you want to play.</p>
      </div>

      <div style={menuStyle}>
        <button onClick={() => (window.location.hash = '#/local')} style={primaryButton}>
          ⚔️ Solo Play
        </button>
        <button onClick={() => (window.location.hash = '#/rooms')} style={secondaryButton}>
          🌐 Play with others!
        </button>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  width: '100vw',
  height: '100dvh',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'monospace',
  color: '#eee',
  background: '#20242c',
  overflowY: 'auto',
};

// Fills whatever vertical room the viewport has above the menu, so the title
// mark grows into tall phone screens instead of leaving it as dead space
// around a small centered block.
const heroStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: '24px 24px 12px',
  textAlign: 'center',
  background: 'radial-gradient(circle at 50% 42%, #2c3140 0%, #20242c 65%)',
};

const pokeballStyle: CSSProperties = {
  width: 'clamp(64px, 20vmin, 120px)',
  height: 'clamp(64px, 20vmin, 120px)',
  imageRendering: 'pixelated',
  filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.4))',
};

const titleStyle: CSSProperties = {
  fontSize: 'clamp(24px, 7vmin, 40px)',
  letterSpacing: 1,
  margin: 0,
};

const taglineStyle: CSSProperties = {
  margin: 0,
  opacity: 0.7,
  fontSize: 'clamp(12px, 3.2vmin, 15px)',
};

// Pinned to the bottom like a game title screen's menu sheet, with a safe-area
// pad so it clears the home indicator on notched phones.
const menuStyle: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  maxWidth: 360,
  margin: '0 auto',
  padding: '20px 24px calc(20px + env(safe-area-inset-bottom))',
  boxSizing: 'border-box',
  background: '#262b35',
  borderTop: '1px solid #383f4d',
};

const buttonBase: CSSProperties = {
  width: '100%',
  padding: '14px 32px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const primaryButton: CSSProperties = {
  ...buttonBase,
  color: '#20242c',
  background: '#e0b030',
};

const secondaryButton: CSSProperties = {
  ...buttonBase,
  color: '#e0b030',
  background: 'transparent',
  border: '2px solid #e0b030',
};
