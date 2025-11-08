import eventlet
eventlet.monkey_patch()
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask
from flask import send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import json
import os

app = Flask(__name__)
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)
    
app.config['SECRET_KEY'] = 'your-secret-key-here'
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Portfolio storage
portfolio = []

# Helper functions
def get_current_price(ticker):
    """Get current stock price"""
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period='1d')
        return hist['Close'].iloc[-1] if not hist.empty else 0
    except:
        return 0

def validate_ticker(ticker):
    """Validate if ticker exists"""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        return info and ('regularMarketPrice' in info or 'currentPrice' in info)
    except:
        return False

def format_stock_info(stock, ticker):
    """Format stock information"""
    info = stock.info
    hist = stock.history(period='1d')
    current_price = hist['Close'].iloc[-1] if not hist.empty else 0
    
    return {
        'ticker': ticker,
        'current_price': float(current_price),
        'market_cap': info.get('marketCap', 0),
        'pe_ratio': info.get('forwardPE', info.get('trailingPE', 0)),
        'beta': info.get('beta', 0),
        'dividend_yield': (info.get('dividendYield', 0) * 100) if info.get('dividendYield') else 0,
        'week_52_high': info.get('fiftyTwoWeekHigh', 0),
        'week_52_low': info.get('fiftyTwoWeekLow', 0),
        'sector': info.get('sector', 'N/A'),
        'industry': info.get('industry', 'N/A'),
        'ev_ebitda': info.get('enterpriseToEbitda', 0),
        'roe': (info.get('returnOnEquity', 0) * 100) if info.get('returnOnEquity') else 0,
        'profit_margin': (info.get('profitMargins', 0) * 100) if info.get('profitMargins') else 0,
        'revenue_growth': (info.get('revenueGrowth', 0) * 100) if info.get('revenueGrowth') else 0,
    }

# Database connection
def get_db_connection():
    """Connect to PostgreSQL database"""
    DATABASE_URL = os.environ.get('DATABASE_URL')
    if DATABASE_URL:
        # Render uses postgresql:// but psycopg2 needs postgres://
        if DATABASE_URL.startswith('postgres://'):
            DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        return conn
    return None

def init_db():
    """Initialize database tables"""
    conn = get_db_connection()
    if not conn:
        print("No database connection - using in-memory storage")
        return
    
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS portfolio (
            id SERIAL PRIMARY KEY,
            ticker VARCHAR(10) NOT NULL,
            buy_price DECIMAL(10, 2) NOT NULL,
            buy_date DATE NOT NULL,
            shares INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    cursor.close()
    conn.close()
    print("Database initialized")

def load_portfolio_from_db():
    """Load portfolio from database"""
    global portfolio
    conn = get_db_connection()
    if not conn:
        return
    
    cursor = conn.cursor()
    cursor.execute('SELECT ticker, buy_price, buy_date, shares FROM portfolio')
    rows = cursor.fetchall()
    portfolio = [dict(row) for row in rows]
    # Convert date to string
    for item in portfolio:
        item['buy_date'] = item['buy_date'].strftime('%Y-%m-%d')
        item['buy_price'] = float(item['buy_price'])
    
    cursor.close()
    conn.close()
    print(f"Loaded {len(portfolio)} positions from database")

# Initialize DB on startup
init_db()
load_portfolio_from_db()

# Socket.IO event handlers
@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('add_stock')
def handle_add_stock(data):
    """Add stock to portfolio"""
    try:
        ticker = data['ticker'].upper()
        
        if not validate_ticker(ticker):
            emit('stock_add_error', {'error': 'Invalid ticker symbol'})
            return
        
        stock_data = {
            'ticker': ticker,
            'buy_price': float(data['buy_price']),
            'buy_date': data['buy_date'],
            'shares': int(data['shares'])
        }
        
        # Save to database
        conn = get_db_connection()
        if conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO portfolio (ticker, buy_price, buy_date, shares) VALUES (%s, %s, %s, %s)',
                (stock_data['ticker'], stock_data['buy_price'], stock_data['buy_date'], stock_data['shares'])
            )
            conn.commit()
            cursor.close()
            conn.close()
        
        # Add to memory
        portfolio.append(stock_data)
        emit('stock_added', {'success': True})
    except Exception as e:
        emit('stock_add_error', {'error': str(e)})

@socketio.on('remove_stock')
def handle_remove_stock(data):
    """Remove stock from portfolio"""
    global portfolio
    ticker = data['ticker']
    
    # Remove from database
    conn = get_db_connection()
    if conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM portfolio WHERE ticker = %s', (ticker,))
        conn.commit()
        cursor.close()
        conn.close()
    
    # Remove from memory
    portfolio = [p for p in portfolio if p['ticker'] != ticker]
    emit('stock_removed', {'success': True})

@socketio.on('update_stock')
def handle_update_stock(data):
    """Update existing stock in portfolio"""
    global portfolio
    try:
        ticker = data['ticker'].upper()
        
        # Update database
        conn = get_db_connection()
        if conn:
            cursor = conn.cursor()
            cursor.execute(
                'UPDATE portfolio SET buy_price = %s, buy_date = %s, shares = %s WHERE ticker = %s',
                (float(data['buy_price']), data['buy_date'], int(data['shares']), ticker)
            )
            conn.commit()
            cursor.close()
            conn.close()
        
        # Update memory
        for item in portfolio:
            if item['ticker'] == ticker:
                item['buy_price'] = float(data['buy_price'])
                item['buy_date'] = data['buy_date']
                item['shares'] = int(data['shares'])
                break
        
        emit('stock_updated', {'success': True})
    except Exception as e:
        emit('stock_update_error', {'error': str(e)})

@socketio.on('get_portfolio')
def handle_get_portfolio():
    """Get portfolio data"""
    emit('portfolio_data', {'portfolio': portfolio})

@socketio.on('get_portfolio_summary')
def handle_get_portfolio_summary():
    """Calculate and return portfolio summary"""
    if not portfolio:
        emit('portfolio_summary', {
            'total_value': 0, 'total_invested': 0, 'total_gain_loss': 0,
            'total_gain_loss_pct': 0, 'ytd_return': 0, 'positions': []
        })
        return
    
    try:
        total_invested = total_current_value = 0
        positions = []
        year_start = f"{datetime.now().year}-01-01"
        
        for item in portfolio:
            ticker, buy_price, shares = item['ticker'], item['buy_price'], item['shares']
            current_price = get_current_price(ticker) or buy_price
            
            market_value = current_price * shares
            cost_basis = buy_price * shares
            gain_loss = market_value - cost_basis
            gain_loss_pct = ((current_price - buy_price) / buy_price * 100) if buy_price > 0 else 0
            
            total_invested += cost_basis
            total_current_value += market_value
            
            buy_date = pd.to_datetime(item['buy_date'])
            days_held = (datetime.now() - buy_date).days
            
            positions.append({
                'ticker': ticker, 'shares': shares, 'buy_price': float(buy_price),
                'current_price': float(current_price), 'market_value': float(market_value),
                'cost_basis': float(cost_basis), 'gain_loss': float(gain_loss),
                'gain_loss_pct': float(gain_loss_pct), 'days_held': days_held,
                'buy_date': item['buy_date']
            })
        
        # Calculate YTD return
        ytd_invested = ytd_current_value = 0
        for item in portfolio:
            ticker = item['ticker']
            buy_date = pd.to_datetime(item['buy_date'])
            current_price = get_current_price(ticker) or item['buy_price']
            
            if buy_date.year == datetime.now().year:
                start_price = item['buy_price']
            else:
                try:
                    stock = yf.Ticker(ticker)
                    hist_ytd = stock.history(start=year_start)
                    start_price = hist_ytd['Close'].iloc[0] if not hist_ytd.empty else item['buy_price']
                except:
                    start_price = item['buy_price']
            
            ytd_invested += start_price * item['shares']
            ytd_current_value += current_price * item['shares']
        
        ytd_return = ((ytd_current_value - ytd_invested) / ytd_invested * 100) if ytd_invested > 0 else 0
        
        emit('portfolio_summary', {
            'total_value': float(total_current_value),
            'total_invested': float(total_invested),
            'total_gain_loss': float(total_current_value - total_invested),
            'total_gain_loss_pct': float((total_current_value - total_invested) / total_invested * 100) if total_invested > 0 else 0,
            'ytd_return': float(ytd_return),
            'positions': positions
        })
    except Exception as e:
        print(f"Error in portfolio summary: {e}")
        emit('portfolio_summary', {
            'total_value': 0, 'total_invested': 0, 'total_gain_loss': 0,
            'total_gain_loss_pct': 0, 'ytd_return': 0, 'positions': []
        })

@socketio.on('get_stock_info')
def handle_get_stock_info(data):
    """Get detailed stock information"""
    try:
        ticker = data['ticker']
        stock = yf.Ticker(ticker)
        stock_data = format_stock_info(stock, ticker)
        emit('stock_info', {'success': True, 'data': stock_data})
    except Exception as e:
        emit('stock_info', {'success': False, 'error': str(e)})

@socketio.on('get_sector_allocation')
def handle_get_sector_allocation():
    """Get sector allocation"""
    if not portfolio:
        emit('sector_allocation', [])
        return
    
    sectors = {}
    for item in portfolio:
        try:
            stock = yf.Ticker(item['ticker'])
            info = stock.info
            current_price = get_current_price(item['ticker'])
            sector = info.get('sector', 'Unknown')
            value = current_price * item['shares']
            sectors[sector] = sectors.get(sector, 0) + value
        except:
            continue
    
    total = sum(sectors.values())
    sector_list = [{'sector': k, 'value': float(v), 'percentage': float((v/total)*100)} 
                   for k, v in sectors.items()] if total > 0 else []
    
    emit('sector_allocation', sector_list)

@socketio.on('get_portfolio_chart_data')
def handle_get_portfolio_chart_data(data):
    """Get portfolio chart data"""
    if not portfolio:
        emit('portfolio_chart_data', {'success': False, 'error': 'No portfolio'})
        return
    
    try:
        period = data.get('period', 'ytd')
        period_map = {
            'ytd': f"{datetime.now().year}-01-01",
            '1y': (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d'),
            '6mo': (datetime.now() - timedelta(days=180)).strftime('%Y-%m-%d'),
            '3mo': (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d'),
            '1mo': (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        }
        start_date = period_map.get(period, period_map['1mo'])
        
        portfolio_data = {}
        for item in portfolio:
            ticker = item['ticker']
            try:
                stock = yf.Ticker(ticker)
                hist = stock.history(start=start_date)
                if not hist.empty:
                    portfolio_data[ticker] = {
                        'dates': hist.index.strftime('%Y-%m-%d').tolist(),
                        'close': hist['Close'].tolist(),
                        'volume': hist['Volume'].tolist()
                    }
            except:
                continue
        
        emit('portfolio_chart_data', {'success': True, 'data': portfolio_data})
    except Exception as e:
        emit('portfolio_chart_data', {'success': False, 'error': str(e)})

@socketio.on('get_news')
def handle_get_news(data):
    """Get news for ticker"""
    try:
        ticker = data['ticker']
        limit = data.get('limit', 5)
        stock = yf.Ticker(ticker)
        news = stock.news[:limit] if hasattr(stock, 'news') and stock.news else []
        
        news_list = [{
            'title': article.get('title', 'No title'),
            'publisher': article.get('publisher', 'Unknown'),
            'link': article.get('link', '#'),
            'published': datetime.fromtimestamp(article.get('providerPublishTime', 0)).strftime('%Y-%m-%d %H:%M') 
                        if article.get('providerPublishTime') else 'Unknown',
            'ticker': ticker
        } for article in news]
        
        emit('news_data', {'success': True, 'news': news_list})
    except Exception as e:
        emit('news_data', {'success': False, 'error': str(e)})

@socketio.on('export_portfolio')
def handle_export_portfolio():
    """Export portfolio to JSON"""
    emit('portfolio_export', json.dumps(portfolio, indent=2))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
