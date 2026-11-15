# Site Isolation

[Site isolation](https://www.chromium.org/Home/chromium-security/site-isolation/) is a browser security feature that mitigates [Spectre](https://spectreattack.com/) and other side-channel attacks, as well as attacks from a compromised renderer, by running documents from different [sites](https://html.spec.whatwg.org/multipage/browsers.html#sites) in different processes.

Browsers consider two documents to be from the same site if their origins' hostnames have the same [registrable domain](https://developer.mozilla.org/en-US/docs/Glossary/Registrable_domain), defined as the first subdomain of their effective top-level domain (example.com and example.co.uk, e.g.). So, foo.example.com and bar.example.com have different origins but the same site. Browsers use the [Public Suffix List](https://publicsuffix.org/) to determine an origin's eTLD. A domain owner can add a subdomain to this list to make it an eTLD. If foo.example.com appears in the public suffix list, for example, then it is a different site than bar.example.com.

Chromium and Firefox enable site isolation by default. WebKit support is in progress and disabled by default, but can be enabled by the user in Safari's Technology Preview. Browser implementations of site isolation differ.

## Browser Support

### Chromium

Service workers run in the page's process, so the page and any other script in its process (other service workers, e.g.) can read any secrets the worker contains with a side-channel attack. Sandboxed frames in the page run in a process separate from the page, but that process is shared with other sandboxed frames from the page's site, so an attacker-controlled sandboxed frame (`<iframe sandbox="allow-scripts" srcdoc="<attack>"></iframe>`, e.g.) can read secrets from any other sandboxed frames from the page's site.

Not all Chromium-based browsers support site isolation (Android Webviews do not, e.g.). There are two ways to site isolate a frame in Chromium.

#### Document-Isolation-Policy

If possible, Chromium runs documents served with [`Document-Isolation-Policy`](https://github.com/WICG/document-isolation-policy) in a process shared only with same-origin documents also served with the header. If successful, the [`crossOriginIsolated`](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated) property of the document's window object will be true.

#### Opaque Blob Origins

Chromium runs documents created from null-origin Blob URLs of the form `blob:null/<uuid>` (i.e., one created by a sandboxed frame) in a process shared only with other documents created from other null-origin blob URLs with the same UUID. However, it does not set `crossOriginIsolated`, so there is no reliable way to determine if the blob frame is in fact site-isolated.

### Firefox

Service workers run in a separate process for each site (see Firefox's [process model](https://firefox-source-docs.mozilla.org/dom/ipc/process_model.html) documentation), so the page can't read the key, but an attacker-controlled service worker can. However, Firefox assigns documents with opaque origins to the site of the document that created them (see [`dom/ipc/ProcessIsolation.cpp`](https://github.com/mozilla-firefox/firefox/blob/ac7b5e4bc10b65142541a54b0ef23462647f7da1/dom/ipc/ProcessIsolation.cpp) in the Firefox source), so sandboxed frames are vulnerable to side channel attacks.

### WebKit

Site isolation is under active development and disabled by default ([`UnifiedWebPreferences.yaml`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L5962-L5970)). When site isolation is enabled, all frames from a page's site, including sandboxed frames, run in a shared process ([`WebProcessPool.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/WebProcessPool.cpp#L2526-L2530)), as does the service worker ([`WebProcessPool.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/WebProcessPool.cpp#L755-L759)). Frames from all other sites share a single process ([`BrowsingContextGroup.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/BrowsingContextGroup.cpp#L65-L127)).
