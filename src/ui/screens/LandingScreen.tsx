import type { CSSProperties } from 'react';

export function LandingScreen() {
  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: 22, letterSpacing: 1, margin: '8px 0 0' }}>POKÉPIXEL ARENA</h1>
      <p style={{ margin: 0, opacity: 0.7, fontSize: 12, textAlign: 'center' }}>Choose how you want to play.</p>

      <button onClick={() => (window.location.hash = '#/local')} style={primaryButton}>
        LOCAL MATCH
      </button>
      <button onClick={() => (window.location.hash = '#/rooms')} style={primaryButton}>
        MULTIPLAYER ROOMS
      </button>
    </div>
  );
}

const containerStyle: CSSProperties = {
  width: '100vw',
  height: '100vh',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 20,
  padding: 24,
  overflowY: 'auto',
  fontFamily: 'monospace',
  color: '#eee',
  background: '#20242c',
};

const primaryButton: CSSProperties = {
  width: '100%',
  maxWidth: 280,
  padding: '12px 32px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: '#20242c',
  background: '#e0b030',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};
