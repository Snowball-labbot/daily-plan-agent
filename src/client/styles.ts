import { VISUAL_CSS } from './visual.ts'

const ID = 'dsh-daily-plan-styles'

const CSS = String.raw`
/* ── design tokens ─────────────────────────────────────────────────────────── */
.dp-root{
  /* category semantics: soft = block fill, ink = text on it, base = accent bar */
  --dp-study:#2563eb;    --dp-study-ink:#0e3074;    --dp-study-soft:#eff6ff;
  --dp-intern:#4176e6;   --dp-intern-ink:#283142;   --dp-intern-soft:#edf3fe;
  --dp-activity:#f59e0b; --dp-activity-ink:#27241f; --dp-activity-soft:#fef5e7;
  --dp-gym:#22c55e;      --dp-gym-ink:#233c2c;      --dp-gym-soft:#e6faed;

  /* record page: GitHub's own contribution palette, deliberately not our green */
  --dp-heat-0:#EBEDF0;      --dp-heat-0-ring:#D0D7DE;
  --dp-heat-1:#9BE9A8;      --dp-heat-2:#40C463;
  --dp-heat-3:#30A14E;      --dp-heat-4:#216E39;   --dp-heat-4-ring:#30A14E;
  --dp-heat-size:13px;      --dp-heat-gap:3px;      --dp-heat-label-w:15px;
  /* Wide enough for '07:00-08:00' next to the period number. */
  --dp-grid-label:150px;

  /* the 8 colours a backlog item can be tagged with */
  --dp-pick-blue:#2563eb;   --dp-pick-blue-soft:#eff6ff;   --dp-pick-blue-ink:#0e3074;
  --dp-pick-indigo:#6366f1; --dp-pick-indigo-soft:#eef2ff; --dp-pick-indigo-ink:#1e1b60;
  --dp-pick-teal:#0d9488;   --dp-pick-teal-soft:#effcf9;   --dp-pick-teal-ink:#0b3b36;
  --dp-pick-green:#22c55e;  --dp-pick-green-soft:#e6faed;  --dp-pick-green-ink:#233c2c;
  --dp-pick-amber:#f59e0b;  --dp-pick-amber-soft:#fef5e7;  --dp-pick-amber-ink:#27241f;
  --dp-pick-orange:#f97316; --dp-pick-orange-soft:#fff3ea; --dp-pick-orange-ink:#3a1c06;
  --dp-pick-rose:#e11d48;   --dp-pick-rose-soft:#fff1f4;   --dp-pick-rose-ink:#4c0519;
  --dp-pick-slate:#64748b;  --dp-pick-slate-soft:#f1f5f9;  --dp-pick-slate-ink:#1e293b;

  --dp-s1:4px; --dp-s2:8px; --dp-s3:12px; --dp-s4:16px;
  --dp-s5:24px; --dp-s6:32px; --dp-s7:48px;

  --dp-f-caption:11px; --dp-f-xs:12px; --dp-f-sm:13px; --dp-f-base:14px;
  --dp-f-lg:16px; --dp-f-xl:20px; --dp-f-2xl:24px;

  --dp-r-sm:6px; --dp-r-md:8px; --dp-r-lg:12px; --dp-r-pill:999px;

  --dp-d:var(--ds-transition-duration,.2s);
  --dp-d-fast:var(--ds-transition-duration-fast,.1s);
  --dp-d-slow:var(--ds-transition-duration-slow,.3s);
  --dp-ease:var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1));

  --dp-shadow:var(--dsw-elevation-soft,0 1px 2px rgb(0 0 0/.06));
  --dp-shadow-float:var(--dsw-elevation-prominent,var(--dsw-shadow-lv3,0 12px 32px rgb(0 0 0/.14)));

  position:absolute; inset:0; display:flex; flex-direction:column; min-width:0;
  font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
  font-size:var(--dp-f-base); line-height:1.6; font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base);
  -webkit-font-smoothing:antialiased; text-wrap:pretty;
}
body[data-ds-dark-theme] .dp-root{
  --dp-study:#60a5fa;    --dp-study-ink:#dbeafe;    --dp-study-soft:#172554;
  --dp-intern:#679efe;   --dp-intern-ink:#e4edfd;   --dp-intern-soft:#283142;
  --dp-activity:#f7ad31; --dp-activity-ink:#fef5e7; --dp-activity-soft:#27241f;
  --dp-gym:#4ed17e;      --dp-gym-ink:#e6faed;      --dp-gym-soft:#233c2c;

  --dp-heat-0:#2D333B;   --dp-heat-0-ring:#444C56;
  --dp-heat-1:#0E4429;   --dp-heat-2:#006D32;
  --dp-heat-3:#26A641;   --dp-heat-4:#39D353;       --dp-heat-4-ring:#26A641;

  --dp-pick-blue:#60a5fa;   --dp-pick-blue-soft:#172554;   --dp-pick-blue-ink:#dbeafe;
  --dp-pick-indigo:#818cf8; --dp-pick-indigo-soft:#1e1b4b; --dp-pick-indigo-ink:#e0e7ff;
  --dp-pick-teal:#2dd4bf;   --dp-pick-teal-soft:#042f2e;   --dp-pick-teal-ink:#ccfbf1;
  --dp-pick-green:#4ed17e;  --dp-pick-green-soft:#233c2c;  --dp-pick-green-ink:#e6faed;
  --dp-pick-amber:#fbbf24;  --dp-pick-amber-soft:#3b2f13;  --dp-pick-amber-ink:#fef3c7;
  --dp-pick-orange:#fb923c; --dp-pick-orange-soft:#431407; --dp-pick-orange-ink:#ffedd5;
  --dp-pick-rose:#fb7185;   --dp-pick-rose-soft:#4c0519;   --dp-pick-rose-ink:#ffe4e6;
  --dp-pick-slate:#94a3b8;  --dp-pick-slate-soft:#1e293b;  --dp-pick-slate-ink:#f1f5f9;
}

/* Closed panel: only route a toast to the screen, never intercept input.
   Doubled class beats the overlay layer's child pointer-events:auto rule. */
.dp-root.dp-root--bare{background:transparent;pointer-events:none}
.dp-root.dp-root--bare>*{pointer-events:none}

/* ── base ──────────────────────────────────────────────────────────────────── */
.dp-root *,.dp-root *:before,.dp-root *:after{box-sizing:border-box}
/* :where() keeps the element reset at element specificity, so any class-based
   rule (.dp-cell, .dp-gblock-body, …) overrides it without !important. */
:where(.dp-root) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:where(.dp-root) button:disabled{cursor:not-allowed;opacity:.5}
:where(.dp-root) input,:where(.dp-root) textarea,:where(.dp-root) select{
  font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);padding:6px 9px;
}
.dp-root input:focus-visible,.dp-root textarea:focus-visible,.dp-root select:focus-visible,
.dp-root button:focus-visible,.dp-root a:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary,#2563eb);outline-offset:2px;
}
.dp-root h1,.dp-root h2,.dp-root h3,.dp-root h4{margin:0;font-weight:500}
.dp-root p{margin:0}
.dp-root small{font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary)}
.dp-scroll{scrollbar-gutter:stable;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgb(0 0 0/.2)) transparent}
.dp-scroll::-webkit-scrollbar{width:8px;height:8px}
.dp-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgb(0 0 0/.2));border-radius:4px}
.dp-scroll::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,rgb(0 0 0/.3))}
.dp-scroll::-webkit-scrollbar-track{background:transparent}
.dp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ── shell ─────────────────────────────────────────────────────────────────── */
.dp-topbar{
  flex:0 0 42px;display:flex;align-items:center;gap:10px;padding:0 14px;
  border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);
}
.dp-topbar-sep{width:1px;height:14px;background:var(--dsw-alias-border-l3);flex:0 0 1px}
.dp-topbar-title{font-weight:500}
.dp-topbar-spacer{flex:1 1 auto}
.dp-status{display:flex;align-items:center;gap:6px;font-size:var(--dp-f-xs);color:var(--dsw-alias-label-secondary)}
.dp-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:0 0 6px}
.dp-dot.is-ready{background:var(--dsw-alias-state-success-primary,#22c55e)}
.dp-dot.is-loading{background:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dp-dot.is-error{background:var(--dsw-alias-state-error-primary,#ef4444)}

.dp-nav{flex:0 0 40px;display:flex;align-items:center;gap:2px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dp-nav-item{
  height:28px;padding:0 12px;border-radius:var(--dp-r-sm);font-size:var(--dp-f-sm);
  color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;
  transition:background-color var(--dp-d) var(--dp-ease),color var(--dp-d) var(--dp-ease);
}
.dp-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dp-nav-item[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}

.dp-body{flex:1 1 auto;min-height:0;overflow:auto}
.dp-page{max-width:1280px;margin:0 auto;padding:20px 24px 28px;animation:dp-fade var(--dp-d) var(--dp-ease)}
@keyframes dp-fade{from{opacity:0}to{opacity:1}}

/* ── primitives ────────────────────────────────────────────────────────────── */
.dp-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);
  font-size:var(--dp-f-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  transition:background-color var(--dp-d) var(--dp-ease),border-color var(--dp-d) var(--dp-ease),
             transform var(--dp-d-fast) var(--dp-ease);
}
.dp-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}
.dp-btn:active:not(:disabled){transform:scale(.98)}
.dp-btn--primary{
  border-color:var(--dsw-alias-state-business-primary,#2563eb);
  background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff;
}
.dp-btn--primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-state-business-primary,#2563eb)}
.dp-btn--ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.dp-btn--ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dp-btn--sm{height:26px;padding:0 9px;font-size:var(--dp-f-xs)}
.dp-btn--icon{width:30px;height:30px;padding:0}
.dp-btn svg{width:15px;height:15px;flex:0 0 auto}

.dp-chip{
  display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:var(--dp-r-pill);
  border:1px dashed var(--dsw-alias-border-l3);font-size:var(--dp-f-xs);
  color:var(--dsw-alias-label-secondary);background:transparent;
  transition:background-color var(--dp-d) var(--dp-ease),color var(--dp-d) var(--dp-ease);
}
.dp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dp-chip--solid{border-style:solid;border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}

.dp-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-md);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.dp-card--flat{border-color:transparent;background:transparent;padding:0}

.dp-head{display:flex;align-items:center;gap:10px;margin-bottom:var(--dp-s3)}
.dp-head h2{font-size:var(--dp-f-lg)}
.dp-spacer{flex:1 1 auto}
.dp-muted{color:var(--dsw-alias-label-secondary);font-size:var(--dp-f-xs)}
.dp-faint{color:var(--dsw-alias-label-tertiary);font-size:var(--dp-f-xs)}
.dp-label{font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);display:block;margin-bottom:2px}
.dp-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  min-height:180px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary);
  border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dp-r-md);font-size:var(--dp-f-sm);
}
.dp-error{
  border:1px solid var(--dsw-alias-state-error-primary,#ef4444);border-radius:var(--dp-r-sm);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 8%,transparent);
  color:var(--dsw-alias-label-primary);padding:9px 11px;font-size:var(--dp-f-xs);margin-bottom:var(--dp-s3);
}
.dp-alert{
  border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:var(--dp-r-sm);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 10%,transparent);
  color:var(--dsw-alias-label-primary);padding:9px 11px;font-size:var(--dp-f-xs);
}
.dp-stat{min-width:0}
.dp-stat b{display:block;font-size:var(--dp-f-xl);font-weight:500;line-height:1.2}
.dp-stat.is-accent b{color:var(--dsw-alias-state-business-primary,#2563eb)}
.dp-stats{display:flex;gap:26px;flex-wrap:wrap;padding:14px 0 4px}

.dp-dots{color:var(--dp-gym);letter-spacing:3px;font-size:var(--dp-f-xs)}
.dp-dots i{font-style:normal;opacity:.25}
.dp-dots i.on{opacity:1}
.dp-tag{
  display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:4px;
  font-size:var(--dp-f-caption);border:1px solid currentColor;opacity:.9;
}
.dp-cat{display:inline-block;width:3px;align-self:stretch;border-radius:2px;flex:0 0 3px}
.dp-cat--study{background:var(--dp-study)}
.dp-cat--intern{background:var(--dp-intern)}
.dp-cat--activity{background:var(--dp-activity)}
.dp-cat--gym{background:var(--dp-gym)}

.dp-sidebar-entry{
  position:relative;display:flex;width:100%;height:36px;align-items:center;gap:9px;padding:0 10px;
  border-radius:7px;color:var(--dsw-alias-label-secondary);
  font:500 13px var(--dsw-font-family,"Segoe UI",sans-serif);
  transition:background-color var(--dp-d) var(--dp-ease),color var(--dp-d) var(--dp-ease);
}
.dp-sidebar-entry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dp-sidebar-entry svg{width:18px;height:18px;flex:0 0 18px}
.dp-sidebar-entry[data-wide="false"]{justify-content:center;padding:0}

/* ── today ─────────────────────────────────────────────────────────────────── */
.dp-split{display:grid;grid-template-columns:minmax(0,1fr) 216px;gap:20px;align-items:start}
.dp-tl{display:flex;flex-direction:column;gap:3px}
.dp-row{display:flex;gap:10px;align-items:stretch}
.dp-row-time{
  width:42px;flex:0 0 42px;padding-top:8px;font-size:var(--dp-f-xs);
  color:var(--dsw-alias-label-tertiary);
}
.dp-block{
  flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:9px;
  padding:7px 10px;border-radius:var(--dp-r-sm);
  border-left:3px solid var(--dp-accent,transparent);
  background:var(--dp-accent-soft,var(--dsw-alias-bg-layer-2));
  color:var(--dp-accent-ink,var(--dsw-alias-label-primary));
  transition:opacity var(--dp-d) var(--dp-ease);
}
/* Category sets the default accent. An explicit colour overrides it — the
   [data-color] rules below come later in the sheet and win on equal specificity. */
.dp-block[data-cat="study"],.dp-gblock[data-cat="study"],.dp-pool-card[data-cat="study"],.dp-ghost[data-cat="study"]{--dp-accent:var(--dp-study);--dp-accent-soft:var(--dp-study-soft);--dp-accent-ink:var(--dp-study-ink)}
.dp-block[data-cat="intern"],.dp-gblock[data-cat="intern"],.dp-pool-card[data-cat="intern"],.dp-ghost[data-cat="intern"]{--dp-accent:var(--dp-intern);--dp-accent-soft:var(--dp-intern-soft);--dp-accent-ink:var(--dp-intern-ink)}
.dp-block[data-cat="activity"],.dp-gblock[data-cat="activity"],.dp-pool-card[data-cat="activity"],.dp-ghost[data-cat="activity"]{--dp-accent:var(--dp-activity);--dp-accent-soft:var(--dp-activity-soft);--dp-accent-ink:var(--dp-activity-ink)}
.dp-block[data-cat="gym"],.dp-gblock[data-cat="gym"],.dp-pool-card[data-cat="gym"],.dp-ghost[data-cat="gym"]{--dp-accent:var(--dp-gym);--dp-accent-soft:var(--dp-gym-soft);--dp-accent-ink:var(--dp-gym-ink)}
.dp-root [data-color="blue"]{--dp-accent:var(--dp-pick-blue);--dp-accent-soft:var(--dp-pick-blue-soft);--dp-accent-ink:var(--dp-pick-blue-ink)}
.dp-root [data-color="indigo"]{--dp-accent:var(--dp-pick-indigo);--dp-accent-soft:var(--dp-pick-indigo-soft);--dp-accent-ink:var(--dp-pick-indigo-ink)}
.dp-root [data-color="teal"]{--dp-accent:var(--dp-pick-teal);--dp-accent-soft:var(--dp-pick-teal-soft);--dp-accent-ink:var(--dp-pick-teal-ink)}
.dp-root [data-color="green"]{--dp-accent:var(--dp-pick-green);--dp-accent-soft:var(--dp-pick-green-soft);--dp-accent-ink:var(--dp-pick-green-ink)}
.dp-root [data-color="amber"]{--dp-accent:var(--dp-pick-amber);--dp-accent-soft:var(--dp-pick-amber-soft);--dp-accent-ink:var(--dp-pick-amber-ink)}
.dp-root [data-color="orange"]{--dp-accent:var(--dp-pick-orange);--dp-accent-soft:var(--dp-pick-orange-soft);--dp-accent-ink:var(--dp-pick-orange-ink)}
.dp-root [data-color="rose"]{--dp-accent:var(--dp-pick-rose);--dp-accent-soft:var(--dp-pick-rose-soft);--dp-accent-ink:var(--dp-pick-rose-ink)}
.dp-root [data-color="slate"]{--dp-accent:var(--dp-pick-slate);--dp-accent-soft:var(--dp-pick-slate-soft);--dp-accent-ink:var(--dp-pick-slate-ink)}
.dp-block.is-done{opacity:.5}
.dp-block.is-done .dp-block-title{text-decoration:line-through}
.dp-block.is-locked{border-left-style:dashed}
.dp-block-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-block-meta{font-size:var(--dp-f-xs);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dp-check{
  width:20px;height:20px;flex:0 0 20px;border-radius:5px;display:grid;place-items:center;
  border:1px solid currentColor;opacity:.45;
  transition:opacity var(--dp-d) var(--dp-ease),transform var(--dp-d-fast) var(--dp-ease);
}
.dp-check:hover{opacity:.8}
.dp-check:active{transform:scale(.92)}
.dp-check.is-on{background:currentColor;opacity:1;border-color:transparent}
.dp-check svg{width:13px;height:13px;color:var(--dsw-alias-bg-base)}
.dp-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.dp-side .dp-card b{font-size:var(--dp-f-sm)}
.dp-addrow{border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dp-r-sm);padding:7px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:var(--dp-f-xs);width:100%}
.dp-addrow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dp-toast{
  position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:5;
  background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);
  border-radius:var(--dp-r-pill);padding:6px 14px;font-size:var(--dp-f-xs);
  box-shadow:var(--dp-shadow-float);
}
.dp-now-line{height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary,#2563eb);opacity:.5;margin:2px 0}

/* ── week ──────────────────────────────────────────────────────────────────── */
.dp-week{display:grid;grid-template-columns:234px minmax(0,1fr);gap:16px;align-items:start}
.dp-pool,.dp-grid-scroll{max-height:calc(100vh - 268px);min-height:220px;overflow:auto}
.dp-pool{display:flex;flex-direction:column;gap:5px;padding-right:4px}
.dp-pool-head{display:flex;align-items:baseline;gap:8px;font-size:var(--dp-f-xs);color:var(--dsw-alias-label-tertiary);margin-bottom:2px;position:sticky;top:0;background:var(--dsw-alias-bg-base);padding:2px 0;z-index:2}
.dp-pool-card{
  display:flex;align-items:flex-start;gap:7px;width:100%;text-align:left;
  border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-border-l3);
  border-radius:var(--dp-r-sm);background:var(--dsw-alias-bg-layer-1);padding:6px 8px;
  cursor:grab;touch-action:none;
  transition:transform var(--dp-d-fast) var(--dp-ease),box-shadow var(--dp-d) var(--dp-ease);
}
.dp-pool-card:hover{transform:translateY(-1px);box-shadow:var(--dp-shadow)}
.dp-pool-card:active{cursor:grabbing}
.dp-pool-card{border-left-color:var(--dp-accent,var(--dsw-alias-border-l3))}
.dp-pool-grip{color:var(--dsw-alias-label-tertiary);flex:0 0 auto;margin-top:1px;line-height:0}
.dp-pool-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.dp-pool-title{font-weight:500;font-size:var(--dp-f-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-pool-meta{font-size:var(--dp-f-caption);color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dp-pool-del{opacity:0;color:var(--dsw-alias-label-tertiary);padding:2px;border-radius:4px;flex:0 0 auto;line-height:0;cursor:pointer}
.dp-pool-card:hover .dp-pool-del{opacity:1}
.dp-pool-del:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary,#ef4444)}
.dp-pool-new{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dp-r-sm);padding:7px}
.dp-pool-row{display:flex;align-items:center;gap:6px}

.dp-grid-head{display:grid;grid-template-columns:var(--dp-grid-label) repeat(7,minmax(0,1fr));gap:2px;position:sticky;top:0;z-index:2;background:var(--dsw-alias-bg-base);padding-bottom:4px}
.dp-grid-day{display:flex;flex-direction:column;align-items:center;font-size:var(--dp-f-caption);color:var(--dsw-alias-label-secondary);line-height:1.3}
.dp-grid-day small{color:var(--dsw-alias-label-tertiary)}
.dp-grid-day.is-today{color:var(--dsw-alias-state-business-primary,#2563eb);font-weight:500}
.dp-grid{display:grid;grid-template-columns:var(--dp-grid-label) repeat(7,minmax(0,1fr));grid-auto-rows:32px;gap:2px}
.dp-grid-period{
  display:flex;align-items:baseline;justify-content:flex-end;gap:4px;padding-right:4px;
  font-size:var(--dp-f-caption);line-height:32px;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary);
}
.dp-grid-period b{min-width:12px;text-align:right;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dp-grid-period em{font-style:normal;font-variant-numeric:tabular-nums}
.dp-grid-period small{opacity:.7}
.dp-cell{border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 8%,transparent);transition:background-color var(--dp-d-fast) var(--dp-ease)}
.dp-cell[data-weekend="true"]{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent)}
.dp-cell[data-armed="true"]{cursor:pointer}
.dp-cell[data-armed="true"]:hover{outline:1px solid var(--dsw-alias-border-l4);outline-offset:0}
.dp-cell[data-preview="true"]{
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 15%,transparent);
  outline:1.5px dashed var(--dsw-alias-state-business-primary,#2563eb);
}
.dp-gblock{position:relative;display:flex;border-radius:5px;border-left:3px solid transparent;overflow:hidden}
.dp-gblock{
  background:var(--dp-accent-soft,var(--dsw-alias-bg-layer-2));
  border-left-color:var(--dp-accent,transparent);
  color:var(--dp-accent-ink,var(--dsw-alias-label-primary));
}
.dp-gblock.is-locked{
  cursor:not-allowed;border-left-style:dashed;
  background:color-mix(in srgb,var(--dp-study-soft) 55%,var(--dsw-alias-bg-layer-2));
}
.dp-gblock.is-carry{background-image:repeating-linear-gradient(45deg,transparent 0 6px,var(--dsw-alias-interactive-bg-hover) 6px 12px)}
.dp-gblock.is-done{opacity:.5}
.dp-gblock.is-done .dp-gblock-title{text-decoration:line-through}
.dp-gblock-body{
  flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0;
  padding:2px 6px;text-align:left;cursor:inherit;touch-action:none;
}
.dp-gblock-title{font-size:var(--dp-f-caption);font-weight:500;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-gblock-note{font-size:var(--dp-f-caption);opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-gblock-del{
  position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:3px;
  display:grid;place-items:center;opacity:0;color:inherit;line-height:0;
  transition:opacity var(--dp-d-fast) var(--dp-ease);
}
.dp-gblock:hover .dp-gblock-del{opacity:.65}
.dp-gblock-del:hover{opacity:1!important;background:var(--dsw-alias-interactive-bg-hover)}
.dp-gblock.is-locked .dp-gblock-body{cursor:not-allowed}

.dp-ghost{
  position:fixed;left:0;top:0;z-index:60;pointer-events:none;will-change:transform;
  display:flex;align-items:center;gap:7px;max-width:230px;
  padding:7px 11px;border-radius:var(--dp-r-sm);
  border:1px solid var(--dsw-alias-border-l3);border-left:3px solid var(--dsw-alias-border-l4);
  background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dp-shadow-float);
  font-size:var(--dp-f-sm);font-weight:500;
}
.dp-block-gym{opacity:.8}
.dp-gblock-gym{
  display:block;font-size:10px;line-height:1.3;opacity:.75;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dp-gblock-open{
  flex:0 0 auto;display:grid;place-items:center;width:18px;height:18px;margin-right:2px;
  border-radius:4px;color:var(--dsw-alias-label-tertiary);opacity:0;
  transition:opacity var(--dp-d-fast) var(--dp-ease);
}
.dp-gblock:hover .dp-gblock-open,.dp-gblock-open:focus-visible{opacity:1}
.dp-gblock-open:hover{color:var(--dsw-alias-label-primary)}

.dp-daynav{display:inline-flex;align-items:center;gap:4px}

.dp-ghost{border-left-color:var(--dp-accent,var(--dsw-alias-border-l4))}
.dp-ghost svg{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}

.dp-armed{
  display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:7px 11px;
  font-size:var(--dp-f-xs);border-radius:var(--dp-r-sm);
  border:1px solid var(--dsw-alias-state-business-primary,#2563eb);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 10%,transparent);
}
.dp-armed svg{flex:0 0 auto;color:var(--dsw-alias-state-business-primary,#2563eb)}


.dp-swatches{display:inline-flex;align-items:center;gap:5px}
.dp-swatch{
  width:18px;height:18px;padding:0;border-radius:5px;
  background:var(--dp-accent,var(--dsw-alias-border-l3));
  border:1px solid var(--dsw-alias-border-l3);
}
.dp-swatch[data-on="true"]{
  box-shadow:0 0 0 2px var(--dsw-alias-bg-base),0 0 0 3.5px var(--dp-accent,var(--dsw-alias-border-l4));
}

@media (max-width:1100px){
  .dp-week{grid-template-columns:1fr}
  .dp-pool,.dp-grid-scroll{max-height:none}
}

/* ── gym ──────────────────────────────────────────────────────────────────── */
.dp-gym{display:grid;grid-template-columns:216px minmax(0,1fr);gap:16px;align-items:start}
.dp-gym-lib,.dp-gym-session{max-height:calc(100vh - 268px);min-height:220px;overflow:auto}
.dp-gym-lib{display:flex;flex-direction:column;gap:5px;padding-right:4px}
.dp-parts{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.dp-parts .dp-chip[data-on="true"]{
  background:var(--dp-gym-soft);border-color:var(--dp-gym);color:var(--dp-gym-ink);
  border-style:solid;font-weight:500;
}
.dp-gym-session{display:flex;flex-direction:column}
.dp-gym-row{
  display:flex;align-items:center;gap:8px;padding:6px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);
  background:var(--dsw-alias-bg-layer-1);
}
.dp-gym-grip{
  color:var(--dsw-alias-label-tertiary);cursor:grab;touch-action:none;line-height:0;
  flex:0 0 auto;padding:2px;border-radius:4px;
}
.dp-gym-grip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dp-gym-grip:active{cursor:grabbing}
.dp-gym-name{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}
.dp-gym-x{color:var(--dsw-alias-label-tertiary);font-size:var(--dp-f-xs)}
.dp-inline{
  font-size:var(--dp-f-sm);font-variant-numeric:tabular-nums;padding:1px 5px;border-radius:4px;
  border:1px solid transparent;color:var(--dsw-alias-label-primary);cursor:text;
}
.dp-inline:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.dp-inline-input{
  font-size:var(--dp-f-sm);font-variant-numeric:tabular-nums;padding:1px 5px;
  border:1px solid var(--dsw-alias-state-business-primary,#2563eb)!important;border-radius:4px;
}
.dp-gym-del{
  color:var(--dsw-alias-label-tertiary);flex:0 0 auto;padding:3px;border-radius:4px;
  opacity:.4;line-height:0;
  transition:opacity var(--dp-d-fast) var(--dp-ease);
}
.dp-gym-row:hover .dp-gym-del{opacity:1}
.dp-gym-del:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary,#ef4444)}
.dp-gym-slot{height:7px;position:relative;flex:0 0 auto;border-radius:3px;transition:height var(--dp-d-fast) var(--dp-ease)}
.dp-gym-slot[data-preview="true"]{
  height:22px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 12%,transparent);
  border-top:2px solid var(--dsw-alias-state-business-primary,#2563eb);
  display:flex;align-items:center;justify-content:center;
}
.dp-gym-slot-label{font-size:var(--dp-f-caption);color:var(--dsw-alias-state-business-primary,#2563eb)}
.dp-gym-session .dp-empty{min-height:140px}
.dp-dots button{color:inherit}

@media (max-width:1100px){
  .dp-gym{grid-template-columns:1fr}
  .dp-gym-lib,.dp-gym-session{max-height:none}
}

/* ── review: the tidied-up result reads as prose, not as a form ───────────── */
.dp-review-summary{width:100%;resize:vertical;line-height:1.65;padding:9px 11px}
.dp-addrow-bar{
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  margin-top:12px;padding-top:11px;
  border-top:1px dashed var(--dsw-alias-border-l2);
}
/* Bulleted, borderless rows: these are the user's own points, not form fields. */
.dp-listedit-row{position:relative}
.dp-listedit-row input{
  border-color:transparent;background:transparent;padding-left:18px;
  transition:border-color var(--dp-d-fast) var(--dp-ease),background-color var(--dp-d-fast) var(--dp-ease);
}
.dp-listedit-row input:hover{
  border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);
}
.dp-listedit-row input:focus{
  border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);
}
.dp-listedit-row::before{
  content:'';
  position:absolute;left:6px;top:50%;width:4px;height:4px;margin-top:-2px;
  border-radius:999px;background:var(--dsw-alias-label-tertiary);
}

/* ── review: progress updates read out of the text ────────────────────────── */
.dp-learning-updates{display:flex;flex-direction:column;gap:5px;margin:2px 0 14px}
.dp-learning-row{
  display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);
  font-size:var(--dp-f-sm);
}
.dp-learning-row[data-on="true"]{
  border-color:var(--dp-accent,var(--dsw-alias-state-business-primary,#2563eb));
  background:color-mix(in srgb,var(--dp-accent,var(--dsw-alias-state-business-primary,#2563eb)) 7%,transparent);
}
.dp-learning-row[data-on="false"]{opacity:.55}
.dp-learning-row svg{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}
.dp-learning-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-learning-delta{
  margin-left:auto;font-weight:500;font-variant-numeric:tabular-nums;flex:0 0 auto;
  color:var(--dsw-alias-state-business-primary,#2563eb);
}

/* ── standing plans (Settings) ────────────────────────────────────────────── */
.dp-hint{
  margin:0 0 8px;font-size:var(--dp-f-caption);line-height:1.6;
  color:var(--dsw-alias-label-tertiary);
}
.dp-routine-input{
  width:100%;resize:vertical;line-height:1.6;
  font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);padding:8px 10px;
}
.dp-routines{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.dp-routine-row{
  display:flex;align-items:center;gap:7px;flex-wrap:wrap;
  padding:7px 9px;border-radius:var(--dp-r-sm);
  border:1px solid var(--dsw-alias-border-l2);
  border-left:3px solid var(--dp-accent,var(--dsw-alias-border-l3));
}
.dp-routine-row input,.dp-routine-row select{flex:0 0 auto}
.dp-routine-name{width:112px}
.dp-routine-row select{width:auto}
.dp-weekday-picks{display:inline-flex;gap:3px}
.dp-weekday-pick{
  width:20px;height:20px;display:grid;place-items:center;border-radius:5px;
  font-size:11px;border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-tertiary);
}
.dp-weekday-pick[data-on="true"]{
  border-color:var(--dp-accent,var(--dsw-alias-state-business-primary,#2563eb));
  background:color-mix(in srgb,var(--dp-accent,var(--dsw-alias-state-business-primary,#2563eb)) 14%,transparent);
  color:var(--dsw-alias-label-primary);font-weight:500;
}
.dp-routine-periods{display:inline-flex;align-items:center;gap:4px}
.dp-routine-periods input{width:42px;text-align:center;padding:3px 5px}

/* ── learn ────────────────────────────────────────────────────────────────── */
.dp-learn{display:flex;flex-direction:column;gap:20px;max-width:960px;margin-inline:auto}
.dp-week-stats{
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r);
  padding:14px 16px;background:var(--dsw-alias-bg-layer-1);
}
.dp-week-stats-row{display:flex;gap:22px;flex-wrap:wrap;margin-bottom:12px}
.dp-big{display:flex;flex-direction:column;gap:1px}
.dp-big b{font-size:22px;font-weight:500;line-height:1.1;font-variant-numeric:tabular-nums}
.dp-big span{font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary)}

.dp-week-bar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end}
.dp-week-bar-col{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.dp-week-bar-track{
  width:100%;height:56px;display:flex;align-items:flex-end;
  border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 8%,transparent);
  overflow:hidden;
}
.dp-week-bar-fill{
  width:100%;display:block;min-height:2px;border-radius:5px 5px 0 0;
  background:var(--dp-study,#2563eb);position:relative;overflow:hidden;
}
.dp-week-bar-read{
  position:absolute;inset:0 0 auto 0;background:var(--dp-gym,#22c55e);
}
.dp-week-bar-col em{
  font-style:normal;font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);
}
.dp-week-bar-col[data-today="true"] em{color:var(--dsw-alias-label-primary);font-weight:500}
.dp-learn-legend{display:flex;align-items:center;gap:5px;margin-top:8px;font-size:var(--dp-f-caption)}
.dp-swatch-dot{
  width:9px;height:9px;border-radius:2px;display:inline-block;margin-left:8px;
  background:var(--dp-gym,#22c55e);
}
.dp-swatch-dot[data-kind="read"]{background:var(--dp-study,#2563eb)}

.dp-learn-col{display:flex;flex-direction:column;gap:9px}
.dp-learn-card{
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r);
  padding:11px 13px;display:flex;flex-direction:column;gap:8px;
  background:var(--dsw-alias-bg-layer-1);
  border-left:3px solid var(--dp-accent,var(--dsw-alias-border-l3));
}
.dp-learn-card-head{display:flex;align-items:center;gap:7px;min-width:0}
.dp-learn-title{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-learn-card-head .dp-gym-del{margin-left:auto;flex:0 0 auto}
.dp-learn-act{
  width:22px;height:22px;display:grid;place-items:center;border-radius:5px;flex:0 0 auto;
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);
}
.dp-learn-act:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.dp-learn-card-head .dp-faint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-tag{
  font-size:11px;padding:1px 6px;border-radius:999px;flex:0 0 auto;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);
}
.dp-tag[data-kind="problem"]{background:var(--dp-study-soft,#e6f0ff);color:var(--dp-study-ink,#0e3074)}
.dp-tag[data-kind="course"]{background:var(--dp-intern-soft,#e7eefd);color:var(--dp-intern-ink,#0e3074)}
.dp-tag[data-kind="skill"]{background:var(--dp-activity-soft,#fdf1dc);color:var(--dp-activity-ink,#4a3410)}

.dp-learn-bar{
  height:6px;border-radius:999px;overflow:hidden;
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 12%,transparent);
}
.dp-learn-bar span{display:block;height:100%;border-radius:999px;background:var(--dp-accent,var(--dp-study,#2563eb))}
.dp-learn-goal{display:flex;align-items:center;gap:8px}
.dp-learn-goal-track{
  flex:1 1 auto;height:4px;border-radius:999px;overflow:hidden;
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 12%,transparent);
}
.dp-learn-goal-track span{display:block;height:100%;background:var(--dp-accent,var(--dp-study,#2563eb))}
.dp-learn-goal-track span[data-full="true"]{background:var(--dp-gym,#22c55e)}

.dp-learn-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:var(--dp-f-caption)}
.dp-learn-meta b{font-weight:500;font-variant-numeric:tabular-nums}
.dp-learn-meta b.is-good{color:var(--dp-gym-ink,#166534)}
.dp-learn-meta [data-late="true"]{color:var(--dsw-alias-state-danger,#b91c1c)}
.dp-learn-meta svg{vertical-align:-1px;margin-right:2px}
.dp-learn-spacer{flex:1 1 auto}
.dp-learn-stepper{display:inline-flex;align-items:center;gap:3px}
.dp-learn-stepper button{
  width:22px;height:22px;display:grid;place-items:center;border-radius:5px;
  border:1px solid var(--dsw-alias-border-l2);
}
.dp-tiny-input{width:74px;padding:3px 6px;font-size:var(--dp-f-caption);text-align:center}
.dp-tiny-input--w{width:52px}

.dp-learn-form{
  display:flex;flex-direction:column;gap:7px;padding:11px;
  border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dp-r);
}
.dp-learn-form .dp-pool-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dp-learn-form input,.dp-learn-form select{flex:1 1 120px;min-width:0}
.dp-learn-form select{flex:0 0 auto;width:auto}

.dp-learn-done summary{
  cursor:pointer;font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);
  padding:4px 0;
}
.dp-learn-done > *:not(summary){margin-top:7px}

/* ── learn ────────────────────────────────────────────────────────────────── */
.dp-learn{display:flex;flex-direction:column;gap:20px;max-width:960px;margin-inline:auto}
.dp-week-stats{
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r);
  padding:14px 16px;background:var(--dsw-alias-bg-layer-1);
}
.dp-week-stats-row{display:flex;gap:22px;flex-wrap:wrap;margin-bottom:12px}
.dp-big{display:flex;flex-direction:column;gap:1px}
.dp-big b{font-size:22px;font-weight:500;line-height:1.1;font-variant-numeric:tabular-nums}
.dp-big span{font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary)}

.dp-week-bar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end}
.dp-week-bar-col{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.dp-week-bar-track{
  width:100%;height:56px;display:flex;align-items:flex-end;
  border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 8%,transparent);
  overflow:hidden;
}
.dp-week-bar-fill{
  width:100%;display:block;min-height:2px;border-radius:5px 5px 0 0;
  background:var(--dp-study,#2563eb);position:relative;overflow:hidden;
}
.dp-week-bar-read{
  position:absolute;inset:0 0 auto 0;background:var(--dp-gym,#22c55e);
}
.dp-week-bar-col em{
  font-style:normal;font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);
}
.dp-week-bar-col[data-today="true"] em{color:var(--dsw-alias-label-primary);font-weight:500}
.dp-learn-legend{display:flex;align-items:center;gap:5px;margin-top:8px;font-size:var(--dp-f-caption)}
.dp-swatch-dot{
  width:9px;height:9px;border-radius:2px;display:inline-block;margin-left:8px;
  background:var(--dp-gym,#22c55e);
}
.dp-swatch-dot[data-kind="read"]{background:var(--dp-study,#2563eb)}

.dp-learn-col{display:flex;flex-direction:column;gap:9px}
.dp-learn-card{
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r);
  padding:11px 13px;display:flex;flex-direction:column;gap:8px;
  background:var(--dsw-alias-bg-layer-1);
  border-left:3px solid var(--dp-accent,var(--dsw-alias-border-l3));
}
.dp-learn-card-head{display:flex;align-items:center;gap:7px;min-width:0}
.dp-learn-title{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-learn-card-head .dp-gym-del{margin-left:auto;flex:0 0 auto}
.dp-learn-card-head .dp-faint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-tag{
  font-size:11px;padding:1px 6px;border-radius:999px;flex:0 0 auto;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);
}
.dp-tag[data-kind="problem"]{background:var(--dp-study-soft,#e6f0ff);color:var(--dp-study-ink,#0e3074)}
.dp-tag[data-kind="course"]{background:var(--dp-intern-soft,#e7eefd);color:var(--dp-intern-ink,#0e3074)}
.dp-tag[data-kind="skill"]{background:var(--dp-activity-soft,#fdf1dc);color:var(--dp-activity-ink,#4a3410)}

.dp-learn-bar{
  height:6px;border-radius:999px;overflow:hidden;
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 12%,transparent);
}
.dp-learn-bar span{display:block;height:100%;border-radius:999px;background:var(--dp-accent,var(--dp-study,#2563eb))}
.dp-learn-goal{display:flex;align-items:center;gap:8px}
.dp-learn-goal-track{
  flex:1 1 auto;height:4px;border-radius:999px;overflow:hidden;
  background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 12%,transparent);
}
.dp-learn-goal-track span{display:block;height:100%;background:var(--dp-accent,var(--dp-study,#2563eb))}
.dp-learn-goal-track span[data-full="true"]{background:var(--dp-gym,#22c55e)}

.dp-learn-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:var(--dp-f-caption)}
.dp-learn-meta b{font-weight:500;font-variant-numeric:tabular-nums}
.dp-learn-meta b.is-good{color:var(--dp-gym-ink,#166534)}
.dp-learn-meta [data-late="true"]{color:var(--dsw-alias-state-danger,#b91c1c)}
.dp-learn-meta svg{vertical-align:-1px;margin-right:2px}
.dp-learn-spacer{flex:1 1 auto}
.dp-learn-stepper{display:inline-flex;align-items:center;gap:3px}
.dp-learn-stepper button{
  width:22px;height:22px;display:grid;place-items:center;border-radius:5px;
  border:1px solid var(--dsw-alias-border-l2);
}
.dp-tiny-input{width:74px;padding:3px 6px;font-size:var(--dp-f-caption);text-align:center}
.dp-tiny-input--w{width:52px}

.dp-learn-form{
  display:flex;flex-direction:column;gap:7px;padding:11px;
  border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dp-r);
}
.dp-learn-form .dp-pool-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dp-learn-form input,.dp-learn-form select{flex:1 1 120px;min-width:0}
.dp-learn-form select{flex:0 0 auto;width:auto}

.dp-learn-done summary{
  cursor:pointer;font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);
  padding:4px 0;
}
.dp-learn-done > *:not(summary){margin-top:7px}

/* ── review ───────────────────────────────────────────────────────────────── */
.dp-prompts{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:9px}
.dp-prompts .dp-chip[data-on="true"]{
  border-style:solid;border-color:var(--dsw-alias-state-business-primary,#2563eb);
  color:var(--dsw-alias-state-business-primary,#2563eb);
}
.dp-review-input{
  display:block;width:100%;min-height:160px;resize:none;overflow:hidden;
  line-height:1.85;font-size:var(--dp-f-sm);border-radius:var(--dp-r-md);padding:12px 14px;
}
.dp-subhead{
  display:flex;align-items:baseline;gap:9px;margin:18px 0 7px;
  font-size:var(--dp-f-xs);color:var(--dsw-alias-label-tertiary);
}
.dp-listedit{display:flex;gap:10px;margin-top:10px}
.dp-listedit-tag{flex:0 0 34px;font-size:var(--dp-f-caption);padding-top:6px}
.dp-listedit-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.dp-listedit-row{display:flex;gap:5px;align-items:center}
.dp-listedit-row input{flex:1 1 auto;font-size:var(--dp-f-sm)}
.dp-listedit-body .dp-addrow{padding:2px;font-size:var(--dp-f-xs)}
.dp-tone-good{color:var(--dp-study)}
.dp-tone-bad{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dp-tone-warn{color:var(--dsw-alias-state-warn-label,#a16207)}
.dp-score-row{
  display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:14px;
  font-size:var(--dp-f-xs);color:var(--dsw-alias-label-secondary);
}
.dp-carry{display:flex;flex-direction:column;gap:6px}
.dp-carry-row{
  display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:var(--dp-f-sm);
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);
  background:var(--dsw-alias-bg-layer-1);
}
.dp-carry-row svg{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}
.dp-carry-title{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-carry-group{display:flex;flex-direction:column;gap:5px}
.dp-carry-group-head{
  display:flex;align-items:center;gap:5px;font-size:var(--dp-f-caption);
  color:var(--dsw-alias-label-tertiary);margin-top:4px;
}
.dp-carry-group-head svg{flex:0 0 auto}
.dp-carry>.dp-btn{align-self:flex-start;margin-top:4px}

/* ── record: GitHub contribution graph ────────────────────────────────────── */
.dp-record-summary{font-size:var(--dp-f-sm);color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.dp-heat-wrap{
  position:relative;margin-top:10px;padding:14px 16px 12px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-md);
  background:var(--dsw-alias-bg-layer-1);
}
.dp-heat-scroll{overflow-x:auto;overflow-y:hidden;padding-bottom:4px}
.dp-heat-inner{display:inline-block;min-width:100%}
.dp-heat-wrap{--dp-heat-size:13px;--dp-heat-gap:3px;--dp-heat-label-w:15px}
.dp-heat-months{
  display:grid;gap:var(--dp-heat-gap);margin-bottom:4px;
  width:max-content;margin-inline:auto;
  font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);
}
.dp-heat-months span{white-space:nowrap;align-self:end}
.dp-heat-body{display:flex;gap:var(--dp-heat-gap);width:max-content;margin-inline:auto}
/* The month view is the same grid with fewer columns, so it is centred rather
   than scrolled — no horizontal scrollbar for a six-column year. */
.dp-heat-plain{display:flex;justify-content:center}
.dp-heat-cell[data-outside="true"]{opacity:.35}
.dp-heat-days{
  display:grid;grid-template-rows:repeat(7,var(--dp-heat-size));gap:var(--dp-heat-gap,3px);
  font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);
  width:var(--dp-heat-label-w,15px);justify-items:end;flex:0 0 var(--dp-heat-label-w,15px);
}
.dp-heat-days span{line-height:var(--dp-heat-size);height:var(--dp-heat-size)}
.dp-heat-grid{
  display:grid;grid-auto-rows:var(--dp-heat-size);gap:var(--dp-heat-gap,3px);
  animation:dp-heat-in 220ms var(--dp-ease);
}
@keyframes dp-heat-in{from{opacity:0}to{opacity:1}}
.dp-heat-cell{
  width:var(--dp-heat-size);height:var(--dp-heat-size);border-radius:3px;padding:0;
  transition:outline-color var(--dp-d-fast) var(--dp-ease);
  outline:1px solid transparent;outline-offset:0;
}
.dp-heat-cell:hover{outline-color:var(--dsw-alias-border-l4)}
.dp-heat-cell[data-today="true"]{outline:1.5px solid var(--dsw-alias-label-primary);outline-offset:1px}
.dp-heat-cell[data-selected="true"]{outline:1.5px solid var(--dsw-alias-state-business-primary,#2563eb);outline-offset:1px}
.dp-heat-cell.is-void{background:transparent;cursor:default}
.dp-heat-swatch{width:11px;height:11px;border-radius:3px;display:inline-block;flex:0 0 11px}
.dp-heat-legend{
  display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:10px;
  font-size:var(--dp-f-caption);color:var(--dsw-alias-label-secondary);
}
.dp-heat-tip{
  position:absolute;transform:translate(-50%,-100%);z-index:4;pointer-events:none;
  background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dp-r-sm);
  padding:5px 9px;font-size:var(--dp-f-caption);white-space:nowrap;box-shadow:var(--dp-shadow-float);
}
.dp-heat-tip:after{
  content:"";position:absolute;left:50%;top:100%;width:0;height:0;margin-left:-4px;
  border:4px solid transparent;border-top-color:var(--dsw-alias-bg-layer-3);
}
.dp-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:var(--dp-f-caption);color:var(--dsw-alias-label-secondary)}
.dp-legend-item{display:flex;align-items:center;gap:5px}

/* ── settings ─────────────────────────────────────────────────────────────── */
.dp-settings{display:grid;gap:12px}
.dp-settings-body{display:flex;flex-direction:column;gap:10px}
.dp-btnrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dp-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.dp-field input,.dp-field select{width:100%}
.dp-field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.dp-check-line{display:flex;align-items:center;gap:6px;font-size:var(--dp-f-xs);color:var(--dsw-alias-label-secondary);cursor:pointer}
.dp-check-line input[type="checkbox"]{width:auto;accent-color:var(--dsw-alias-state-business-primary,#2563eb)}
.dp-table{display:flex;flex-direction:column;gap:4px}
.dp-table-head,.dp-table-row{display:grid;grid-template-columns:minmax(110px,1.6fr) 54px 92px 84px minmax(80px,1fr) 28px;gap:6px;align-items:center}
.dp-table-head{font-size:var(--dp-f-caption);color:var(--dsw-alias-label-tertiary);padding:0 2px}
.dp-table-row input,.dp-table-row select{font-size:var(--dp-f-xs);padding:4px 6px}
.dp-col-act{display:flex;justify-content:center}
.dp-period-cell{display:flex;align-items:center;gap:3px}
.dp-period-cell input{width:100%;min-width:0}
.dp-periods{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:6px}
.dp-period{display:flex;align-items:center;gap:5px;font-size:var(--dp-f-xs);color:var(--dsw-alias-label-secondary)}
.dp-period-index{flex:0 0 30px;color:var(--dsw-alias-label-tertiary)}
.dp-period input{width:66px;font-variant-numeric:tabular-nums}
.dp-import{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dp-r-sm);padding:10px}
.dp-import-input{
  width:100%;min-height:110px;resize:vertical;font-size:var(--dp-f-xs);line-height:1.7;
  font-family:var(--dsw-font-family);white-space:pre;
}
.dp-import-head{display:flex;align-items:center;gap:10px;font-size:var(--dp-f-xs);color:var(--dsw-alias-label-secondary)}
.dp-import-list{display:flex;flex-direction:column;gap:3px;max-height:200px;overflow:auto}
.dp-import-row{display:flex;align-items:center;gap:8px;font-size:var(--dp-f-xs);padding:3px 4px;border-radius:4px}
.dp-import-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dp-import-name{font-weight:500;flex:0 0 auto;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-import-meta{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-import-failed{
  border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b);border-radius:var(--dp-r-sm);
  padding:7px 9px;display:flex;flex-direction:column;gap:3px;
}
.dp-import-failed-head{display:flex;align-items:center;gap:5px;font-size:var(--dp-f-xs);color:var(--dsw-alias-label-primary)}
.dp-import-failed-row{display:flex;gap:8px;font-size:var(--dp-f-caption);align-items:baseline}
.dp-import-failed-row code{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);padding:1px 4px;border-radius:3px}
.dp-import-actions{display:flex;justify-content:flex-end;gap:8px}

@media (max-width:1100px){
  .dp-table-head,.dp-table-row{grid-template-columns:minmax(90px,1.4fr) 50px 84px 70px minmax(60px,1fr) 26px}
}

@media (prefers-reduced-motion:reduce){
  .dp-root *,.dp-root *:before,.dp-root *:after{
    animation:none!important;transition-duration:.01ms!important;scroll-behavior:auto!important;
  }
}
.dp-workflow{display:flex;flex-direction:column;gap:9px;margin-bottom:16px}
.dp-workflow-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.dp-workflow textarea{width:100%;resize:vertical;min-height:64px;line-height:1.6}
.dp-workflow-result{border-top:1px solid var(--dsw-alias-border-primary,#e5e7eb);padding-top:10px;line-height:1.7}
.dp-workflow-focus{font-weight:500}
.dp-workflow-top{font-size:var(--dp-f-sm)}
.dp-workflow-disclosure{margin-bottom:16px}
.dp-workflow-disclosure>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:var(--dp-f-sm);padding:8px 0}
.dp-block[data-adaptive=true]{border-style:dashed}
.dp-gblock[data-adaptive=true]{border-style:dashed}
.dp-life-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dp-life-card{padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fafafa);border-radius:10px;line-height:1.7}
.dp-life-card>b{font-size:var(--dp-f-sm)}
.dp-life-task{font-size:var(--dp-f-sm);overflow-wrap:anywhere}
.dp-feedback-questions{padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fafafa);border-radius:8px;margin-top:8px}
.dp-actual-sets{padding:5px 12px 12px 34px;font-size:var(--dp-f-sm);line-height:1.7}
.dp-actual-sets>summary,.dp-gym-trend>summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#666)}
.dp-set-line,.dp-set-form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0}
.dp-set-form input{width:100px;min-width:0}.dp-set-form input:last-of-type{width:115px}
.dp-gym-trends{margin-bottom:14px;line-height:1.8;overflow:auto}
.dp-gym-trend{border-top:1px solid var(--dsw-alias-border-primary,#ddd);padding:5px 0}
.dp-gym-trend>summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dp-gym-trend>summary>span:first-child{min-width:110px;font-weight:500}
.dp-progress-table{border-collapse:collapse;width:100%;font-size:var(--dp-f-sm);text-align:left;margin:8px 0}
.dp-progress-table th,.dp-progress-table td{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-primary,#ddd);white-space:nowrap}
@media(max-width:650px){.dp-life-grid{grid-template-columns:1fr}.dp-actual-sets{padding-left:12px}.dp-set-form{gap:5px}}
`

export function installStyles(): () => void {
  if (document.getElementById(ID) !== null) return () => undefined
  const style = document.createElement('style')
  style.id = ID
  style.textContent = CSS + VISUAL_CSS
  document.head.append(style)
  return () => {
    style.remove()
  }
}
