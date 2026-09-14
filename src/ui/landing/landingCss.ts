import {
  ACCENT,
  BG,
  BG_ALT,
  DESTRUCTIVE,
  DURATION_BASE_MS,
  DURATION_FAST_MS,
  DURATION_PULSE_MS,
  EASE_OUT,
  FONT_DISPLAY,
  FONT_MONO,
  PRIMARY,
  PRIMARY_DEEP,
  PRIMARY_TEXT,
  RADIUS_LG,
  RADIUS_MD,
  RADIUS_PILL,
  RADIUS_SM,
  SHADOW_HARD,
  SHADOW_HARD_LG,
  SHADOW_MD,
  SHADOW_SM,
  STAGE_BG,
  TEXT,
  TEXT_MUTED,
  accentAlpha,
  bgAlpha,
  destructiveAlpha,
  primaryAlpha,
  secondaryAlpha,
  textAlpha,
  yellowAlpha,
} from '../theme';

/** Every style rule on the landing page, as one stylesheet string that
 * LandingScreen renders once in a `<style>` element. The rest of the app
 * styles with inline `CSSProperties`, but the landing page needs what inline
 * styles can't express: `:hover` gated to real pointers (no sticky hover on
 * touch), `:focus-visible` rings, `@keyframes`, `:has()`, media queries at
 * the 600/900px breakpoints and `prefers-reduced-motion` — and a React-state
 * `useMediaQuery` version would re-render the whole page on every resize.
 *
 * Still no CSS file and no CSS-in-JS library: this is a plain template string
 * whose every color, font, radius, shadow and timing is interpolated from
 * theme.ts, so the theme stays the single source of truth. Client-rendered
 * only, so nothing needs escaping.
 *
 * Rules are `lp-`-prefixed so they can't leak into the embedded RoomScreen,
 * and landing elements take *all* their styling from these classes — an
 * inline `style` on one would beat every hover/media rule here. The 900px
 * breakpoint matches chatModel.ts's CHAT_SIDEBAR_MIN_WIDTH_PX, where the
 * embedded RoomScreen grows its 340px chat sidebar. */
export const LANDING_CSS = `
.lp-root{min-height:100dvh;background:${BG};color:${TEXT};font-family:${FONT_MONO};overflow-x:clip;
  --lp-gutter-l:max(24px,env(safe-area-inset-left));--lp-gutter-r:max(24px,env(safe-area-inset-right))}
@media (max-width:599px){.lp-root{--lp-gutter-l:max(16px,env(safe-area-inset-left));--lp-gutter-r:max(16px,env(safe-area-inset-right))}}
.lp-container{max-width:1200px;margin-inline:auto;padding-left:var(--lp-gutter-l);padding-right:var(--lp-gutter-r)}
.lp-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.lp-only-mobile{display:none}
@media (max-width:599px){.lp-hide-mobile{display:none!important}.lp-only-mobile{display:inline}}

/* ---------- nav ---------- */
.lp-nav{position:sticky;top:0;z-index:30;padding-top:env(safe-area-inset-top);background:${bgAlpha(0.9)};
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid ${textAlpha(0.1)}}
.lp-nav-inner{height:64px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.lp-brand{display:inline-flex;align-items:center;gap:10px;min-height:44px;color:${TEXT};text-decoration:none;border-radius:${RADIUS_SM}px}
.lp-brand img{width:30px;height:30px;image-rendering:pixelated;flex:none}
.lp-wordmark{font-family:${FONT_DISPLAY};font-size:16px;line-height:1;padding-top:2px;white-space:nowrap}
.lp-nav-actions{display:flex;align-items:center;gap:10px}
@media (max-width:599px){.lp-nav-inner{height:56px}.lp-wordmark{font-size:12px}}
/* Contact me would push the row wider than the viewport below 900px; the footer link carries it there. */
@media (max-width:899px){.lp-nav .lp-btn-contact{display:none}}

/* ---------- buttons ---------- */
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;
  font-family:${FONT_MONO};font-weight:700;line-height:1;white-space:nowrap;text-decoration:none;cursor:pointer;
  -webkit-tap-highlight-color:transparent;
  transition:transform ${DURATION_FAST_MS}ms ${EASE_OUT},box-shadow ${DURATION_FAST_MS}ms ${EASE_OUT},
    background-color ${DURATION_BASE_MS}ms ${EASE_OUT},border-color ${DURATION_BASE_MS}ms ${EASE_OUT},color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-btn svg{flex:none}
.lp-btn-primary{height:52px;padding:0 24px;border:0;border-radius:${RADIUS_SM}px;background:${PRIMARY};color:${PRIMARY_TEXT};
  font-size:15px;letter-spacing:.08em;box-shadow:0 4px 0 ${PRIMARY_DEEP},0 10px 22px ${primaryAlpha(0.22)}}
.lp-btn-secondary{height:48px;padding:0 22px;border:2px solid ${TEXT};border-radius:${RADIUS_SM}px;background:${BG};color:${TEXT};
  font-size:15px;letter-spacing:.08em;box-shadow:0 4px 0 ${TEXT}}
.lp-btn-ghost{height:40px;padding:0 14px;border:2px solid ${textAlpha(0.18)};border-radius:${RADIUS_SM}px;background:transparent;
  color:${TEXT};font-size:12px;letter-spacing:.08em}
.lp-btn-support{height:40px;padding:0 14px;gap:8px;border:2px solid ${accentAlpha(0.45)};border-radius:${RADIUS_SM}px;
  background:${accentAlpha(0.12)};color:${TEXT};font-size:12px;letter-spacing:.08em}
.lp-btn-support svg{color:${ACCENT}}
.lp-btn-contact{gap:8px}
@media (hover:hover) and (pointer:fine){
  .lp-btn-primary:hover{transform:translateY(-1px);box-shadow:0 5px 0 ${PRIMARY_DEEP},0 14px 28px ${primaryAlpha(0.28)}}
  .lp-btn-secondary:hover{transform:translateY(-1px);box-shadow:0 5px 0 ${TEXT};background:${BG_ALT}}
  .lp-btn-ghost:hover{border-color:${PRIMARY};background:${primaryAlpha(0.06)};color:${PRIMARY_DEEP}}
  .lp-btn-support:hover{border-color:${ACCENT};background:${accentAlpha(0.2)}}
}
.lp-btn-primary:active{transform:translateY(3px);box-shadow:0 1px 0 ${PRIMARY_DEEP},0 4px 10px ${primaryAlpha(0.2)}}
.lp-btn-secondary:active{transform:translateY(3px);box-shadow:0 1px 0 ${TEXT}}
.lp-btn.is-disabled{opacity:.55;pointer-events:none;box-shadow:none}
@media (pointer:coarse){.lp-btn-ghost,.lp-btn-support{min-height:44px}}
@media (max-width:899px){.lp-btn-primary,.lp-btn-secondary{height:48px}}
@media (max-width:599px){.lp-btn-primary,.lp-btn-secondary{font-size:14px;padding:0 12px}}

/* ---------- focus ---------- */
.lp-root a:focus-visible,.lp-root button:focus-visible{outline:3px solid ${TEXT};outline-offset:3px}

/* ---------- hero ---------- */
.lp-hero{display:grid;grid-template-columns:minmax(0,1fr) 260px;column-gap:48px;row-gap:14px;align-items:end;padding-block:44px 28px}
.lp-hero-copy{display:flex;flex-direction:column;align-items:flex-start;gap:14px;min-width:0}
.lp-live-pill{display:inline-flex;align-items:center;gap:8px;max-width:100%;box-sizing:border-box;height:30px;margin:0;padding:0 12px 0 4px;
  border-radius:${RADIUS_PILL}px;background:${destructiveAlpha(0.08)};border:1px solid ${destructiveAlpha(0.25)};
  font:700 12px/1 ${FONT_MONO};color:${TEXT}}
.lp-live-pill.is-neutral{background:${textAlpha(0.05)};border-color:${textAlpha(0.14)}}
.lp-live-pill-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-badge-live{display:inline-flex;align-items:center;gap:6px;flex:none;height:22px;padding:0 8px;border-radius:${RADIUS_PILL}px;
  background:${DESTRUCTIVE};color:${PRIMARY_TEXT};font:700 11px/1 ${FONT_MONO};letter-spacing:.08em}
.lp-badge-live.is-neutral{background:${textAlpha(0.12)};color:${TEXT}}
.lp-badge-live.is-neutral .lp-dot{display:none}
.lp-dot{width:6px;height:6px;border-radius:50%;background:${BG};flex:none;animation:lp-pulse ${DURATION_PULSE_MS}ms cubic-bezier(.4,0,.6,1) infinite}
@keyframes lp-pulse{0%{box-shadow:0 0 0 0 ${bgAlpha(0.7)}}70%{box-shadow:0 0 0 6px ${bgAlpha(0)}}100%{box-shadow:0 0 0 0 ${bgAlpha(0)}}}
.lp-h1{margin:0;font:400 48px/1.2 ${FONT_DISPLAY};letter-spacing:0;color:${TEXT};-webkit-font-smoothing:auto}
@media (max-width:899px){.lp-h1{font-size:40px}}
@media (max-width:599px){.lp-h1{font-size:32px}}
.lp-h1-accent{color:${PRIMARY}}
.lp-hero-tagline{margin:0;font:700 clamp(18px,calc(.6vw + 14px),24px)/1.3 ${FONT_MONO};color:${TEXT}}
.lp-lead{margin:0;max-width:60ch;font:400 clamp(14px,calc(.45vw + 12.3px),17px)/1.55 ${FONT_MONO};color:${TEXT_MUTED}}
.lp-hero-actions{display:flex;flex-direction:column;gap:12px}
.lp-hero-actions .lp-btn{width:100%}
.lp-trust{margin:2px 0 0;text-align:center;font:400 12px/1.4 ${FONT_MONO};color:${TEXT_MUTED}}
@media (max-width:899px){
  .lp-hero{grid-template-columns:1fr;row-gap:20px;padding-block:32px 24px}
  .lp-hero-actions{flex-direction:row;max-width:520px}
  .lp-hero-actions .lp-btn{flex:1 1 0;width:auto;min-width:0}
  .lp-trust{display:none}
}
@media (max-width:599px){.lp-hero{row-gap:14px;padding-block:20px 16px}.lp-hero-copy{gap:12px}.lp-hero-actions{gap:10px;max-width:none}}

/* ---------- featured ---------- */
.lp-featured{container-type:inline-size}
.lp-featured-frame{position:relative;width:100%;box-sizing:border-box;
  height:clamp(420px,calc((100cqw - 344px) * .5625 + 4px),600px);
  background:${STAGE_BG};border:2px solid ${TEXT};border-radius:${RADIUS_LG}px;overflow:hidden;box-shadow:${SHADOW_HARD_LG};
  transition:box-shadow ${DURATION_BASE_MS}ms ${EASE_OUT},border-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
@media (max-width:899px){.lp-featured-frame{height:auto;aspect-ratio:16/9}}
@media (max-width:599px){.lp-featured-frame{width:auto;margin-left:calc(-1 * var(--lp-gutter-l));margin-right:calc(-1 * var(--lp-gutter-r));
  border-radius:0;border-left:0;border-right:0;box-shadow:none}}
.lp-featured-embed{position:absolute;inset:0}
.lp-featured-overlay{position:absolute;inset:0;z-index:2;display:flex;align-items:flex-start;justify-content:flex-start;
  margin:0;padding:12px;border:0;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-featured-chips{display:flex;align-items:center;gap:8px}
.lp-featured-chips .lp-badge-live{height:24px;border-radius:6px}
.lp-chip-enter{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:6px;background:${PRIMARY};
  color:${PRIMARY_TEXT};font:700 11px/1 ${FONT_MONO};letter-spacing:.08em;box-shadow:0 2px 0 ${PRIMARY_DEEP};
  transition:background-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-arrow{display:inline-block;transition:transform ${DURATION_BASE_MS}ms ${EASE_OUT}}
@media (hover:hover) and (pointer:fine){
  .lp-featured-frame:hover{border-color:${PRIMARY};box-shadow:0 0 0 4px ${primaryAlpha(0.18)},${SHADOW_HARD_LG}}
  .lp-featured-frame:hover .lp-featured-overlay{background:${textAlpha(0.06)}}
  .lp-featured-frame:hover .lp-chip-enter{background:${PRIMARY_DEEP}}
  .lp-featured-frame:hover .lp-arrow,.lp-btn-ghost:hover .lp-arrow{transform:translateX(3px)}
}
.lp-root .lp-featured-overlay:focus-visible{outline:none}
.lp-featured-frame:has(.lp-featured-overlay:focus-visible){outline:3px solid ${TEXT};outline-offset:4px}
@media (max-width:599px){
  .lp-featured-overlay{padding:10px}
  .lp-featured-frame:has(.lp-featured-overlay:focus-visible){outline:3px solid ${PRIMARY};outline-offset:-3px}
}
.lp-frame-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  padding:24px;text-align:center;color:${BG}}
.lp-frame-state img{width:60px;height:60px;image-rendering:pixelated}
.lp-frame-state.is-offline img{opacity:.5}
.lp-frame-state h3{margin:0;font:400 16px/1.5 ${FONT_DISPLAY}}
.lp-frame-state p{margin:0;max-width:44ch;font:400 14px/1.6 ${FONT_MONO}}
.lp-bob{animation:lp-bob 600ms steps(2,end) infinite alternate}
@keyframes lp-bob{from{transform:translateY(0)}to{transform:translateY(-6px)}}
@media (max-width:599px){.lp-frame-state{gap:8px;padding:16px}.lp-frame-state.is-offline img{display:none}.lp-frame-state p{font-size:13px}}
.lp-featured-caption{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px}
.lp-featured-caption-text{min-width:0;display:flex;flex-direction:column;gap:4px}
.lp-featured-title{margin:0;font:700 16px/1.3 ${FONT_MONO};color:${TEXT};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-featured-meta{margin:0;font:400 13px/1.5 ${FONT_MONO};color:${TEXT_MUTED};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-featured-caption .lp-btn{flex:none}
@media (max-width:599px){.lp-featured-caption{padding-top:12px;gap:12px}.lp-featured-title{font-size:15px}.lp-featured-meta{font-size:12px}}

/* ---------- sections ---------- */
.lp-section{margin-top:72px}
.lp-section-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px;margin-bottom:6px}
.lp-h2{margin:0;font:400 16px/1.5 ${FONT_DISPLAY};color:${TEXT}}
.lp-section-meta{display:flex;align-items:center;gap:12px;font:400 13px/1.5 ${FONT_MONO};color:${TEXT_MUTED}}
.lp-section-sub{margin:0 0 20px;font:400 13px/1.5 ${FONT_MONO};color:${TEXT_MUTED}}
@media (max-width:899px){.lp-section{margin-top:56px}}
@media (max-width:599px){.lp-section{margin-top:44px}.lp-section-meta,.lp-section-sub{font-size:12px}.lp-section-sub{margin-bottom:16px}}

/* ---------- how it works ---------- */
.lp-steps{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.lp-step{display:flex;flex-direction:column;padding:24px;background:${BG};border:2px solid ${textAlpha(0.12)};
  border-radius:${RADIUS_LG}px;box-shadow:${SHADOW_HARD}}
.lp-step-num{margin-bottom:14px;font:400 24px/1 ${FONT_DISPLAY};color:${PRIMARY}}
.lp-step-title{margin:0 0 8px;font:700 17px/1.3 ${FONT_MONO};color:${TEXT}}
.lp-step-body{margin:0;font:400 14px/1.6 ${FONT_MONO};color:${TEXT_MUTED}}
@media (max-width:899px){
  .lp-steps{grid-template-columns:1fr;gap:12px}
  .lp-step{display:grid;grid-template-columns:44px 1fr;column-gap:14px;align-items:start;padding:16px}
  .lp-step-num{grid-row:1 / span 2;width:44px;height:44px;margin:0;display:flex;align-items:center;justify-content:center;
    font-size:16px;color:${PRIMARY_DEEP};background:${primaryAlpha(0.1)};border-radius:${RADIUS_SM}px}
  .lp-step-title{margin:2px 0 4px;font-size:16px}
}

/* ---------- rooms grid + cards ---------- */
.lp-room-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:28px 16px;margin:0;padding:0;list-style:none}
@media (max-width:899px){.lp-room-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:24px 14px}}
@media (max-width:599px){.lp-room-grid{grid-template-columns:1fr;gap:10px}}
.lp-card{display:flex;flex-direction:column;gap:10px;width:100%;box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;
  color:${TEXT};font-family:${FONT_MONO};text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
.lp-card-thumb{position:relative;width:100%;aspect-ratio:4/5;box-sizing:border-box;overflow:hidden;background:${STAGE_BG};
  border:2px solid ${textAlpha(0.12)};border-radius:${RADIUS_MD}px;box-shadow:${SHADOW_SM};
  transition:transform ${DURATION_BASE_MS}ms ${EASE_OUT},box-shadow ${DURATION_BASE_MS}ms ${EASE_OUT},border-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-card-thumb>img{display:block;width:100%;height:100%;object-fit:cover;image-rendering:pixelated}
.lp-card-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  padding:12px;text-align:center;background-color:${BG_ALT};
  background-image:repeating-linear-gradient(135deg,${textAlpha(0.035)} 0 10px,transparent 10px 20px)}
.lp-card-placeholder img{width:60px;height:60px;image-rendering:pixelated;opacity:.4}
.lp-card-placeholder span{font:700 11px/1.4 ${FONT_MONO};letter-spacing:.08em;color:${TEXT}}
.lp-pill{position:absolute;display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:${RADIUS_PILL}px;
  font:700 11px/1 ${FONT_MONO};letter-spacing:.08em;white-space:nowrap}
.lp-pill-tl{top:8px;left:8px}.lp-pill-tr{top:8px;right:8px}.lp-pill-bl{bottom:8px;left:8px}
.lp-pill-dark{background:${textAlpha(0.85)};color:${BG}}
.lp-pill-light{background:${bgAlpha(0.94)};color:${TEXT};box-shadow:inset 0 0 0 1px ${textAlpha(0.15)}}
.lp-pill-battle{background:${DESTRUCTIVE};color:${PRIMARY_TEXT}}
.lp-pill-starting{background:${PRIMARY};color:${PRIMARY_TEXT}}
.lp-card-body{display:flex;flex-direction:column;gap:6px;min-width:0;padding:0 2px}
.lp-card-name{font:700 15px/1.3 ${FONT_MONO};color:${TEXT};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  transition:color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-chip-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.lp-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;box-sizing:border-box;border:1px solid transparent;border-radius:6px;
  font:700 11px/1 ${FONT_MONO};letter-spacing:.08em;color:${TEXT}}
.lp-chip-ffa{background:${textAlpha(0.05)};border-color:${textAlpha(0.16)}}
.lp-chip-boss{background:${accentAlpha(0.14)};border-color:${accentAlpha(0.45)}}
.lp-chip-team{background:${secondaryAlpha(0.14)};border-color:${secondaryAlpha(0.5)}}
.lp-chip-wide{background:${yellowAlpha(0.16)};border-color:${yellowAlpha(0.5)}}
.lp-pill-inline,.lp-card-meta,.lp-card-chevron{display:none}
@media (hover:hover) and (pointer:fine){
  .lp-card:hover .lp-card-thumb{transform:translateY(-3px);border-color:${PRIMARY};box-shadow:${SHADOW_MD}}
  .lp-card:hover .lp-card-name{color:${PRIMARY_DEEP}}
}
.lp-card:active .lp-card-thumb{transform:translateY(-1px)}
.lp-root .lp-card:focus-visible{outline:none}
.lp-card:focus-visible .lp-card-thumb{outline:3px solid ${TEXT};outline-offset:3px}
@media (max-width:599px){
  .lp-card{flex-direction:row;align-items:center;gap:12px;min-height:96px;padding:8px 14px 8px 8px;background:${BG};
    border:2px solid ${textAlpha(0.12)};border-radius:${RADIUS_LG}px;box-shadow:${SHADOW_HARD}}
  .lp-card-thumb{width:64px;flex:none;border-width:1px;border-radius:${RADIUS_SM}px;box-shadow:none}
  .lp-card-thumb .lp-pill,.lp-card-placeholder span{display:none}
  .lp-card-placeholder img{width:30px;height:30px}
  .lp-card-body{flex:1;gap:5px;padding:0}
  .lp-pill-inline{position:static;display:inline-flex}
  .lp-card-meta{display:block;font:400 12px/1.4 ${FONT_MONO};color:${TEXT_MUTED}}
  .lp-card-chevron{display:block;flex:none;font:700 18px/1 ${FONT_MONO};color:${TEXT_MUTED}}
  .lp-card:active{background:${BG_ALT}}
  .lp-root .lp-card:focus-visible{outline:3px solid ${TEXT};outline-offset:3px}
  .lp-card:focus-visible .lp-card-thumb{outline:none}
}

/* ---------- skeletons, info boxes, create row ---------- */
.lp-skeleton,.lp-skeleton-line{background:linear-gradient(90deg,${BG_ALT} 25%,${BG} 50%,${BG_ALT} 75%);background-size:200% 100%;
  animation:lp-shimmer 1400ms linear infinite}
.lp-skeleton{aspect-ratio:4/5;border-radius:${RADIUS_MD}px}
.lp-skeleton-line{height:14px;width:60%;margin-top:10px;border-radius:4px}
@keyframes lp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@media (max-width:599px){.lp-skeleton{aspect-ratio:auto;height:96px;border-radius:${RADIUS_LG}px}.lp-skeleton-line{display:none}}
.lp-info-box{display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 20px;text-align:center;background:${BG};
  border:2px dashed ${textAlpha(0.22)};border-radius:${RADIUS_LG}px}
.lp-info-box img{width:30px;height:30px;image-rendering:pixelated}
.lp-info-box p{margin:0;max-width:48ch;font:400 14px/1.6 ${FONT_MONO};color:${TEXT}}
.lp-create-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.lp-create-row .lp-btn-primary,.lp-create-row .lp-btn-secondary{height:44px;font-size:13px}
.lp-btn-ghost[aria-pressed="true"]{border-color:${ACCENT};background:${accentAlpha(0.14)}}
.lp-alert{margin:12px 0 0;padding:10px 14px;border-radius:${RADIUS_SM}px;background:${destructiveAlpha(0.08)};
  border:1px solid ${destructiveAlpha(0.3)};font:400 13px/1.5 ${FONT_MONO};color:${TEXT}}

/* ---------- footer ---------- */
.lp-footer{margin-top:80px;background:${BG_ALT};border-top:2px solid ${textAlpha(0.1)};
  padding-top:36px;padding-bottom:calc(36px + env(safe-area-inset-bottom))}
.lp-footer-inner{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:48px;row-gap:20px;align-items:start}
.lp-footer-brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.lp-footer-brand img{width:30px;height:30px;image-rendering:pixelated}
.lp-footer-brand span{font:400 12px/1 ${FONT_DISPLAY};padding-top:2px;color:${TEXT}}
.lp-footer-copy{display:flex;flex-direction:column;gap:10px;max-width:68ch}
.lp-footer-copy p{margin:0;font:400 12px/1.65 ${FONT_MONO};color:${TEXT}}
.lp-footer-copy p:first-of-type{font-size:13px}
.lp-footer a,.lp-footer-links button{color:${TEXT};font-weight:700;text-decoration:underline;text-decoration-color:${primaryAlpha(0.5)};
  text-decoration-thickness:2px;text-underline-offset:4px;
  transition:color ${DURATION_BASE_MS}ms ${EASE_OUT},text-decoration-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
@media (hover:hover) and (pointer:fine){.lp-footer a:hover,.lp-footer-links button:hover{color:${PRIMARY_DEEP};text-decoration-color:${PRIMARY}}}
.lp-footer-links{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin:0;padding:0;list-style:none}
.lp-footer-links a,.lp-footer-links button{display:inline-flex;align-items:center;min-height:36px;padding:0;border:0;background:none;
  font:700 13px/1.4 ${FONT_MONO};cursor:pointer}
@media (pointer:coarse){.lp-footer-links a,.lp-footer-links button{min-height:44px}}
@media (max-width:899px){.lp-footer{margin-top:64px}.lp-footer-inner{grid-template-columns:1fr}
  .lp-footer-links{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 20px}}
@media (max-width:599px){.lp-footer{margin-top:48px;padding-top:28px}}

/* ---------- contact modal ---------- */
.lp-modal{box-sizing:border-box;width:min(460px,calc(100% - var(--lp-gutter-l) - var(--lp-gutter-r)));max-width:none;
  max-height:calc(100dvh - 32px);margin:auto;padding:0;overflow:auto;overscroll-behavior:contain;
  background:${BG};color:${TEXT};font-family:${FONT_MONO};border:2px solid ${TEXT};border-radius:${RADIUS_LG}px;box-shadow:${SHADOW_HARD_LG}}
.lp-modal::backdrop{background:${textAlpha(0.55)};-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.lp-modal[open]{animation:lp-modal-in ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-modal[open]::backdrop{animation:lp-fade-in ${DURATION_BASE_MS}ms ${EASE_OUT}}
@keyframes lp-modal-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes lp-fade-in{from{opacity:0}to{opacity:1}}
html:has(.lp-modal[open]){overflow:hidden}
.lp-modal-body{display:flex;flex-direction:column;gap:16px;padding:24px}
.lp-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lp-modal-close{display:inline-flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;margin:-8px -8px -8px 0;padding:0;
  border:0;border-radius:${RADIUS_SM}px;background:transparent;color:${TEXT_MUTED};cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:background-color ${DURATION_BASE_MS}ms ${EASE_OUT},color ${DURATION_BASE_MS}ms ${EASE_OUT}}
@media (pointer:coarse){.lp-modal-close{width:44px;height:44px}}
.lp-modal-lead{margin:0;font:400 14px/1.6 ${FONT_MONO};color:${TEXT_MUTED}}
.lp-modal-options{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.lp-modal-option{display:flex;align-items:center;gap:14px;padding:14px 16px 14px 14px;background:${BG};color:${TEXT};text-decoration:none;
  border:2px solid ${textAlpha(0.12)};border-radius:${RADIUS_LG}px;box-shadow:${SHADOW_HARD};-webkit-tap-highlight-color:transparent;
  transition:transform ${DURATION_BASE_MS}ms ${EASE_OUT},box-shadow ${DURATION_BASE_MS}ms ${EASE_OUT},border-color ${DURATION_BASE_MS}ms ${EASE_OUT},
    background-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-modal-mark{display:flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;width:44px;height:44px;padding-top:2px;
  border-radius:${RADIUS_SM}px;background:${primaryAlpha(0.1)};color:${PRIMARY_DEEP};font:400 16px/1 ${FONT_DISPLAY}}
.lp-modal-option-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.lp-modal-option-title{font:700 16px/1.3 ${FONT_MONO};color:${TEXT}}
.lp-modal-option-body{font:400 13px/1.5 ${FONT_MONO};color:${TEXT_MUTED}}
.lp-modal-option .lp-arrow{flex:none;font:700 16px/1 ${FONT_MONO};color:${TEXT_MUTED}}
.lp-modal-address{display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:1px solid ${textAlpha(0.1)}}
.lp-modal-address-label{margin:0;font:400 12px/1.5 ${FONT_MONO};color:${TEXT_MUTED}}
.lp-modal-address-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 6px 6px 14px;
  background:${BG_ALT};border-radius:${RADIUS_SM}px}
.lp-modal-email{min-width:0;overflow-wrap:anywhere;font:700 14px/1.4 ${FONT_MONO};color:${TEXT};text-decoration:underline;
  text-decoration-color:${primaryAlpha(0.5)};text-decoration-thickness:2px;text-underline-offset:4px;
  transition:color ${DURATION_BASE_MS}ms ${EASE_OUT},text-decoration-color ${DURATION_BASE_MS}ms ${EASE_OUT}}
.lp-modal-copy{flex:none;min-width:84px;background:${BG}}
@media (hover:hover) and (pointer:fine){
  .lp-modal-option:hover{transform:translateY(-2px);border-color:${PRIMARY};box-shadow:${SHADOW_MD}}
  .lp-modal-option:hover .lp-arrow{transform:translateX(3px);color:${PRIMARY_DEEP}}
  .lp-modal-close:hover{background:${textAlpha(0.06)};color:${TEXT}}
  .lp-modal-email:hover{color:${PRIMARY_DEEP};text-decoration-color:${PRIMARY}}
}
.lp-modal-option:active{transform:none;background:${BG_ALT}}
@media (max-width:599px){
  .lp-modal-body{gap:14px;padding:20px 16px}
  .lp-modal-lead{font-size:13px}
  .lp-modal-option{gap:12px;padding:12px}
  .lp-modal-option-title{font-size:15px}
  .lp-modal-option-body{font-size:12px}
}

/* ---------- reduced motion (keep last) ---------- */
@media (prefers-reduced-motion:reduce){
  .lp-dot,.lp-bob,.lp-skeleton,.lp-skeleton-line,.lp-modal[open]{animation:none}
  .lp-modal[open]::backdrop{animation:none}
  .lp-dot{box-shadow:0 0 0 2px ${bgAlpha(0.35)}}
  .lp-btn,.lp-card-thumb,.lp-card-name,.lp-featured-frame,.lp-featured-overlay,.lp-chip-enter,.lp-arrow,.lp-footer a,.lp-footer-links button,
  .lp-modal-option,.lp-modal-close,.lp-modal-email{transition:none}
  .lp-btn-primary:hover,.lp-btn-secondary:hover,.lp-btn-primary:active,.lp-btn-secondary:active,
  .lp-card:hover .lp-card-thumb,.lp-card:active .lp-card-thumb,
  .lp-featured-frame:hover .lp-arrow,.lp-btn-ghost:hover .lp-arrow,.lp-modal-option:hover,.lp-modal-option:hover .lp-arrow{transform:none}
}
`;
