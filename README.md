# MarketSim

A paper-trading desk in the spirit of the iOS app MarketSim: virtual cash, real market hours, fractional shares, and a book you can hand to an AI agent.

This is an independent project. It is not affiliated with Third Line LLC.

The repo has three parts:

- `app/` — Expo (SDK 58) app that runs in Expo Go. Bottom tabs for the book, research, trade ticket, watchlist, agents, and settings.
- `server/` — Hono API, SQLite (Drizzle), a trading engine, and an MCP server.
- `examples/` — a REST agent and an MCP client.

With no API key the server uses a built-in simulated market (about forty liquid names, deterministic prices). Set `FINNHUB_API_KEY` to switch to live Finnhub quotes.

## Run the server

```bash
cd server
npm install
npm start
```

The API listens on `http://127.0.0.1:8787`. Docs are at [http://127.0.0.1:8787/docs](http://127.0.0.1:8787/docs) and the OpenAPI spec is at `/openapi.json`.

On a fresh database the server seeds a demo account:

- Email `demo@marketsim.app`
- Password `password123`
- A Primary book plus two agents, Scout and Hawk

Seeded agent keys are written once to `server/data/demo-keys.json` (gitignored). Create your own agent in the app if you want a key that was never on disk.

```bash
npm test          # trading engine, market hours, guardrails, API
npm run typecheck
```

## Open the app in Expo Go

```bash
cd app
npm install
npx expo start --port 8093
```

Scan the QR code with Expo Go (SDK 58). The phone has to reach the computer running the API.

1. Find the computer's LAN address.
2. In the app, open Settings and set the server to `http://<lan-ip>:8787`. `localhost` on a phone is the phone itself.
3. Sign in with the demo account, or register a new one and open a portfolio (starting cash from $1 to $1,000,000,000).

Web, for a quick look on the same machine:

```bash
npx expo start --web --port 8093
```

Tunnel, if the phone is not on the same network:

```bash
npx expo start --tunnel --port 8093
```

The app stays inside Expo Go. It does not use custom native modules.

## Market hours

US equities, America/New_York, 9:30–16:00 on weekdays, skipping full NYSE holidays for 2025–2027. Orders placed while the session is closed are stored as queued and fill at the next open, oldest first. Cash and shares are checked again at the fill, so a gap can reject a queued order.

Settings has **Queue when the NYSE is closed**. Turn it off and new orders fill immediately at the latest price. That is the switch to use when you want to try an agent on a weekend. The default is on.

Fractional shares are stored as millionths of a share. Dollar orders buy or sell as many shares as the cash (or the position) allows without going over the amount.

Dividends and splits are applied when the market-data provider returns them. The built-in market and the Finnhub free tier return none, so that path is a no-op until a provider supplies actions. The applier is covered by tests.

## Connect an agent over REST

Create an agent in the Agents tab. The API key is shown once. Then:

```bash
export MARKETSIM_API_URL=http://127.0.0.1:8787
export MARKETSIM_API_KEY=mks_your_key
curl -s "$MARKETSIM_API_URL/v1/me" \
  -H "Authorization: Bearer $MARKETSIM_API_KEY"

curl -s "$MARKETSIM_API_URL/v1/orders" \
  -H "Authorization: Bearer $MARKETSIM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","side":"buy","amountType":"dollars","amount":150}'
```

`amountType` is `dollars` or `shares`. Guardrails on the agent (max order size, max trades per New York day, optional symbol list) are enforced. A paused agent can read but cannot trade. A revoked key is rejected until you generate a new one.

The example script places a dollar buy and a fractional share buy. If `MARKETSIM_API_KEY` is unset it uses Scout's key from `server/data/demo-keys.json`.

```bash
node --experimental-strip-types examples/simple-agent.ts
```

Agent routes, all under `/v1` with the bearer key:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/me` | Cash, equity, guardrails, session |
| GET | `/v1/quote/{symbol}` | Latest quote |
| GET | `/v1/quotes?symbols=AAPL,MSFT` | Several quotes |
| GET | `/v1/search?q=` | Name or ticker |
| GET | `/v1/movers` | Active, gainers, losers |
| GET | `/v1/history/{symbol}?range=1d\|1w\|1m\|3m\|1y\|5y` | Candles |
| GET | `/v1/portfolio` | The agent's book |
| GET | `/v1/positions` | Open positions |
| GET | `/v1/orders` | Order history |
| POST | `/v1/orders` | Market order |
| GET | `/v1/market` | NYSE session |

The app itself uses `/api` with a session token from `/api/auth/login`.

## Connect an agent over MCP

The same key authenticates a Streamable HTTP MCP server at `http://127.0.0.1:8787/mcp`. Tools: `get_market_status`, `get_quote`, `search_symbols`, `get_movers`, `get_price_history`, `get_portfolio`, `get_positions`, `list_orders`, `place_order`.

Cursor, or any client that speaks Streamable HTTP:

```json
{
  "mcpServers": {
    "marketsim": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer mks_your_key"
      }
    }
  }
}
```

A client that only spawns a local process can bridge to it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "marketsim": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:8787/mcp",
        "--header",
        "Authorization: Bearer mks_your_key"
      ]
    }
  }
}
```

Check the tools and place a trade with the example client (uses Hawk's seeded key when `MARKETSIM_API_KEY` is unset):

```bash
npm install
node --experimental-strip-types examples/mcp-client.ts
```

Trades show up in the Agents tab, including orders that are still queued for the open.

## Environment

Server (`server/.env` or the shell):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `server/data/marketsim.sqlite` | SQLite file |
| `MARKET_DATA_PROVIDER` | `auto` | `auto`, `mock`, or `finnhub` |
| `FINNHUB_API_KEY` | empty | Live quotes when set. `auto` uses Finnhub if this is present, otherwise the built-in market |
| `SEED_DEMO` | `true` | Set to `false` to skip the demo account |

App:

| Variable | Default | Meaning |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://127.0.0.1:8787` | Server the app uses until you change it in Settings |

Agent examples:

| Variable | Meaning |
| --- | --- |
| `MARKETSIM_API_URL` | Server origin. Defaults to `http://127.0.0.1:8787` |
| `MARKETSIM_API_KEY` | Agent key. Defaults to the seeded key file when it exists |

Copy `server/.env.example` if you want the variables written down next to the process.
