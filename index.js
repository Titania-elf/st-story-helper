// plugin.js - 剧情助手 (独立 API 版) - SillyTavern后端代理模式

class StoryHelperPlugin {
    constructor() {
        this.apiConfig = {
            provider: 'openai_test',
            url: '',
            key: '',
            model: 'gpt-3.5-turbo'
        };
        this.isGenerating = false;
        this.currentResponse = null;
        
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
        
        this.loadSavedConfig();
        this.loadSavedPrompt();
    }

    setupEventListeners() {
        document.getElementById('sh-settings-toggle').addEventListener('click', () => {
            const panel = document.getElementById('sh-settings-panel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('sh-close').addEventListener('click', () => {
            document.getElementById('st-story-helper').style.display = 'none';
        });

        document.getElementById('sh-save-settings').addEventListener('click', () => {
            this.saveApiConfig();
        });

        document.getElementById('sh-save-prompt').addEventListener('click', () => {
            this.savePrompt();
        });

        document.getElementById('sh-load-sample').addEventListener('click', () => {
            this.loadSamplePrompt();
        });

        document.getElementById('sh-generate').addEventListener('click', () => {
            this.generateStory();
        });

        document.getElementById('sh-apply-to-st').addEventListener('click', () => {
            this.applyToST();
        });

        document.getElementById('sh-clear-preview').addEventListener('click', () => {
            document.getElementById('sh-target-preview').value = '';
        });
    }

    loadSavedConfig() {
        try {
            const saved = localStorage.getItem('story_helper_config');
            if (saved) {
                this.apiConfig = JSON.parse(saved);
                document.getElementById('sh-api-url').value = this.apiConfig.url || '';
                document.getElementById('sh-api-key').value = this.apiConfig.key || '';
                document.getElementById('sh-api-model').value = this.apiConfig.model || 'gpt-3.5-turbo';
            }
        } catch (e) {
            console.warn('加载配置失败:', e);
        }
    }

    saveApiConfig() {
        const url = document.getElementById('sh-api-url').value.trim();
        const key = document.getElementById('sh-api-key').value.trim();
        const model = document.getElementById('sh-api-model').value.trim();

        if (!url || !key) {
            this.updateStatus('sh-prompt-status', '请填写完整的API配置', 'error');
            return;
        }

        this.apiConfig = { 
            provider: 'openai_test', 
            url, 
            key, 
            model 
        };
        
        try {
            localStorage.setItem('story_helper_config', JSON.stringify(this.apiConfig));
            this.updateStatus('sh-prompt-status', '配置保存成功', 'success');
        } catch (e) {
            this.updateStatus('sh-prompt-status', '保存失败: ' + e.message, 'error');
        }
    }

    loadSavedPrompt() {
        try {
            const saved = localStorage.getItem('story_helper_prompt');
            if (saved) {
                document.getElementById('sh-prompt').value = saved;
            }
        } catch (e) {
            console.warn('加载提示词失败:', e);
        }
    }

    savePrompt() {
        const prompt = document.getElementById('sh-prompt').value;
        try {
            localStorage.setItem('story_helper_prompt', prompt);
            this.updateStatus('sh-prompt-status', '提示词保存成功', 'success');
        } catch (e) {
            this.updateStatus('sh-prompt-status', '提示词保存失败', 'error');
        }
    }

    loadSamplePrompt() {
        const sample = `请根据以下上下文生成剧情走向：

上下文：
{{context}}

要求：
1. 剧情发展合理
2. 保持连贯性
3. 增加戏剧冲突
4. 字数200-300字

生成剧情：`;
        
        document.getElementById('sh-prompt').value = sample;
        this.updateStatus('sh-prompt-status', '示例已载入', 'info');
    }

    updateStatus(elementId, message, type = 'info') {
        const element = document.getElementById(elementId);
        element.textContent = message;
        element.className = `sh-note ${type}`;
        
        setTimeout(() => {
            if (element.textContent === message) {
                element.textContent = '';
                element.className = 'sh-note';
            }
        }, 3000);
    }

    async getContext() {
        const contextInput = document.getElementById('sh-context').value.trim();
        if (contextInput) {
            return contextInput;
        }

        try {
            // 尝试获取ST聊天记录
            if (window.SB && window.SB.chat) {
                const chat = window.SB.chat;
                if (Array.isArray(chat)) {
                    const recentMessages = chat.slice(-5);
                    return recentMessages.map(msg => 
                        `${msg.name || 'Unknown'}: ${msg.mes || ''}`
                    ).join('\n');
                }
            }
        } catch (e) {
            console.warn('获取聊天记录失败:', e);
        }
        
        return '暂无上下文';
    }

    async generateStory() {
        if (this.isGenerating) {
            this.updateStatus('sh-gen-status', '生成中...', 'warning');
            return;
        }

        const prompt = document.getElementById('sh-prompt').value.trim();
        if (!prompt) {
            this.updateStatus('sh-gen-status', '请输入提示词', 'error');
            return;
        }

        if (!this.apiConfig.url || !this.apiConfig.key) {
            this.updateStatus('sh-gen-status', '请先配置API', 'error');
            return;
        }

        this.isGenerating = true;
        this.updateStatus('sh-gen-status', '生成中...', 'info');

        try {
            const context = await this.getContext();
            const finalPrompt = prompt.replace('{{context}}', context);

            const requestBody = {
                model: this.apiConfig.model,
                messages: [{ role: 'user', content: finalPrompt }],
                temperature: 0.7,
                max_tokens: 500
            };

            // 通过SillyTavern后端代理调用
            const response = await this.callSillyTavernBackend(requestBody);
            
            if (response && response.choices && response.choices.length > 0) {
                const generatedText = response.choices[0].message.content;
                this.currentResponse = generatedText;
                
                document.getElementById('sh-target-preview').value = generatedText;
                this.updateStatus('sh-gen-status', '生成成功', 'success');
                
                this.updateOptions(generatedText);
            } else {
                throw new Error('API返回格式错误');
            }
        } catch (error) {
            console.error('生成失败:', error);
            this.updateStatus('sh-gen-status', `生成失败: ${error.message}`, 'error');
        } finally {
            this.isGenerating = false;
        }
    }

    async callSillyTavernBackend(requestBody) {
        // 使用SillyTavern的API代理功能
        const response = await fetch('/api/llm/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': this.apiConfig.key
            },
            body: JSON.stringify({
                url: this.apiConfig.url,
                model: this.apiConfig.model,
                messages: requestBody.messages,
                temperature: requestBody.temperature,
                max_tokens: requestBody.max_tokens
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    updateOptions(responseText) {
        const optionsContainer = document.getElementById('sh-options');
        optionsContainer.innerHTML = '';
        
        const parts = responseText.split(/(?<!\n)\n(?!\n)|[。！？]/).filter(p => p.trim().length > 10);
        
        if (parts.length === 0) {
            optionsContainer.innerHTML = '<div class="sh-empty">无可用选项</div>';
            return;
        }

        parts.slice(0, 5).forEach((part, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'sh-option';
            optionDiv.textContent = part.length > 80 ? part.substring(0, 80) + '...' : part;
            optionDiv.title = part;
            
            optionDiv.addEventListener('click', () => {
                document.getElementById('sh-target-preview').value = part.trim();
                document.querySelectorAll('.sh-option').forEach(opt => {
                    opt.style.background = 'rgba(255,255,255,0.05)';
                });
                optionDiv.style.background = 'rgba(111, 141, 246, 0.2)';
            });
            
            optionsContainer.appendChild(optionDiv);
        });
    }

    applyToST() {
        if (!this.currentResponse) {
            this.updateStatus('sh-last', '没有内容可填入', 'warning');
            return;
        }

        try {
            // 尝试多个可能的输入框选择器
            const selectors = [
                '#send_textarea',
                '.chat-input textarea',
                'textarea[name="send_text"]',
                '.textarea_send_message',
                '#chat-input-textarea'
            ];
            
            let inputBox = null;
            for (const selector of selectors) {
                inputBox = document.querySelector(selector);
                if (inputBox) break;
            }
            
            if (inputBox) {
                inputBox.value = this.currentResponse;
                inputBox.dispatchEvent(new Event('input', { bubbles: true }));
                this.updateStatus('sh-last', '已填入输入框', 'success');
            } else {
                this.updateStatus('sh-last', '未找到输入框', 'error');
            }
        } catch (error) {
            this.updateStatus('sh-last', '填入失败: ' + error.message, 'error');
        }
    }

    show() {
        document.getElementById('st-story-helper').style.display = 'flex';
    }

    hide() {
        document.getElementById('st-story-helper').style.display = 'none';
    }
}

// 初始化插件
let storyHelper = null;

function initStoryHelper() {
    if (storyHelper === null) {
        storyHelper = new StoryHelperPlugin();
    }
    
    window.StoryHelper = storyHelper;
}

// 页面加载完成后初始化
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initStoryHelper();
} else {
    document.addEventListener('DOMContentLoaded', initStoryHelper);
}

// 为ST扩展系统提供接口
if (typeof window.SB !== 'undefined' && window.SB.extensions) {
    window.SB.extensions.storyHelper = {
        init: initStoryHelper,
        getInstance: () => storyHelper
    };
}
