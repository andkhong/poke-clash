import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ItemUse, ShopSummary } from '../../net/protocol';
import { ITEMS, MATCH_ITEM_LIMIT_PER_SESSION, type ItemId, type ShopItem } from '../../net/shop';
import type { SimStore } from '../state/simStore';
import { useSimSnapshot } from '../hooks/useSimSnapshot';
import { formatDollars } from '../predictions/predictionModel';
import { DESTRUCTIVE, FONT_BODY, FONT_UI, INFO_BOX, INK, INK_MUTED, OUTLINE, PANEL, SUCCESS, SUNK } from '../theme';
import {
  canBuyItem,
  hpColor,
  itemErrorNotice,
  itemTerms,
  shopNotice,
  stockColor,
  stockLabel,
  stockLeft,
  targetBlockedLabel,
  targetRows,
  itemUseEmoji,
  itemUseText,
} from './shopModel';

export interface ShopPanelProps {
  /** The room's shop for the running match, or null between rounds. */
  shop: ShopSummary | null;
  /** The live match, for target HP. Null outside a match. */
  store: SimStore | null;
  /** This tab's balance, or null until the server has said (the hello). */
  balance: number | null;
  /** Purchases this session has already made this match (SessionPrivate). */
  myItemUses: number;
  /** False where taps can't land anyway (the landing page's covered embed). */
  canBuy: boolean;
  /** Resolves to null on success, or a machine error code the panel turns
   * into a short notice (see itemErrorNotice). */
  onBuy: (itemId: ItemId, targetInstanceId: string) => Promise<string | null>;
}

const NOTICE_MS = 2000;

/** The item shop: a shelf of items with their room-wide stock, then — once
 * one is picked — the living fighters to use it on, each with the HP it would
 * actually restore. Two steps rather than a grid of item-by-target buttons so
 * both dimensions can grow: more items lengthen the first list, a bigger
 * roster the second, and neither changes the layout.
 *
 * Layout-agnostic in the same way PredictionsPanel is: the web sidebar and
 * the mobile drawer both give it a tab beside BETS.
 *
 * A thin shell over ShopPanelBody, which holds all the state and the sim
 * subscription — between rounds there is no shop and no store to read, and a
 * hook can't be called conditionally. Unmounting the body then also drops a
 * half-made pick, which is what should happen when a match ends anyway. */
export function ShopPanel({ shop, store, ...rest }: ShopPanelProps) {
  if (!shop || !store) {
    return (
      <section style={panelStyle} aria-label="Item shop">
        <header style={headerStyle}>
          <span style={titleStyle}>🎒 SHOP</span>
        </header>
        <p style={emptyStyle}>Opens when the next battle starts.</p>
      </section>
    );
  }
  return <ShopPanelBody shop={shop} store={store} {...rest} />;
}

function ShopPanelBody({
  shop,
  store,
  balance,
  myItemUses,
  canBuy,
  onBuy,
}: Omit<ShopPanelProps, 'shop' | 'store'> & { shop: ShopSummary; store: SimStore }) {
  const [picked, setPicked] = useState<ItemId | null>(null);
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Subscribes this component alone to the HUD's 10 Hz bump. `store` is a
  // stable reference, so the memoized ChatOverlay hosting this on mobile
  // keeps its props equal and its message list is not re-rendered with it —
  // the exact regression that memo exists to prevent.
  const state = useSimSnapshot(store);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    []
  );

  // A pick can't outlive the stock it counted on — someone else may have
  // taken the last one while this tab was on the target list.
  const pickedItem = picked !== null ? (ITEMS.find((i) => i.id === picked) ?? null) : null;
  const pickSoldOut = pickedItem !== null && stockLeft(shop, pickedItem) <= 0;
  useEffect(() => {
    if (pickSoldOut) setPicked(null);
  }, [pickSoldOut]);

  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const wallet = balance ?? 0;
  const blocked = shopNotice(state, shop, wallet, myItemUses, canBuy);

  const buy = async (item: ShopItem, targetInstanceId: string) => {
    if (buying) return;
    setBuying(true);
    const error = await onBuy(item.id, targetInstanceId);
    setBuying(false);
    if (error) {
      flashNotice(itemErrorNotice(error));
      return;
    }
    setPicked(null);
  };

  return (
    <section style={panelStyle} aria-label="Item shop">
      <header style={headerStyle}>
        <span style={titleStyle}>🎒 SHOP</span>
        {canBuy && (
          <span style={{ ...statusStyle, color: myItemUses >= MATCH_ITEM_LIMIT_PER_SESSION ? INK_MUTED : SUCCESS }}>
            {myItemUses}/{MATCH_ITEM_LIMIT_PER_SESSION} used
          </span>
        )}
      </header>

      {balance !== null && (
        <div style={walletRowStyle}>
          <span style={walletLabelStyle}>YOUR WALLET</span>
          <span style={walletValueStyle}>{formatDollars(balance)}</span>
        </div>
      )}

      {pickedItem === null || pickSoldOut ? (
        <>
          <p style={captionStyle}>USE ON ANY FIGHTER · STOCK IS SHARED</p>
          <div style={listStyle}>
            {ITEMS.map((item) => {
              const enabled = canBuyItem(state, shop, item, wallet, myItemUses, canBuy);
              const left = stockLeft(shop, item);
              const color = stockColor(shop, item);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setPicked(item.id)}
                  // The label is assembled from several spans (and the emoji
                  // is decorative), so spell it out — same as the bet buttons.
                  aria-label={`${item.label}, ${formatDollars(item.price)}, ${stockLabel(shop, item)}`}
                  style={{ ...itemStyle, ...(enabled ? null : disabledStyle) }}
                >
                  <span style={itemEmojiStyle} aria-hidden>
                    {item.emoji}
                  </span>
                  <span style={itemTextStyle}>
                    <span style={itemNameStyle}>{item.label.toUpperCase()}</span>
                    <span style={itemTermsStyle}>{itemTerms(item)}</span>
                  </span>
                  <span style={{ ...stockStyle, ...(color ? { color } : null) }}>{stockLabel(shop, item)}</span>
                  {/* How much of the shelf is gone, at a glance. */}
                  <span style={stockBarStyle} aria-hidden>
                    <span style={{ ...stockFillStyle, width: `${(left / item.stock) * 100}%`, background: color ?? SUCCESS }} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={stepHeaderStyle}>
            <button type="button" onClick={() => setPicked(null)} style={backStyle}>
              ‹ BACK
            </button>
            <span style={stepTitleStyle}>
              {pickedItem.emoji} {pickedItem.label.toUpperCase()} · {formatDollars(pickedItem.price)}
            </span>
          </div>
          <p style={captionStyle}>{pickedItem.effect === 'revive' ? 'CHOOSE A FAINTED FIGHTER' : 'CHOOSE A FIGHTER'}</p>
          <div style={listStyle}>
            {targetRows(state, shop, pickedItem).map((row) => (
              <button
                key={row.instanceId}
                type="button"
                disabled={buying || row.blocked !== null}
                onClick={() => void buy(pickedItem, row.instanceId)}
                aria-label={
                  row.blocked === null
                    ? `${pickedItem.effect === 'revive' ? 'Revive' : `Use ${pickedItem.label} on`} ${row.name}, restores ${row.heal} HP`
                    : `${row.name}, ${targetBlockedLabel(row.blocked)}`
                }
                style={{ ...targetStyle, ...(row.blocked === null && !buying ? null : disabledStyle) }}
              >
                <span style={targetNameStyle}>{row.name.toUpperCase()}</span>
                <span style={hpBarStyle} aria-hidden>
                  <span
                    style={{
                      ...hpFillStyle,
                      width: `${Math.max(0, Math.min(1, row.hpFraction)) * 100}%`,
                      background: hpColor(row.hpFraction),
                    }}
                  />
                </span>
                <span style={row.blocked === null ? healStyle : blockedStyle}>
                  {row.blocked === null
                    ? pickedItem.effect === 'revive'
                      ? `REVIVE ${row.heal}`
                      : `+${row.heal}`
                    : targetBlockedLabel(row.blocked)}
                </span>
              </button>
            ))}
            {targetRows(state, shop, pickedItem).length === 0 && <p style={captionStyle}>NO FAINTED FIGHTERS</p>}
          </div>
        </>
      )}

      {notice && <p style={noticeStyle}>{notice}</p>}
      {!notice && blocked && <p style={blockedNoticeStyle}>{blocked}</p>}
      {shop.recent.length > 0 && <ActivityLog recent={shop.recent} />}
    </section>
  );
}

/** The last few purchases — who spent what on whom. The same information the
 * system chat line carries, kept here too so it survives the chat scrolling
 * away and is visible without switching tabs. */
function ActivityLog({ recent }: { recent: ItemUse[] }) {
  return (
    <div style={logStyle}>
      {[...recent].reverse().map((use, index) => (
        <span key={`${use.atMs}-${use.targetInstanceId}-${index}`} style={logRowStyle}>
          <span aria-hidden>{itemUseEmoji(use)}</span> {itemUseText(use)}
        </span>
      ))}
    </div>
  );
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
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
  fontSize: 20,
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
  padding: '6px 10px',
  borderRadius: 8,
  background: INFO_BOX,
  border: OUTLINE,
};

const walletLabelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  color: INK_MUTED,
};

const walletValueStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 20,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const captionStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 'bold',
  color: INK_MUTED,
};

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: INK_MUTED,
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const itemStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 52,
  padding: '6px 10px 9px',
  fontFamily: FONT_BODY,
  color: INK,
  textAlign: 'left',
  background: PANEL,
  border: OUTLINE,
  borderRadius: 8,
  cursor: 'pointer',
  overflow: 'hidden',
};

const disabledStyle: CSSProperties = {
  background: SUNK,
  color: INK_MUTED,
  borderStyle: 'dashed',
  cursor: 'default',
};

const itemEmojiStyle: CSSProperties = {
  fontSize: 20,
  lineHeight: 1,
};

const itemTextStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
};

const itemNameStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 18,
  fontWeight: 700,
};

const itemTermsStyle: CSSProperties = {
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

const stockStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

// A thin bar along the bottom edge of the row, so the shelf draining reads
// without taking a line of its own.
const stockBarStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 4,
  background: SUNK,
};

const stockFillStyle: CSSProperties = {
  display: 'block',
  height: '100%',
};

const stepHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const backStyle: CSSProperties = {
  minHeight: 44,
  padding: '0 10px',
  fontSize: 17,
  fontFamily: FONT_UI,
  fontWeight: 600,
  color: INK,
  background: PANEL,
  border: OUTLINE,
  borderRadius: 8,
  boxShadow: `inset 0 -3px 0 ${SUNK}`,
  cursor: 'pointer',
};

const stepTitleStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 18,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const targetStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 46,
  padding: '0 10px',
  fontFamily: FONT_BODY,
  color: INK,
  textAlign: 'left',
  background: INFO_BOX,
  border: OUTLINE,
  borderRadius: 8,
  cursor: 'pointer',
};

const targetNameStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: FONT_UI,
  fontSize: 18,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const hpBarStyle: CSSProperties = {
  flex: 'none',
  width: 56,
  height: 10,
  boxSizing: 'border-box',
  border: `2px solid ${INK}`,
  borderRadius: 4,
  background: SUNK,
  overflow: 'hidden',
};

const hpFillStyle: CSSProperties = {
  display: 'block',
  height: '100%',
};

const healStyle: CSSProperties = {
  flex: 'none',
  minWidth: 36,
  textAlign: 'right',
  fontSize: 14,
  fontWeight: 'bold',
  color: SUCCESS,
  fontVariantNumeric: 'tabular-nums',
};

const blockedStyle: CSSProperties = {
  ...healStyle,
  color: INK_MUTED,
};

const noticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 'bold',
  color: DESTRUCTIVE,
};

const blockedNoticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: INK_MUTED,
};

const logStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  paddingTop: 6,
  borderTop: `2px solid ${INK}`,
};

const logRowStyle: CSSProperties = {
  fontSize: 13,
  color: INK_MUTED,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
