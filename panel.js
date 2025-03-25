let activeTab = 'graphql'; // Default tab

function downloadLog(data, filename) {
    try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download failed:', error);
    }
}

function formatTimestamp(timestamp) {
    try {
        return new Date(timestamp).toLocaleString();
    } catch (error) {
        return 'Invalid date';
    }
}

function formatSize(bytes) {
    try {
        if (bytes === undefined || bytes === null) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    } catch (error) {
        return 'N/A';
    }
}

function safeGetValue(obj, path, defaultValue = 'N/A') {
    try {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj) ?? defaultValue;
    } catch (error) {
        return defaultValue;
    }
}

function createTabContent(response) {
    try {
        return {
            network: `
                <div class="network-list">
                    ${(response.network || []).map(req => `
                        <div class="request-item ${req.graphql ? 'graphql-request' : ''}">
                            <div class="request-header">
                                <span class="method ${safeGetValue(req, 'method')}">${safeGetValue(req, 'method')}</span>
                                <span class="status-code">${safeGetValue(req, 'status')}</span>
                                <span class="url">${safeGetValue(req, 'url')}</span>
                            </div>
                            <div class="request-details">
                                <strong>Time:</strong> ${formatTimestamp(safeGetValue(req, 'timestamp'))}<br>
                                <strong>Size:</strong> ${formatSize(safeGetValue(req, 'size.response'))}<br>
                                <strong>Type:</strong> ${safeGetValue(req, 'resourceType', 'unknown')}<br>
                                <strong>Duration:</strong> ${safeGetValue(req, 'timing') ? `${Number(req.timing).toFixed(2)}ms` : 'N/A'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `,
            graphql: `
                <div class="graphql-list">
                    ${(response.graphql || []).map(req => `
                        <div class="request-item graphql-request">
                            <div class="request-header">
                                <span class="method ${safeGetValue(req, 'method')}">${safeGetValue(req, 'method')}</span>
                                <span class="status-code">${safeGetValue(req, 'status')}</span>
                            </div>
                            <div class="request-details">
                                <strong>Time:</strong> ${formatTimestamp(safeGetValue(req, 'timestamp'))}<br>
                                <strong>Operation:</strong> ${safeGetValue(req, 'operationName', 'Unknown')}<br>
                                <div class="query-section">
                                    <strong>Query:</strong>
                                    <pre class="query-content">${safeGetValue(req, 'postData.text', '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                                </div>
                                ${req.response ? `
                                    <div class="response-section">
                                        <strong>Response:</strong>
                                        <pre class="response-content">${JSON.stringify(req.response, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `,
            console: `
                <div class="console-list">
                    ${(response.console || []).map(log => `
                        <div class="console-item ${safeGetValue(log, 'type')}">
                            <div class="console-timestamp">${formatTimestamp(safeGetValue(log, 'timestamp'))}</div>
                            <div class="console-content">
                                <pre>${(safeGetValue(log, 'messages', [])).join(' ')}</pre>
                            </div>
                            <div class="console-source">${safeGetValue(log, 'source')}</div>
                        </div>
                    `).join('')}
                </div>
            `
        };
    } catch (error) {
        console.error('Error creating tab content:', error);
        return {
            network: '<div class="error">Error loading network data</div>',
            graphql: '<div class="error">Error loading GraphQL data</div>',
            console: '<div class="error">Error loading console data</div>'
        };
    }
}

let updateInterval = null;

function updateDisplay() {
    try {
        chrome.runtime.sendMessage({type: 'getLog'}, function(response) {
            if (chrome.runtime.lastError) {
                console.error('Runtime error:', chrome.runtime.lastError);
                stopUpdates();
                return;
            }

            const content = document.getElementById('content');
            if (!content) return;

            const tabs = createTabContent(response || { network: [], console: [], graphql: [] });
            
            content.innerHTML = `
                <div class="controls">
                    <button id="downloadBtn">Download All Data</button>
                    <button id="clearBtn">Clear Data</button>
                </div>
                
                <div class="stats">
                    <p>Network Requests: ${(response?.network || []).length}</p>
                    <p>GraphQL Requests: ${(response?.graphql || []).length}</p>
                    <p>Console Events: ${(response?.console || []).length}</p>
                </div>

                <div class="tabs">
                    <button class="tab-btn ${activeTab === 'network' ? 'active' : ''}" data-tab="network">Network</button>
                    <button class="tab-btn ${activeTab === 'graphql' ? 'active' : ''}" data-tab="graphql">GraphQL</button>
                    <button class="tab-btn ${activeTab === 'console' ? 'active' : ''}" data-tab="console">Console</button>
                </div>

                <div class="tab-content ${activeTab === 'network' ? '' : 'hidden'}" id="networkTab">
                    ${tabs.network}
                </div>
                <div class="tab-content ${activeTab === 'graphql' ? '' : 'hidden'}" id="graphqlTab">
                    ${tabs.graphql}
                </div>
                <div class="tab-content ${activeTab === 'console' ? '' : 'hidden'}" id="consoleTab">
                    ${tabs.console}
                </div>
            `;

            // Add event listeners
            const downloadBtn = document.getElementById('downloadBtn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => {
                    downloadLog(response, `devtools-log-${Date.now()}.json`);
                });
            }

            const clearBtn = document.getElementById('clearBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    chrome.runtime.sendMessage({type: 'clearLog'});
                });
            }

            // Tab switching
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    activeTab = e.target.dataset.tab; // Update the active tab
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
                    e.target.classList.add('active');
                    document.getElementById(`${activeTab}Tab`).classList.remove('hidden');
                });
            });
        });
    } catch (error) {
        console.error('Update display error:', error);
        stopUpdates();
    }
}

function stopUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

function startUpdates() {
    stopUpdates();
    updateInterval = setInterval(updateDisplay, 2000);
    updateDisplay(); // Initial update
}

// Start updates when the panel is loaded
document.addEventListener('DOMContentLoaded', startUpdates);

// Cleanup when the panel is closed
window.addEventListener('unload', stopUpdates); 