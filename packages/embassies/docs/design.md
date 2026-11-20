# Design

This package implements the client execution interface of [Embassies](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final85.pdf) (NSDI '13) with features browsers ship today. Each app runs in its own process with an opaque origin, can't touch the network, and reaches other apps, servers and the screen only through a kernel page.

It runs in Chromium only, because it relies on [Document-Isolation-Policy](https://github.com/WICG/document-isolation-policy) for process isolation.

## Terms

- **CEI (client execution interface):** the interface the client gives an app to run on. In Embassies it has 30 calls ([Figure 2](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final85.pdf#page=4)).
- **DPI (developer programming interface):** the interface a developer writes to, like HTML or Qt. In Embassies each app brings its own, above the CEI ([HotNets '11](https://www.microsoft.com/en-us/research/wp-content/uploads/2011/11/hotnets-submitted.pdf)).
- **Kernel:** the top-level page, `kernel/kernel.js`. It implements the CEI calls the web platform lacks.
- **Container:** a frame the kernel creates for each app. The app runs in a dedicated worker inside it.
- **Principal:** an app's identity, the hex SHA-256 of its vendor's Ed25519 public key.
- **Deed:** a secret, single-use capability for a viewport, which one app gives another.

## How an app runs

1. Some app, or the kernel for the first one, fetches a vendor's key, boot block and signature from `https://<label>/.well-known/embassies/`, and calls `ensureAlive`.
2. The kernel checks the signature with WebCrypto, and, if no app with that key runs, adds a container frame.
3. The container's document sends the kernel `ready`. The kernel replies with the boot block and a `MessagePort`.
4. The container starts the boot block in a dedicated worker from a `blob:` URL and hands it the port. Every CEI call is a message on that port.

Each container is served with three policies:

| Policy | Effect |
| --- | --- |
| `Content-Security-Policy: sandbox allow-scripts` | An [opaque origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin): no storage, cookies or same-origin access to the kernel. |
| `Document-Isolation-Policy: isolate-and-credentialless` | Its own process, and `crossOriginIsolated`, so `SharedArrayBuffer` works. Its workers run in the same process. |
| `Content-Security-Policy: default-src 'none'; script-src 'nonce-…' blob: 'wasm-unsafe-eval'; worker-src blob:` | No network. Workers made from `blob:` URLs inherit it. |

The sandbox alone doesn't stop network access. A sandboxed worker can still `fetch` servers that allow any origin, open WebSockets, `importScripts` from anywhere, and send `SameSite=None` cookies. The CSP closes all of those, so the kernel is the only way out.

CSP can't block WebRTC. `RTCPeerConnection` doesn't exist in workers, so only the container document could use it, and it runs nothing but the kernel's bootstrap.

## The CEI, call by call

Calls marked **platform** need no kernel: the container already has them. The rest are messages to the kernel, wrapped by `apps/lib/cei.js`.

| Embassies call | Here |
| --- | --- |
| allocate memory, free memory | **platform:** `WebAssembly.Memory`, `ArrayBuffer` |
| process exit | `exit()`: removes the container and empties its viewports |
| thread create, thread exit | **platform:** `new Worker(blobUrl)`, `close()` |
| futex wait, futex wake | **platform:** `Atomics.wait`, `Atomics.notify` on shared memory |
| get events | **platform:** the worker's message events |
| get time, set clock alarm | **platform:** `Date.now`, `performance.now`, `setTimeout` |
| get ifconfig | `ifconfig()`: address, principal, prefix, broadcast and kernel addresses |
| alloc net buffer, free net buffer | **platform:** `ArrayBuffer` |
| send net buffer | `send(dst, payload)`: the payload is transferred, not copied |
| receive net buffer | `packet` events: `{ src, dst, payload }` |
| get random | **platform:** `crypto.getRandomValues` |
| get app secret | `appSecret()`: HMAC-SHA256 of the principal under a kernel key |
| accept viewport | `acceptViewport(deed)`: needs a verified label |
| map canvas | `mapCanvas(viewport)`: a fresh canvas, and its size in pixels |
| update canvas | `updateCanvas(viewport, bitmap)`: blits a transferred `ImageBitmap` |
| receive ui event | `ui` events: pointer events under the pointer, key events when focused |
| verify label | `verifyLabel(label)` |
| transfer viewport | `transferViewport(viewport)`: returns a deed |
| sublet viewport | `subletViewport(viewport, rect)`: returns a sublet handle and a deed |
| modify viewport | `modifyViewport(sublet, rect)` |
| repossess viewport | `repossessViewport(sublet)`: returns a fresh deed |
| tenant changed | `tenantChanged(sublet)`: the tenant's generation and key |
| ensure alive | `ensureAlive(boot, signature, publicKey)`: returns the principal |
| endorse me | `endorseMe(key)` |
| verify endorsement | `verifyEndorsement(key, principal, endorsement)` |

The kernel also has `fetch`, which Embassies doesn't. See below.

## Where it departs from Embassies

### Network: kernel fetch instead of raw IP

A browser can't give an app raw IP, so the kernel offers two things in its place:

- **Local packets.** The kernel routes `{ src, dst, payload }` packets between apps. Each app gets an address in `fd65:6d62::/64`, and `ff02::1` broadcasts. The kernel sets `src` itself, so an app can't forge it, and delivers a unicast packet only to its destination.
- **`fetch` for the internet.** The kernel calls `fetch` with `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `mode: "cors"` and `cache: "no-store"`. At most 32 run at once per app.

`fetch` keeps the property Embassies' "coffee-shop networking" protects: the CEI never adds ambient authority. No cookies, HTTP auth or client certificates go with a request. It also gives up some of what Embassies has, and adds one problem:

- **HTTP and TLS join the trusted computing base**, which Embassies argues against.
- **Apps read only servers that allow it through [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).** Vendors proxy third-party content through their own servers, as a datacenter tenant would.
- **Apps can't send cookies.** `Cookie` is a [forbidden request header](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header). Vendors use tokens in other headers.
- **Every request carries the kernel's `Origin`.** Servers can't tell apps apart, much as servers can't tell apart the apps behind one coffee-shop IP address.
- **The firewall is still there.** Embassies places apps outside the firewall. Here, Chromium's [Local Network Access](https://developer.chrome.com/blog/local-network-access) asks the user before a public page reaches a private address. It doesn't apply when the kernel itself is on `localhost`, as in the example.
- **`cache: "no-store"`** keeps one app from timing another's cached responses, since all of them share the kernel's cache partition.

### UI: blitted bitmaps instead of a mapped framebuffer

An app draws to its own `OffscreenCanvas`, and sends `transferToImageBitmap()` with `updateCanvas`. The kernel shows it in a `bitmaprenderer` canvas, if the app still holds the viewport.

The kernel can't hand apps the screen's canvas with `transferControlToOffscreen`. In Chromium 156, drawing to such a canvas from a worker in another process crashes the page's renderer (`tests/offscreen-canvas.spec.ts`). Blitting also makes revocation simple: `mapCanvas`, `transferViewport` and `repossessViewport` replace the canvas element, and the kernel drops blits from anyone but the holder.

Sublets sit above their landlord's canvas, so a landlord can't draw over its tenant. The kernel labels every viewport, sublets included, above its canvas, and highlights the focused one.

### Labels: the Web PKI instead of DNSSEC

`verifyLabel("news.example")` fetches `https://news.example/.well-known/embassies/key` and checks its hash is the app's principal. The example serves vendors at `http://<vendor>.localhost:<port>`, so the kernel uses `http` for `*.localhost` labels.

### SubtleCrypto is relayed

Chromium doesn't treat a worker from a `blob:null` URL as a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), so the app's worker has no `crypto.subtle`. The HTML spec says a dedicated worker takes its owner's status. The container document is a secure context, so it relays `SubtleCrypto` calls on a second port. `CryptoKey` is exposed only in secure contexts, so keys stay in the document and the worker holds handles. A `data:` worker is a secure context, but isn't `crossOriginIsolated`, so it loses shared memory.

Embassies leaves crypto to apps. The relay isn't a CEI call; the kernel never sees it.

#### Why containers aren't credentialless frames

A [credentialless iframe](https://developer.mozilla.org/en-US/docs/Web/Security/IFrame_credentialless) at a kernel URL would have a real origin, so its worker could load from a URL and be a secure context. In Chromium 156 it would let apps reach each other without the kernel (`tests/credentialless-frame.spec.ts`):

- Every credentialless frame under one top-level document shares one ephemeral partition: `localStorage`, IndexedDB, cookies and `BroadcastChannel`. Nesting and Document-Isolation-Policy don't change that. A new top-level document gets a new partition.
- A credentialless frame can register a service worker in that partition. It then handles the navigations of later credentialless frames on the page, so it could serve another app's container any document.
- Same-origin frames with Document-Isolation-Policy share one process, credentialless or not, so Spectre could read across apps. Sandboxed frames, each with its own opaque origin, each get their own.
- Serving the app's worker with CSP `sandbox` doesn't help. The worker gets an opaque origin, so it loses `crypto.subtle` again, but it stays in its frame's shared process, and still shares `BroadcastChannel` with the other frames' workers.

Today's containers have neither problem: apps can't reach each other through `BroadcastChannel`, IndexedDB, the Cache API or Web Locks (`tests/container.spec.ts`).

### Smaller changes

- `ifconfig` returns the app's principal, so an app can answer for it in protocols like linking.
- `tenantChanged` returns the tenant's generation and a fresh landlord-tenant key, which the tenant gets from `acceptViewport`. Embassies gives each landlord-tenant pair a key but doesn't say how the landlord gets it.
- `repossessViewport` returns a fresh deed, so the landlord can let the sublet to another tenant.
- A boot block is the whole app. An app could load more through `fetch` and `blob:` URLs.

## Linking and embedding

`apps/lib/link.js` implements the protocol of §4.1 between apps; the kernel knows nothing of it. To link to `recipes.example`, the caller:

1. Fetches its key and boot block and calls `ensureAlive`.
2. Broadcasts `who` with the target's principal. The target answers with an ECDH key the kernel endorsed for it.
3. Checks the endorsement with `verifyEndorsement`, and sends a deed encrypted to that key.

Embedding (§4.3) is the same with a sublet deed. Back navigation (§4.5) sends the caller's label as the reverse edge. The demo in `apps/` shows all three: news embeds weather and links to recipes, which links back.

## Limitations

- **Chromium only.** Firefox puts opaque-origin frames in their creator's process, and WebKit has site isolation off by default, so apps there would share the kernel's process.
- **Side channels.** As in Embassies, apps can infer each other through shared resources like the CPU, DNS and connection pools.
- **Not implemented:** global history and favorites (§4.4, §4.5), z-order among sublets, and detecting a crashed container. A tenant can hand its sublet on with `transferViewport`, and the landlord sees the change with `tenantChanged`, but the demo has no three-party protocol for it (§4.3).
