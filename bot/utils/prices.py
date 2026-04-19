import aiohttp

SYMBOLS = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "SOL": "SOLUSDT",
    "BNB": "BNBUSDT",
    "XRP": "XRPUSDT",
}

async def get_price(symbol: str) -> float:
    pair = SYMBOLS.get(symbol.upper())
    if not pair:
        return None
    url = f"https://api.binance.com/api/v3/ticker/price?symbol={pair}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                data = await resp.json()
                return float(data["price"])
    except Exception:
        return None

def calc_pnl(direction, leverage, amount, entry_price, current_price):
    price_change = (current_price - entry_price) / entry_price
    if direction == "short":
        price_change = -price_change
    pnl = amount * leverage * price_change
    if pnl <= -amount:
        return -amount
    return round(pnl, 4)
