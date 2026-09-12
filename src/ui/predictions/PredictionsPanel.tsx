import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MyBet, PredictionOptionSummary, PredictionSummary, WalletEventPayload } from '../../net/protocol';
import { STAKE_CHIPS } from '../../net/predictions';
import { useCountdown } from '../../net/useCountdown';
import { DESTRUCTIVE, PRIMARY, PRIMARY_TEXT, SUCCESS, TEXT, TEXT_MUTED, primaryAlpha, textAlpha } from '../theme';
import {
  betErrorNotice,
  canAffordChip,
  canBetOn,
  favouriteOptionId,
  formatAmount,
  formatCloseCountdown,
  formatDollars,
  impliedMultiplier,
  optionColor,
  percentLabel,
  resultText,
  stakeForChip,
  watchedText,
  type StakeChip,
} from './predictionModel';

export interface PredictionsPanelProps {
  /** The room's current pool, or null between rounds / before the first. */
  prediction: PredictionSummary | null;
  /** This tab's balance, or null until the server has said (the hello). */
  balance: number | null;
  myBet: MyBet | null;
  /** How the last settlement went for this tab (see WalletEventPayload). */
  settled: WalletEventPayload['settled'] | null;
  /** False where taps can't land anyway (the landing page's covered embed). */
  canBet: boolean;
  /** Resolves to null on success, or a machine error code the panel turns
   * into a short notice (see betErrorNotice). */
  onBet: (optionId: string, amount: number) => Promise<string | null>;
}

const NOTICE_MS = 2000;
const CHIPS: readonly StakeChip[] = [...STAKE_CHIPS, 'all'];

/** The "WHO WILL WIN?" pool: one row per fighter (per side in boss/team
 * rooms) with its live win odds and its share of the pool, a stake picker,
 * and the window's countdown. Layout-agnostic — the web sidebar stacks it
 * above chat, the mobile drawer shows it on its own tab. */
export function PredictionsPanel({ prediction, balance, myBet, settled, canBet, onBet }: PredictionsPanelProps) {
  const [chip, setChip] = useState<StakeChip>(STAKE_CHIPS[0]);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = prediction?.status === 'open';
  const remainingMs = useCountdown(open ? prediction.closesAtMs : null);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const stake = balance === null ? 0 : stakeForChip(chip, balance);
  const bet = async (option: PredictionOptionSummary) => {
    if (!prediction || !canBet || placing || balance === null) return;
    if (!canAffordChip(chip, balance)) {
      flashNotice(betErrorNotice('insufficient_funds'));
      return;
    }
    setPlacing(true);
    const error = await onBet(option.id, stake);
    setPlacing(false);
    if (error !== null) flashNotice(betErrorNotice(error));
  };

  const favourite = prediction ? favouriteOptionId(prediction) : null;
  const status = !prediction
    ? null
    : prediction.status === 'open'
      ? `🔒 Closes in ${formatCloseCountdown(remainingMs)}`
      : prediction.status === 'closed'
        ? '🔒 CLOSED'
        : 'SETTLED';
  const result = prediction ? resultText(prediction, settled) : null;
  const watched = prediction?.status === 'settled' ? watchedText(settled) : null;

  return (
    <section style={panelStyle} aria-label="Predictions">
      <header style={headerStyle}>
        <span style={titleStyle}>🔮 PREDICTIONS</span>
        {status && <span style={{ ...statusStyle, color: open ? PRIMARY : TEXT_MUTED }}>{status}</span>}
      </header>

      {balance !== null && (
        <div style={walletRowStyle}>
          <span style={walletLabelStyle}>YOUR BALANCE</span>
          <span style={walletValueStyle}>{formatDollars(balance)}</span>
        </div>
      )}

      {!prediction && <p style={emptyStyle}>Betting opens when the next battle starts.</p>}

      {prediction && (
        <>
          <p style={questionStyle}>WHO WILL WIN?</p>

          {open && canBet && (
            <div style={chipRowStyle}>
              {CHIPS.map((c) => {
                const affordable = balance !== null && canAffordChip(c, balance);
                const selected = c === chip;
                return (
                  <button
                    key={String(c)}
                    type="button"
                    onClick={() => setChip(c)}
                    disabled={!affordable}
                    style={{
                      ...chipStyle,
                      ...(selected ? chipSelectedStyle : {}),
                      opacity: affordable ? 1 : 0.4,
                    }}
                  >
                    {c === 'all' ? 'ALL IN' : `$${c}`}
                  </button>
                );
              })}
            </div>
          )}

          <div style={optionListStyle}>
            {prediction.options.map((option) => {
              const share = prediction.pool > 0 ? option.total / prediction.pool : 0;
              const mine = myBet !== null && myBet.optionId === option.id;
              const winner = prediction.status === 'settled' && prediction.winnerOptionId === option.id;
              const clickable = canBet && canBetOn(prediction, option, myBet) && !placing;
              const color = optionColor(option);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void bet(option)}
                  disabled={!clickable}
                  aria-label={`Bet ${formatDollars(stake)} on ${option.label}`}
                  style={{
                    ...optionStyle,
                    borderColor: winner ? SUCCESS : mine ? PRIMARY : option.id === favourite ? `${color}` : textAlpha(0.15),
                    boxShadow: winner || mine ? `0 0 0 1px ${winner ? SUCCESS : PRIMARY}` : 'none',
                    opacity: option.alive || winner ? 1 : 0.45,
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <div style={optionTopStyle}>
                    <span style={{ ...optionNameStyle, color, textDecoration: option.alive ? 'none' : 'line-through' }}>
                      {option.label}
                      {option.id === favourite && <span style={favTagStyle}>FAV</span>}
                      {winner && <span style={{ ...favTagStyle, color: SUCCESS, borderColor: SUCCESS }}>WIN</span>}
                    </span>
                    <span style={oddsStyle}>{percentLabel(option.odds)}</span>
                  </div>
                  <div style={barTrackStyle}>
                    <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: color, transition: 'width 300ms ease-out' }} />
                  </div>
                  <div style={optionBottomStyle}>
                    <span>
                      {formatDollars(option.total)} · {option.bettors} {option.bettors === 1 ? 'bet' : 'bets'} · {impliedMultiplier(prediction.pool, option.total)}
                    </span>
                    {mine && <span style={mineStyle}>YOU {formatDollars(myBet.amount)}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {notice && <p style={noticeStyle}>{notice}</p>}

          <div style={footerStyle}>
            <span>
              Pool: <strong>{formatAmount(prediction.pool)}</strong> 🪙
            </span>
            {open && canBet && balance !== null && <span style={{ opacity: 0.7 }}>Tap a fighter to stake {formatDollars(stake)}</span>}
          </div>

          {result && (
            <p style={resultStyle}>
              {result}
              {watched && <span style={watchedStyle}>{watched}</span>}
            </p>
          )}
        </>
      )}
    </section>
  );
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  boxSizing: 'border-box',
  fontFamily: 'monospace',
  color: TEXT,
  borderBottom: `1px solid ${textAlpha(0.12)}`,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const titleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 'bold',
  letterSpacing: 1,
};

const statusStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 'bold',
  letterSpacing: 0.5,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const walletRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '6px 8px',
  borderRadius: 6,
  background: primaryAlpha(0.08),
  border: `1px solid ${primaryAlpha(0.25)}`,
};

const walletLabelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 'bold',
  letterSpacing: 1,
  opacity: 0.7,
};

const walletValueStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 'bold',
  color: PRIMARY,
  fontVariantNumeric: 'tabular-nums',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  opacity: 0.6,
};

const questionStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 'bold',
  letterSpacing: 1,
  opacity: 0.7,
};

const chipRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};

const chipStyle: CSSProperties = {
  flex: '1 0 auto',
  padding: '5px 8px',
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  color: TEXT,
  background: textAlpha(0.06),
  border: `1px solid ${textAlpha(0.18)}`,
  borderRadius: 14,
  cursor: 'pointer',
};

const chipSelectedStyle: CSSProperties = {
  color: PRIMARY_TEXT,
  background: PRIMARY,
  borderColor: PRIMARY,
};

const optionListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const optionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
  padding: '6px 8px',
  boxSizing: 'border-box',
  textAlign: 'left',
  fontFamily: 'monospace',
  color: TEXT,
  background: textAlpha(0.04),
  // Longhands, not the `border` shorthand: the row sets borderColor per
  // render and React warns when a shorthand and a longhand disagree.
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 6,
};

const optionTopStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const optionNameStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const favTagStyle: CSSProperties = {
  fontSize: 8,
  letterSpacing: 1,
  padding: '1px 4px',
  border: '1px solid currentColor',
  borderRadius: 3,
};

const oddsStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  fontVariantNumeric: 'tabular-nums',
  flex: 'none',
};

const barTrackStyle: CSSProperties = {
  width: '100%',
  height: 6,
  background: textAlpha(0.12),
  borderRadius: 3,
  overflow: 'hidden',
};

const optionBottomStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 10,
  opacity: 0.8,
  fontVariantNumeric: 'tabular-nums',
};

const mineStyle: CSSProperties = {
  color: PRIMARY,
  fontWeight: 'bold',
};

const noticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: DESTRUCTIVE,
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
  flexWrap: 'wrap',
};

const resultStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  fontWeight: 'bold',
  color: PRIMARY,
};

const watchedStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 'normal',
  color: SUCCESS,
};
