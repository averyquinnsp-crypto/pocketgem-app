// PocketGem Mobile Agent Client App

const DEFAULT_CONFIG = {
  apiKey: "",
  model: "openrouter/free",
  bridgeUrl: "http://127.0.0.1:3000",
  yoloMode: false
};

let config = { ...DEFAULT_CONFIG };
let conversationHistory = [];
let isTermuxBridgeOnline = false;

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('statusText');
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelSelect = document.getElementById('modelSelect');
const bridgeUrlInput = document.getElementById('bridgeUrlInput');
const chipModel = document.getElementById('chipModel');
const chipModelText = document.getElementById('chipModelText');
const chipYolo = document.getElementById('chipYolo');
const chipYoloText = document.getElementById('chipYoloText');
const chipCompact = document.getElementById('chipCompact');

// Load saved config
function loadSavedConfig() {
  const saved = localStorage.getItem('pocketgem_config');
  if (saved) {
    try {
      config = { ...config, ...JSON.parse(saved) };
    } catch {}
  }
  apiKeyInput.value = config.apiKey;
  modelSelect.value = config.model;
  bridgeUrlInput.value = config.bridgeUrl;
  chipModelText.textContent = config.model.split('/').pop();
  chipYoloText.textContent = config.yoloMode ? 'ON' : 'OFF';
  chipYolo.style.borderColor = config.yoloMode ? '#ef4444' : 'rgba(255, 255, 255, 0.1)';
}

function saveConfigState() {
  config.apiKey = apiKeyInput.value.trim();
  config.model = modelSelect.value;
  config.bridgeUrl = bridgeUrlInput.value.trim().replace(/\/+$/, '');
  localStorage.setItem('pocketgem_config', JSON.stringify(config));
  chipModelText.textContent = config.model.split('/').pop();
  settingsModal.classList.remove('open');
  checkTermuxBridge();
}

// Check if local Termux bridge server is running
async function checkTermuxBridge() {
  try {
    const res = await fetch(`${config.bridgeUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      isTermuxBridgeOnline = true;
      statusDot.className = 'status-dot online';
      statusText.textContent = 'Termux Bridge: Online';
      return;
    }
  } catch {}
  isTermuxBridgeOnline = false;
  statusDot.className = 'status-dot offline';
  statusText.textContent = 'Termux Bridge: Offline (Cloud Mode)';
}

// Render message in chat
function appendMessage(role, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  msgDiv.appendChild(bubble);
  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return bubble;
}

// Render Tool Card
function appendToolCard(toolName, command, initialStatus = 'running') {
  const card = document.createElement('div');
  card.className = 'tool-card';

  const header = document.createElement('div');
  header.className = 'tool-header';
  header.innerHTML = `
    <span>⚙ ${toolName}</span>
    <span class="tool-status ${initialStatus}">${initialStatus.toUpperCase()}</span>
  `;

  const body = document.createElement('div');
  body.className = 'tool-body';
  body.textContent = command;

  card.appendChild(header);
  card.appendChild(body);
  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  return {
    update: (output, isError = false) => {
      const statusBadge = header.querySelector('.tool-status');
      statusBadge.className = `tool-status ${isError ? 'error' : 'success'}`;
      statusBadge.textContent = isError ? 'FAILED' : 'COMPLETED';
      body.textContent = (command ? command + '\n\n' : '') + output;
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  };
}

// Send Message handler
async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = '';
  appendMessage('user', text);

  // If Slash commands
  if (text.startsWith('/')) {
    handleSlashCommand(text);
    return;
  }

  // If Bridge is online, delegate full execution to Termux PocketCode engine
  if (isTermuxBridgeOnline) {
    await sendToTermuxBridge(text);
  } else {
    await sendDirectCloud(text);
  }
}

// Send to local Termux PocketCode HTTP Bridge
async function sendToTermuxBridge(prompt) {
  const agentBubble = appendMessage('agent', 'Connecting to Termux PocketCode engine...');
  try {
    const res = await fetch(`${config.bridgeUrl}/api/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, yolo: config.yoloMode, model: config.model })
    });
    const data = await res.json();
    if (data.tools && data.tools.length > 0) {
      data.tools.forEach(t => {
        const card = appendToolCard(t.name, t.command || JSON.stringify(t.args), t.success ? 'success' : 'error');
        card.update(t.output, !t.success);
      });
    }
    agentBubble.textContent = data.reply || 'Task finished.';
  } catch (err) {
    agentBubble.textContent = `Termux Bridge Error: ${err.message}. Ensure pocket-code --server is running in Termux.`;
  }
}

// Fallback Direct Cloud Execution via OpenRouter
async function sendDirectCloud(prompt) {
  const agentBubble = appendMessage('agent', 'Thinking...');
  conversationHistory.push({ role: 'user', content: prompt });

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are PocketGem, an autonomous AI assistant on mobile.' },
          ...conversationHistory
        ]
      })
    });

    const data = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message?.content;
    if (reply) {
      agentBubble.textContent = reply;
      conversationHistory.push({ role: 'assistant', content: reply });
    } else {
      agentBubble.textContent = 'Error: ' + JSON.stringify(data.error || 'No response');
    }
  } catch (err) {
    agentBubble.textContent = 'Cloud API Error: ' + err.message;
  }
}

function handleSlashCommand(cmd) {
  if (cmd === '/compact') {
    conversationHistory = [];
    appendMessage('agent', '✔ Memory compacted.');
  } else if (cmd === '/yolo') {
    config.yoloMode = !config.yoloMode;
    chipYoloText.textContent = config.yoloMode ? 'ON' : 'OFF';
    appendMessage('agent', `YOLO mode is now ${config.yoloMode ? 'ENABLED' : 'DISABLED'}.`);
  } else {
    appendMessage('agent', `Command ${cmd} recognized.`);
  }
}

window.sendQuickPrompt = (p) => {
  userInput.value = p;
  handleSend();
};

// Event Listeners
sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

openSettingsBtn.addEventListener('click', () => settingsModal.classList.add('open'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('open'));
saveSettingsBtn.addEventListener('click', saveConfigState);

clearChatBtn.addEventListener('click', () => {
  chatContainer.innerHTML = '';
  conversationHistory = [];
});

chipYolo.addEventListener('click', () => {
  config.yoloMode = !config.yoloMode;
  chipYoloText.textContent = config.yoloMode ? 'ON' : 'OFF';
  chipYolo.style.borderColor = config.yoloMode ? '#ef4444' : 'rgba(255, 255, 255, 0.1)';
  localStorage.setItem('pocketgem_config', JSON.stringify(config));
});

chipCompact.addEventListener('click', () => handleSlashCommand('/compact'));

// Init
loadSavedConfig();
checkTermuxBridge();
setInterval(checkTermuxBridge, 5000);
