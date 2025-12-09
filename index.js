// plugin.js - 剧情助手 (独立 API 版) - 完整实现

class StoryHelperPlugin {
    constructor() {
        this.apiConfig = {
            url: '',
            key: '',
            model: 'gpt-3.5-turbo'
        };
        this.promptHistory = [];
        this.currentResponse = null;
        this.isGenerating = false;
        
        this.init();
    }

    init() {
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
        
        // 加载保存的配置
        this.loadSavedConfig();
        this.loadSavedPrompt();
    }

    setupEventListeners() {
        // 设置面板切换
        document.getElementById('sh-settings-toggle').addEventListener('click', () => {
            const panel = document.getElementById('sh-settings-panel');
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';
        });

        // 关闭按钮
        document.getElementById('sh-close').addEventListener('click', () => {
            document.getElementById('st-story-helper').style.display = 'none';
        });

        // 保存设置
        document.getElementById('sh-save-settings').addEventListener('click', () => {
            this.saveApiConfig();
        });

        // 保存提示词
        document.getElementById('sh-save-prompt').addEventListener('click', () => {
            this.savePrompt();
        });

        // 载入示例
        document.getElementById('sh-load-sample').addEventListener('click', () => {
            this.loadSamplePrompt();
        });

        // 生成按钮
        document.getElementById('sh-generate').addEventListener('click', () => {
            this.generateStory();
        });

        // 填入输入框
        document.getElementById('sh-apply-to-st').addEventListener('click', () => {
            this.applyToST();
        });

        // 清空预览
        document.getElementById('sh-clear-preview').addEventListener('click', () => {
            document.getElementById('sh-target-preview').value = '';
        });
    }

    // 加载保存的配置
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
            console.warn('无法加载保存的配置:', e);
        }
    }

    // 保存API配置
    saveApiConfig() {
        const url = document.getElementById('sh-api-url').value.trim();
        const key = document.getElementById('sh-api-key').value.trim();
        const model = document.getElementById('sh-api-model').value.trim();

        if (!url || !key) {
            this.updateStatus('sh-prompt-status', '请填写完整的API配置信息', 'error');
            return;
        }

        this.apiConfig = { url, key, model };
        
        try {
            localStorage.setItem('story_helper_config', JSON.stringify(this.apiConfig));
            this.updateStatus('sh-prompt-status', '配置保存成功', 'success');
        } catch (e) {
            this.updateStatus('sh-prompt-status', '配置保存失败: ' + e.message, 'error');
        }
    }

    // 加载保存的提示词
    loadSavedPrompt() {
        try {
            const saved = localStorage.getItem('story_helper_prompt');
            if (saved) {
                document.getElementById('sh-prompt').value = saved;
            }
        } catch (e) {
            console.warn('无法加载保存的提示词:', e);
        }
    }

    // 保存提示词
    savePrompt() {
        const prompt = document.getElementById('sh-prompt').value;
        try {
            localStorage.setItem('story_helper_prompt', prompt);
            this.updateStatus('sh-prompt-status', '提示词保存成功', 'success');
        } catch (e) {
            this.updateStatus('sh-prompt-status', '提示词保存失败: ' + e.message, 'error');
        }
    }

    // 载入示例提示词
    loadSamplePrompt() {
        const samplePrompt = `请根据以下上下文生成一个引人入胜的剧情走向：

上下文：
{{context}}

要求：
1. 剧情发展要合理且有逻辑
2. 保持故事的连贯性
3. 可以适当增加戏剧冲突
4. 字数控制在200-300字

生成的剧情：`;
        
        document.getElementById('sh-prompt').value = samplePrompt;
        this.updateStatus('sh-prompt-status', '示例提示词已载入', 'info');
    }

    // 更新状态显示
    updateStatus(elementId, message, type = 'info') {
        const element = document.getElementById(elementId);
        element.textContent = message;
        element.className = `sh-note ${type}`;
        
        // 3秒后清除状态消息
        setTimeout(() => {
            if (element.textContent === message) {
                element.textContent = '';
                element.className = 'sh-note';
            }
        }, 3000);
    }

    // 获取上下文
    async getContext() {
        const contextInput = document.getElementById('sh-context').value.trim();
        if (contextInput) {
            return contextInput;
        }

        // 尝试从SillyTavern获取最近的聊天记录
        try {
            // 这里假设可以通过SillyTavern的API获取聊天记录
            if (window.SB && window.SB.chat) {
                // 获取最近几条消息作为上下文
                const chat = window.SB.chat;
                let context = '';
                
                // 获取最近的聊天消息
                if (Array.isArray(chat)) {
                    const recentMessages = chat.slice(-5); // 获取最后5条消息
                    context = recentMessages.map(msg => 
                        `${msg.name || 'Unknown'}: ${msg.mes || ''}`
                    ).join('\n');
                }
                
                return context || '暂无聊天记录';
            }
        } catch (e) {
            console.warn('无法获取聊天记录作为上下文:', e);
        }
        
        return '暂无聊天记录';
    }

    // 生成故事
    async generateStory() {
        if (this.isGenerating) {
            this.updateStatus('sh-gen-status', '正在生成中，请稍候...', 'warning');
            return;
        }

        const prompt = document.getElementById('sh-prompt').value.trim();
        if (!prompt) {
            this.updateStatus('sh-gen-status', '请先输入提示词', 'error');
            return;
        }

        if (!this.apiConfig.url || !this.apiConfig.key) {
            this.updateStatus('sh-gen-status', '请先配置API信息', 'error');
            return;
        }

        this.isGenerating = true;
        this.updateStatus('sh-gen-status', '生成中...', 'info');

        try {
            const context = await this.getContext();
            const finalPrompt = prompt.replace('{{context}}', context);

            // 构建API请求
            const requestBody = {
                model: this.apiConfig.model || 'gpt-3.5-turbo',
                messages: [
                    { role: 'user', content: finalPrompt }
                ],
                temperature: 0.7,
                max_tokens: 500
            };

            // 通过SillyTavern后端代理发送请求
            const response = await this.callSillyTavernAPI(requestBody);
            
            if (response && response.choices && response.choices.length > 0) {
                const generatedText = response.choices[0].message.content;
                this.currentResponse = generatedText;
                
                // 更新预览区域
                document.getElementById('sh-target-preview').value = generatedText;
                this.updateStatus('sh-gen-status', '生成成功', 'success');
                
                // 更新选项区域
                this.updateOptions(generatedText);
            } else {
                throw new Error('API返回格式不正确');
            }
        } catch (error) {
            console.error('生成失败:', error);
            this.updateStatus('sh-gen-status', `生成失败: ${error.message}`, 'error');
        } finally {
            this.isGenerating = false;
        }
    }

    // 通过SillyTavern后端代理调用API
    async callSillyTavernAPI(requestBody) {
        // 构建符合SillyTavern后端代理格式的请求
        const proxyRequest = {
            url: this.apiConfig.url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiConfig.key}`
            },
            method: 'POST',
            body: requestBody
        };

        try {
            // 发送到SillyTavern后端代理
            const response = await fetch('/api/proxy/openai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(proxyRequest)
            });

            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            // 如果标准代理路径失败，尝试其他可能的路径
            console.warn('标准代理路径失败，尝试备用路径:', error);
            
            try {
                // 尝试使用SillyTavern的通用API代理
                const altResponse = await fetch('/api/openai/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: this.apiConfig.url,
                        headers: {
                            'Authorization': `Bearer ${this.apiConfig.key}`
                        },
                        body: requestBody
                    })
                });

                if (!altResponse.ok) {
                    throw new Error(`备用路径HTTP错误: ${altResponse.status}`);
                }

                return await altResponse.json();
            } catch (altError) {
                console.error('所有代理路径都失败:', altError);
                throw new Error(`API调用失败: ${altError.message}`);
            }
        }
    }

    // 更新选项区域
    updateOptions(responseText) {
        const optionsContainer = document.getElementById('sh-options');
        optionsContainer.innerHTML = '';
        
        // 简单地将响应文本按段落分割为选项
        const paragraphs = responseText.split('\n').filter(p => p.trim().length > 0);
        
        if (paragraphs.length === 0) {
            optionsContainer.innerHTML = '<div class="sh-empty">无可用选项</div>';
            return;
        }

        paragraphs.forEach((paragraph, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'sh-option';
            optionDiv.textContent = paragraph.length > 100 ? paragraph.substring(0, 100) + '...' : paragraph;
            optionDiv.title = paragraph;
            
            optionDiv.addEventListener('click', () => {
                document.getElementById('sh-target-preview').value = paragraph;
                // 高亮选中的选项
                document.querySelectorAll('.sh-option').forEach(opt => {
                    opt.style.background = 'rgba(255,255,255,0.05)';
                });
                optionDiv.style.background = 'rgba(111, 141, 246, 0.2)';
            });
            
            optionsContainer.appendChild(optionDiv);
        });
    }

    // 填入SillyTavern输入框
    applyToST() {
        if (!this.currentResponse) {
            this.updateStatus('sh-last', '没有可填入的内容', 'warning');
            return;
        }

        try {
            // 尝试将内容填入SillyTavern的输入框
            const inputBox = document.querySelector('#send_textarea') || 
                           document.querySelector('.chat-input textarea') ||
                           document.querySelector('textarea[name="send_text"]');
            
            if (inputBox) {
                inputBox.value = this.currentResponse;
                // 触发输入事件以更新UI
                inputBox.dispatchEvent(new Event('input', { bubbles: true }));
                inputBox.dispatchEvent(new Event('change', { bubbles: true }));
                
                this.updateStatus('sh-last', '已填入输入框', 'success');
            } else {
                this.updateStatus('sh-last', '未找到输入框', 'error');
            }
        } catch (error) {
            this.updateStatus('sh-last', '填入失败: ' + error.message, 'error');
        }
    }

    // 显示插件面板
    show() {
        document.getElementById('st-story-helper').style.display = 'flex';
    }

    // 隐藏插件面板
    hide() {
        document.getElementById('st-story-helper').style.display = 'none';
    }
}

// 初始化插件
let storyHelper = null;

// 等待SillyTavern环境就绪
function initStoryHelper() {
    if (storyHelper === null) {
        storyHelper = new StoryHelperPlugin();
    }
    
    // 提供全局访问接口
    window.StoryHelper = storyHelper;
}

// 如果SillyTavern环境已就绪，立即初始化
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initStoryHelper();
} else {
    document.addEventListener('DOMContentLoaded', initStoryHelper);
}

// 也可以通过ST的扩展机制初始化
if (typeof window.SB !== 'undefined' && window.SB.extensions) {
    window.SB.extensions.storyHelper = {
        init: initStoryHelper,
        getInstance: () => storyHelper
    };
}
