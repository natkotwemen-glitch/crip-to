from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton

from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
import database as db
from utils.prices import get_price, calc_pnl, SYMBOLS

router = Router()

LEVERAGES = [1, 2, 5, 10, 25, 50, 75, 100]

class TradeState(StatesGroup):
    choosing_symbol = State()
    choosing_direction = State()
    choosing_leverage = State()
    entering_amount = State()

def trade_menu_kb():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=s, callback_data=f"trade_sym_{s}") for s in list(SYMBOLS.keys())[:3]],
        [InlineKeyboardButton(text=s, callback_data=f"trade_sym_{s}") for s in list(SYMBOLS.keys())[3:]],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="back_main")],
    ])

@router.message(F.text == "📊 Торговля")
async def trade_menu_msg(message: Message):
    await message.answer("📊 Выбери монету для торговли:", reply_markup=trade_menu_kb())

@router.callback_query(F.data == "trade_menu")
async def trade_menu(call: CallbackQuery):
    await call.message.edit_text("📊 Выбери монету для торговли:", reply_markup=trade_menu_kb())

@router.callback_query(F.data.startswith("trade_sym_"))
async def choose_symbol(call: CallbackQuery, state: FSMContext):
    symbol = call.data.split("_")[2]
    price = await get_price(symbol)
    await state.update_data(symbol=symbol, entry_price=price)
    await call.message.edit_text(
        f"📈 {symbol} — ${price:,.2f}\n\nВыбери направление:",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🟢 LONG", callback_data="dir_long"),
             InlineKeyboardButton(text="🔴 SHORT", callback_data="dir_short")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="trade_menu")],
        ])
    )

@router.callback_query(F.data.startswith("dir_"))
async def choose_direction(call: CallbackQuery, state: FSMContext):
    direction = call.data.split("_")[1]
    await state.update_data(direction=direction)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"x{lev}", callback_data=f"lev_{lev}") for lev in LEVERAGES[:4]],
        [InlineKeyboardButton(text=f"x{lev}", callback_data=f"lev_{lev}") for lev in LEVERAGES[4:]],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="trade_menu")],
    ])
    await call.message.edit_text("⚡ Выбери плечо:", reply_markup=kb)

@router.callback_query(F.data.startswith("lev_"))
async def choose_leverage(call: CallbackQuery, state: FSMContext):
    leverage = int(call.data.split("_")[1])
    await state.update_data(leverage=leverage)
    bal = db.get_balance(call.from_user.id)
    await call.message.edit_text(
        f"💰 Твой баланс: {bal:.2f} монет\nВведи сумму для открытия позиции:"
    )
    await state.set_state(TradeState.entering_amount)

@router.message(TradeState.entering_amount)
async def enter_amount(message: Message, state: FSMContext):
    try:
        amount = float(message.text.replace(",", "."))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("Введи корректную сумму.")
        return
    bal = db.get_balance(message.from_user.id)
    if amount > bal:
        await message.answer(f"Недостаточно средств. Баланс: {bal:.2f}")
        return
    data = await state.get_data()
    pos_id = db.open_position(
        message.from_user.id,
        data["symbol"],
        data["direction"],
        data["leverage"],
        amount,
        data["entry_price"]
    )
    await state.clear()
    from handlers.user import main_menu
    await message.answer(
        f"✅ Позиция #{pos_id} открыта!\n"
        f"📌 {data['symbol']} | {'🟢 LONG' if data['direction'] == 'long' else '🔴 SHORT'} | x{data['leverage']}\n"
        f"💵 Вход: ${data['entry_price']:,.2f}\n"
        f"💰 Сумма: {amount} монет",
        reply_markup=main_menu()
    )

@router.message(F.text == "📋 Мои позиции")
async def my_positions_msg(message: Message):
    positions = db.get_open_positions(message.from_user.id)
    if not positions:
        await message.answer("У тебя нет открытых позиций.")
        return
    buttons = []
    text = "📋 Твои открытые позиции:\n\n"
    for pos in positions:
        pos_id, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
        current_price = await get_price(symbol)
        pnl = calc_pnl(direction, leverage, amount, entry_price, current_price)
        emoji = "🟢" if pnl >= 0 else "🔴"
        text += (
            f"#{pos_id} {symbol} | {'LONG' if direction == 'long' else 'SHORT'} x{leverage}\n"
            f"Вход: ${entry_price:,.2f} | Сейчас: ${current_price:,.2f}\n"
            f"{emoji} PnL: {pnl:+.2f} монет\n\n"
        )
        buttons.append([InlineKeyboardButton(text=f"❌ Закрыть #{pos_id}", callback_data=f"close_{pos_id}")])
    await message.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.callback_query(F.data == "my_positions")
async def my_positions(call: CallbackQuery):
    positions = db.get_open_positions(call.from_user.id)
    if not positions:
        await call.message.edit_text("У тебя нет открытых позиций.", reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="back_main")]
        ]))
        return
    buttons = []
    text = "📋 Твои открытые позиции:\n\n"
    for pos in positions:
        pos_id, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
        current_price = await get_price(symbol)
        pnl = calc_pnl(direction, leverage, amount, entry_price, current_price)
        emoji = "🟢" if pnl >= 0 else "🔴"
        text += (
            f"#{pos_id} {symbol} | {'LONG' if direction == 'long' else 'SHORT'} x{leverage}\n"
            f"Вход: ${entry_price:,.2f} | Сейчас: ${current_price:,.2f}\n"
            f"{emoji} PnL: {pnl:+.2f} монет\n\n"
        )
        buttons.append([InlineKeyboardButton(text=f"❌ Закрыть #{pos_id}", callback_data=f"close_{pos_id}")])
    buttons.append([InlineKeyboardButton(text="🔙 Назад", callback_data="back_main")])
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.callback_query(F.data.startswith("close_"))
async def close_position(call: CallbackQuery):
    pos_id = int(call.data.split("_")[1])
    positions = db.get_open_positions(call.from_user.id)
    pos = next((p for p in positions if p[0] == pos_id), None)
    if not pos:
        await call.answer("Позиция не найдена.")
        return
    _, user_id, symbol, direction, leverage, amount, entry_price, status, created_at = pos
    current_price = await get_price(symbol)
    pnl = calc_pnl(direction, leverage, amount, entry_price, current_price)
    db.close_position(pos_id, pnl)
    new_bal = db.get_balance(call.from_user.id)
    emoji = "🟢" if pnl >= 0 else "🔴"
    from handlers.user import main_menu
    await call.message.edit_text(
        f"Позиция #{pos_id} закрыта.\n"
        f"{emoji} PnL: {pnl:+.2f} монет\n"
        f"💰 Новый баланс: {new_bal:.2f} монет",
        reply_markup=main_menu()
    )

@router.callback_query(F.data == "back_main")
async def back_main(call: CallbackQuery):
    from handlers.user import main_menu
    bal = db.get_balance(call.from_user.id)
    await call.message.edit_text(f"💰 Баланс: {bal:.2f} монет", reply_markup=main_menu())
