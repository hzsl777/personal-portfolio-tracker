const BACKEND_URL = 'https://personal-portfolio-tracker-7tdz.onrender.com';
const socket = io(BACKEND_URL);
const UPDATE_INTERVAL = 60000; // 1 minute

const state = {
    portfolioChart: null,
    sectorChart: null,
    currentPage: 'dashboard',
    updateTimer: null
};

// Utility 
const formatCurrency = (value) => {
    if (value === undefined || value === null) return '$0.00';
    return new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', 
        minimumFractionDigits: 2, maximumFractionDigits: 2 
    }).format(value);
};

const formatLargeNumber = (value) => {
    if (!value) return 'N/A';
    const suffixes = ['', 'K', 'M', 'B', 'T'];
    const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
    if (tier === 0) return '$' + value.toFixed(2);
    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    return '$' + (value / scale).toFixed(2) + suffix;
};

const showNotification = (message, type = 'info') => {
    const notification = document.createElement('div');
    notification.className = 'notification glass-card';
    notification.style.cssText = `
        position: fixed; top: 24px; right: 24px; padding: 18px 28px; 
        border-radius: 14px; font-weight: 700; font-size: 14px; 
        z-index: 10000; animation: slideIn 0.3s ease; max-width: 350px;
    `;
    
    notification.style.background = type === 'success' 
        ? 'rgba(255, 255, 255, 0.95)' 
        : 'rgba(30, 30, 30, 0.95)';
    notification.style.color = type === 'success' ? '#000' : '#fff';
    notification.textContent = message;
    
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.parentNode?.removeChild(notification), 300);
    }, 3000);
};

// Socket 
socket.on('connect', () => {
    console.log('Connected to backend');
    initializeApp();
});

socket.on('stock_added', (data) => {
    if (data.success) {
        closeAddStockModal();
        refreshDashboard();
        showNotification('Stock added successfully!', 'success');
    }
});

socket.on('stock_add_error', (data) => {
    const errorEl = document.getElementById('modal-error');
    errorEl.textContent = data.error;
    errorEl.classList.add('active');
});

socket.on('stock_removed', (data) => {
    if (data.success) {
        refreshDashboard();
        showNotification('Stock removed successfully!', 'success');
    }
});

function initializeApp() {
    setupEventListeners();
    setTodayDate();
    refreshDashboard();
    startAutoUpdate();
}

function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateToPage(item.dataset.page);
        });
    });
    
    // Modal close 
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAllModals();
        });
    });
    
    // SCs
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            showAddStockModal();
        }
        if (e.key === 'Escape') closeAllModals();
        if (e.key === 'Enter' && document.getElementById('add-stock-modal').classList.contains('active')) {
            addStock();
        }
    });
    
    // Refresh 
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshDashboard();
    });
}

function startAutoUpdate() {
    if (state.updateTimer) clearInterval(state.updateTimer);
    state.updateTimer = setInterval(() => refreshDashboard(), UPDATE_INTERVAL);
}

function refreshDashboard() {
    updateDashboard();
    updateCharts();
    if (state.currentPage === 'holdings') loadHoldings();
    if (state.currentPage === 'analytics') loadAnalytics();
    if (state.currentPage === 'news') loadNews();
}

// Navigation
function navigateToPage(page) {
    state.currentPage = page;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`${page}-page`).classList.add('active');
    
    if (page === 'holdings') loadHoldings();
    else if (page === 'analytics') loadAnalytics();
    else if (page === 'news') loadNews();
}

// Modal 
function showAddStockModal() {
    document.getElementById('add-stock-modal').classList.add('active');
    document.getElementById('modal-ticker').focus();
}

function closeAddStockModal() {
    document.getElementById('add-stock-modal').classList.remove('active');
    clearModalForm();
}

function closeStockDetailModal() {
    document.getElementById('stock-detail-modal').classList.remove('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('active');
    });
}

function clearModalForm() {
    document.getElementById('modal-ticker').value = '';
    document.getElementById('modal-price').value = '';
    document.getElementById('modal-shares').value = '1';
    const errorEl = document.getElementById('modal-error');
    errorEl.classList.remove('active');
    errorEl.textContent = '';
}

function setTodayDate() {
    document.getElementById('modal-date').value = new Date().toISOString().split('T')[0];
}

// Stock 
function addStock() {
    const ticker = document.getElementById('modal-ticker').value.toUpperCase().trim();
    const price = parseFloat(document.getElementById('modal-price').value);
    const shares = parseInt(document.getElementById('modal-shares').value);
    const date = document.getElementById('modal-date').value;
    const errorEl = document.getElementById('modal-error');
    
    if (!ticker || !price || !shares || !date) {
        errorEl.textContent = 'Please fill in all fields';
        errorEl.classList.add('active');
        return;
    }
    
    if (price <= 0 || shares <= 0) {
        errorEl.textContent = 'Price and shares must be positive';
        errorEl.classList.add('active');
        return;
    }
    
    socket.emit('add_stock', { ticker, buy_price: price, buy_date: date, shares });
}

function removeStock(ticker) {
    if (confirm(`Remove ${ticker} from portfolio?`)) {
        socket.emit('remove_stock', { ticker });
    }
}

// Dashboard update
function updateDashboard() {
    socket.emit('get_portfolio_summary');
    socket.once('portfolio_summary', (summary) => {
        // Update summary 
        document.getElementById('total-value').textContent = formatCurrency(summary.total_value);
        document.getElementById('total-invested').textContent = formatCurrency(summary.total_invested);
        
        const changeEl = document.getElementById('total-change');
        const sign = summary.total_gain_loss >= 0 ? '+' : '';
        changeEl.textContent = `${sign}${formatCurrency(summary.total_gain_loss)} (${summary.total_gain_loss_pct.toFixed(2)}%)`;
        changeEl.className = `card-change ${summary.total_gain_loss >= 0 ? 'positive' : 'negative'}`;
        
        const ytdEl = document.getElementById('ytd-return');
        ytdEl.textContent = `${summary.ytd_return >= 0 ? '+' : ''}${summary.ytd_return.toFixed(2)}%`;
        ytdEl.style.color = summary.ytd_return >= 0 ? '#fff' : '#aaa';
        
        document.getElementById('num-positions').textContent = summary.positions.length;
        
        // Update best/worst holdings
        if (summary.positions.length > 0) {
            const sorted = [...summary.positions].sort((a, b) => b.gain_loss_pct - a.gain_loss_pct);
            const top = sorted[0];
            const bottom = sorted[sorted.length - 1];
            
            document.getElementById('top-performer').innerHTML = `
                <div style="font-size: 22px; font-weight: 900; margin-bottom: 8px;">${top.ticker}</div>
                <div style="color: #fff; font-size: 18px; font-weight: 700;">+${top.gain_loss_pct.toFixed(2)}%</div>
            `;
            
            document.getElementById('bottom-performer').innerHTML = `
                <div style="font-size: 22px; font-weight: 900; margin-bottom: 8px;">${bottom.ticker}</div>
                <div style="color: ${bottom.gain_loss_pct >= 0 ? '#fff' : '#aaa'}; font-size: 18px; font-weight: 700;">
                    ${bottom.gain_loss_pct >= 0 ? '+' : ''}${bottom.gain_loss_pct.toFixed(2)}%
                </div>
            `;
        } else {
            document.getElementById('top-performer').innerHTML = '<div style="color: #666;">No data</div>';
            document.getElementById('bottom-performer').innerHTML = '<div style="color: #666;">No data</div>';
        }
    });
}

function updateCharts() {
    const period = document.getElementById('chart-period').value;
    socket.emit('get_portfolio_chart_data', { period });
    socket.once('portfolio_chart_data', (chartData) => {
        if (chartData.success) updatePortfolioChart(chartData.data);
    });
}

function updatePortfolioChart(data) {
    const ctx = document.getElementById('portfolioChart');
    if (!ctx) return;
    
    if (state.portfolioChart) {
        state.portfolioChart.destroy();
        state.portfolioChart = null;
    }
    
    if (Object.keys(data).length === 0) return;
    
    const datasets = Object.entries(data).map(([ticker, stockData], index) => {
        const colors = ['#fff', '#aaa', '#888', '#666', '#ddd', '#bbb', '#999', '#777'];
        return {
            label: ticker,
            data: stockData.dates.map((date, i) => ({ x: date, y: stockData.close[i] })),
            borderColor: colors[index % colors.length],
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4
        };
    });
    
    state.portfolioChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { 
                    labels: { 
                        color: '#fff', 
                        font: { family: 'Inter', size: 12, weight: '700' },
                        padding: 15 
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#333',
                    borderWidth: 1
                }
            },
            scales: {
                x: { 
                    type: 'time', 
                    time: { unit: 'day' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#fff', font: { family: 'Inter', weight: '600' } }
                },
                y: { 
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { 
                        color: '#fff',
                        font: { family: 'Inter', weight: '600' },
                        callback: (value) => '$' + value.toFixed(2)
                    }
                }
            }
        }
    });
}

// Holdings 
function loadHoldings() {
    socket.emit('get_portfolio_summary');
    socket.once('portfolio_summary', (summary) => {
        const holdingsGrid = document.getElementById('holdings-grid');
        
        if (summary.positions.length === 0) {
            holdingsGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">EMPTY</div>
                    <h3>No Holdings Yet</h3>
                    <p>Add your first stock to get started</p>
                    <button class="btn-primary" onclick="showAddStockModal()">ADD STOCK</button>
                </div>
            `;
            return;
        }
        
        holdingsGrid.innerHTML = '';
        summary.positions.forEach(position => {
            const card = document.createElement('div');
            card.className = 'holding-card glass-card';
            const changeClass = position.gain_loss >= 0 ? 'positive' : 'negative';
            const sign = position.gain_loss >= 0 ? '+' : '';
            
            card.innerHTML = `
                <div class="holding-header">
                    <div class="holding-ticker">${position.ticker}</div>
                    <div class="holding-change ${changeClass}">
                        ${sign}${position.gain_loss_pct.toFixed(2)}%
                    </div>
                </div>
                <div class="holding-details">
                    <div class="detail-row">
                        <span>Shares</span>
                        <span>${position.shares}</span>
                    </div>
                    <div class="detail-row">
                        <span>Buy Price</span>
                        <span>${formatCurrency(position.buy_price)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Current Price</span>
                        <span>${formatCurrency(position.current_price)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Market Value</span>
                        <span>${formatCurrency(position.market_value)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Gain/Loss</span>
                        <span class="${changeClass}">${sign}${formatCurrency(position.gain_loss)}</span>
                    </div>
                </div>
                <div class="holding-actions">
                    <button class="btn-view" onclick="viewStockDetails('${position.ticker}')">DETAILS</button>
                    <button class="btn-remove" onclick="removeStock('${position.ticker}')">REMOVE</button>
                </div>
            `;
            holdingsGrid.appendChild(card);
        });
    });
}

function viewStockDetails(ticker) {
    socket.emit('get_stock_info', { ticker });
    socket.once('stock_info', (result) => {
        if (!result.success) return;
        
        const data = result.data;
        document.getElementById('detail-ticker').textContent = ticker;
        document.getElementById('detail-price').textContent = formatCurrency(data.current_price);
        document.getElementById('detail-52w-high').textContent = formatCurrency(data.week_52_high);
        document.getElementById('detail-52w-low').textContent = formatCurrency(data.week_52_low);
        document.getElementById('detail-pe').textContent = data.pe_ratio > 0 ? data.pe_ratio.toFixed(2) : 'N/A';
        document.getElementById('detail-mcap').textContent = formatLargeNumber(data.market_cap);
        document.getElementById('detail-beta').textContent = data.beta.toFixed(2);
        document.getElementById('detail-roe').textContent = data.roe.toFixed(2) + '%';
        document.getElementById('detail-margin').textContent = data.profit_margin.toFixed(2) + '%';
        document.getElementById('detail-growth').textContent = data.revenue_growth.toFixed(2) + '%';
        document.getElementById('detail-sector').textContent = data.sector;
        document.getElementById('detail-industry').textContent = data.industry;
        document.getElementById('detail-dividend').textContent = data.dividend_yield.toFixed(2) + '%';
        document.getElementById('stock-detail-modal').classList.add('active');
    });
}

// Analytics 
function loadAnalytics() {
    socket.emit('get_sector_allocation');
    socket.once('sector_allocation', updateSectorChart);
    
    socket.emit('get_portfolio_summary');
    socket.once('portfolio_summary', (summary) => {
        updatePerformanceAttribution(summary.positions);
    });
}

function updateSectorChart(data) {
    const ctx = document.getElementById('sectorChart');
    if (!ctx) return;
    
    if (state.sectorChart) {
        state.sectorChart.destroy();
        state.sectorChart = null;
    }
    
    if (data.length === 0) return;
    
    const colors = ['#fff', '#ddd', '#bbb', '#999', '#888', '#777', '#666', '#555'];
    
    state.sectorChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.sector),
            datasets: [{ 
                data: data.map(d => d.percentage), 
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#000'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { 
                        padding: 15,
                        color: '#fff',
                        font: { family: 'Inter', size: 12, weight: '700' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    callbacks: {
                        label: (ctx) => ctx.label + ': ' + ctx.parsed.toFixed(1) + '%'
                    }
                }
            }
        }
    });
}

function updatePerformanceAttribution(positions) {
    const list = document.getElementById('attribution-list');
    if (!list || positions.length === 0) return;
    
    const sorted = [...positions].sort((a, b) => b.gain_loss - a.gain_loss);
    list.innerHTML = '';
    
    sorted.forEach(pos => {
        const item = document.createElement('div');
        item.className = 'attribution-item';
        const sign = pos.gain_loss >= 0 ? '+' : '';
        item.innerHTML = `
            <span class="attribution-ticker">${pos.ticker}</span>
            <span class="attribution-value ${pos.gain_loss >= 0 ? 'positive' : 'negative'}">
                ${sign}${formatCurrency(pos.gain_loss)}
            </span>
        `;
        list.appendChild(item);
    });
}

// News
function loadNews() {
    socket.emit('get_portfolio');
    socket.once('portfolio_data', (data) => {
        const portfolio = data.portfolio;
        const newsFeed = document.getElementById('news-feed');
        
        if (portfolio.length === 0) {
            newsFeed.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">NEWS</div>
                    <h3>No News Available</h3>
                    <p>Add stocks to see market news</p>
                </div>
            `;
            return;
        }
        
        newsFeed.innerHTML = '';
        portfolio.forEach(stock => socket.emit('get_news', { ticker: stock.ticker, limit: 3 }));
    });
}

socket.on('news_data', (result) => {
    if (!result.success || result.news.length === 0) return;
    
    const newsFeed = document.getElementById('news-feed');
    result.news.forEach(article => {
        const card = document.createElement('div');
        card.className = 'news-card glass-card';
        card.innerHTML = `
            <div class="news-header">
                <div class="news-title">${article.title}</div>
                <div class="news-ticker">${article.ticker || 'N/A'}</div>
            </div>
            <div class="news-meta">
                <span class="news-publisher">${article.publisher}</span>
                <span>${article.published}</span>
                <a href="${article.link}" target="_blank" class="news-link">READ →</a>
            </div>
        `;
        newsFeed.appendChild(card);
    });
});

// Export 
function exportPortfolio() {
    socket.emit('export_portfolio');
    socket.once('portfolio_export', (data) => {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portfolio_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification('Portfolio exported!', 'success');
    });
}

// Animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
`;
document.head.appendChild(style);

// DOM
document.addEventListener('DOMContentLoaded', initializeApp);
