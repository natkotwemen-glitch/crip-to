from aiohttp import web
import database as db
from utils.prices import calc_pnl, get_price

routes = web.RouteTableDef()

def fmt_rub(amount):
    return f"₽{round(amount):,}".replace(',', ' ')

@routes.get('/balance')
async def balance(req):
    user_id = int(req.rel_url.query.get('user_id', 0))
    bal = db.get_balance(user_id)
    return web.json_response({'balance': bal})

@routes.get('/positions')
async def positions(req):
    user_id = int(req.rel_url.query.get('user_id', 0))
    rows = db.get_open_positions(user_id)
    result = [{'id': r[0], 'symbol': r[2], 'direction': r[3], 'leverage': r[4], 'amount': r[5], 'entry_price': r[6]} for r in rows]
    return web.json_response({'positions': result})

@routes.post('/open_position')
async def open_position(req):
    data = await req.json()
    user_id = data['user_id']
    bal = db.get_balance(user_id)
    if data['amount'] > bal:
        return web.json_response({'ok': False, 'error': 'Недостаточно средств'})
    # защита от дублирования
    existing = db.get_open_positions(user_id)
    for p in existing:
        if p[2] == data['symbol'] and p[3] == data['direction'] and p[4] == data['leverage']:
            from datetime import datetime
            try:
                created = datetime.fromisoformat(p[8])
                if (datetime.utcnow() - created).total_seconds() < 3:
                    return web.json_response({'ok': False, 'error': 'Дублирующий запрос'})
            except Exception:
                pass
    pos_id = db.open_position(user_id, data['symbol'], data['direction'], data['leverage'], data['amount'], data['entry_price'])
    try:
        from main import bot
        await bot.send_message(
            user_id,
            f"✅ Позиция #{pos_id} открыта\n"
            f"📌 {data['symbol']} {'LONG 📈' if data['direction'] == 'long' else 'SHORT 📉'} x{data['leverage']}\n"
            f"Цена входа: {data['entry_price']:,.2f}\n"
            f"Сумма: {fmt_rub(data['amount'])}"
        )
    except Exception:
        pass
    return web.json_response({'ok': True, 'position_id': pos_id})

@routes.post('/close_position')
async def close_position(req):
    data = await req.json()
    user_id = data['user_id']
    pos_id = data['position_id']
    current_price = data['current_price']
    positions = db.get_open_positions(user_id)
    pos = next((p for p in positions if p[0] == pos_id), None)
    if not pos:
        return web.json_response({'ok': False, 'error': 'Позиция не найдена'})
    pnl = calc_pnl(pos[3], pos[4], pos[5], pos[6], current_price)
    db.close_position(pos_id, pnl)
    try:
        from main import bot
        emoji = "🟢" if pnl >= 0 else "🔴"
        await bot.send_message(
            user_id,
            f"{emoji} Позиция #{pos_id} закрыта\n"
            f"📌 {pos[2]} {'LONG' if pos[3] == 'long' else 'SHORT'} x{pos[4]}\n"
            f"Вход: {pos[6]:,.2f} | Выход: {current_price:,.2f}\n"
            f"{'💰' if pnl >= 0 else '💸'} PnL: {fmt_rub(pnl)}"
        )
    except Exception:
        pass
    return web.json_response({'ok': True, 'pnl': pnl})

@routes.post('/deposit')
async def deposit(req):
    data = await req.json()
    user_id = data['user_id']
    amount = data['amount']
    dep_id = db.create_deposit(user_id, amount)
    try:
        from main import bot
        from config import ADMIN_ID
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        await bot.send_message(
            ADMIN_ID,
            f"📥 Заявка на пополнение #{dep_id}\n"
            f"👤 Юзер: {user_id}\n"
            f"💰 Сумма: {fmt_rub(amount)}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="✅ Принять", callback_data=f"dep_approve_{dep_id}"),
                InlineKeyboardButton(text="❌ Отклонить", callback_data=f"dep_reject_{dep_id}")
            ]])
        )
    except Exception as e:
        print(f"deposit notify error: {e}")
    return web.json_response({'ok': True, 'deposit_id': dep_id})

@routes.post('/withdraw')
async def withdraw(req):
    data = await req.json()
    user_id = data['user_id']
    amount = data['amount']
    bal = db.get_balance(user_id)
    if amount > bal:
        return web.json_response({'ok': False, 'error': 'Недостаточно средств'})
    w_id = db.create_withdrawal(user_id, amount)
    try:
        from main import bot
        from config import ADMIN_ID
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        await bot.send_message(
            ADMIN_ID,
            f"📤 Заявка на вывод #{w_id}\n"
            f"👤 Юзер: {user_id}\n"
            f"💰 Сумма: {fmt_rub(amount)}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="✅ Выплачено", callback_data=f"wd_approve_{w_id}"),
                InlineKeyboardButton(text="❌ Отклонить", callback_data=f"wd_reject_{w_id}")
            ]])
        )
    except Exception as e:
        print(f"withdraw notify error: {e}")
    return web.json_response({'ok': True, 'withdrawal_id': w_id})

def create_app():
    app = web.Application()
    app.router.add_routes(routes)
    async def cors_middleware(app, handler):
        async def middleware(request):
            if request.method == 'OPTIONS':
                return web.Response(headers={
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                })
            response = await handler(request)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        return middleware
    app.middlewares.append(cors_middleware)
    return app
