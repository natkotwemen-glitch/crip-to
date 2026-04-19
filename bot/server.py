from aiohttp import web
import database as db
from utils.prices import calc_pnl, get_price
import json

routes = web.RouteTableDef()

@routes.get('/balance')
async def balance(req):
    user_id = int(req.rel_url.query.get('user_id', 0))
    bal = db.get_balance(user_id)
    return web.json_response({'balance': bal})

@routes.get('/positions')
async def positions(req):
    user_id = int(req.rel_url.query.get('user_id', 0))
    rows = db.get_open_positions(user_id)
    result = []
    for r in rows:
        result.append({
            'id': r[0], 'symbol': r[2], 'direction': r[3],
            'leverage': r[4], 'amount': r[5], 'entry_price': r[6]
        })
    return web.json_response({'positions': result})

@routes.post('/open_position')
async def open_position(req):
    data = await req.json()
    user_id = data['user_id']
    bal = db.get_balance(user_id)
    if data['amount'] > bal:
        return web.json_response({'ok': False, 'error': 'Недостаточно средств'})
    pos_id = db.open_position(
        user_id, data['symbol'], data['direction'],
        data['leverage'], data['amount'], data['entry_price']
    )
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
    return web.json_response({'ok': True, 'pnl': pnl})

@routes.post('/deposit')
async def deposit(req):
    data = await req.json()
    dep_id = db.create_deposit(data['user_id'], data['amount'])
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
    return web.json_response({'ok': True, 'withdrawal_id': w_id})

def create_app():
    app = web.Application()
    app.router.add_routes(routes)
    # CORS для WebApp
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
