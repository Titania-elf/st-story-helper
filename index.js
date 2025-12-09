// index.js - 独立 API 请求版 (Select 下拉框适配版)

const extensionName = "st-story-helper";
const LS_KEY_PROMPT = 'sh_prompt';
const LS_KEY_API_URL = 'sh_api_url';
const LS_KEY_API_KEY = 'sh_api_key';
const LS_KEY_MODEL = 'sh_api_model';

const scriptPath = document.currentScript ? document.currentScript.src : import.meta.url;
const extensionFolderPath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));

console.log(`[${extensionName}] 插件启动 (Select UI Mode)`);

// -------------------------------------------------------
// 1. 核心生成逻辑
// -------------------------------------------------------

async function sendToModel(fullPrompt) {
    const apiUrl = localStorage.getItem(LS_KEY_API_URL);
    const apiKey = localStorage.getItem(LS_KEY_API_KEY);
    const model = localStorage.getItem(LS_KEY_MODEL);

    if (!apiUrl) throw new Error("请先点击右上角 ⚙️ 设置 API 地址！");

    let endpoint = apiUrl;
    if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/generate')) {
         if (endpoint.endsWith('/')) endpoint += 'chat/completions';
         else endpoint += '/chat/completions';
    }

    const payload = {
        model: model || "gpt-3.5-turbo",
        messages: [
            { role: "system", content: "You are a creative writing assistant." },
            { role: "user", content: fullPrompt }
        ],
        temperature: 0.7,
        stream: false
    };

    console.log(`[${extensionName}] 发送请求到: ${endpoint}`);

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
    }
    if (data.choices && data.choices[0] && data.choices[0].text) return data.choices[0].text;
    if (data.text) return data.text;
    
    return JSON.stringify(data);
}

// -------------------------------------------------------
// 2. 获取模型列表功能 (适配 Select)
// -------------------------------------------------------

async function fetchModelList() {
    const apiUrl = $("#sh-api-url").val().trim();
    const apiKey = $("#sh-api-key").val().trim();
    const refreshBtn = $("#sh-refresh-models");
    // 改动：直接操作 select 元素
    const selectBox = $("#sh-api-model");

    if (!apiUrl) return alert("请先填写 API 地址！");

    refreshBtn.text("...").prop("disabled", true);
    
    try {
        let modelsEndpoint = apiUrl;
        if (modelsEndpoint.includes("/chat/completions")) {
            modelsEndpoint = modelsEndpoint.replace("/chat/completions", "/models");
        } else if (modelsEndpoint.endsWith("/")) {
            modelsEndpoint += "models";
        } else {
            modelsEndpoint += "/models";
        }

        console.log(`[${extensionName}] 获取模型列表: ${modelsEndpoint}`);

        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const response = await fetch(modelsEndpoint, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        
        let models = [];
        if (data.data && Array.isArray(data.data)) {
            models = data.data.map(item => item.id);
        } else if (Array.isArray(data)) {
            models = data.map(item => item.id || item);
        }

        if (models.length === 0) throw new Error("未找到模型数据");

        models.sort();
        
        // 改动：清空 select 并重新填充 option
        selectBox.empty();
        models.forEach(m => {
            selectBox.append(`<option value="${m}">${m}</option>`);
        });

        // 尝试保持当前选择，或者选中第一个
        const currentModel = localStorage.getItem(LS_KEY_MODEL);
        if (currentModel && models.includes(currentModel)) {
            selectBox.val(currentModel);
        } else {
            selectBox.val(models[0]);
            // 自动保存新选中的模型
            localStorage.setItem(LS_KEY_MODEL, models[0]);
        }

        alert(`刷新成功！已加载 ${models.length} 个模型。`);

    } catch (err) {
        console.error("获取模型失败", err);
        alert(`获取失败: ${err.message}\n请检查 API 地址是否正确。`);
    } finally {
        refreshBtn.text("↻").prop("disabled", false);
    }
}

// -------------------------------------------------------
// 3. 辅助工具
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

// -------------------------------------------------------
// 4. UI 绑定
// -------------------------------------------------------

function bindPanelEvents() {
    const savedPrompt = localStorage.getItem(LS_KEY_PROMPT);
    if (savedPrompt) $("#sh-prompt").val(savedPrompt);
    
    // 加载设置
    $("#sh-api-url").val(localStorage.getItem(LS_KEY_API_URL) || '');
    $("#sh-api-key").val(localStorage.getItem(LS_KEY_API_KEY) || '');
    
    // 改动：初始化 Select
    const savedModel = localStorage.getItem(LS_KEY_MODEL) || 'gpt-3.5-turbo';
    const selectBox = $("#sh-api-model");
    
    // 初始化时，不管列表有没有获取，先保证有一个选项是当前的保存值
    selectBox.empty(); 
    selectBox.append(`<option value="${savedModel}">${savedModel}</option>`);
    selectBox.val(savedModel);

    $("#sh-settings-toggle").off().on("click", () => {
        $("#sh-settings-panel").slideToggle(200);
    });

    $("#sh-refresh-models").off().on("click", () => {
        fetchModelList();
    });

    // 改动：监听 select 变化，实时保存模型选择
    $("#sh-api-model").off().on("change", function() {
        localStorage.setItem(LS_KEY_MODEL, $(this).val());
    });

    $("#sh-save-settings").off().on("click", () => {
        localStorage.setItem(LS_KEY_API_URL, $("#sh-api-url").val().trim());
        localStorage.setItem(LS_KEY_API_KEY, $("#sh-api-key").val().trim());
        localStorage.setItem(LS_KEY_MODEL, $("#sh-api-model").val().trim()); // 这里的 .val() 对 select 也有效
        alert("设置已保存！");
        $("#sh-settings-panel").slideUp(200);
    });

    $("#sh-save-prompt").off().on("click", () => {
        localStorage.setItem(LS_KEY_PROMPT, $("#sh-prompt").val());
        alert("提示词已保存");
    });

    $("#sh-load-sample").off().on("click", () => {
        $("#sh-prompt").val("请基于上文，写出 4 种不同的剧情后续发展（每条 30-50 字）。");
    });

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
// 5. 加载
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

jQuery(async () => {
    setTimeout(async () => {
        injectStyles();
        await loadStoryHelperUI();
        createToolbarButton();
        console.log(`[${extensionName}] 就绪`);
    }, 1000);
});
