// index.js - 独立 API 请求版 (Stand-alone Client)
// 完全解耦：不依赖 SillyTavern 内部 API，直接发起 fetch 请求

const extensionName = "st-story-helper";
const LS_KEY_PROMPT = 'sh_prompt';
const LS_KEY_API_URL = 'sh_api_url';
const LS_KEY_API_KEY = 'sh_api_key';
const LS_KEY_MODEL = 'sh_api_model';

const scriptPath = document.currentScript ? document.currentScript.src : import.meta.url;
const extensionFolderPath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));

console.log(`[${extensionName}] 插件启动 (Direct Client Mode)`);

// -------------------------------------------------------
// 1. 核心生成逻辑 (直接 Fetch)
// -------------------------------------------------------

async function sendToModel(fullPrompt) {
    // 读取设置
    const apiUrl = localStorage.getItem(LS_KEY_API_URL);
    const apiKey = localStorage.getItem(LS_KEY_API_KEY);
    const model = localStorage.getItem(LS_KEY_MODEL);

    if (!apiUrl) throw new Error("请先点击右上角 ⚙️ 设置 API 地址！");

    // 构造标准的 OpenAI 兼容格式
    const payload = {
        model: model || "gpt-3.5-turbo",
        messages: [
            { role: "system", content: "You are a creative writing assistant." },
            { role: "user", content: fullPrompt }
        ],
        temperature: 0.7,
        stream: false
    };

    // 自动补全 /chat/completions 如果用户只填了 base url
    let endpoint = apiUrl;
    if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/generate')) {
         // 简单的判断：如果看起来像 base URL，就拼上 chat completion
         if (endpoint.endsWith('/')) endpoint += 'chat/completions';
         else endpoint += '/chat/completions';
    }

    console.log(`[${extensionName}] 发送请求到: ${endpoint}`);

    const headers = {
        "Content-Type": "application/json"
    };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // 解析 OpenAI 格式
    if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
    }
    // 解析其他格式
    if (data.choices && data.choices[0] && data.choices[0].text) return data.choices[0].text;
    if (data.text) return data.text;
    
    return JSON.stringify(data);
}

// -------------------------------------------------------
// 2. 辅助工具
// -------------------------------------------------------

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeText(node) {
    return node ? (node.textContent || node.innerText || '').trim() : '';
}

function findSTInput() {
    const candidates = ['#send_textarea', 'textarea[aria-label="Message"]', '.composer textarea', '#chat_input_form textarea'];
    for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

function writeToSTInput(text) {
    const stInput = findSTInput();
    if (stInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeInputValueSetter.call(stInput, text);
        stInput.dispatchEvent(new Event('input', { bubbles: true }));
        stInput.dispatchEvent(new Event('change', { bubbles: true }));
        stInput.focus();
        return true;
    }
    return false;
}

function extractRecentChatHistory(maxItems = 15) {
    const chatContainer = document.querySelector('#chat');
    if (!chatContainer) return [];
    const messageNodes = Array.from(chatContainer.querySelectorAll('.mes'));
    const results = [];
    for (let i = messageNodes.length - 1; i >= 0 && results.length < maxItems; i--) {
        const node = messageNodes[i];
        if (node.style.display === 'none') continue;
        let role = 'user';
        if (node.getAttribute('is_user') === 'false' || node.classList.contains('not_user')) role = 'assistant';
        const textNode = node.querySelector('.mes_text');
        if (textNode) {
            const clone = textNode.cloneNode(true);
            clone.querySelectorAll('.mes_buttons, .timestamp, .mes_edit_clone, .conf_div').forEach(b => b.remove());
            let text = safeText(clone).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
            if (text) results.push({ role, text });
        }
    }
    return results.reverse();
}

function buildModelPayload(userPrompt, historyItems) {
    const historyText = historyItems.map(it => `${it.role.toUpperCase()}: ${it.text}`).join('\n');
    return `
[Context]
${historyText}

[Instruction]
${userPrompt.trim()}

[Format]
Output exactly 4 options numbered 1 to 4.
`.trim();
}

function parseModelOptions(text) {
    if (!text) return [];
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const items = [];
    let current = null;
    const indexRegex = /^([①1-9]+)[\.\)\、\s]+(.*)$/;
    for (const line of lines) {
        const m = line.match(indexRegex);
        if (m) {
            if (current) items.push(current.trim());
            current = m[2];
        } else {
            if (current) current += ' ' + line;
        }
    }
    if (current) items.push(current.trim());
    if (items.length < 2) return text.split(/\n\s*\n/).filter(p => p.length > 5).slice(0, 4);
    return items.slice(0, 4);
}

// -------------------------------------------------------
// 3. UI 交互
// -------------------------------------------------------

function renderOptionsToPanel(optionTexts) {
    const optionsWrap = document.getElementById('sh-options');
    optionsWrap.innerHTML = '';
    if (!optionTexts.length) {
        optionsWrap.innerHTML = '<div class="sh-empty">未能解析出选项。</div>';
        return;
    }
    optionTexts.forEach((txt, idx) => {
        const btn = document.createElement('div');
        btn.className = 'sh-option';
        btn.innerHTML = `<strong style="color:var(--sh-accent-2);margin-right:6px;">${idx + 1}.</strong>${escapeHtml(txt)}`;
        btn.addEventListener('click', () => {
            const success = writeToSTInput(txt);
            const preview = document.getElementById('sh-target-preview');
            if (preview) preview.value = txt;
        });
        optionsWrap.appendChild(btn);
    });
}

function bindPanelEvents() {
    // 1. 加载所有设置
    const savedPrompt = localStorage.getItem(LS_KEY_PROMPT);
    if (savedPrompt) $("#sh-prompt").val(savedPrompt);
    
    $("#sh-api-url").val(localStorage.getItem(LS_KEY_API_URL) || '');
    $("#sh-api-key").val(localStorage.getItem(LS_KEY_API_KEY) || '');
    $("#sh-api-model").val(localStorage.getItem(LS_KEY_MODEL) || '');

    // 2. 绑定设置按钮
    $("#sh-settings-toggle").off().on("click", () => {
        $("#sh-settings-panel").slideToggle(200);
    });

    $("#sh-save-settings").off().on("click", () => {
        localStorage.setItem(LS_KEY_API_URL, $("#sh-api-url").val().trim());
        localStorage.setItem(LS_KEY_API_KEY, $("#sh-api-key").val().trim());
        localStorage.setItem(LS_KEY_MODEL, $("#sh-api-model").val().trim());
        alert("设置已保存！");
        $("#sh-settings-panel").slideUp(200);
    });

    // 3. 绑定 Prompt 保存
    $("#sh-save-prompt").off().on("click", () => {
        localStorage.setItem(LS_KEY_PROMPT, $("#sh-prompt").val());
        alert("提示词已保存");
    });

    $("#sh-load-sample").off().on("click", () => {
        $("#sh-prompt").val("请基于上文，写出 4 种不同的剧情后续发展（每条 30-50 字）。");
    });

    // 4. 生成按钮
    $("#sh-generate").off().on("click", async () => {
        const promptText = $("#sh-prompt").val().trim();
        if (!promptText) return alert('请先填写提示词！');

        if (!localStorage.getItem(LS_KEY_API_URL)) {
             $("#sh-settings-panel").slideDown();
             return alert("请先在设置中填写 API 地址！");
        }

        $("#sh-gen-status").text('请求中...');
        $("#sh-options").html('<div class="sh-empty">正在连接 API...</div>');

        try {
            let historyItems = [];
            const manualCtx = $("#sh-context").val().trim();
            if (manualCtx) historyItems = [{ role: 'user', text: manualCtx }];
            else historyItems = extractRecentChatHistory(15);

            const fullPayload = buildModelPayload(promptText, historyItems);
            const responseText = await sendToModel(fullPayload);
            const options = parseModelOptions(responseText);
            renderOptionsToPanel(options);
            
            $("#sh-gen-status").text('完成');
        } catch (err) {
            console.error(err);
            $("#sh-options").html(`<div class="sh-empty" style="color:#ff6b6b">错误: ${err.message}</div>`);
            $("#sh-gen-status").text('失败');
        }
    });

    $("#sh-apply-to-st").off().on("click", () => {
        const txt = $("#sh-target-preview").val();
        if (txt) writeToSTInput(txt);
    });
    $("#sh-clear-preview").off().on("click", () => $("#sh-target-preview").val(""));
}

// -------------------------------------------------------
// 4. 加载
// -------------------------------------------------------

function injectStyles() {
    const link = document.createElement("link");
    link.href = `${extensionFolderPath}/plugin.css`;
    link.type = "text/css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
}

async function loadStoryHelperUI() {
    try {
        const html = await $.get(`${extensionFolderPath}/plugin.html`);
        if ($("#st-story-helper").length > 0) $("#st-story-helper").remove();
        $("body").append(html);
        const $panel = $("#st-story-helper");
        $panel.css("display", "none");
        $("#sh-close").off().on("click", () => $panel.fadeOut(200));
        if ($panel.draggable) $panel.draggable({ handle: ".sh-header", containment: "window" });
        bindPanelEvents();
    } catch (err) { console.error(err); }
}

function createToolbarButton() {
    $("#sh-toggle-btn").remove();
    const buttonHtml = `<div id="sh-toggle-btn" class="qr--button menu_button" title="剧情助手"><div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;"><path d="M9 18h6M10 21h4M12 2a6 6 0 0 0-4 10c0 2 1 3 1 4h6c0-1 1-2 1-4a6 6 0 0 0-4-10z"></path></svg></div></div>`;
    let $target = $("#qr--bar");
    if ($target.length === 0) {
        $("#send_textarea").closest('#send_form').prepend('<div class="flex-container flexGap5" id="qr--bar"></div>');
        $target = $("#qr--bar");
    }
    $target.append(buttonHtml);
    $(document).off("click", "#sh-toggle-btn").on("click", "#sh-toggle-btn", (e) => {
        e.preventDefault();
        const $panel = $("#st-story-helper");
        if ($panel.is(":visible")) $panel.fadeOut(200);
        else $panel.css("display", "flex").hide().fadeIn(200);
    });
}

// 启动
jQuery(async () => {
    setTimeout(async () => {
        injectStyles();
        await loadStoryHelperUI();
        createToolbarButton();
        console.log(`[${extensionName}] 就绪`);
    }, 1000);
});
