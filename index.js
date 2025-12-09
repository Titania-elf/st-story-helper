// index.js - 遵循 ST 标准流版
// 逻辑：前端 -> ST 后端 (代理) -> OpenAI/反代 -> ST 后端 -> 前端

const extensionName = "st-story-helper";
const LS_KEY = 'story-helper-prompt';

// 自动获取路径
const scriptPath = document.currentScript ? document.currentScript.src : import.meta.url;
const extensionFolderPath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));

console.log(`[${extensionName}] 插件启动 - 标准代理模式`);

// -------------------------------------------------------
// 1. 核心生成逻辑 (利用 ST 后端代理)
// -------------------------------------------------------

/**
 * 获取 CSRF Token (最关键的一步，必须拿到这个才能调用 ST 后端)
 */
function getCsrfToken() {
    // 1. 从 Meta 标签拿 (新版 ST 标准)
    let token = $('meta[name="csrf-token"]').attr('content');
    
    // 2. 从全局变量拿 (旧版 ST)
    if (!token && window.csrfToken) token = window.csrfToken;
    
    // 3. 从 jQuery 全局配置拿
    if (!token && $.ajaxSettings && $.ajaxSettings.headers) {
        token = $.ajaxSettings.headers['X-CSRF-Token'];
    }
    
    return token;
}

/**
 * 发送请求
 * 核心思想：我不直接连 OpenAI，我让 ST 后端帮我连
 */
async function sendToModel(fullPrompt) {
    console.log(`[${extensionName}] 正在委托 ST 后端生成...`);

    // 1. 确保 CSRF Token 存在
    const token = getCsrfToken();
    if (!token) {
        console.warn("⚠️ 未找到 CSRF Token，请求可能会被 ST 拒绝 (403)。");
    }

    // 2. 构造请求参数
    // quiet: true 是核心。这意味着 "静默生成"，ST 不会把它显示在聊天框里，
    // 而是直接把结果返回给调用者（也就是我们的插件）。
    // 并且 ST 会自动使用你当前在 "API设置" 里填写的反代地址和 Key。
    const payload = {
        prompt: fullPrompt,
        quiet: true,           // 关键：静默模式
        use_story: false,      // 不受当前聊天记录干扰（我们已经在 prompt 里手动加了）
        use_memory: false,
        use_authors_note: false,
        use_world_info: false
    };

    // 3. 使用 jQuery.ajax 发送
    // 为什么要用 jQuery？因为 ST 也是用的 jQuery，它会自动处理 Cookie 和 Session。
    return new Promise((resolve, reject) => {
        $.ajax({
            url: '/api/generate',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            headers: {
                'X-CSRF-Token': token // 必须带上这个
            },
            success: function(data) {
                console.log(`[${extensionName}] ST 后端返回成功:`, data);
                
                // 解析各种可能的返回格式
                // 1. 文本补全模式返回结构
                if (data.results && data.results[0]) {
                    resolve(data.results[0].text);
                    return;
                }
                // 2. 聊天补全模式 (OpenAI/Claude) 返回结构
                if (data.choices && data.choices[0]) {
                    const content = data.choices[0].message?.content || data.choices[0].text;
                    resolve(content);
                    return;
                }
                // 3. 简单结构
                if (data.text) {
                    resolve(data.text);
                    return;
                }
                
                resolve(JSON.stringify(data));
            },
            error: function(xhr, status, error) {
                console.error(`[${extensionName}] ST 后端报错:`, status, error);
                
                let errMsg = "未知错误";
                if (xhr.status === 403) errMsg = "403 禁止访问 (CSRF 校验失败，请刷新页面)";
                else if (xhr.status === 500) errMsg = "500 服务器错误 (请检查 ST 控制台日志)";
                else if (xhr.responseJSON && xhr.responseJSON.error) {
                    errMsg = xhr.responseJSON.error.message || xhr.responseJSON.error;
                }
                
                reject(new Error(errMsg));
            }
        });
    });
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
    return document.querySelector('#send_textarea') || 
           document.querySelector('textarea[aria-label="Message"]');
}

function writeToSTInput(text) {
    const stInput = findSTInput();
    if (stInput) {
        // 模拟 React 输入事件
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeInputValueSetter.call(stInput, text);
        stInput.dispatchEvent(new Event('input', { bubbles: true }));
        stInput.dispatchEvent(new Event('change', { bubbles: true }));
        stInput.focus();
        return true;
    }
    return false;
}

// 提取上下文
function extractRecentChatHistory(maxItems = 20) {
    const chatContainer = document.querySelector('#chat');
    if (!chatContainer) return [];
    
    // 只获取显示的文本
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
            // 克隆以避免破坏 DOM
            const clone = textNode.cloneNode(true);
            // 移除干扰元素
            clone.querySelectorAll('.mes_buttons, .timestamp, .mes_edit_clone, .conf_div').forEach(b => b.remove());
            let text = clone.innerText.trim();
            // 清理 deepseek 思考过程
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
Output exactly 4 distinct plot options numbered 1 to 4.
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

    // 隐藏之前的设置按钮，因为现在自动使用 ST 连接
    $("#sh-settings-toggle").hide();

    $("#sh-load-sample").off().on("click", () => {
        if (promptEl) promptEl.value = "请基于上文，写出 4 种不同的剧情后续发展（每条 30-50 字）。";
    });

    $("#sh-generate").off().on("click", async () => {
        const promptText = promptEl ? promptEl.value.trim() : '';
        if (!promptText) return alert('请先填写提示词！');

        if (genStatus) genStatus.textContent = '请求中...';
        $("#sh-options").html('<div class="sh-empty"><span class="sh-spinner">⏳</span> 正在委托 ST 后台生成...</div>');

        try {
            let historyItems = [];
            const manualCtx = ctxEl ? ctxEl.value.trim() : '';
            if (manualCtx) {
                historyItems = [{ role: 'user', text: manualCtx }];
            } else {
                historyItems = extractRecentChatHistory(15);
            }

            const fullPayload = buildModelPayload(promptText, historyItems);
            
            // === 核心调用 ===
            const responseText = await sendToModel(fullPayload);

            const options = parseModelOptions(responseText);
            renderOptionsToPanel(options);
            
            if (genStatus) genStatus.textContent = '完成';

        } catch (err) {
            console.error(err);
            $("#sh-options").html(`<div class="sh-empty" style="color:#ff6b6b">生成错误: ${err.message}</div>`);
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
        if ($panel.is(":visible")) {
            $panel.fadeOut(200);
        } else {
            $panel.css("display", "flex").hide().fadeIn(200);
        }
    });
}

// -------------------------------------------------------
// 5. 启动循环 (确保 jQuery 已加载)
// -------------------------------------------------------

function waitForST() {
    let checks = 0;
    const interval = setInterval(() => {
        checks++;
        // 我们只需要 jQuery 存在，并且 DOM 解析完毕
        if (window.jQuery && document.querySelector('#send_textarea')) {
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

// 使用 jQuery 的 document.ready 保证环境安全
jQuery(() => waitForST());
