import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { getSpacecatSessionToken } from './session-auth.js';

// LLMO API origin. Defaults to prod; override for local dev with
// ?llmo-api=http://localhost:3001
const DEFAULT_API_BASE_URL = 'https://llmo.experiencecloud.live/api/v1';

const STATUS_FILTERS = ['all', 'new', 'in_progress', 'resolved', 'ignored'];
const SORTS = ['recent', 'title', 'type'];
const SORT_LABELS = { recent: 'Most recent', title: 'A–Z', type: 'Type' };
const PAGE_SIZE = 50;
const SUGGESTIONS_CONCURRENCY = 6;

// `suggestion.data` shapes vary by opportunity type (verified against live SpaceCat
// data), but the URL a suggestion targets is always one of these keys — "url" for
// almost every LLMO-relevant type, "pageUrl" as a fallback (used by "readability").
const SUGGESTION_URL_KEYS = ['url', 'pageUrl', 'page_url', 'recommendedUrl', 'targetUrl', 'suggestedUrl', 'urlTo', 'urlFrom', 'path'];

function extractSuggestionUrl(data) {
  if (!data || typeof data !== 'object') return null;
  for (const key of SUGGESTION_URL_KEYS) {
    if (typeof data[key] === 'string' && data[key]) return data[key];
  }
  return null;
}

// Normalize a suggestion's URL (absolute, relative, with/without a trailing
// ".html") and a DA document path (from da.live's canvas hash, extensionless)
// down to the same comparable form so the two can be matched directly.
function toPagePath(rawUrl) {
  if (!rawUrl) return null;
  let value = rawUrl;
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch {
    /* not a valid absolute URL — treat as a relative path below */
  }
  if (!value.startsWith('/')) value = `/${value}`;
  try {
    value = decodeURIComponent(value);
  } catch {
    /* malformed escape sequence — compare as-is */
  }
  if (value.endsWith('.html')) value = value.slice(0, -'.html'.length);
  value = value.replace(/\/$/, '');
  return value || '/';
}

async function withConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop -- Sequential work within each worker enforces the concurrency limit.
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Down chevron for the expand/collapse affordance (rotates 180° when open).
const chevronIcon = () => html`
  <svg class="bv-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
`;

// Human-readable labels for opportunity statuses; the API is authoritative,
// this is purely a display concern.
const STATUS_LABELS = {
  NEW: 'New',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  IGNORED: 'Ignored',
  FIXED: 'Fixed',
};
const statusLabel = (s) => STATUS_LABELS[s] || s;
const statusKey = (s) => String(s || '').toLowerCase();

// Opportunity `type` values are audit/handler slugs (e.g. "llm-error-pages-404");
// title-case them for display when no friendlier label is known.
const typeLabel = (t) => String(t).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Renders "**bold**" markdown spans as <strong> (suggestion text from SpaceCat
// uses this convention rather than full markdown).
function renderBold(text) {
  const parts = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(html`<strong>${match[1]}</strong>`);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Some `aiSummary` values pack multiple sections into one string using
// "<br>" line breaks and "&nbsp;" indentation on top of "**bold**" markdown —
// split/decode those before handing off to renderBold, or they show up as
// literal, unreadable "<br>"/"&nbsp;" text.
function renderRichText(text) {
  if (!text) return nothing;
  return text.split(/<br\s*\/?>/i).map((line, i) => {
    const decoded = line.replace(/&nbsp;/g, ' ');
    return html`${i > 0 ? html`<br />` : nothing}${renderBold(decoded)}`;
  });
}

// "toc" suggestions carry their proposed markup as a hast-like AST under
// transformRules.value; walk it to pull out the anchor labels (the actual TOC
// entries), which is far more useful to a reader than the raw tree.
function extractTocLabels(transformRules) {
  const root = transformRules?.value;
  if (!root) return [];
  const labels = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'element' && node.tagName === 'a') {
      const text = (node.children ?? []).filter((c) => c.type === 'text').map((c) => c.value).join('');
      if (text) labels.push(text);
      return;
    }
    (node.children ?? []).forEach(walk);
  };
  walk(root);
  return labels;
}

// "summarization" suggestions don't carry a separate key-points array — `keyPoints`
// is a boolean flag, and when true, `summarizationText` itself is formatted as a
// markdown bullet list rather than prose. Pull those bullets out for display.
function extractBulletPoints(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[*-]\s+/.test(line))
    .map((line) => line.replace(/^[*-]\s+/, ''));
}

// Per-opportunity-type suggestion renderers — `suggestion.data` has a different
// shape for each SpaceCat opportunity type (verified against live data), so a
// generic key/value dump reads poorly for the ones a user actually needs to act on.
function renderPrerenderSuggestion(data) {
  const gainPct = typeof data.contentGainRatio === 'number' ? Math.round((data.contentGainRatio - 1) * 100) : null;
  return html`
    <div class="opp-suggestion opp-suggestion--prerender">
      ${data.aiSummary ? html`<p class="opp-suggestion-summary">${renderRichText(data.aiSummary)}</p>` : nothing}
      <div class="opp-stat-row">
        ${data.valuable != null
          ? html`<span class="bv-pill bv-pill-status-${data.valuable ? 'resolved' : 'ignored'}">
              ${data.valuable ? 'High impact' : 'Low impact'}
            </span>`
          : nothing}
        ${typeof data.citabilityScore === 'number'
          ? html`<span class="opp-stat">Citability score: <strong>${data.citabilityScore}</strong>/100</span>`
          : nothing}
      </div>
      ${data.wordCountBefore != null && data.wordCountAfter != null
        ? html`<p class="opp-stat">
            Word count: ${data.wordCountBefore.toLocaleString()} → ${data.wordCountAfter.toLocaleString()}
            ${gainPct != null ? html`(${gainPct >= 0 ? '+' : ''}${gainPct}%)` : nothing}
          </p>`
        : nothing}
      ${typeof data.organicTraffic === 'number'
        ? html`<p class="opp-stat">Organic traffic: ${data.organicTraffic.toLocaleString()}</p>`
        : nothing}
    </div>
  `;
}

function renderTocSuggestion(data) {
  const labels = extractTocLabels(data.transformRules);
  return html`
    <div class="opp-suggestion opp-suggestion--toc">
      ${labels.length
        ? html`<ol class="opp-toc-list">
            ${labels.map((l) => html`<li>${l}</li>`)}
          </ol>`
        : nothing}
    </div>
  `;
}

function renderSummarizationSuggestion(data) {
  const summaryText = data.summarizationText || data.aiGeneratedSummarizationText;
  const bullets = data.keyPoints === true ? extractBulletPoints(summaryText) : [];
  let content = nothing;
  if (bullets.length) {
    content = html`<p class="opp-suggestion-summary"><strong>Key points:</strong></p>
      <ul class="opp-evidence-list">
        ${bullets.map((b) => html`<li>${renderBold(b)}</li>`)}
      </ul>`;
  } else if (summaryText) {
    content = html`<p class="opp-suggestion-summary"><strong>Summary:</strong> ${renderRichText(summaryText)}</p>`;
  }
  return html`
    <div class="opp-suggestion opp-suggestion--summarization">
      ${content}
    </div>
  `;
}

// One-time intro line shown above a type's suggestion list (not repeated per
// suggestion, since an opportunity can have several matching suggestions).
const SUGGESTION_INTROS = {
  summarization: 'Add the below summary suggestions to the page.',
  toc: 'Add the Table of Contents below to the page',
};

const SUGGESTION_RENDERERS = {
  prerender: renderPrerenderSuggestion,
  toc: renderTocSuggestion,
  summarization: renderSummarizationSuggestion,
};

// Falls back to a plain key/value dump for opportunity types without a dedicated
// renderer (e.g. llm-error-pages-*, readability, generic-autofix-edge).
function renderSuggestionData(type, data) {
  const renderer = SUGGESTION_RENDERERS[type];
  if (renderer) return renderer(data ?? {});
  return html`
    <div class="opp-data-list">
      ${Object.entries(data ?? {}).map(
        ([k, v]) => html`<div><span class="opp-data-key">${k}:</span> <span>${typeof v === 'string' ? v : JSON.stringify(v)}</span></div>`,
      )}
    </div>
  `;
}

// Normalize an API opportunity into the shape the UI renders. `isElmo` flags the
// opportunities SpaceCat tags as LLMO-relevant (brand visibility in AI answers,
// LLM crawl errors, etc.) — surfaced as a badge, not used to filter (see below).
function normalize(o) {
  const tags = Array.isArray(o.tags) ? o.tags : [];
  return {
    id: o.id,
    type: o.type ?? '',
    title: o.title || typeLabel(o.type ?? 'Opportunity'),
    description: o.description ?? '',
    status: o.status ?? 'NEW',
    tags: tags.filter((t) => t.toLowerCase() !== 'iselmo'),
    isElmo: tags.some((t) => t.toLowerCase() === 'iselmo'),
    guidanceSteps: Array.isArray(o.guidance?.steps) ? o.guidance.steps : [],
    data: o.data && typeof o.data === 'object' ? o.data : {},
    createdAt: o.createdAt ?? null,
    updatedAt: o.updatedAt ?? null,
  };
}

class BrandVisibilityApp extends LitElement {
  static properties = {
    _token: { state: true },
    _siteId: { state: true },
    _opportunities: { state: true },
    _visibleCount: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _status: { state: true },
    _sort: { state: true },
    _q: { state: true },
    _showFilters: { state: true },
    _expanded: { state: true },
    _pagePath: { state: true },
    _scope: { state: true },
    _matchingSuggestions: { state: true },
    _matchingDone: { state: true },
  };

  constructor() {
    super();
    this._token = null;
    this._siteId = null;
    this._opportunities = [];
    this._visibleCount = PAGE_SIZE;
    this._loading = false;
    this._error = null;
    this._status = 'all';
    this._sort = 'recent';
    this._q = '';
    this._showFilters = false;
    this._expanded = new Set();
    this._pagePath = null; // the currently-open DA document's path (e.g. "/blog/my-post"), if known
    this._scope = 'all'; // 'page' (only opportunities with a NEW suggestion for _pagePath) | 'all' — set from _pagePath in _init()
    this._matchingSuggestions = {}; // { [oppId]: { id, data }[] } — NEW suggestions matching _pagePath, once loaded
    this._matchingDone = false; // flips true once the suggestion-matching pass finishes (even if nothing matched)
    // Non-reactive
    this._apiBase = DEFAULT_API_BASE_URL;
    this._accessToken = null; // IMS token used only to obtain a short-lived SpaceCat session token
    this._org = null; // DA project org (slug), used for site-id storage key
    this._site = null; // DA project repo (slug), used for site-id storage key
    this._suggestionsStarted = false;
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    const params = new URLSearchParams(window.location.search);
    const apiOverride = params.get('llmo-api');
    if (apiOverride) this._apiBase = apiOverride.replace(/\/$/, '');

    // Dev-only escape hatch: outside the EW iframe (e.g. running this tool's html
    // directly against a local static server, per the repo README's "isolated
    // extension development" flow) DA_SDK never resolves, since it's just waiting
    // on a postMessage from a host that isn't there. Letting a token/site-id be
    // passed via the URL makes the tool testable standalone without da-live/da-nx.
    const tokenOverride = params.get('token');
    const siteIdOverride = params.get('site-id');
    const pagePathOverride = params.get('page-path');
    // ?token= is only meant to bypass DA_SDK when it's unreachable (running this
    // tool's html standalone against a local static server, outside any EW
    // iframe) — DA_SDK never resolves there since it's just waiting on a
    // postMessage from a host that isn't there. Inside a real EW iframe, DA_SDK
    // *does* resolve, so it still needs to run (for org/site/pagePath)
    // even if ?token= is also set to swap in a different token.
    const inIframe = window.self !== window.top;
    if (inIframe) {
      try {
        const sdk = await DA_SDK;
        this._accessToken = tokenOverride || sdk.token;
        this._org = sdk.project?.org;
        this._site = sdk.project?.repo;
        // The exact field the host uses for the open document's path isn't
        // documented (this repo's other tools only ever read org/repo) — try the
        // plausible candidates and log the raw payload so it can be confirmed
        // against devtools when running for real inside EW.
        this._pagePath = toPagePath(
          sdk.project?.path ?? sdk.project?.pathname ?? sdk.context?.path ?? sdk.path ?? null,
        );
        // eslint-disable-next-line no-console
        console.debug('[brand-visibility] DA_SDK payload', sdk, '-> detected page path:', this._pagePath);
      } catch {
        if (tokenOverride) this._accessToken = tokenOverride;
      }
    } else if (tokenOverride) {
      this._accessToken = tokenOverride;
    }
    if (pagePathOverride) this._pagePath = toPagePath(pagePathOverride);

    // When a page path is known, scope to it from the start — otherwise the
    // full site-wide list would flash while suggestions are still being matched
    // against the open page. _visibleOpportunities() already filters page-scope
    // rows to matched suggestions, which are empty until matching completes, so
    // this naturally renders an empty (not "all") list during that window.
    this._scope = this._pagePath ? 'page' : 'all';

    // The site ID is configured purely via the ?site-id= URL param — once seen,
    // it's cached so reloads don't need the param repeated, but there's no in-app
    // UI for it: change it by editing the URL.
    if (siteIdOverride) this._saveSiteId(siteIdOverride);
    this._siteId = siteIdOverride || this._loadSiteId();

    if (this._accessToken && this._siteId) this._fetchOpportunities();
  }

  _siteIdStorageKey() {
    return `bv-site-id:${this._org || ''}/${this._site || ''}`;
  }

  _loadSiteId() {
    try {
      return localStorage.getItem(this._siteIdStorageKey()) || null;
    } catch {
      return null;
    }
  }

  _saveSiteId(siteId) {
    try {
      localStorage.setItem(this._siteIdStorageKey(), siteId);
    } catch {
      /* ignore */
    }
  }

  async _fetchOpportunities() {
    if (!this._accessToken || !this._siteId) return;
    this._loading = true;
    this._error = null;
    try {
      this._token = await getSpacecatSessionToken(this._apiBase, this._accessToken);
      const resp = await fetch(`${this._apiBase}/sites/${this._siteId}/opportunities`, {
        headers: { Authorization: `Bearer ${this._token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      // Brand visibility == the LLMO-tagged subset of a site's opportunities
      // (LLM crawl errors, prerender/summarization/readability, generic-opportunity
      // reports tagged "isElmo") — everything else is out of scope for this tool.
      this._opportunities = (Array.isArray(data) ? data : []).map(normalize).filter((o) => o.isElmo);
      this._visibleCount = PAGE_SIZE;
      this._checkFetchSuggestions();
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  // Opportunities are generic (site-wide); a suggestion's URL is the only
  // thing that ties an opportunity to a specific page. Only worth the extra API
  // calls when we actually know which page is open (see _pagePath in _init()).
  _checkFetchSuggestions() {
    if (!this._pagePath || this._opportunities.length === 0 || this._suggestionsStarted) return;
    this._suggestionsStarted = true;
    withConcurrency(this._opportunities, SUGGESTIONS_CONCURRENCY, (o) => this._fetchOpportunitySuggestions(o.id))
      .then(() => {
        this._matchingDone = true;
      });
  }

  async _fetchOpportunitySuggestions(oppId) {
    try {
      // Fetch all suggestions (not just NEW) so already-FIXED ones still show —
      // as read-only history rather than disappearing once acted on.
      const resp = await fetch(
        `${this._apiBase}/sites/${this._siteId}/opportunities/${oppId}/suggestions`,
        { headers: { Authorization: `Bearer ${this._token}` } },
      );
      if (!resp.ok) return;
      const data = await resp.json();
      const matches = (Array.isArray(data) ? data : [])
        .filter((s) => (s.status === 'NEW' || s.status === 'FIXED') && toPagePath(extractSuggestionUrl(s.data)) === this._pagePath)
        .map((s) => ({ id: s.id, data: s.data ?? {}, status: s.status }));
      if (matches.length) this._matchingSuggestions = { ...this._matchingSuggestions, [oppId]: matches };
    } catch {
      /* leave unmatched — a single opportunity's suggestions failing shouldn't break the page-scope view */
    }
  }

  _renderWithLinks(text) {
    const parts = [];
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let last = 0;
    for (const match of text.matchAll(re)) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(html`<a href=${match[2]} target="_blank" rel="noopener noreferrer">${match[1]}</a>`);
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  _toggleExpanded(oppId) {
    const next = new Set(this._expanded);
    if (next.has(oppId)) next.delete(oppId);
    else next.add(oppId);
    this._expanded = next;
  }

  _pill(text, kind) {
    return html`<span class="bv-pill bv-pill-${kind.replaceAll('_', '-')}">${text}</span>`;
  }

  _visibleOpportunities() {
    const q = this._q.trim().toLowerCase();
    let rows = this._opportunities
      .filter((o) => this._scope === 'all' || (this._matchingSuggestions[o.id]?.length ?? 0) > 0)
      .filter((o) => this._status === 'all' || statusKey(o.status) === this._status)
      .filter((o) => !q || `${o.title} ${o.description} ${o.type} ${o.tags.join(' ')}`.toLowerCase().includes(q));
    if (this._sort === 'recent') {
      rows = rows.sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
    } else if (this._sort === 'type') rows = rows.sort((a, b) => a.type.localeCompare(b.type));
    else rows = rows.sort((a, b) => a.title.localeCompare(b.title));
    return rows;
  }

  _renderPageScopeBanner() {
    if (!this._pagePath) return nothing;
    const loading = this._suggestionsStarted && !this._matchingDone;
    let message = 'Showing opportunities for the whole site';
    if (loading) {
      message = 'Matching opportunities against this page…';
    } else if (this._scope === 'page') {
      message = html`Showing opportunities for <strong>${this._pagePath}</strong>`;
    }
    return html`
      <div class="bv-scope-banner">
        <span>
          ${message}
        </span>
        ${!loading
          ? html`<button
              type="button"
              class="bv-scope-toggle"
              @click=${() => {
                this._scope = this._scope === 'page' ? 'all' : 'page';
                this._visibleCount = PAGE_SIZE;
              }}
            >
              ${this._scope === 'page' ? 'Show all opportunities' : 'Show only this page'}
            </button>`
          : nothing}
      </div>
    `;
  }

  _renderToolbar() {
    const activeFilters = (this._status !== 'all' ? 1 : 0) + (this._q ? 1 : 0);
    return html`
      <div class="bv-toolbar">
        <div class="bv-search">
          <input
            type="search"
            placeholder="Search opportunities"
            .value=${this._q}
            @input=${(e) => {
              this._q = e.target.value;
            }}
          />
        </div>
        <button
          class="bv-filter-toggle ${this._showFilters ? 'is-open' : ''}"
          aria-label="Show filters and sorting"
          @click=${() => {
            this._showFilters = !this._showFilters;
          }}
        >
          Filters${activeFilters ? html` <span class="bv-filter-count">${activeFilters}</span>` : nothing}
        </button>
      </div>
      ${this._showFilters
        ? html`
            <div class="bv-controls">
              <div class="bv-control-row">
                <span class="bv-control-label">Status</span>
                ${STATUS_FILTERS.map(
                  (s) => html`<button
                    class="bv-chip ${this._status === s ? 'is-active' : ''}"
                    @click=${() => {
                      this._status = s;
                    }}
                  >
                    ${s === 'all' ? 'All' : statusLabel(s.toUpperCase())}
                  </button>`,
                )}
              </div>
              <div class="bv-control-row">
                <span class="bv-control-label">Sort</span>
                ${SORTS.map(
                  (s) => html`<button
                    class="bv-chip ${this._sort === s ? 'is-active' : ''}"
                    @click=${() => {
                      this._sort = s;
                    }}
                  >
                    ${SORT_LABELS[s]}
                  </button>`,
                )}
              </div>
            </div>
          `
        : nothing}
    `;
  }

  _renderCard(o) {
    const open = this._expanded.has(o.id);
    // In page scope, each card is about a specific suggestion targeting the open
    // page — show that suggestion's own data (shape varies per opportunity type)
    // instead of the generic, site-wide opportunity description.
    const suggestions = this._scope === 'page' ? (this._matchingSuggestions[o.id] ?? []) : [];
    const showSuggestions = suggestions.length > 0;
    // The opportunity's own status field doesn't always get flipped to RESOLVED
    // once every one of its suggestions for this page is FIXED — show it as
    // resolved locally rather than the stale "New" from the API.
    const allFixed = showSuggestions && suggestions.every((s) => s.status === 'FIXED');
    const displayStatus = allFixed ? 'FIXED' : o.status;
    // The all-opportunities view is a generic, site-wide list — there's no
    // suggestion/page context to drill into, so it's just title + description,
    // no expand affordance.
    const canExpand = this._scope === 'page';
    return html`
      <div class="card opportunity-item ${open && canExpand ? 'is-open' : ''}">
        <div
          class="opp-clickable ${canExpand ? '' : 'opp-clickable-static'}"
          @click=${canExpand ? () => this._toggleExpanded(o.id) : nothing}
        >
          <div class="opp-meta">
            ${this._pill(statusLabel(displayStatus), `status-${statusKey(displayStatus)}`)}
          </div>
          <p class="opp-title">${o.title}</p>
          ${o.tags.length
            ? html`<div class="opp-tags">
                ${o.tags.map((t) => html`<span class="bv-tag-chip">${t}</span>`)}
              </div>`
            : nothing}
          ${o.description ? html`<p class="opp-description">${this._renderWithLinks(o.description)}</p>` : nothing}
        </div>
        ${canExpand && open
          ? html`
              <div class="opp-detail">
                ${showSuggestions
                  ? html`
                      ${SUGGESTION_INTROS[o.type] ? html`<p class="opp-suggestion-summary">${SUGGESTION_INTROS[o.type]}</p>` : nothing}
                      ${suggestions.map((s) => html`
                        <div class="opp-suggestion-wrap ${s.status === 'FIXED' ? 'opp-suggestion-wrap-fixed' : ''}">
                          ${s.status === 'FIXED' ? html`<span class="bv-pill bv-pill-status-fixed">Fixed</span>` : nothing}
                          ${renderSuggestionData(o.type, s.data)}
                        </div>
                      `)}
                    `
                  : html`
                      <div><p class="opp-detail-label">Type</p><p>${typeLabel(o.type)}</p></div>
                      ${o.guidanceSteps.length
                        ? html`<div><p class="opp-detail-label">Recommended steps</p>
                            <ol>${o.guidanceSteps.map((s) => html`<li>${s}</li>`)}</ol>
                          </div>`
                        : nothing}
                      ${Object.keys(o.data).length
                        ? html`<div><p class="opp-detail-label">Details</p>
                            <div class="opp-data-list">
                              ${Object.entries(o.data).map(
                                ([k, v]) => html`<div><span class="opp-data-key">${k}:</span> <span>${JSON.stringify(v)}</span></div>`,
                              )}
                            </div>
                          </div>`
                        : nothing}
                    `}
              </div>
            `
          : nothing}
        ${canExpand
          ? html`<button
              type="button"
              class="opp-expand-toggle"
              aria-expanded=${open}
              aria-label=${open ? 'Show less' : 'Show details'}
              @click=${() => this._toggleExpanded(o.id)}
            >
              ${chevronIcon()}
            </button>`
          : nothing}
      </div>
    `;
  }

  _renderContent() {
    if (!this._accessToken) {
      return html`<div class="card"><p>Sign in to Experience Workspace to see your brand visibility opportunities.</p></div>`;
    }
    if (!this._siteId) {
      return html`<div class="card">
        <p>No LLMO site ID configured. Add <code>?site-id=&lt;your-site-id&gt;</code> to this page's URL.</p>
      </div>`;
    }
    if (this._loading) {
      return html`<div class="card">
        <sl-skeleton effect="pulse" style="height:56px;margin-bottom:12px;"></sl-skeleton>
        <sl-skeleton effect="pulse" style="height:56px;margin-bottom:12px;"></sl-skeleton>
        <sl-skeleton effect="pulse" style="height:56px;"></sl-skeleton>
      </div>`;
    }
    if (this._error) {
      return html`<div class="card error">
        <p>Couldn't load opportunities: ${this._error}</p>
        <sl-button class="ew-fill-accent" @click=${() => this._fetchOpportunities()}>Retry</sl-button>
      </div>`;
    }
    if (!this._token) {
      return html`<div class="card"><p>Unable to connect to Adobe Brand Visibility.</p></div>`;
    }
    if (this._opportunities.length === 0) {
      return html`<div class="card"><p>No brand visibility (LLMO) opportunities for this site yet.</p></div>`;
    }
    const rows = this._visibleOpportunities();
    const shown = rows.slice(0, this._visibleCount);
    const moreToLoad = rows.length > shown.length;
    return html`
      ${this._renderPageScopeBanner()}
      ${this._renderToolbar()}
      <p class="bv-count">${shown.length} of ${rows.length}</p>
      ${shown.length
        ? shown.map((o) => this._renderCard(o))
        : html`<div class="card">
            <p>
              ${this._scope === 'page'
                ? html`No brand-visibility opportunities have a suggestion for this page (${this._pagePath}).`
                : 'No matching opportunities.'}
            </p>
          </div>`}
      ${moreToLoad
        ? html`<button
            class="bv-load-more"
            @click=${() => {
              this._visibleCount += PAGE_SIZE;
            }}
          >
            Load more (${rows.length - shown.length} more)
          </button>`
        : nothing}
    `;
  }

  render() {
    return html`${this._renderContent()}`;
  }
}

customElements.define('brand-visibility-app', BrandVisibilityApp);
