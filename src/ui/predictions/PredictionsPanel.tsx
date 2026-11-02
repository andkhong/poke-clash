import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { MyBet, PredictionOptionSummary, PredictionSummary, WalletEventPayload } from '../../net/protocol';
import { STAKE_CHIPS } from '../../net/predictions';
import { useCountdown } from '../../net/useCountdown';
import {
  ACTION,
  ACTION_BEVEL,
  DESTRUCTIVE,
  FONT_BODY,
  FONT_UI,
  INFO_BOX,
  INK,
  INK_MUTED,
  PANEL,
  SAPPHIRE_DEEP,
  SUCCESS,
  SUNK,
} from '../theme';
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
import { tapHeight } from '../crowd/hoenn';

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
  /** Desktop sidebar density: 36 px controls instead of 44 px touch targets. */
  dense?: boolean;
}

const NOTICE_MS = 2000;
const CHIPS: readonly StakeChip[] = [...STAKE_CHIPS, 'all'];

/** The "WHO WILL WIN?" pool: one row per fighter (per side in boss/team
 * rooms) with its live win odds and its share of the pool, a stake picker,
 * and the window's countdown. Layout-agnostic — the web sidebar stacks it
 * above chat, the mobile drawer shows it on its own tab. */
export function PredictionsPanel({ prediction, balance, myBet, settled, canBet, onBet, dense = false }: PredictionsPanelProps) {
  const intl = useIntl();
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
      ? `🔒 ${intl.formatMessage({ id: 'predictions.status.closesIn', defaultMessage: 'Closes in {time}' }, { time: formatCloseCountdown(remainingMs) })}`
      : prediction.status === 'closed'
        ? `🔒 ${intl.formatMessage({ id: 'predictions.status.closed', defaultMessage: 'CLOSED' })}`
        : intl.formatMessage({
            id: 'predictions.status.settled',
            defaultMessage: 'SETTLED',
          });
  const result = prediction ? resultText(prediction, settled) : null;
  const watched = prediction?.status === 'settled' ? watchedText(settled) : null;

  return (
    <section
      style={panelStyle}
      aria-label={intl.formatMessage({
        id: 'predictions.panel.label',
        defaultMessage: 'Predictions',
      })}
    >
      <header style={headerStyle}>
        <span style={titleStyle}>
          🔮{' '}
          {intl.formatMessage({
            id: 'predictions.panel.title',
            defaultMessage: 'PREDICTIONS',
          })}
        </span>
        {status && <span style={{ ...statusStyle, color: open ? SAPPHIRE_DEEP : INK_MUTED }}>{status}</span>}
      </header>

      {balance !== null && (
        <div style={walletRowStyle}>
          <span style={walletLabelStyle}>
            {intl.formatMessage({
              id: 'predictions.wallet.balance',
              defaultMessage: 'YOUR BALANCE',
            })}
          </span>
          <span style={walletValueStyle}>{formatDollars(balance)}</span>
        </div>
      )}

      {!prediction && (
        <p style={emptyStyle}>
          {intl.formatMessage({
            id: 'predictions.empty',
            defaultMessage: 'Betting opens when the next battle starts.',
          })}
        </p>
      )}

      {prediction && (
        <>
          <p style={questionStyle}>
            {intl.formatMessage({
              id: 'predictions.question',
              defaultMessage: 'WHO WILL WIN?',
            })}
          </p>

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
                      minHeight: tapHeight(dense),
                      ...(selected ? chipSelectedStyle : {}),
                      opacity: affordable ? 1 : 0.4,
                    }}
                  >
                    {c === 'all'
                      ? intl.formatMessage({
                          id: 'predictions.chip.allIn',
                          defaultMessage: 'ALL IN',
                        })
                      : `$${c}`}
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
                  aria-label={intl.formatMessage(
                    {
                      id: 'predictions.option.betLabel',
                      defaultMessage: 'Bet {amount} on {name}',
                    },
                    { amount: formatDollars(stake), name: option.label }
                  )}
                  style={{
                    ...optionStyle,
                    borderColor: winner ? SUCCESS : option.id === favourite && !mine ? color : INK,
                    // Your bet: a gold ring outside the ink border, like the focus ring.
                    outline: winner || mine ? `3px solid ${winner ? SUCCESS : ACTION}` : 'none',
                    opacity: option.alive || winner ? 1 : 0.45,
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <div style={optionTopStyle}>
                    <span
                      style={{
                        ...optionNameStyle,
                        color,
                        textDecoration: option.alive ? 'none' : 'line-through',
                      }}
                    >
                      {option.label}
                      {option.id === favourite && (
                        <span style={favTagStyle}>
                          {intl.formatMessage({
                            id: 'predictions.option.fav',
                            defaultMessage: 'FAV',
                          })}
                        </span>
                      )}
                      {winner && (
                        <span
                          style={{
                            ...favTagStyle,
                            color: SUCCESS,
                            borderColor: SUCCESS,
                          }}
                        >
                          {intl.formatMessage({
                            id: 'predictions.option.win',
                            defaultMessage: 'WIN',
                          })}
                        </span>
                      )}
                    </span>
                    <span style={oddsStyle}>{percentLabel(option.odds)}</span>
                  </div>
                  <div style={barTrackStyle}>
                    <div
                      style={{
                        width: `${Math.round(share * 100)}%`,
                        height: '100%',
                        background: color,
                        transition: 'width 300ms ease-out',
                      }}
                    />
                  </div>
                  <div style={optionBottomStyle}>
                    <span>
                      {intl.formatMessage(
                        {
                          id: 'predictions.option.stats',
                          defaultMessage: '{total} · {bettors, plural, one {# bet} other {# bets}} · {multiplier}',
                        },
                        {
                          total: formatDollars(option.total),
                          bettors: option.bettors,
                          multiplier: impliedMultiplier(prediction.pool, option.total),
                        }
                      )}
                    </span>
                    {mine && (
                      <span style={mineStyle}>
                        {intl.formatMessage(
                          {
                            id: 'predictions.option.mine',
                            defaultMessage: 'YOU {amount}',
                          },
                          { amount: formatDollars(myBet.amount) }
                        )}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {notice && <p style={noticeStyle}>{notice}</p>}

          <div style={footerStyle}>
            <span>
              <FormattedMessage
                id="predictions.pool"
                defaultMessage="Pool: {amount}"
                values={{
                  amount: <strong>{formatAmount(prediction.pool)}</strong>,
                }}
              />{' '}
              🪙
            </span>
            {open && canBet && balance !== null && (
              <span style={{ color: INK_MUTED }}>
                {intl.formatMessage(
                  {
                    id: 'predictions.tapToStake',
                    defaultMessage: 'Tap a fighter to stake {amount}',
                  },
                  { amount: formatDollars(stake) }
                )}
              </span>
            )}
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
  gap: 6,
  padding: '8px 10px 10px',
  boxSizing: 'border-box',
  fontFamily: FONT_BODY,
  color: INK,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const titleStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 16,
  fontWeight: 700,
};

const statusStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const walletRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '3px 8px',
  borderRadius: 6,
  background: INFO_BOX,
  border: `2px solid ${INK}`,
};

const walletLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 'bold',
  color: INK_MUTED,
};

const walletValueStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 16,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: INK_MUTED,
};

const questionStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT_UI,
  fontSize: 14,
  fontWeight: 600,
};

const chipRowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
};

const chipStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  padding: '0 4px',
  fontSize: 15,
  whiteSpace: 'nowrap',
  fontFamily: FONT_UI,
  fontWeight: 600,
  color: INK,
  background: PANEL,
  border: `2px solid ${INK}`,
  borderRadius: 6,
  boxShadow: `inset 0 -3px 0 ${SUNK}`,
  cursor: 'pointer',
};

const chipSelectedStyle: CSSProperties = {
  background: ACTION,
  boxShadow: `inset 0 -3px 0 ${ACTION_BEVEL}`,
};

const optionListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const optionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  width: '100%',
  padding: '4px 8px',
  boxSizing: 'border-box',
  textAlign: 'left',
  fontFamily: FONT_BODY,
  color: INK,
  background: INFO_BOX,
  // Longhands, not the `border` shorthand: the row sets borderColor per
  // render and React warns when a shorthand and a longhand disagree.
  borderWidth: 2,
  borderStyle: 'solid',
  borderRadius: 8,
  outlineOffset: 1,
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
  fontFamily: FONT_UI,
  fontSize: 15,
  fontWeight: 700,
  textTransform: 'uppercase',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const favTagStyle: CSSProperties = {
  fontSize: 10,
  padding: '0 4px',
  border: '2px solid currentColor',
  borderRadius: 4,
};

const oddsStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 15,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  flex: 'none',
};

const barTrackStyle: CSSProperties = {
  width: '100%',
  height: 6,
  boxSizing: 'border-box',
  background: SUNK,
  border: `2px solid ${INK}`,
  borderRadius: 4,
  overflow: 'hidden',
};

const optionBottomStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12,
  color: INK_MUTED,
  fontVariantNumeric: 'tabular-nums',
};

const mineStyle: CSSProperties = {
  color: INK,
  fontWeight: 'bold',
};

const noticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 'bold',
  color: DESTRUCTIVE,
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 13,
  flexWrap: 'wrap',
};

const resultStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontFamily: FONT_UI,
  fontSize: 15,
  fontWeight: 700,
  color: SAPPHIRE_DEEP,
};

const watchedStyle: CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 14,
  fontWeight: 'bold',
  color: SUCCESS,
};
