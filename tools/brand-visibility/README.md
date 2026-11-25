# Brand Visibility Extension

Review Adobe Brand Visibility (LLMO) opportunities in Experience Workspace (EW),
and find suggestions for the page you are editing.

## Prerequisites

- An authenticated EW session with access to the DA organization and site.
- An LLMO site ID and permission to read that site's opportunities and suggestions.
  The LLMO site ID is separate from the DA organization and repository names.
- An EW host that loads DA App SDK extensions.
- A configured Brand Visibility integration with existing opportunities.

## Setup

### Register the Panel

Add the extension to the `library` sheet of your DA organization or site
configuration, following your host's sidebar extension configuration. For the
repository's main deployment, use this entry after confirming it is published:

| title | path | format | experience | icon | ref |
| --- | --- | --- | --- | --- | --- |
| Brand Visibility | https://main--ew-extensions--adobe-rnd.aem.live/tools/brand-visibility/brand-visibility.html?site-id=YOUR_LLMO_SITE_ID | | | | |

Replace `YOUR_LLMO_SITE_ID` with the site's actual LLMO ID. If using another
deployment, replace the URL origin with that deployment's origin. The entry point
is [brand-visibility.html](brand-visibility.html).

Set the `site-id` parameter in the extension iframe URL. Keep it in the configured
URL so new users and browsers get the same setup.
To switch LLMO sites, change the parameter and reload the panel.

### Authentication

EW supplies the user's IMS access token through the DA App SDK. The extension
exchanges it for a SpaceCat session token at:

```text
POST https://llmo.experiencecloud.live/api/v1/auth/login
```

The session token is cached in the current tab's session storage and reused until
shortly before expiry. The panel then reads opportunities and suggestions from
the LLMO API.

## Using the Panel

1. Open a page in the EW canvas, then open **Brand Visibility**.
2. Wait for the panel to load opportunities and match suggestions to the page.
   When the host supplies a page path, the initial view is scoped to that page.
3. Expand an opportunity by clicking its card or **Show details**. Review the
  suggested content.
4. Make any desired changes in the canvas and review them before publishing
  through your normal workflow.

### Page and Site Views

Use **Show all opportunities** to browse the site's LLMO opportunities and
**Show only this page** to return to the current page. If the host provides no
page path, only the site-wide view is available. Site-wide cards show titles and
descriptions.

The page view shows suggestions for the current page.
Reload the panel after navigating if it still shows the previous page's path.

Search matches titles, descriptions, types, and tags. Open **Filters** to filter
by opportunity status or sort by **Most recent**, **A-Z**, or **Type**. Use
**Load more** when more than 50 results match.

### Reviewing Suggestions

- **Table of contents:** displays the proposed TOC entries.
- **Summarization:** displays the proposed summary or key points.
- **Prerender:** displays the available summary and impact metrics.
- **Other types:** displays the suggestion's data fields.

Use these details to inform your edits.

Fixed suggestions remain visible as history. Reload the panel to see updated
statuses.

## Local Development

Serve this repository with the AEM CLI from the repository root:

```bash
aem up --port 3001
```

Open the following URL, substituting your LLMO site ID and a URL-encoded,
short-lived IMS access token:

```text
http://localhost:3001/tools/brand-visibility/brand-visibility.html?site-id=YOUR_LLMO_SITE_ID&page-path=%2Fexample&token=YOUR_IMS_ACCESS_TOKEN
```

Standalone mode bypasses the SDK wait. Test authentication and automatic canvas
page-path detection inside EW before deployment.

| Parameter | Purpose |
| --- | --- |
| `site-id` | LLMO site ID; cached in browser local storage. |
| `page-path` | Override the page path, for example `/example`. |
| `llmo-api` | Override the API base, including `/api/v1` if required by that server. Defaults to `https://llmo.experiencecloud.live/api/v1`. |
| `token` | Override the IMS access token for development; not a SpaceCat session token. |

Use `token` only for local testing. URL tokens can leak through browser history,
logs, screenshots, and shared links. Never put one in library configuration,
source control, or support reports. Only use a trusted `llmo-api` endpoint: the
extension sends the IMS token to that endpoint's `/auth/login` route. A different
API origin must allow requests from the extension origin through CORS.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Sign-in message | Open the panel inside an authenticated EW session; standalone testing requires the development token override. |
| No LLMO site ID configured | Add `site-id` to the extension iframe URL and reload. |
| Session exchange failure or HTTP 401/403 | Check the IMS session, LLMO access permissions, API endpoint, and site ID. Sign in again or reopen the panel, then use **Retry**. |
| No brand visibility opportunities | Verify the site ID and check that opportunities are available for the site in Brand Visibility. |
| No suggestions for this page | Check the displayed page path and try **Show all opportunities**. If suggestions are expected, check for failed requests and reload the panel. |

For setup and support, share the extension URL with credentials removed, the
displayed page path, and the HTTP status of the failed request. Do not share
tokens or authorization headers.