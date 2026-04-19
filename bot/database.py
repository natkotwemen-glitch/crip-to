import sqlite3

DB = "bot.db"

def init_db():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            balance REAL DEFAULT 0
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            symbol TEXT,
            direction TEXT,
            leverage INTEGER,
            amount REAL,
            entry_price REAL,
            status TEXT DEFAULT 'open',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def get_user(user_id):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row

def create_user(user_id, username):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)", (user_id, username))
    conn.commit()
    conn.close()

def get_balance(user_id):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT balance FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else 0

def update_balance(user_id, amount):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
    conn.commit()
    conn.close()

def create_deposit(user_id, amount):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("INSERT INTO deposits (user_id, amount) VALUES (?, ?)", (user_id, amount))
    dep_id = c.lastrowid
    conn.commit()
    conn.close()
    return dep_id

def get_pending_deposits():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT id, user_id, amount, created_at FROM deposits WHERE status = 'pending'")
    rows = c.fetchall()
    conn.close()
    return rows

def resolve_deposit(dep_id, status):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT user_id, amount FROM deposits WHERE id = ?", (dep_id,))
    row = c.fetchone()
    if row and status == "approved":
        c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (row[1], row[0]))
    c.execute("UPDATE deposits SET status = ? WHERE id = ?", (status, dep_id))
    conn.commit()
    conn.close()
    return row

def create_withdrawal(user_id, amount):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("UPDATE users SET balance = balance - ? WHERE user_id = ?", (amount, user_id))
    c.execute("INSERT INTO withdrawals (user_id, amount) VALUES (?, ?)", (user_id, amount))
    w_id = c.lastrowid
    conn.commit()
    conn.close()
    return w_id

def get_pending_withdrawals():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT id, user_id, amount, created_at FROM withdrawals WHERE status = 'pending'")
    rows = c.fetchall()
    conn.close()
    return rows

def resolve_withdrawal(w_id, status):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT user_id, amount FROM withdrawals WHERE id = ?", (w_id,))
    row = c.fetchone()
    if row and status == "rejected":
        c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (row[1], row[0]))
    c.execute("UPDATE withdrawals SET status = ? WHERE id = ?", (status, w_id))
    conn.commit()
    conn.close()
    return row

def open_position(user_id, symbol, direction, leverage, amount, entry_price):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("UPDATE users SET balance = balance - ? WHERE user_id = ?", (amount, user_id))
    c.execute("""
        INSERT INTO positions (user_id, symbol, direction, leverage, amount, entry_price)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (user_id, symbol, direction, leverage, amount, entry_price))
    pos_id = c.lastrowid
    conn.commit()
    conn.close()
    return pos_id

def get_all_open_positions():
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT * FROM positions WHERE status = 'open' ORDER BY created_at DESC")
    rows = c.fetchall()
    conn.close()
    return rows

def get_open_positions(user_id):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT * FROM positions WHERE user_id = ? AND status = 'open'", (user_id,))
    rows = c.fetchall()
    conn.close()
    return rows

def close_position(pos_id, pnl):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute("SELECT user_id, amount FROM positions WHERE id = ?", (pos_id,))
    row = c.fetchone()
    if row:
        payout = row[1] + pnl
        if payout > 0:
            c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (payout, row[0]))
        c.execute("UPDATE positions SET status = 'closed' WHERE id = ?", (pos_id,))
    conn.commit()
    conn.close()
    return row
