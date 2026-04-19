import aiohttp

SYMBOLS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
}

async def get_price(symbol: str) -> float:
    coin_id = SYMBOLS.get(symbol.upper())
    if not coin_id:
        return None
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            data = await resp.json()
            return data[coin_id]["usd"]

def calc_pnl(direction, leverage, amount, entry_price, current_price):
    price_change = (current_price - entry_price) / entry_price
    if direction == "short":
        price_change = -price_change
    pnl = amount * leverage * price_change
    # ликвидация если убыток >= депозит
    if pnl <= -amount:
        return -amount
    return round(pnl, 4)
