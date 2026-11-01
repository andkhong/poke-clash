import {
  ACTION,
  ACTION_BEVEL,
  CROWD,
  CROWD_TEXT,
  CROWD_BEVEL,
  CROWD_TINT,
  DURATION_BASE_MS,
  DURATION_FAST_MS,
  EASE_OUT,
  FONT_BODY,
  FONT_UI,
  FRAME,
  GROUND,
  GROUND_ROUTE,
  HP_GREEN,
  HP_RED,
  INK,
  INK_MUTED,
  OUTLINE,
  PANEL,
  RUBY,
  SAPPHIRE,
  SAPPHIRE_DEEP,
  SUNK,
  textAlpha,
} from '../theme';
import { HERO_FIGHTER_CSS } from './courtSprites';

/** The arena floor in the CSS-drawn courts (hero art, room thumbnails).
 * Illustration only, matched to the design canvas; not a theme token
 * because nothing outside these drawings uses it. */
const COURT = '#a4625a';

/** The battle message box's double trim (white gap, then FRAME teal). */
const TRIM = `inset 0 0 0 3px ${PANEL},inset 0 0 0 6px ${FRAME}`;

/** Every style rule on the landing page, as one stylesheet string that
 * LandingPage renders once in a `<style>` element. The rest of the app
 * styles with inline `CSSProperties`, but the landing page needs what inline
 * styles can't express: `:hover` gated to real pointers, `:focus-visible`
 * rings, media queries at the 600/900px breakpoints and
 * `prefers-reduced-motion`. Every color and font is interpolated from
 * theme.ts ("Hoenn Handheld"), so the theme stays the single source of truth.
 *
 * Rules are `lp-`-prefixed, and landing elements take *all* their styling
 * from these classes — an inline `style` on one would beat every hover/media
 * rule here. Gold (ACTION) is only ever a fill, with INK text on it. */
export const LANDING_CSS = `
.lp-root{min-height:100dvh;background:${GROUND};color:${INK};font-family:${FONT_BODY};overflow-x:clip;
  --lp-gutter-l:max(32px,env(safe-area-inset-left));--lp-gutter-r:max(32px,env(safe-area-inset-right))}
@media (max-width:599px){.lp-root{--lp-gutter-l:max(16px,env(safe-area-inset-left));--lp-gutter-r:max(16px,env(safe-area-inset-right))}}
.lp-container{box-sizing:border-box;max-width:1280px;margin-inline:auto;padding-left:var(--lp-gutter-l);padding-right:var(--lp-gutter-r)}
.lp-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.lp-only-mobile{display:none}
@media (max-width:599px){.lp-hide-mobile{display:none!important}.lp-only-mobile{display:inline}}
.lp-crowd-text{color:${CROWD_TEXT}}
.lp-root [id]{scroll-margin-top:84px}

/* ---------- type ---------- */
.lp-h1{margin:0;font:700 clamp(52px,6.4vw,86px)/1 ${FONT_UI};text-wrap:balance}
/* Headline-size text passes the 3:1 large-text bar in the brighter crowd green (4.3:1). */
.lp-h1 .lp-crowd-text{color:${CROWD}}
.lp-h2{margin:0;font:700 46px/1.08 ${FONT_UI};text-wrap:balance}
.lp-h3{margin:0;font:700 26px/1.15 ${FONT_UI}}
.lp-lead{margin:0;max-width:520px;font:400 21px/1.55 ${FONT_BODY};color:${INK_MUTED};text-wrap:pretty}
.lp-section-sub{margin:0;font:400 18px/1.55 ${FONT_BODY};color:${INK_MUTED}}
.lp-note{margin:0;font:400 16px/1.55 ${FONT_BODY};color:${INK_MUTED}}
.lp-text-link{align-items:center;min-height:44px;font:700 16px/1 ${FONT_BODY};color:${SAPPHIRE_DEEP}}
@media (max-width:599px){
  .lp-h1{font-size:50px;line-height:1.02}.lp-h2{font-size:34px}.lp-h3{font-size:17px;font-family:${FONT_BODY}}
  .lp-lead{font-size:18px;line-height:1.5}.lp-section-sub,.lp-note{font-size:15px}
  .lp-text-link.lp-only-mobile{display:inline-flex}
}

/* ---------- buttons ---------- */
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;padding:0 22px;
  border:${OUTLINE};border-radius:8px;font-family:${FONT_UI};font-weight:700;line-height:1;white-space:nowrap;text-decoration:none;
  cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform ${DURATION_FAST_MS}ms ${EASE_OUT},box-shadow ${DURATION_FAST_MS}ms ${EASE_OUT}}
.lp-btn svg{flex:none}
.lp-btn-primary{background:${ACTION};color:${INK};box-shadow:inset 0 -5px 0 ${ACTION_BEVEL}}
.lp-btn-secondary,.lp-btn-ghost{background:${PANEL};color:${INK};box-shadow:inset 0 -5px 0 ${SUNK}}
.lp-btn-crowd{background:${CROWD};color:${PANEL};box-shadow:inset 0 -5px 0 ${CROWD_BEVEL}}
.lp-btn-crowd-outline{background:${PANEL};color:${CROWD_TEXT};box-shadow:inset 0 -5px 0 ${SUNK}}
.lp-btn-xl{min-height:62px;padding:0 28px;font-size:22px}
.lp-btn-xl.lp-btn-primary{font-size:28px}
.lp-btn-md{min-height:50px;font-size:21px}
.lp-btn-sm{min-height:46px;padding:0 20px;font-size:20px;box-shadow:inset 0 -4px 0 ${ACTION_BEVEL}}
.lp-btn-ghost{min-height:44px;padding:0 14px;font-size:18px;box-shadow:inset 0 -4px 0 ${SUNK}}
@media (hover:hover) and (pointer:fine){.lp-btn:hover{transform:translateY(-1px)}}
.lp-btn:active{transform:translateY(2px)}
.lp-btn-primary:active{box-shadow:inset 0 -2px 0 ${ACTION_BEVEL}}
.lp-btn-secondary:active,.lp-btn-ghost:active,.lp-btn-crowd-outline:active{box-shadow:inset 0 -2px 0 ${SUNK}}
.lp-btn-crowd:active{box-shadow:inset 0 -2px 0 ${CROWD_BEVEL}}

/* ---------- focus: INK ring + gold halo (gold alone is weak on the light ground) ---------- */
.lp-root a:focus-visible,.lp-root button:focus-visible,.lp-modal a:focus-visible,.lp-modal button:focus-visible{
  outline:3px solid ${INK};outline-offset:2px;box-shadow:0 0 0 8px ${ACTION}}
.lp-btn-primary:focus-visible{box-shadow:inset 0 -5px 0 ${ACTION_BEVEL},0 0 0 8px ${ACTION}!important}
.lp-btn-secondary:focus-visible,.lp-btn-ghost:focus-visible,.lp-btn-crowd-outline:focus-visible{box-shadow:inset 0 -5px 0 ${SUNK},0 0 0 8px ${ACTION}!important}
.lp-btn-crowd:focus-visible{box-shadow:inset 0 -5px 0 ${CROWD_BEVEL},0 0 0 8px ${ACTION}!important}

/* ---------- nav ---------- */
.lp-nav{position:sticky;top:0;z-index:30;padding-top:env(safe-area-inset-top);background:${PANEL};border-bottom:${OUTLINE}}
.lp-nav-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:10px}
.lp-brand{display:inline-flex;align-items:center;gap:12px;min-height:44px;color:${INK};text-decoration:none;border-radius:8px}
.lp-brand img{width:32px;height:32px;image-rendering:pixelated;flex:none}
.lp-wordmark{font:700 28px/1 ${FONT_UI};white-space:nowrap}
.lp-nav-links{display:flex;align-items:center;gap:6px}
.lp-nav-link{padding:12px 14px;border:0;border-radius:8px;background:none;color:${INK};font:700 16px/1 ${FONT_BODY};cursor:pointer}
@media (hover:hover) and (pointer:fine){.lp-nav-link:hover{background:${GROUND}}}
.lp-menu-btn{display:none;align-items:center;justify-content:center;width:46px;height:46px;padding:0;border:${OUTLINE};border-radius:8px;
  background:${PANEL};color:${INK};cursor:pointer}
.lp-menu{display:none}
@media (max-width:899px){
  .lp-nav-links{display:none}.lp-menu-btn{display:inline-flex}
  .lp-menu{display:flex;flex-direction:column;padding:4px var(--lp-gutter-r) 12px var(--lp-gutter-l);border-top:2px solid ${SUNK}}
  .lp-menu-item{display:flex;align-items:center;min-height:48px;padding:0;border:0;background:none;color:${INK};
    font:700 18px/1 ${FONT_BODY};text-align:left;text-decoration:none;cursor:pointer}
}
@media (max-width:599px){.lp-nav-inner{padding-block:6px}.lp-wordmark{font-size:24px}.lp-brand img{width:28px;height:28px}}

/* ---------- hero ---------- */
.lp-hero{display:flex;flex-wrap:wrap;gap:56px;align-items:center;padding-top:60px;padding-bottom:60px}
.lp-hero-copy{flex:1 1 440px;min-width:0;display:flex;flex-direction:column;gap:24px}
.lp-pill{display:inline-flex;align-self:flex-start;align-items:center;gap:8px;min-height:34px;margin:0;padding:0 12px;box-sizing:border-box;
  border-radius:6px;background:${PANEL};border:${OUTLINE};font:700 15px/1 ${FONT_BODY}}
.lp-pill-dot{width:10px;height:10px;border-radius:50%;background:${HP_GREEN};border:2px solid ${INK};flex:none}
.lp-hero-actions{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.lp-trust{margin:0;font:400 16px/1.5 ${FONT_BODY};color:${INK_MUTED}}
.lp-hero-art{position:relative;flex:1 1 520px;min-width:0;aspect-ratio:16/10;border-radius:8px;background:${SUNK};border:${OUTLINE};overflow:hidden}
.lp-court{position:absolute;left:7%;right:7%;top:8%;bottom:30%;background:${COURT};border-radius:6px;border:${OUTLINE}}
.lp-court::before{content:"";position:absolute;inset:10px;border:3px solid ${PANEL};border-radius:4px}
.lp-court-line{position:absolute;left:50%;top:10px;bottom:10px;width:3px;background:${PANEL};transform:translateX(-50%)}
.lp-court-circle{position:absolute;left:50%;top:50%;width:70px;height:70px;box-sizing:border-box;border-radius:50%;border:3px solid ${PANEL};
  transform:translate(-50%,-50%)}
.lp-token{position:absolute;display:flex;align-items:center;justify-content:center;width:50px;height:50px;box-sizing:border-box;
  border-radius:50%;border:${OUTLINE};font:400 13px/1 ${FONT_UI};color:${PANEL}}
.lp-token-ruby{background:${RUBY}}
.lp-token-sapphire{width:34px;height:34px;box-sizing:border-box;transform:rotate(45deg);border-radius:4px;background:${SAPPHIRE};border:${OUTLINE}}
.lp-shield-ring{position:absolute;display:flex;align-items:center;justify-content:center;width:64px;height:64px;box-sizing:border-box;
  border-radius:50%;border:4px dashed ${CROWD};background:${CROWD_TINT}}
.lp-hero-t1{left:18%;top:22%}.lp-hero-t2{left:28%;top:56%}.lp-hero-t3{right:18%;top:16%}.lp-hero-t4{right:28%;top:52%}
.lp-fighter{position:absolute;display:flex;align-items:center;justify-content:center;width:88px;height:88px}
.lp-sprite{position:relative;z-index:1;image-rendering:pixelated;transform:scale(2)}
.lp-fighter-mark{position:absolute;bottom:18px;left:50%;width:46px;height:14px;box-sizing:border-box;border-radius:50%;transform:translateX(-50%)}
.lp-fighter-mark-ruby{border:3px solid ${RUBY};background:rgba(197,65,65,.25)}
.lp-fighter-mark-sapphire{border:3px solid ${SAPPHIRE_DEEP};background:rgba(98,172,238,.35)}
.lp-fighter-shield{position:absolute;inset:4px;box-sizing:border-box;border-radius:50%;border:4px dashed ${CROWD};background:rgba(115,197,164,.55)}
${HERO_FIGHTER_CSS}
.lp-msgbox{box-sizing:border-box;border-radius:8px;background:${PANEL};border:${OUTLINE};box-shadow:${TRIM}}
.lp-hero-msg{position:absolute;left:3%;right:3%;bottom:4%;height:22%;display:flex;align-items:center;padding:12px 18px;
  font:400 21px/1.25 ${FONT_UI}}
@media (max-width:599px){
  .lp-hero{flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:18px;padding-top:22px;padding-bottom:30px}
  .lp-hero-copy{display:contents}
  .lp-pill{order:1;min-height:32px;padding:0 10px;font-size:14px}.lp-h1{order:2}.lp-lead{order:3}
  .lp-hero-art{order:4;flex:none;aspect-ratio:auto;height:230px}
  .lp-hero-actions{order:5;flex-direction:column;align-items:stretch;gap:12px}
  .lp-trust{order:6;font-size:15px;text-align:center}
  .lp-court{left:5%;right:5%;top:6%;bottom:34%}
  .lp-court::before{inset:6px;border-width:2px}.lp-court-line{top:6px;bottom:6px;width:2px}.lp-court-circle{width:44px;height:44px;border-width:2px}
  .lp-token{width:34px;height:34px}.lp-hero-t1{left:18%;top:30%}
  .lp-fighter{width:60px;height:60px}.lp-sprite{transform:scale(1.4)}.lp-fighter-mark{bottom:6px;width:34px;height:10px;border-width:2px}
  .lp-fighter-shield{border-width:3px}
  .lp-shield-ring{width:52px;height:52px;border-width:3px}.lp-shield-ring .lp-token-sapphire{width:26px;height:26px}.lp-hero-t3{right:15%;top:18%}
  .lp-hero-msg{bottom:5%;height:26%;padding:8px 14px;font-size:18px;line-height:1.2}
  .lp-hero-actions .lp-btn-xl{min-height:58px}
}

/* ---------- sections ---------- */
.lp-section{display:flex;flex-direction:column;gap:24px;padding-top:28px;padding-bottom:72px}
.lp-section-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px}
.lp-section-titles{display:flex;flex-direction:column;gap:6px}
@media (max-width:599px){.lp-section{gap:14px;padding-top:6px;padding-bottom:30px}.lp-section-head{align-items:center}.lp-section-sub{display:none}
  .lp-band .lp-section-sub{display:block}}

/* ---------- rooms ---------- */
.lp-room-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:22px;margin:0;padding:0;list-style:none}
.lp-room-grid>li{display:flex}
.lp-room-grid{grid-auto-flow:row dense}
.lp-room-wide{grid-column:span 2;grid-row:span 2}
.lp-room-wide .lp-seats{inset:40px 24px 14px}
.lp-room-wide .lp-mini{width:72px;height:60px}
.lp-room-wide .lp-mini .lp-sprite{transform:scale(1.6);transform-origin:50% 100%;margin-bottom:-10px}
.lp-room-wide .lp-mini-mark{width:40px;height:12px;bottom:4px}
.lp-room-wide .lp-seat-col:has(.lp-mini){gap:6px}
.lp-room{flex:1;display:flex;flex-direction:column;overflow:hidden;border-radius:8px;background:${PANEL};border:${OUTLINE}}
.lp-room-thumb{position:relative;aspect-ratio:16/9;background:${COURT};border-bottom:${OUTLINE}}
.lp-court-inset{position:absolute;inset:10px;border:2px solid ${PANEL};border-radius:3px}
.lp-seats{position:absolute;inset:30px 14px 8px;display:flex;align-items:center;justify-content:space-around}
.lp-seats-ffa{display:grid;grid-template-columns:repeat(4,auto);justify-content:space-evenly;align-content:space-evenly;justify-items:center}
.lp-seat-col{display:flex;flex-direction:column;gap:10px}
.lp-seat{display:block;width:20px;height:20px;box-sizing:border-box;border-radius:50%;border:${OUTLINE}}
.lp-seat-ruby{background:${RUBY}}
.lp-seat-sapphire{border-radius:3px;transform:rotate(45deg);background:${SAPPHIRE};width:18px;height:18px}
.lp-seat-col:has(.lp-mini){gap:0}
.lp-mini{position:relative;display:flex;align-items:flex-end;justify-content:center;width:44px;height:36px}
.lp-mini .lp-sprite{position:relative;z-index:1;margin-bottom:-6px}
.lp-mini-mark{position:absolute;bottom:2px;left:50%;width:26px;height:8px;box-sizing:border-box;border-radius:50%;border:2px solid ${INK};transform:translateX(-50%)}
.lp-seat-ffa0{background:${RUBY}}.lp-seat-ffa1{background:${SAPPHIRE}}.lp-seat-ffa2{background:${HP_GREEN}}.lp-seat-ffa3{background:${ACTION}}
.lp-room-badge{position:absolute;left:10px;top:10px;display:inline-flex;align-items:center;gap:6px;min-height:28px;box-sizing:border-box;
  padding:0 10px;border-radius:4px;background:${PANEL};border:2px solid ${INK};font:400 15px/1 ${FONT_UI};color:${INK}}
.lp-room-badge-open{left:auto;right:10px;background:${ACTION}}
.lp-live-dot{width:8px;height:8px;border-radius:50%;background:${HP_RED}}
.lp-room-body{flex:1;display:flex;flex-direction:column;gap:12px;padding:16px}
.lp-room-body .lp-btn{margin-top:auto}
.lp-room-title{display:flex;justify-content:space-between;align-items:center;gap:8px}
.lp-room-name{font:700 19px/1.2 ${FONT_BODY}}
.lp-chip{display:inline-flex;align-items:center;min-height:28px;box-sizing:border-box;padding:0 10px;border-radius:4px;background:${GROUND_ROUTE};
  border:2px solid ${INK};font:400 15px/1 ${FONT_UI}}
.lp-room-meta{margin:0;font:400 15px/1.4 ${FONT_BODY};color:${INK_MUTED}}
.lp-room-new{border-style:dashed}
.lp-room-thumb-new{display:flex;align-items:center;justify-content:center;background:${GROUND_ROUTE};border-bottom-style:dashed;color:${INK}}
@media (max-width:599px){
  .lp-room-grid{grid-template-columns:1fr;gap:14px}
  .lp-room{flex-direction:row;align-items:center;gap:12px;padding:10px}
  .lp-room-thumb{flex:none;width:90px;height:60px;aspect-ratio:auto;border:2px solid ${INK};border-radius:4px;overflow:hidden}
  .lp-court-inset{inset:5px}.lp-seats{inset:6px}.lp-seat-col{gap:4px}.lp-seats-ffa{gap:2px 0}
  .lp-seat{width:12px;height:12px;border-width:2px}.lp-seat-sapphire{width:10px;height:10px}
  .lp-mini{width:30px;height:26px}.lp-mini .lp-sprite{transform:scale(.65);transform-origin:50% 100%;margin-bottom:-4px}.lp-mini-mark{width:18px;height:6px;border-width:1px}
  .lp-room-body{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;row-gap:3px;padding:0}
  .lp-room-wide{grid-column:auto;grid-row:auto}
  .lp-room-wide .lp-room{flex-direction:column;align-items:stretch}
  .lp-room-wide .lp-room-thumb{width:auto;height:auto;aspect-ratio:16/9}
  .lp-room-wide .lp-seats{inset:22px 10px 6px}
  .lp-room-wide .lp-mini{width:44px;height:36px}.lp-room-wide .lp-mini .lp-sprite{transform:scale(1);margin-bottom:-6px}
  .lp-room-wide .lp-mini-mark{width:26px;height:8px;bottom:2px}.lp-room-wide .lp-seat-col:has(.lp-mini){gap:0}
  .lp-room-title{justify-content:flex-start;gap:6px;min-width:0}
  .lp-room-name{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lp-chip{min-height:0;padding:1px 6px;font-size:14px}
  .lp-room-meta{grid-column:1;font-size:14px}.lp-room-meta.is-open{font-weight:700;color:${SAPPHIRE_DEEP}}
  .lp-room-body .lp-btn{grid-column:2;grid-row:1/3;margin:0;min-height:46px;min-width:76px;padding:0 12px;font-size:18px}
}

/* ---------- crowd band ---------- */
.lp-band{background:${GROUND_ROUTE};border-top:${OUTLINE};border-bottom:${OUTLINE}}
.lp-band-inner{display:flex;flex-direction:column;gap:34px;padding-top:68px;padding-bottom:68px}
.lp-band-head{display:flex;flex-direction:column;gap:12px;max-width:800px}
.lp-band .lp-h2{font-size:52px;line-height:1.05}
.lp-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:20px;margin:0;padding:0;list-style:none}
.lp-step{display:flex;flex-direction:column;gap:12px;padding:24px;border-radius:8px;background:${PANEL};border:${OUTLINE};box-shadow:${TRIM}}
.lp-step-num{display:flex;align-items:center;justify-content:center;flex:none;width:48px;height:48px;box-sizing:border-box;border-radius:6px;
  background:${CROWD};border:${OUTLINE};color:${PANEL};font:700 28px/1 ${FONT_UI}}
.lp-step-text{display:flex;flex-direction:column;gap:12px}
.lp-step-body{margin:0;font:400 16px/1.55 ${FONT_BODY};color:${INK_MUTED}}
.lp-rules{display:flex;flex-wrap:wrap;gap:12px;margin:0;padding:0;list-style:none}
.lp-rule{padding:10px 14px;border-radius:6px;background:${PANEL};border:${OUTLINE};font:700 15px/1.4 ${FONT_BODY}}
@media (max-width:599px){
  .lp-band-inner{gap:16px;padding-top:32px;padding-bottom:32px}
  .lp-band .lp-h2{font-size:34px;line-height:1.08}
  .lp-steps{gap:12px}
  .lp-step{flex-direction:row;align-items:flex-start;gap:14px;padding:14px;box-shadow:none}
  .lp-step-num{width:38px;height:38px;font-size:22px}
  .lp-step-text{gap:3px}.lp-step-body{font-size:15px;line-height:1.45}
  .lp-rules{flex-direction:column;gap:6px}
  .lp-rule{padding:0;border:0;background:none;font-weight:400;color:${INK_MUTED}}
}

/* ---------- modes ---------- */
.lp-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:18px;margin:0;padding:0;list-style:none}
.lp-mode{display:flex;flex-direction:column;gap:8px;min-height:140px;height:100%;box-sizing:border-box;padding:22px;border-radius:8px;
  background:${PANEL};border:${OUTLINE};box-shadow:inset 0 -5px 0 ${SUNK};color:${INK};text-decoration:none;
  transition:transform ${DURATION_FAST_MS}ms ${EASE_OUT}}
@media (hover:hover) and (pointer:fine){.lp-mode:hover{transform:translateY(-2px)}}
.lp-mode-label{font:700 46px/1 ${FONT_UI};color:${SAPPHIRE_DEEP}}
.lp-mode-blurb{font:400 16px/1.4 ${FONT_BODY};color:${INK_MUTED}}
.lp-mode-blurb-short{display:none}
@media (max-width:599px){
  .lp-modes{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .lp-mode-ffa{grid-column:span 2}
  .lp-mode{flex-direction:row;align-items:center;justify-content:center;gap:10px;min-height:72px;padding:0;box-shadow:inset 0 -4px 0 ${SUNK}}
  .lp-mode-label{font-size:30px}
  .lp-mode-blurb{display:none}
  .lp-mode-blurb-short{display:inline;font:700 14px/1 ${FONT_BODY};color:${INK_MUTED}}
}

/* ---------- closing CTA ---------- */
.lp-cta-wrap{padding-bottom:72px}
.lp-cta{display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between;padding:40px 44px}
.lp-cta .lp-h2{max-width:660px}
@media (max-width:599px){.lp-cta-wrap{padding-bottom:30px}.lp-cta{flex-direction:column;align-items:stretch;gap:16px;padding:24px 20px}
  .lp-cta .lp-h2{font-size:32px;line-height:1.1}.lp-cta .lp-btn-xl{min-height:56px;font-size:24px}}

/* ---------- footer ---------- */
.lp-footer{background:${PANEL};border-top:${OUTLINE};padding-bottom:env(safe-area-inset-bottom)}
.lp-footer-inner{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;padding-top:28px;padding-bottom:28px}
.lp-footer-copy{margin:0;max-width:780px;font:400 14px/1.55 ${FONT_BODY};color:${INK_MUTED}}
.lp-footer-links{display:flex;flex-wrap:wrap;gap:4px 20px;margin:0;padding:0;list-style:none}
.lp-footer-links a,.lp-footer-links button{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;
  font:700 14px/1.4 ${FONT_BODY};color:${SAPPHIRE_DEEP};text-decoration:underline;text-underline-offset:4px;cursor:pointer}
@media (hover:hover) and (pointer:fine){.lp-footer-links a:hover,.lp-footer-links button:hover{color:${INK}}}
/* Room for the fixed mobile dock below. */
@media (max-width:599px){.lp-footer-inner{padding-top:22px;padding-bottom:calc(100px + env(safe-area-inset-bottom))}}

/* ---------- mobile dock ---------- */
.lp-dock{display:none}
@media (max-width:599px){
  .lp-dock{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;gap:10px;
    padding:12px var(--lp-gutter-r) calc(12px + env(safe-area-inset-bottom)) var(--lp-gutter-l);background:${PANEL};border-top:${OUTLINE}}
  .lp-dock-play{flex:2;min-height:54px;font-size:24px;box-shadow:inset 0 -4px 0 ${ACTION_BEVEL}}
  .lp-dock-watch{flex:1;min-height:54px;padding:0 12px;font-size:20px}
}

/* ---------- contact modal ---------- */
.lp-modal{box-sizing:border-box;width:min(460px,calc(100% - 32px));max-width:none;max-height:calc(100dvh - 32px);margin:auto;padding:0;
  overflow:auto;overscroll-behavior:contain;background:${PANEL};color:${INK};font-family:${FONT_BODY};border:${OUTLINE};border-radius:8px;
  box-shadow:${TRIM}}
.lp-modal::backdrop{background:${textAlpha(0.55)}}
.lp-modal[open]{animation:lp-modal-in ${DURATION_BASE_MS}ms ${EASE_OUT}}
@keyframes lp-modal-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
html:has(.lp-modal[open]){overflow:hidden}
.lp-modal .lp-h2{font-size:30px}
.lp-modal-body{display:flex;flex-direction:column;gap:16px;padding:26px}
.lp-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lp-modal-close{display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;margin:-8px -8px -8px 0;padding:0;
  border:0;border-radius:8px;background:transparent;color:${INK};cursor:pointer}
.lp-modal-lead{margin:0;font:400 15px/1.6 ${FONT_BODY};color:${INK_MUTED}}
.lp-modal-options{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.lp-modal-option{display:flex;align-items:center;gap:14px;padding:14px;background:${PANEL};color:${INK};text-decoration:none;
  border:${OUTLINE};border-radius:8px;box-shadow:inset 0 -4px 0 ${SUNK};transition:transform ${DURATION_FAST_MS}ms ${EASE_OUT}}
.lp-modal-mark{display:flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;box-sizing:border-box;border-radius:6px;
  background:${ACTION};border:2px solid ${INK};color:${INK};font:700 20px/1 ${FONT_UI}}
.lp-modal-option-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.lp-modal-option-title{font:700 16px/1.3 ${FONT_BODY}}
.lp-modal-option-body{font:400 14px/1.5 ${FONT_BODY};color:${INK_MUTED}}
.lp-arrow{flex:none;font:700 16px/1 ${FONT_BODY};color:${INK_MUTED}}
.lp-modal-address{display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:2px solid ${SUNK}}
.lp-modal-address-label{margin:0;font:400 14px/1.5 ${FONT_BODY};color:${INK_MUTED}}
.lp-modal-address-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 6px 6px 14px;
  background:${GROUND};border-radius:8px}
.lp-modal-email{min-width:0;overflow-wrap:anywhere;font:700 15px/1.4 ${FONT_BODY};color:${SAPPHIRE_DEEP};text-underline-offset:4px}
.lp-modal-copy{flex:none;min-width:84px}
@media (hover:hover) and (pointer:fine){.lp-modal-option:hover{transform:translateY(-2px)}.lp-modal-close:hover{background:${GROUND}}}
@media (max-width:599px){.lp-modal-body{gap:14px;padding:20px 16px}}

/* ---------- reduced motion (keep last) ---------- */
@media (prefers-reduced-motion:reduce){
  .lp-sprite{animation:none}
  .lp-modal[open]{animation:none}
  .lp-btn,.lp-mode,.lp-modal-option{transition:none}
  .lp-btn:hover,.lp-btn:active,.lp-mode:hover,.lp-modal-option:hover{transform:none}
}
`;
