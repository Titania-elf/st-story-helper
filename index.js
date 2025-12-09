// index.js - 模仿原生行为版
// 利用 ST 内置的 jQuery 直接调用后端接口，这是最“原生”的方式，肯定能通

const extensionName = "st-story-helper";
const LS_KEY = 'story-helper-prompt';

const scriptPath = document.currentScript ? document.currentScript.src : import.meta.url;
const extensionFolderPath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));

console.log(`[${extensionName}] 插件启动 (Native jQuery Mode)`);

// -------------------------------------------------------
// 1. 核心生成逻辑
// -------------------------------------------------------

async function sendToModel(fullPrompt) {
    console.log(`[${extensionName}] 正在请求生成...`);

    // 1. 获取 CSRF Token (这是唯一的安全门槛)
    // ST 通常把 token 放在全局变量或 meta 标签里
    let token = '';
    if (typeof window.csrfToken !== 'undefined') token = window.csrfToken;
    else if (document.querySelector('meta[name="csrf-token"]')) token = document.querySelector('meta[name="csrf-token"]').content;
    
    // 2. 准备参数
    // quiet: true 是核心，告诉 ST "别说话，悄悄帮我跑个提示词，别存进聊天记录"
    const payload = {
        prompt: fullPrompt,
        quiet: true,
        use_story: false,
        use_memory: false,
        use_authors_note: false,
        use_world_info: false
    };

    try {
        // 3. 使用 jQuery.ajax (核心！)
        // SillyTavern 全局配置了 jQuery，它会自动携带 Cookie，解决 403 问题
        const response = await $.ajax({
            url: '/api/generate',
            type: 'POST',
            dataType: 'json',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            headers: {
                'X-CSRF-Token': token // 手动补全 Token，双重保险
            },
            xhrFields: {
                withCredentials: true // 强制带 Cookie
            }
        });

        // 4. 解析结果 (ST 后端会帮我们处理好格式)
        // 不管是 Chat 还是 Text 模式，ST 后端通常会标准化返回
        
        // 情况 A: 标准 Text 格式
        if (response.results && response.results[0]) {
            return response.results[0].text;
        }
        
        // 情况 B: 某些 Chat 模式透传
        if (response.choices && response.choices[0]) {
            return response.choices[0].message?.content || response.choices[0].text;
        }

        // 情况 C: 根目录 text
        if (response.text) return response.text;

        // 情况 D: 纯文本
        if (typeof response === 'string') return response;

        console.warn("未知返回格式:", response);
        return JSON.stringify(response);

    } catch (err) {
        console.error("生成失败:", err);
        
        // 解析错误信息给用户看
        let msg = "未知错误";
        if (err.responseJSON && err.responseJSON.error) {
            msg = err.responseJSON.error.message || JSON.stringify(err.responseJSON.error);
        } else if (err.statusText) {
            msg = err.statusText;
        }
        
        if (err.status === 403) msg += " (权限不足，请刷新页面)";
        if (err.status === 500) msg += " (反代/模型端报错)";
        
        throw new Error(msg);
    }
}

// -------------------------------------------------------
// 2. 辅助工具
// -------------------------------------------------------

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findSTInput() {
    return document.querySelector('#send_textarea') || 
           document.querySelector('textarea[aria-label="Message"]') ||
           document.querySelector('.composer textarea');
}

function writeToSTInput(text) {
    const stInput = findSTInput();
    if (stInput) {
        // 模拟用户输入，触发 React 更新
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeInputValueSetter.call(stInput, text);
        stInput.dispatchEvent(new Event('input', { bubbles: true }));
        stInput.dispatchEvent(new Event('change', { bubbles: true }));
        stInput.focus();
        return true;
    }
    return false;
}

function extractRecentChatHistory(maxItems = 20) {
    const chatContainer = document.querySelector('#chat');
    if (!chatContainer) return [];
    
    // 获取可见消息
    const messageNodes = Array.from(chatContainer.querySelectorAll('.mes')).filter(n => n.style.display !== 'none');
    const results = [];

    for (let i = messageNodes.length - 1; i >= 0 && results.length < maxItems; i--) {
        const node = messageNodes[i];
        let role = 'user';
        if (node.getAttribute('is_user') === 'false' || node.classList.contains('not_user')) {
            role = 'assistant';
        }

        const textNode = node.querySelector('.mes_text');
        if (textNode) {
            // 克隆节点以获取纯文本
            const clone = textNode.cloneNode(true);
            clone.querySelectorAll('.mes_buttons, .timestamp, .mes_edit_clone, .conf_div').forEach(b => b.remove());
            // 简单处理 <br> 为换行
            clone.innerHTML = clone.innerHTML.replace(/<br\s*\/?>/gi, '\n');
            const text = clone.innerText.trim();
            
            if (text) results.push({ role, text });
        }
    }
    return results.reverse();
}

function buildModelPayload(userPrompt, historyItems) {
    const historyText = historyItems.map(it => `${it.role.toUpperCase()}: ${it.text}`).join('\n');
    
    // Prompt 模板
    return `
[Context]
${historyText}

[System Instruction]
${userPrompt.trim()}

[Format]
Output exactly 4 distinct plot options numbered 1 to 4.
1. ...
2. ...
3. ...
4. ...
`.trim();
}

function parseModelOptions(text) {
    if (!text) return [];
    
    // 清理 DeepSeek 思维链
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const items = [];
    let current = null;
    
    // 匹配编号 1. 1) 1、
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

    // 容错：如果没有正则匹配到，按段落分
    if (items.length < 2) return text.split(/\n\s*\n/).filter(p => p.length > 5).slice(0, 4);
    
    return items.slice(0, 4);
}

// -------------------------------------------------------
// 3. UI 交互
// -------------------------------------------------------

function renderOptionsToPanel(optionTexts) {
    const optionsWrap = document.getElementById('sh-options');
    if (!optionsWrap) return;
    optionsWrap.innerHTML = '';
    
    if (!optionTexts || optionTexts.length === 0) {
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
    const promptEl = document.getElementById('sh-prompt');
    const ctxEl = document.getElementById('sh-context');
    const genStatus = document.getElementById('sh-gen-status');
    const savedPrompt = localStorage.getItem(LS_KEY);
    
    if (savedPrompt && promptEl) promptEl.value = savedPrompt;

    $("#sh-save-prompt").off().on("click", () => {
        if (promptEl) {
            localStorage.setItem(LS_KEY, promptEl.value);
            alert("提示词已保存");
        }
    });

    // 隐藏之前的设置按钮，因为现在自动使用 ST 连接
    $("#sh-settings-toggle").hide();

    $("#sh-load-sample").off().on("click", () => {
        if (promptEl) promptEl.value = "请基于上文，写出 4 种不同的剧情后续发展（每条 30-50 字）。";
    });

    $("#sh-fill-sample").off().on("click", () => {
        const history = extractRecentChatHistory(5);
        if (ctxEl) ctxEl.value = history.map(h => `${h.role}: ${h.text}`).join('\n') || "User: 开门。\nAssistant: 里面很黑。";
    });

    // === 生成按钮 ===
    $("#sh-generate").off().on("click", async () => {
        const promptText = promptEl ? promptEl.value.trim() : '';
        if (!promptText) return alert('请先填写提示词！');

        if (genStatus) genStatus.textContent = '请求中...';
        $("#sh-options").html('<div class="sh-empty"><span class="sh-spinner">⏳</span> 正在生成...</div>');

        try {
            let historyItems = [];
            const manualCtx = ctxEl ? ctxEl.value.trim() : '';
            if (manualCtx) {
                historyItems = [{ role: 'user', text: manualCtx }];
            } else {
                historyItems = extractRecentChatHistory(15);
            }

            const fullPayload = buildModelPayload(promptText, historyItems);
            
            // 调用模型
            const responseText = await sendToModel(fullPayload);

            const options = parseModelOptions(responseText);
            renderOptionsToPanel(options);
            
            if (genStatus) genStatus.textContent = '完成';

        } catch (err) {
            console.error(err);
            $("#sh-options").html(`<div class="sh-empty" style="color:#ff6b6b">错误: ${err.message}</div>`);
            if (genStatus) genStatus.textContent = '失败';
        }
    });

    $("#sh-apply-to-st").off().on("click", () => {
        const preview = document.getElementById('sh-target-preview');
        if (preview && preview.value) writeToSTInput(preview.value);
    });
    
    $("#sh-clear-preview").off().on("click", () => {
        $("#sh-target-preview").val("");
    });
}

// -------------------------------------------------------
// 4. 加载逻辑
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
        console.log(`[${extensionName}] UI 加载完成`);
    } catch (err) {
        console.error(`[${extensionName}] HTML 加载失败`, err);
    }
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

// -------------------------------------------------------
// 5. 启动
// -------------------------------------------------------

function waitForST() {
    let checks = 0;
    const interval = setInterval(() => {
        checks++;
        // 我们只需要 jQuery 和 ST 的基本变量存在即可
        // 不再需要等待 api 上下文，因为我们走的是 http 接口
        if (window.jQuery && window.SillyTavern) {
            clearInterval(interval);
            console.log(`[${extensionName}] 系统就绪。`);
            injectStyles();
            loadStoryHelperUI();
            createToolbarButton();
        } else if (checks >= 30) {
            clearInterval(interval);
            console.log(`[${extensionName}] 超时，尝试强制启动。`);
            injectStyles();
            loadStoryHelperUI();
            createToolbarButton();
        }
    }, 1000);
}

jQuery(() => waitForST());
