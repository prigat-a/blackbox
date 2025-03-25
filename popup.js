let activeTab = 'graphql';

function downloadLog(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
}

function updateDisplay() {
    chrome.runtime.sendMessage({type: 'getLog'}, function(response) {
        const content = document.getElementById('content');
        if (!content) return;

        content.innerHTML = `
            <div class="controls">
                <button id="downloadBtn">Download Log</button>
                <button id="clearBtn">Clear Log</button>
            </div>
            
            <div class="tabs">
                <button class="tab-btn ${activeTab === 'network' ? 'active' : ''}" data-tab="network">
                    Network (${response.network.length})
                </button>
                <button class="tab-btn ${activeTab === 'graphql' ? 'active' : ''}" data-tab="graphql">
                    GraphQL (${response.graphql.length})
                </button>
                <button class="tab-btn ${activeTab === 'console' ? 'active' : ''}" data-tab="console">
                    Console (${response.console.length})
                </button>
            </div>

            <div class="tab-content ${activeTab === 'network' ? '' : 'hidden'}" id="networkTab">
                ${response.network.map(req => `
                    <div class="request-item">
                        <strong>${req.method}</strong> ${req.url}<br>
                        <small>Status: ${req.status} | Time: ${formatTimestamp(req.timestamp)}</small>
                    </div>
                `).join('')}
            </div>

            <div class="tab-content ${activeTab === 'graphql' ? '' : 'hidden'}" id="graphqlTab">
                ${response.graphql.map(req => `
                    <div class="request-item graphql-request">
                        <strong>${req.method}</strong> ${req.url}<br>
                        <small>Status: ${req.status} | Time: ${formatTimestamp(req.timestamp)}</small>
                    </div>
                `).join('')}
            </div>

            <div class="tab-content ${activeTab === 'console' ? '' : 'hidden'}" id="consoleTab">
                ${response.console.map(log => `
                    <div class="console-item ${log.type}">
                        <div>${formatTimestamp(log.timestamp)}</div>
                        <pre>${log.messages.join(' ')}</pre>
                        <small>${log.url}</small>
                    </div>
                `).join('')}
            </div>
        `;

        // Add event listeners
        document.getElementById('downloadBtn').addEventListener('click', () => {
            downloadLog(response, `activity-log-${Date.now()}.json`);
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            chrome.runtime.sendMessage({type: 'clearLog'});
        });

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                activeTab = e.target.dataset.tab;
                updateDisplay();
            });
        });
    });
}

// Initial display
updateDisplay();

// Update every 2 seconds
setInterval(updateDisplay, 2000); 