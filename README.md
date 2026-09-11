# Field Reports — offline-first submission

One screen for a field worker to file a report. Built for a network that
is mostly not there: the report is written to local storage before any
network call, and a stable client-side id makes sure the same report is
never stored twice on the server.

## Stack

- Next.js (App Router) + TypeScript
- IndexedDB for the queue (no library — a small wrapper in `lib/db.ts`)
- A Next.js API route acts as a proxy to the mock server, mostly to keep
  the browser on the same origin and to forward `Retry-After` unchanged.

## How to run

You need Node 18+.

Terminal 1 — the mock server:

    cd field-reports-app
    cp ../mock-server.js .
    node mock-server.js

It listens on http://localhost:4000 and prints a hash of its own source on
startup. That file is unmodified.

Terminal 2 — the app:

    cd field-reports-app
    npm install
    npm run dev

Open http://localhost:3000.

The proxy reads `MOCK_URL` from the environment if you want to point it at
something other than `http://localhost:4000`.

## The part that matters — duplicates

The mock server kills the connection after storing roughly two in ten
reports. The client sees a network error for a report the server already
has. If the client treats that as a failure and resends, the server ends
up with two copies.

What the app does instead:

1. On submit, generate a `client_report_id` once and write the whole
   report to IndexedDB with status `queued`.
2. Every send — first try or retry — uses that same id.
3. The server dedupes on `client_report_id` before it does anything else,
   so a repeat POST returns 409 with the original `report_id`.
4. The client treats 409 as success: the report is already there, mark it
   `sent` and store the server id.
5. A network error is treated as *unknown*, not *failed*. The report goes
   back to `queued` and the next attempt uses the same id.

That last point is the whole thing. As long as the id survives, the server
cannot store the same report twice, no matter how the connection dies.

To verify:

    curl http://localhost:4000/v1/_debug/count

    "duplicates_created": 0

## What the queue looks like

The queue is split into Pending (queued / sending) and History (sent /
failed). Each card expands to show the full payload, the client id, the
server id if there is one, the attempt count, and the last error. The
point is that the worker can always tell what the server has actually
accepted, and what is still sitting on the device.

The queue lives in IndexedDB, not in memory and not in localStorage.
Closing the tab, force-quitting the browser, or rebooting the phone does
not lose it.

## The retry schedule

- Network error, 500, 502, 503: retry with exponential backoff, capped
  at 30s, with a small jitter.
- 429: honour `Retry-After`.
- 400, 413: give up. Status `failed`. Retrying will not help.
- 409: success.
- 201: success.

The poll also runs on its own every 5 seconds while the tab is open, and
on the browser's `online` event.

## What I am least confident about

- **IndexedDB behaviour in the browser I tested on.** I did the whole
  task on an Android phone via Termux, so the only browser I really
  exercised is the one on the device. The code uses the standard API and
  I would expect it to behave the same in Chrome, Firefox and Safari, but
  I have not confirmed that. Safari's private mode in particular has a
  history of giving IndexedDB a storage limit so small that a queue like
  this would not survive many reports.
- **No conflict resolution on `client_report_id` reuse.** The id is
  generated with `crypto.randomUUID()`, so a collision is not a real
  concern, but if a user somehow cleared site data and re-submitted the
  same logical report, the app would treat it as a new report. This is a
  product decision as much as a technical one.
- **The proxy route has no retry of its own.** If the Next.js server
  loses its connection to the mock server, the client sees a 502 and
  retries. That is correct here, but in a real deployment I would want
  to distinguish "the mock server is down" from "the app server cannot
  reach anything", because the retry pressure is different.
- **The "no photo" case is trivially small.** The mock server allows a
  photo field up to 4 MB. I did not wire it up because the task said not
  to, but the size-check path on the client would need care — a JSON
  body with a base64 photo is not how I would actually ship this.

## AI tools

I used Claude while working through the mock server's failure pattern and
for reviewing the retry state machine in `lib/sync.ts`. The architecture,
the decision to treat a network error as unknown rather than failed, and
the queue design are mine. I can walk through any part of it.
