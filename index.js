// index.js - 反代专用修复版
// 专门解决 CORS 跨域和 CSRF 403 问题

const extensionName = "st-story-helper";
const LS_KEY = 'story-helper-prompt';

// 自动获取插件路径
const scriptPath = document.currentScript ? document.currentScript.src : import.meta.url;
const extensionFolderPath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));

console.log(`[${extensionName}] 插件启动 (Proxy Fix Mode)`);

// -------------------------------------------------------
// 1. 核心生成逻辑 (通过 ST 后台转发)
// -------------------------------------------------------

/**
 * 暴力获取 CSRF Token (这是解决 403 的关键)
 */
function getCsrfToken() {
    // 1. 尝试从全局变量获取 (ST 常用)
    if (typeof window.csrfToken !== 'undefined') return window.csrfToken;
    
    // 2. 尝试从 Meta 标签获取 (新版 ST)
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    
    // 3. 尝试从 Cookie 解析 (旧版 ST)
    const match = document.cookie.match(new RegExp('(^| )X-CSRF-Token=([^;]+)'));
    if (match) return match[2];

    // 4. 尝试从 jQuery 全局配置获取
    if (window.jQuery && window.jQuery.ajaxSettings && window.jQuery.ajaxSettings.headers) {
        return window.jQuery.ajaxSettings.headers['X-CSRF-Token'];
    }

    console.warn(`[${extensionName}] 未找到 CSRF Token，请求可能会失败。`);
    return '';
}

/**
 * 发送请求
 */
async function sendToModel(fullPrompt) {
    console.log(`[${extensionName}] 准备通过 ST 后台转发请求...`);

    // 1. 组装最简参数
    // quiet: true 告诉 ST "这是后台任务，用你现在配置好的 API 设置去跑，别问我参数"
    const payload = {
        prompt: fullPrompt,
        quiet: true,
        use_story: false,
        use_memory: false,
        use_authors_note: false,
        use_world_info: false
    };

    // 2. 获取 Token
    const token = getCsrfToken();

    // 3. 发送请求 (使用 fetch，手动带上凭证)
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            // 关键：include 确保带上 Cookie，否则反代模式下 ST 会认为你没登录
            credentials: 'include', 
            body: JSON.stringify(payload)
        });

        // 处理 HTTP 错误
        if (!response.ok) {
            const errText = await response.text();
            if (response.status === 403) {
                throw new Error("403 禁止访问：CSRF 校验失败。请刷新页面重试。");
            }
            if (response.status === 500 || response.status === 400) {
                // 尝试解析错误里的具体信息
                try {
                    const errJson = JSON.parse(errText);
                    if (errJson.error && errJson.error.message) {
                        throw new Error(`API 报错: ${errJson.error.message}`);
                    }
                } catch(e) {}
                throw new Error(`反代服务器报错 (${response.status})。请检查 API 连接。`);
            }
            throw new Error(`请求失败: ${response.status} ${response.statusText}`);
        }

        // 4. 解析结果
        const data = await response.json();
        console.log(`[${extensionName}] 收到数据:`, data);

        // 兼容各种反代的返回格式
        // 情况 A: 文本补全
        if (data.results && data.results[0] && data.results[0].text) {
            return data.results[0].text;
        }
        // 情况 B: 聊天补全 (OpenAI 格式)
        if (data.choices && data.choices[0]) {
            if (data.choices[0].message && data.choices[0].message.content) {
                return data.choices[0].message.content;
            }
            if (data.choices[0].text) {
                return data.choices[0].text;
            }
        }
        // 情况 C: 简单对象
        if (data.text) return data.text;

        // 情况 D: 纯字符串
        if (typeof data === 'string') return data;

        return JSON.stringify(data);

    } catch (err) {
        console.error(err);
        throw err;
    }
}

// -------------------------------------------------------
// 2. 辅助工具 (无变化)
// -------------------------------------------------------

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeText(node) {
    return node ? (node.textContent || node.innerText || '').trim() : '';
}

function findSTInput() {
    // 暴力查找
    const candidates = [
        '#send_textarea',
        'textarea[aria-label="Message"]',
        '.composer textarea',
        '#chat_input_form textarea'
    ];
    for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

function writeToSTInput(text) {
    const stInput = findSTInput();
    if (stInput) {
        // React/Vue 兼容性写入
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
    const messageNodes = Array.from(chatContainer.querySelectorAll('.mes'));
    const results = [];
    for (let i = messageNodes.length - 1; i >= 0 && results.length < maxItems; i--) {
        const node = messageNodes[i];
        if (node.style.display === 'none') continue;
        let role = 'user';
        if (node.getAttribute('is_user') === 'false' || node.classList.contains('not_user')) {
            role = 'assistant';
        }
        const textNode = node.querySelector('.mes_text');
        if (textNode) {
            const clone = textNode.cloneNode(true);
            clone.querySelectorAll('.mes_buttons, .timestamp, .mes_edit_clone, .conf_div').forEach(b => b.remove());
            let text = safeText(clone);
            text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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
Output 4 distinct options numbered 1 to 4.
1. ...
2. ...
3. ...
4. ...
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
            alert("已保存");
        }
    });

    // 隐藏设置按钮，因为现在走 ST 内部
    $("#sh-settings-toggle").hide();

    $("#sh-load-sample").off().on("click", () => {
        if (promptEl) promptEl.value = "请基于上文，写出 4 种不同的剧情后续发展（每条 30-50 字）。";
    });

    $("#sh-fill-sample").off().on("click", () => {
        if (ctxEl) ctxEl.value = "User: 开门。\nAssistant: 里面很黑。";
    });

    $("#sh-generate").off().on("click", async () => {
        const promptText = promptEl ? promptEl.value.trim() : '';
        if (!promptText) {
            alert('请先填写提示词！');
            return;
        }
        if (genStatus) genStatus.textContent = '请求中...';
        $("#sh-options").html('<div class="sh-empty"><span class="sh-spinner">⏳</span> 正在生成...</div>');
        try {
            let historyItems = [];
            const manualCtx = ctxEl ? ctxEl.value.trim() : '';
            if (manualCtx) historyItems = [{ role: 'user', text: manualCtx }];
            else historyItems = extractRecentChatHistory(15);

            const fullPayload = buildModelPayload(promptText, historyItems);
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

function waitForST() {
    let checks = 0;
    const interval = setInterval(() => {
        checks++;
        // 只要 ST 变量存在即可，不需要等待完全就绪，我们自己发请求
        if (window.SillyTavern || window.jQuery) {
            clearInterval(interval);
            console.log(`[${extensionName}] 就绪。`);
            injectStyles();
            loadStoryHelperUI();
            createToolbarButton();
        } else if (checks >= 30) {
            clearInterval(interval);
            injectStyles();
            loadStoryHelperUI();
            createToolbarButton();
        }
    }, 1000);
}

jQuery(() => waitForST());
