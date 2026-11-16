"""Signaling server for the 2-peer whiteboard (docs/plan/01-architecture.md §2).

Pairs exactly two browsers, relays their WebRTC signaling and passes control
messages. It also serves the built web app (web/dist). The DataChannel
traffic itself never goes through here.

Messages (JSON over the WebSocket):

    server -> client
        {"type": "wait"}                    first peer, waiting for a partner
        {"type": "paired", "offer": bool}   partner present; offer=True means
                                            "create the DataChannel and offer"
        {"type": "peer_left"}               partner disconnected; wait again
        {"type": "full"}                    already 2 peers; connection closed
        {"type": "signal", "data": {...}}   forwarded from the partner
        {"type": "clear"}                   clear canvas and counters

    client -> server
        {"type": "signal", "data": {...}}   offer/answer/ICE, sent to the partner
        {"type": "clear"}                   sent to both peers
        {"type": "set_profile", "name": s}  step 3.6 (manual mode only)

Usage:
    uv run server/signaling.py [--host 0.0.0.0] [--port 8000]
"""

import argparse
from pathlib import Path

from aiohttp import WSCloseCode, WSMsgType, web

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
MAX_PEERS = 2

# Connected peers in join order (at most MAX_PEERS).
PEERS = web.AppKey("peers", list[web.WebSocketResponse])
# Every open WebSocket, registered or not, so shutdown can close them all.
SOCKETS = web.AppKey("sockets", set[web.WebSocketResponse])


async def send(ws: web.WebSocketResponse, msg: dict) -> None:
    """Send a message unless the socket is already closing.

    A peer that just disconnected can still be in PEERS for a moment (until
    its handler runs leave()); writing to it would raise.
    """
    if not ws.closed:
        await ws.send_json(msg)


async def join(app: web.Application, ws: web.WebSocketResponse) -> bool:
    """Register a new peer and tell it (and its partner) the state.

    The first peer gets `wait`. When the second arrives, both get `paired`;
    the newcomer offers, the one already waiting answers. Returns False if
    the server is full; the caller then closes the socket.
    """
    peers = app[PEERS]
    if len(peers) >= MAX_PEERS:
        await send(ws, {"type": "full"})
        return False
    peers.append(ws)
    if len(peers) == 1:
        await send(ws, {"type": "wait"})
    else:
        waiting, newcomer = peers
        await send(waiting, {"type": "paired", "offer": False})
        await send(newcomer, {"type": "paired", "offer": True})
    return True


async def leave(app: web.Application, ws: web.WebSocketResponse) -> None:
    """Unregister a peer and notify the remaining one with `peer_left`.

    The remaining peer then waits; the next peer to join pairs with it.
    A rejected (`full`) socket was never registered, so nothing happens.
    """
    peers = app[PEERS]
    if ws not in peers:
        return
    peers.remove(ws)
    for other in peers:
        await send(other, {"type": "peer_left"})


async def handle_message(app: web.Application, ws: web.WebSocketResponse, msg: dict) -> None:
    """Route one client message.

    `signal` goes unchanged to the partner (dropped if there is none yet:
    the browsers only signal after `paired`). `clear` goes to both peers,
    including the sender, so every canvas clears the same way.
    Unknown types are logged and ignored instead of dropping the connection.
    """
    peers = app[PEERS]
    kind = msg.get("type")
    if kind == "signal":
        for other in peers:
            if other is not ws:
                await send(other, msg)
    elif kind == "clear":
        for peer in peers:
            await send(peer, {"type": "clear"})
    elif kind == "set_profile":
        print(f"set_profile {msg.get('name')!r} ignored (step 3.6)", flush=True)
    else:
        print(f"unknown message type {kind!r} ignored", flush=True)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    """One client connection: join, handle messages until it closes, leave."""
    app = request.app
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    app[SOCKETS].add(ws)
    try:
        if not await join(app, ws):
            print(f"{request.remote} rejected (full)", flush=True)
            await ws.close()
            return ws
        print(f"{request.remote} joined ({len(app[PEERS])}/{MAX_PEERS})", flush=True)

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    await handle_message(app, ws, msg.json())
        finally:
            # Runs on a normal close and on errors, so a peer never stays registered.
            await leave(app, ws)
            print(f"{request.remote} left ({len(app[PEERS])}/{MAX_PEERS})", flush=True)
        return ws
    finally:
        app[SOCKETS].discard(ws)


async def close_sockets(app: web.Application) -> None:
    """On shutdown (Ctrl+C, SIGTERM): close every WebSocket first.

    Otherwise aiohttp cancels handlers that are still waiting for messages,
    which ends in an "Unhandled exception" traceback. Closed sockets let
    each handler finish normally (leave() runs, the pages start retrying).
    """
    for ws in list(app[SOCKETS]):
        await ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown")


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEB_DIST / "index.html")


def make_app() -> web.Application:
    app = web.Application()
    app[PEERS] = []
    app[SOCKETS] = set()
    app.on_shutdown.append(close_sockets)
    app.router.add_get("/ws", ws_handler)
    # The built app; missing until `npm run build` has run in web/.
    if WEB_DIST.is_dir():
        app.router.add_get("/", index)
        app.router.add_static("/", WEB_DIST)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Signaling server for the 2-peer whiteboard.")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = all interfaces, incl. br0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    web.run_app(make_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
