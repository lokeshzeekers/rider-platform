let activeChatUserId = null;

async function loadChatThreads() {
  const el = document.getElementById('chat-threads');
  try {
    const data = await Api.get('/chat/threads');
    let unreadTotal = 0;
    el.innerHTML =
      data.threads.length === 0
        ? '<div class="empty-state">Friend someone to start chatting.</div>'
        : data.threads
            .map((t) => {
              unreadTotal += t.unread_count || 0;
              return `
        <div class="row" style="cursor:pointer;" data-open-chat="${t.id}" data-name="${escapeHtml(t.name)}">
          ${avatarHtml(t)}
          <div style="min-width:0;">
            <div class="row-title">${escapeHtml(t.name)} ${t.unread_count ? `<span class="badge">${t.unread_count}</span>` : ''}</div>
            <div class="row-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${t.last_message ? escapeHtml(t.last_message) : 'Say hi 👋'}</div>
          </div>
        </div>`;
            })
            .join('');

    const badge = document.getElementById('badge-chats');
    badge.textContent = unreadTotal;
    badge.classList.toggle('hidden', unreadTotal === 0);
  } catch (err) {
    el.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

document.getElementById('chat-threads').addEventListener('click', (e) => {
  const row = e.target.closest('[data-open-chat]');
  if (!row) return;
  openChatWith(row.dataset.openChat, row.dataset.name);
});

async function openChatWith(userId, name) {
  activeChatUserId = userId;
  document.getElementById('chat-with-title').textContent = name;
  document.getElementById('chat-input').disabled = false;
  document.getElementById('chat-send').disabled = false;

  const box = document.getElementById('chat-messages');
  box.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const data = await Api.get(`/chat/with/${userId}`);
    renderChatMessages(data.messages);
    loadChatThreads();
  } catch (err) {
    box.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

function renderChatMessages(messages) {
  const box = document.getElementById('chat-messages');
  box.innerHTML = messages
    .map((m) => {
      const mine = m.sender_id === ME.id;
      return `<div class="bubble ${mine ? 'mine' : 'theirs'}">${escapeHtml(m.content)}<div class="bubble-time">${timeAgo(m.created_at)}</div></div>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !activeChatUserId) return;
  input.value = '';
  try {
    const data = await Api.post(`/chat/with/${activeChatUserId}`, { content });
    appendChatBubble(data.message, true);
  } catch (err) {
    alert(err.message);
  }
}
function appendChatBubble(m, mine) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `bubble ${mine ? 'mine' : 'theirs'}`;
  div.innerHTML = `${escapeHtml(m.content)}<div class="bubble-time">${timeAgo(m.created_at)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

socket.on('chat:message', (message) => {
  if (activeChatUserId && message.sender_id === activeChatUserId) {
    appendChatBubble(message, false);
  }
  if (!document.getElementById('section-chats').classList.contains('hidden')) loadChatThreads();
});
